import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupTables, databaseSnapshot, writeBackup } from './backup.js';
import { openStorage } from './storage.js';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function restorePostgresSnapshot(db, snapshot) {
  if (db.dialect !== 'postgres') throw new Error('Migration target must be PostgreSQL');
  if (snapshot?.version !== 3 || !snapshot.tables || Object.keys(backupTables).some(table => !Array.isArray(snapshot.tables[table]))) {
    throw new Error('Unsupported or incomplete backup');
  }
  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of Object.keys(backupTables)) {
      if (await db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw new Error('Target database is not empty. Nothing was overwritten. Use a new empty database or branch.');
    }
    for (const [table, columns] of Object.entries(backupTables)) {
      const insert = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of snapshot.tables[table]) {
        await insert.run(...columns.map(column => table === 'media' && column === 'bytes' ? Buffer.from(row.bytes, 'base64') : row[column]));
      }
    }
    const restored = await databaseSnapshot(db);
    if (fingerprint(restored) !== fingerprint({ version: snapshot.version, tables: snapshot.tables })) {
      throw new Error('Migration verification failed. All imported records were rolled back.');
    }
    for (const table of ['stores', 'venues', 'sales', 'submissions', 'messages', 'users']) {
      const maximum = snapshot.tables[table].reduce((maximum, row) => Math.max(maximum, row.id), 0);
      await db.prepare("SELECT setval(pg_get_serial_sequence(?, 'id'), ?, ?)").get(table, maximum || 1, maximum > 0);
    }
    await db.exec('COMMIT');
    return Object.fromEntries(Object.keys(backupTables).map(table => [table, snapshot.tables[table].length]));
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL privately before migration. Do not paste it into chat or source code.');
  const root = dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--backup')) throw new Error('Usage: npm run migrate:postgres [-- --backup <private-backup.json>]');
  let snapshot;
  if (args.length) {
    snapshot = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
  } else {
    const source = new DatabaseSync(join(resolve(process.env.DATA_DIR || join(root, 'data')), 'calendar.sqlite'), { readOnly: true });
    try {
      source.exec('BEGIN');
      snapshot = await databaseSnapshot(source);
      source.exec('COMMIT');
    } finally { source.close(); }
  }
  const backup = await writeBackup(snapshot, resolve(process.env.BACKUP_DIR || join(root, 'backups')));
  console.log(`Source backup saved locally: ${backup}`);
  const storage = await openStorage({ databaseUrl: process.env.DATABASE_URL });
  try {
    const db = await storage.connect();
    try {
      const counts = await restorePostgresSnapshot(db, snapshot);
      console.log('Migration verified and committed. Source data was not changed.');
      console.log(Object.entries(counts).map(([table, count]) => `${table}: ${count}`).join('\n'));
    } finally { db.release(); }
  } finally { await storage.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
