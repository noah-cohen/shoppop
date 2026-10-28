import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStorage } from './storage.js';

export const backupTables = {
  stores: ['id', 'data'],
  venues: ['id', 'data'],
  admin: ['id', 'hash'],
  media: ['id', 'mime', 'bytes', 'created'],
  sessions: ['token', 'expires'],
  sales: ['id', 'venue_id', 'data'],
  sale_stores: ['sale_id', 'store_id'],
  submissions: ['id', 'data', 'status', 'created', 'reviewed', 'sale_id', 'poster_id'],
  messages: ['id', 'data', 'created', 'is_read'],
  users: ['id', 'email', 'created', 'last_login'],
  login_codes: ['email', 'hash', 'expires', 'attempts', 'requested'],
  user_sessions: ['token', 'user_id', 'expires'],
  user_favorites: ['user_id', 'type', 'entity_id'],
  user_credentials: ['user_id', 'password_hash'],
  user_profiles: ['user_id', 'data', 'updated'],
  auth_codes: ['email', 'purpose', 'hash', 'expires', 'attempts', 'requested'],
  pending_registrations: ['email', 'password_hash', 'profile', 'expires'],
};

export async function databaseSnapshot(db) {
  const tables = {};
  for (const [table, columns] of Object.entries(backupTables)) {
    try {
      tables[table] = (await db.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY ${columns[0]}${table === 'sale_stores' ? ',store_id' : ''}`).all())
        .map(row => ({ ...row }));
    } catch (error) {
      const optionalAccountTable = [
        'users', 'login_codes', 'user_sessions', 'user_favorites', 'user_credentials',
        'user_profiles', 'auth_codes', 'pending_registrations',
      ].includes(table);
      if (!optionalAccountTable || error.code !== 'ERR_SQLITE_ERROR' || !error.message.includes('no such table')) throw error;
      tables[table] = [];
    }
  }
  tables.media = tables.media.map(row => ({ ...row, bytes: Buffer.from(row.bytes).toString('base64') }));
  return { version: 3, tables };
}

export async function writeBackup(snapshot, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const path = join(outputDirectory, `calendar-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(path, JSON.stringify({ ...snapshot, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  return path;
}

async function main() {
  const root = dirname(fileURLToPath(import.meta.url));
  const directory = resolve(process.env.DATA_DIR || join(root, 'data'));
  if (!process.env.DATABASE_URL) await access(join(directory, 'calendar.sqlite'));
  const storage = await openStorage({ directory, databaseUrl: process.env.DATABASE_URL });
  try {
    const db = await storage.connect();
    try {
      await db.exec(db.dialect === 'postgres' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      try {
        const snapshot = await databaseSnapshot(db);
        const path = await writeBackup(snapshot, resolve(process.env.BACKUP_DIR || join(root, 'backups')));
        await db.exec('COMMIT');
        console.log(`Private backup saved locally: ${path}`);
      } catch (error) { await db.exec('ROLLBACK'); throw error; }
    } finally { db.release(); }
  } finally { await storage.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
