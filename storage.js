import { openDatabase, databaseSchema } from './database.js';

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

export async function openStorage({ directory, databaseUrl, requirePostgres = false }) {
  if (!databaseUrl) {
    if (requirePostgres) throw new Error('DATABASE_URL is required on Render. Local SQLite would lose data on the free plan.');
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
  const pool = new pg.Pool(postgresConnectionOptions(databaseUrl));
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
