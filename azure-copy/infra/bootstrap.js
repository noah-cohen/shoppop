import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity';
import pg from 'pg';
import { azureConnectionOptions, postgresConnection } from '../storage.js';
import { databaseSchema } from '../database.js';
import { seedDemo } from '../seed.js';

const [host, administrator, principalId] = process.argv.slice(2);
if (!host || !administrator || !/^[0-9a-f-]{36}$/i.test(principalId || '')) {
  throw new Error('Usage: node infra\\bootstrap.js <Azure PostgreSQL host> <Entra administrator name> <app identity object ID>');
}
const credential = process.env.BOOTSTRAP_CLIENT_ID
  ? new ManagedIdentityCredential({ clientId: process.env.BOOTSTRAP_CLIENT_ID })
  : new AzureCliCredential({ tenantId: process.env.AZURE_TENANT_ID });
const url = database => `postgresql://${encodeURIComponent(administrator)}@${host}/${database}`;
const client = new pg.Client(azureConnectionOptions(url('postgres'), credential));
await client.connect();
try {
  const { rows } = await client.query('SELECT * FROM pgaadauth_list_principals(false) WHERE rolname=$1', ['calendar_app']);
  if (rows.length) {
    if (rows[0].objectid !== principalId) throw new Error('Existing calendar_app belongs to a different identity; refusing to replace it');
  } else {
    await client.query("SELECT * FROM pgaadauth_create_principal_with_oid($1,$2,'service',false,false)", ['calendar_app', principalId]);
  }
  await client.query('GRANT CONNECT ON DATABASE calendar TO calendar_app');
} finally { await client.end(); }

const database = new pg.Client(azureConnectionOptions(url('calendar'), credential));
await database.connect();
try {
  await database.query('GRANT USAGE, CREATE ON SCHEMA public TO calendar_app');
  await database.query('SET ROLE calendar_app');
  const db = postgresConnection(database);
  await db.exec(databaseSchema('postgres'));
  if (process.env.ALLOW_DEMO_SEED === 'true') await seedDemo(db);
  console.log('Database schema and restricted application identity ready.');
} finally { await database.end(); }
