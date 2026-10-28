import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openDatabase } from '../database.js';
import { openStorage } from '../storage.js';
import { databaseSnapshot, backupTables } from '../backup.js';
import { restorePostgresSnapshot } from '../migrate-postgres.js';
import { startPostgres } from './helpers/postgres.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'calendar-migration-'));
  const source = openDatabase(directory);
  t.after(async () => { source.close(); await rm(directory, { recursive: true, force: true }); });
  const poster = '11111111-1111-1111-1111-111111111111';
  source.prepare('INSERT INTO stores VALUES (?,?)').run(7, JSON.stringify({ name: 'חנות בדיקה', addresses: [], categories: [] }));
  source.prepare('INSERT INTO venues VALUES (?,?)').run(11, JSON.stringify({ name: 'אולם', city: 'ירושלים', address: 'יפו 12' }));
  source.prepare('INSERT INTO admin VALUES (?,?)').run(1, 'test-hash-not-a-real-password');
  source.prepare('INSERT INTO sessions VALUES (?,?)').run('test-session-token', Date.now() + 86400_000);
  source.prepare('INSERT INTO media VALUES (?,?,?,?)').run(poster, 'image/png', Buffer.from([0, 255, 1, 254, 2]), Date.now());
  source.prepare('INSERT INTO sales VALUES (?,?,?)').run(21, 11, JSON.stringify({ title: 'מכירה', venueId: 11, stores: [{ storeId: 7, posterId: poster }], days: [{ date: '2026-10-21', open: '10:00', close: '22:00' }] }));
  source.prepare('INSERT INTO sale_stores VALUES (?,?)').run(21, 7);
  source.prepare('INSERT INTO submissions (id,data,status,created,reviewed,sale_id,poster_id) VALUES (?,?,?,?,?,?,?)')
    .run(31, JSON.stringify({ contactName: 'Private name', contactPhone: '0501234567' }), 'approved', Date.now(), Date.now(), 21, poster);
  source.prepare('INSERT INTO messages VALUES (?,?,?,?)').run(41, JSON.stringify({ name: 'Private sender', message: 'שורה אחת\nשורה שנייה' }), Date.now(), 1);
  let storage;
  const databaseUrl = await startPostgres(t, async () => { await storage?.close(); });
  storage = await openStorage({ databaseUrl });
  return { directory, source, databaseUrl, storage };
}

test('migration CLI backs up SQLite, verifies all rows and bytes, and preserves the source', { timeout: 60_000 }, async t => {
  const { directory, source, databaseUrl, storage } = await fixture(t);
  const before = await databaseSnapshot(source);
  const backupDirectory = join(directory, 'private-backups');
  const child = spawn(process.execPath, ['migrate-postgres.js'], {
    env: { ...process.env, DATABASE_URL: databaseUrl, DATA_DIR: directory, BACKUP_DIR: backupDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, output);
  assert.match(output, /Migration verified and committed/);
  assert.deepEqual(await databaseSnapshot(source), before);
  const files = await readdir(backupDirectory);
  assert.equal(files.length, 1);
  const backup = JSON.parse(await readFile(join(backupDirectory, files[0]), 'utf8'));
  assert.deepEqual(backup.tables, before.tables);
  const db = await storage.connect();
  try {
    assert.deepEqual(await databaseSnapshot(db), before);
    for (const table of ['stores', 'venues']) {
      const inserted = await db.prepare(`INSERT INTO ${table} (data) VALUES (?) RETURNING id`).get('{}');
      assert.ok(inserted.id > before.tables[table][0].id);
    }
    const preserved = await databaseSnapshot(db);
    await assert.rejects(() => restorePostgresSnapshot(db, before), /not empty/);
    assert.deepEqual(await databaseSnapshot(db), preserved);
  } finally { db.release(); }
});

test('migration rolls back all tables on a bad reference and can restore the valid backup afterward', { timeout: 60_000 }, async t => {
  const { source, storage } = await fixture(t);
  const valid = await databaseSnapshot(source);
  const invalid = structuredClone(valid);
  invalid.tables.sale_stores[0].store_id = 999;
  const db = await storage.connect();
  try {
    await assert.rejects(() => restorePostgresSnapshot(db, invalid), error => error.code === '23503');
    for (const table of Object.keys(backupTables)) assert.equal(await db.prepare(`SELECT 1 FROM ${table}`).get(), undefined);
    await restorePostgresSnapshot(db, valid);
    assert.deepEqual(await databaseSnapshot(db), valid);
    assert.equal((await db.prepare('INSERT INTO messages (data,created) VALUES (?,?) RETURNING id').get('{}', Date.now())).id, 42);
  } finally { db.release(); }
});

test('local SQLite leases serialize asynchronous requests instead of sharing open transactions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'calendar-storage-'));
  const storage = await openStorage({ directory });
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }); });
  const first = await storage.connect();
  let acquired = false;
  const waiting = storage.connect().then(db => { acquired = true; return db; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(acquired, false);
  first.release();
  const second = await waiting;
  assert.equal(acquired, true);
  second.release();
});
