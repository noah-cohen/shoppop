import { openDatabase, databaseSchema } from './database.js';

export const isHosted = (env = process.env) => env.RENDER === 'true' || Boolean(env.WEBSITE_SITE_NAME) || env.NODE_ENV === 'production';

export function azureConnectionOptions(value, credential) {
  const { connectionString, ...poolOptions } = postgresConnectionOptions(value);
  const url = new URL(connectionString);
  if (url.password || !url.username || !url.hostname.endsWith('.postgres.database.azure.com') || url.pathname.length < 2) {
    throw new Error('Azure database authentication requires an Azure PostgreSQL URL with a username, database and no password');
  }
  return {
    ...poolOptions, host: url.hostname, port: Number(url.port || 5432),
    user: decodeURIComponent(url.username), database: decodeURIComponent(url.pathname.slice(1)),
    ssl: { rejectUnauthorized: true },
    async password() {
      const token = await credential.getToken('https://ossrdbms-aad.database.windows.net/.default');
      if (!token?.token) throw new Error('Azure did not return a database access token');
      return token.token;
    },
  };
}

export function postgresConnectionOptions(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.searchParams.set('sslmode', 'verify-full');
  return { connectionString: url.href, max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 };
}

export function postgresConnection(client) {
  const query = (sql, values) => {
    let index = 0;
    return client.query(sql.replace(/\?/g, () => `$${++index}`), values);
  };
  return {
    dialect: 'postgres',
    prepare(sql) {
      return {
        async all(...values) { return (await query(sql, values)).rows; },
        async get(...values) { return (await query(sql, values)).rows[0]; },
        async run(...values) { return { changes: (await query(sql, values)).rowCount }; },
      };
    },
    async exec(sql) {
      if (sql === 'BEGIN' || sql === 'BEGIN IMMEDIATE') {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(18012026)');
      } else await client.query(sql);
    },
    release() { client.release(); },
  };
}

export async function openStorage({ directory, databaseUrl, requirePostgres = isHosted(), databaseAuth = process.env.DATABASE_AUTH || 'password' }) {
  if (!['password', 'azure'].includes(databaseAuth)) throw new Error('DATABASE_AUTH must be password or azure');
  if (!databaseUrl) {
    if (requirePostgres || databaseAuth === 'azure') throw new Error('DATABASE_URL is required in cloud deployments. Local SQLite is not durable cloud storage.');
    const db = openDatabase(directory);
    let pending = Promise.resolve();
    return {
      dialect: 'sqlite',
      async connect() {
        const previous = pending;
        let release;
        pending = new Promise(resolve => { release = resolve; });
        await previous;
        return { dialect: 'sqlite', prepare: db.prepare.bind(db), exec: db.exec.bind(db), release };
      },
      async close() { await pending; db.close(); },
    };
  }
  const { default: pg } = await import('pg');
  let options = postgresConnectionOptions(databaseUrl);
  if (databaseAuth === 'azure') {
    const { ManagedIdentityCredential, AzureCliCredential } = await import('@azure/identity');
    const credential = process.env.WEBSITE_SITE_NAME
      ? new ManagedIdentityCredential({ clientId: process.env.AZURE_CLIENT_ID })
      : new AzureCliCredential({ tenantId: process.env.AZURE_TENANT_ID });
    options = azureConnectionOptions(databaseUrl, credential);
  }
  const pool = new pg.Pool(options);
  pool.on('error', error => { console.error('PostgreSQL idle connection failed:', error.message); });
  try {
    const db = postgresConnection(await pool.connect());
    try {
      await db.exec('BEGIN');
      await db.exec(databaseSchema('postgres'));
      await db.exec('COMMIT');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
    finally { db.release(); }
  } catch (error) { await pool.end(); throw error; }
  return { dialect: 'postgres', async connect() { return postgresConnection(await pool.connect()); }, close() { return pool.end(); } };
}
