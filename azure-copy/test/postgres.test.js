import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { openStorage, postgresConnectionOptions } from '../storage.js';
import { startPostgres } from './helpers/postgres.js';

test('cloud configuration refuses ephemeral SQLite and verifies remote TLS', async () => {
  await assert.rejects(() => openStorage({ requirePostgres: true }), /DATABASE_URL is required/);
  for (const value of ['not-a-url', 'https://example.com']) assert.throws(() => postgresConnectionOptions(value), /DATABASE_URL/);
  const remote = new URL(postgresConnectionOptions('postgresql://test:example@project.neon.tech/db?sslmode=require').connectionString);
  assert.equal(remote.searchParams.get('sslmode'), 'verify-full');
  assert.equal(new URL(postgresConnectionOptions('postgresql://test@127.0.0.1/db?sslmode=disable').connectionString).searchParams.get('sslmode'), 'disable');
});

test('PostgreSQL driver passes the complete API and persistence suite on a local PostgreSQL engine', { timeout: 120_000 }, async t => {
  const url = await startPostgres(t);
  const env = { ...process.env, TEST_DATABASE_URL: url };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--test', join('test', 'server.test.js')], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, output);
  assert.match(output, /Backend: PostgreSQL/);
  assert.match(output, /contact messages stay private/);
});
