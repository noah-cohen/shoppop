import { mkdtemp, rm, cp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

const execute = promisify(execFile);

export async function startPostgres(t, beforeStop = async () => {}) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const directory = await mkdtemp(join(tmpdir(), 'calendar-postgres-'));
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const binaries = await import(`@embedded-postgres/${platform}-${process.arch}`);
  let native = dirname(dirname(binaries.postgres));
  const bin = name => join(native, 'bin', basename(binaries[name]));
  const data = join(directory, 'database');
  let child;
  t.after(async () => {
    await beforeStop();
    if (child && child.exitCode === null) await execute(bin('pg_ctl'), ['stop', '-D', data, '-m', 'fast', '-w'], { timeout: 20_000 });
    await rm(directory, { recursive: true, force: true });
  });
  if (process.platform === 'win32') {
    // Native Windows PostgreSQL cannot re-execute from a Unicode installation path.
    await cp(native, join(directory, 'native'), { recursive: true });
    native = join(directory, 'native');
  }
  await execute(bin('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], { timeout: 30_000 });
  child = spawn(bin('postgres'), ['-D', data, '-h', '127.0.0.1', '-p', String(port)], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.end();
      return url;
    } catch (error) {
      await client.end();
      if (!['ECONNREFUSED', '57P03'].includes(error.code)) throw error;
      if (child.exitCode !== null) throw new Error(`Local PostgreSQL exited: ${logs}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Local PostgreSQL did not become ready: ${logs}`);
}
