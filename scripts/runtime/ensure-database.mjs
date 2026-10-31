import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import pg from 'pg';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localEnv = parse(readFileSync(path.join(projectRoot, '.env.local')));
if (!localEnv.DATABASE_URL) throw new Error('Missing DATABASE_URL in .env.local.');
const databaseUrl = new URL(localEnv.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
  throw new Error('Native bootstrap only accepts a loopback database host.');
}
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(databaseName)) {
  throw new Error('Database name must contain only letters, digits and underscores.');
}
const maintenanceUrl = new URL(databaseUrl);
maintenanceUrl.pathname = '/postgres';
const maintenance = new pg.Client({ connectionString: maintenanceUrl.href, connectionTimeoutMillis: 5000 });
try {
  await maintenance.connect();
  const exists = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  if (!exists.rowCount) await maintenance.query(`CREATE DATABASE "${databaseName}"`);
} catch (error) {
  console.error('Local database bootstrap failed. PostgreSQL code:', error.code ?? 'connection_error');
  process.exitCode = 1;
} finally {
  await maintenance.end();
}

if (!process.exitCode) {
  const client = new pg.Client({ connectionString: databaseUrl.href, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows } = await client.query("SELECT current_database() AS database, version(), inet_server_addr() AS address, inet_server_port() AS port, current_setting('listen_addresses') AS listen_addresses");
    console.log(JSON.stringify({ connected: true, ...rows[0] }));
  } catch (error) {
    console.error('Local database connection failed. PostgreSQL code:', error.code ?? 'connection_error');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
