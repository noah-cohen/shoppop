targetScope = 'resourceGroup'

param location string = 'francecentral'
param environmentName string = 'sales-demo'
param administratorObjectId string
param administratorName string
@secure()
@minLength(12)
param adminPassword string
@description('Only the operator IP needed during database bootstrap; remove after deployment.')
param operatorIp string = ''
@description('Exact outbound IPv4 addresses of the deployed web app.')
param appOutboundIps array = []

var token = uniqueString(subscription().id, resourceGroup().id, environmentName)
var tags = { application: 'sale-calendar', environment: environmentName }
var databaseName = 'calendar'
var databaseUser = 'calendar_app'

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2025-01-31-preview' = {
  name: 'azid${token}'
  location: location
  tags: tags
}

resource vault 'Microsoft.KeyVault/vaults@2026-05-15' = {
  name: 'azkv${token}'
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 7
  }
}

resource adminSecret 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = {
  parent: vault
  name: 'admin-password'
  properties: { value: adminPassword }
}

resource secretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identity.id, 'secrets-user')
  scope: vault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}

resource operatorSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, administratorObjectId, 'secrets-officer')
  scope: vault
  properties: {
    principalId: administratorObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2026-10-01' = {
  name: 'azpg${token}'
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '17'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
    storage: { storageSizeGB: 32, autoGrow: 'Disabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource administrator 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2026-10-01' = {
  parent: postgres
  name: administratorObjectId
  properties: {
    principalName: administratorName
    principalType: 'User'
    tenantId: tenant().tenantId
  }
  dependsOn: [database, operatorFirewall, appFirewall]
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2026-10-01' = {
  parent: postgres
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource operatorFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2026-10-01' = if (!empty(operatorIp)) {
  parent: postgres
  name: 'bootstrap-operator'
  properties: { startIpAddress: operatorIp, endIpAddress: operatorIp }
}

resource appFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2026-10-01' = [for ip in appOutboundIps: {
  parent: postgres
  name: 'web-${replace(ip, '.', '-')}'
  properties: { startIpAddress: ip, endIpAddress: ip }
}]

resource plan 'Microsoft.Web/serverfarms@2025-03-01' = {
  name: 'azplan${token}'
  location: location
  tags: tags
  sku: { name: 'B1', tier: 'Basic', capacity: 1 }
  properties: { reserved: true }
}

// ponytail: one worker and in-process rate limits for this demo; add shared limits before scaling out.
resource web 'Microsoft.Web/sites@2025-03-01' = {
  name: 'shoppop'
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    keyVaultReferenceIdentity: identity.id
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'npm start'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/healthz'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'HOST', value: '0.0.0.0' }
        { name: 'COOKIE_SECURE', value: 'true' }
        { name: 'DEMO_MODE', value: 'true' }
        { name: 'DATABASE_AUTH', value: 'azure' }
        { name: 'DATABASE_URL', value: 'postgresql://${databaseUser}@${postgres.properties.fullyQualifiedDomainName}/${databaseName}' }
        { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
        { name: 'AZURE_TENANT_ID', value: tenant().tenantId }
        { name: 'ADMIN_PASSWORD', value: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/${adminSecret.name})' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
      ]
    }
  }
  dependsOn: [secretReader]
}

resource ftpAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2025-03-01' = {
  parent: web
  name: 'ftp'
  properties: { allow: false }
}

resource scmAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2025-03-01' = {
  parent: web
  name: 'scm'
  properties: { allow: false }
}

resource logs 'Microsoft.Web/sites/config@2025-03-01' = {
  parent: web
  name: 'logs'
  properties: {
    applicationLogs: { fileSystem: { level: 'Information' } }
    httpLogs: { fileSystem: { enabled: true, retentionInMb: 35, retentionInDays: 3 } }
    detailedErrorMessages: { enabled: true }
    failedRequestsTracing: { enabled: false }
  }
}

output webAppName string = web.name
output siteUrl string = 'https://${web.properties.defaultHostName}'
output postgresName string = postgres.name
output databaseHost string = postgres.properties.fullyQualifiedDomainName
output databaseUser string = databaseUser
output managedIdentityObjectId string = identity.properties.principalId
output vaultName string = vault.name
