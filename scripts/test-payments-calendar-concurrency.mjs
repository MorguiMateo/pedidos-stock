/** Real competing transactions in a disposable database on local Supabase.
 * Never resets or writes to the operational postgres database. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.TEST_LEGACY_PRE_AUTH !== '1') {
 console.log('Legacy anonymous contract superseded; running current isolated authenticated backend suite. Set TEST_LEGACY_PRE_AUTH=1 only against historical migrations.');
 await import('./test-kalak-backend.mjs');
 process.exit(0);
}
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const project = readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "([a-zA-Z0-9_-]+)"/m)[1];
const container = `supabase_db_${project}`;
const database = `calendar_race_${randomUUID().replaceAll('-', '')}`;
const args = db => ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'];
const sql = (db, query) => execFileSync('docker', args(db), { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const commandSQL = (op, payload, version = null) => `SELECT public.app_command(${literal(randomUUID())}::uuid,${literal(op)},${literal(JSON.stringify(payload))}::jsonb,${version ?? 'null'});`;
const command = (op, payload, version) => JSON.parse(sql(database, commandSQL(op, payload, version))).id;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function connection() {
  const process = spawn('docker', args(database), { stdio: ['pipe', 'pipe', 'pipe'] });
  const connection = { process, stdout: '', stderr: '', closed: false };
  process.stdout.on('data', chunk => { connection.stdout += chunk; });
  process.stderr.on('data', chunk => { connection.stderr += chunk; });
  connection.done = new Promise((resolve, reject) => {
    process.on('error', reject);
    process.on('close', code => { connection.closed = true; resolve(code); });
  });
  return connection;
}
async function until(check, message) {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await pause(20);
  }
}
const active = new Set();
async function race(first, second, expectedError, label) {
  const holder = connection(); active.add(holder);
  const contender = connection(); active.add(contender);
  try {
    holder.process.stdin.write(`BEGIN;\nSET LOCAL statement_timeout='15s';\n${first}\n\\echo HOLDER_READY\n`);
    await until(() => holder.stdout.includes('HOLDER_READY') || holder.closed, `holder setup timed out: ${label}`);
    assert.ok(!holder.closed, holder.stderr);
    const application = `race_${randomUUID().replaceAll('-', '')}`;
    contender.process.stdin.end(`SET statement_timeout='15s'; SET application_name=${literal(application)};\n${second}`);
    await until(() => contender.closed || sql(database, `SELECT count(*) FROM pg_stat_activity WHERE datname=${literal(database)} AND application_name=${literal(application)} AND wait_event_type='Lock' AND wait_event='advisory';`) === '1', `contender did not take shared advisory lock: ${label}`);
    assert.ok(!contender.closed, `contender must wait until prior transaction commits: ${contender.stderr}`);
    holder.process.stdin.end('COMMIT;\n');
    assert.equal(await holder.done, 0, holder.stderr);
    assert.notEqual(await contender.done, 0, 'conflicting contender must reject after seeing committed state');
    assert.match(contender.stderr, expectedError);
    console.log(`PASS: ${label}; contender waits on shared lock and rejects after commit.`);
  } finally {
    for (const connection of [holder, contender]) {
      if (!connection.closed) connection.process.kill();
      active.delete(connection);
    }
  }
}
let created = false;
try {
  sql('postgres', `CREATE DATABASE ${database};`); created = true;
  sql(database, 'CREATE SCHEMA extensions; CREATE PUBLICATION supabase_realtime;');
  for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) sql(database, readFileSync(`supabase/migrations/${file}`, 'utf8'));
  const client = command('save_client', { name: 'Isolated concurrency client' });
  const product = command('save_item', { kind: 'product', name: 'Isolated race item', unit: 'unidad', price: '100', minimum: '0', active: true });
  const payload = date => ({ client_id: client, pickup_date: date, location_id: 'mendieta', payment_method: 'efectivo', payment_status: 'no_pagado', lines: [{ product_id: product, quantity: 1 }] });
  await race(commandSQL('set_pickup_closure', { location_id: 'mendieta', pickup_date: '2099-01-01', closed: true }), commandSQL('save_order', payload('2099-01-01')), /PICKUP_CLOSED:.*2099-01-01/, 'closure wins against concurrent order creation');
  assert.equal(sql(database, "SELECT count(*) FROM public.orders WHERE pickup_date='2099-01-01';"), '0');
  await race(commandSQL('save_order', payload('2099-01-02')), commandSQL('set_pickup_closure', { location_id: 'mendieta', pickup_date: '2099-01-02', closed: true }), /hay pedidos pendientes/, 'order creation wins against concurrent closure');
  assert.equal(sql(database, "SELECT count(*) FROM public.pickup_closures WHERE pickup_date='2099-01-02';"), '0');
  const order = command('save_order', payload('2099-01-03'));
  await race(commandSQL('set_pickup_closure', { location_id: 'mendieta', pickup_date: '2099-01-04', closed: true }), commandSQL('reschedule_order', { id: order, pickup_date: '2099-01-04' }, 1), /PICKUP_CLOSED:.*2099-01-04/, 'closure wins against concurrent reschedule');
  assert.equal(sql(database, `SELECT pickup_date FROM public.orders WHERE id=${literal(order)};`), '2099-01-03');
  const paid = { ...payload('2099-01-03'), id: order, payment_status: 'pagado' };
  await race(commandSQL('save_order', paid, 1), commandSQL('save_order', paid, 1), /VERSION_CONFLICT/, 'one settlement wins against duplicate stale settlement');
  assert.equal(sql(database, `SELECT sum(amount)::text||':'||count(*)::text FROM public.financial_movements WHERE order_id=${literal(order)};`), '100.00:1');
  console.log('PASS: no stranded pending orders and no duplicate payments under concurrent commands. Disposable database only.');
} finally {
  for (const connection of active) if (!connection.closed) connection.process.kill();
  if (created) sql('postgres', `DROP DATABASE ${database} WITH (FORCE);`);
}
