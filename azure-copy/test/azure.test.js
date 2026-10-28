import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { azureConnectionOptions, isHosted, openStorage } from '../storage.js';
import { readAll } from '../database.js';
import { seedDemo } from '../seed.js';
import { startPostgres } from './helpers/postgres.js';

test('Azure connections verify TLS, request fresh tokens and never fall back to SQLite', async () => {
  assert.equal(isHosted({ WEBSITE_SITE_NAME: 'demo' }), true);
  assert.equal(isHosted({ NODE_ENV: 'test' }), false);
  await assert.rejects(openStorage({ databaseAuth: 'azure' }), /DATABASE_URL is required/);
  await assert.rejects(openStorage({ databaseAuth: 'typo' }), /DATABASE_AUTH/);
  let requests = 0;
  const options = azureConnectionOptions('postgresql://calendar@demo.postgres.database.azure.com/calendar?sslmode=disable', {
    async getToken(scope) {
      assert.equal(scope, 'https://ossrdbms-aad.database.windows.net/.default');
      return { token: `token-${++requests}` };
    },
  });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.user, 'calendar');
  assert.equal(options.database, 'calendar');
  assert.equal(await options.password(), 'token-1');
  assert.equal(await options.password(), 'token-2');
  assert.throws(() => azureConnectionOptions('postgresql://calendar:password@demo.postgres.database.azure.com/calendar', {}), /no password/);
  assert.throws(() => azureConnectionOptions('postgresql://calendar@example.com/calendar', {}), /Azure PostgreSQL/);
  const invalid = azureConnectionOptions('postgresql://calendar@demo.postgres.database.azure.com/calendar', { async getToken() { return null; } });
  await assert.rejects(invalid.password(), /access token/);
});

for (const dialect of ['sqlite', 'postgres']) {
  test(`demo seed is persistent, relational and refuses duplicates on ${dialect}`, { timeout: 120_000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'calendar-seed-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const databaseUrl = dialect === 'postgres' ? await startPostgres(t) : undefined;
    const options = { directory, databaseUrl, databaseAuth: 'password', requirePostgres: false };
    let storage = await openStorage(options);
    try {
      let db = await storage.connect();
      try {
        await seedDemo(db);
        await assert.rejects(seedDemo(db), /empty database/);
      } finally { db.release(); }
      await storage.close();
      storage = await openStorage(options);
      db = await storage.connect();
      try {
        const data = await readAll(db);
        assert.deepEqual([data.stores.length, data.venues.length, data.sales.length], [4, 3, 8]);
        assert.ok(data.sales.every(sale => sale.title.includes('דוגמה')));
        for (const sale of data.sales) {
          assert.ok(data.venues.some(venue => venue.id === sale.venueId));
          const links = await db.prepare('SELECT store_id FROM sale_stores WHERE sale_id=?').all(sale.id);
          assert.deepEqual(links.map(row => row.store_id).sort(), sale.stores.map(store => store.storeId).sort());
        }
        if (dialect === 'postgres') {
          await assert.rejects(promisify(execFile)(process.execPath, [join(import.meta.dirname, '..', 'server.js')], {
            timeout: 20_000,
            env: {
              ...process.env, DATABASE_URL: databaseUrl, DATABASE_AUTH: 'password',
              NODE_ENV: 'production', DEMO_MODE: 'true', PORT: '0',
              ADMIN_PASSWORD: '@Microsoft.KeyVault(SecretUri=https://example.vault.azure.net/secrets/admin-password)',
            },
          }), error => error.code === 1 && /Key Vault reference resolved/.test(error.stderr));
          assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM admin').get()).n), 0);
        }
      } finally { db.release(); }
    } finally { await storage.close(); }
  });
}
