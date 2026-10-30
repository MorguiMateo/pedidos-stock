/** Isolated SQL/RPC coverage; never changes the operational local or hosted database. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const project = readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "([\w-]+)"/m)[1];
const container = `supabase_db_${project}`, database = `kalak_weekend_${randomUUID().replaceAll('-', '')}`;
const admin = randomUUID(), pointUser = randomUUID();
const sql = (source, db = database) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-X', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const json = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const authenticated = (source, user = admin) => sql(`set role authenticated;set request.jwt.claim.sub='${user}';${source}`);
const command = (operation, payload, version = null, user = admin, id = randomUUID()) => JSON.parse(authenticated(`select public.app_command('${id}','${operation}',${json(payload)},${version ?? 'null'});`, user));
const fails = (fn, code) => assert.throws(fn, error => error.stderr?.toString().includes(code), code);
let created = false;
try {
  sql(`create database ${database};`, 'postgres'); created = true;
  sql("create schema extensions;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create publication supabase_realtime;");
  for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) sql(`begin;${readFileSync(`supabase/migrations/${file}`, 'utf8')}commit;`);
  sql(`insert into auth.users(id,email) values('${admin}','weekend-admin@example.invalid'),('${pointUser}','weekend-point@example.invalid');set role service_role;select public.app_bootstrap_admin('${admin}','Weekend admin');`);
  authenticated(`select public.app_set_member('${pointUser}','responsable','salta','Salta',true);`);
  const client = command('save_client', { name: 'Weekend fixture' }).id;
  const product = command('save_item', { kind: 'product', name: 'Weekend fixture', unit: 'unidad', price: '20', minimum: '0', active: true }).id;
  const payload = (location_id, pickup_date) => ({ client_id: client, location_id, pickup_date, lines: [{ product_id: product, quantity: '1' }], payment_method: 'transferencia', allow_stock_shortage: true });
  // Fixed dates are intentionally future; they express weekdays without device/server-local dates.
  const saturday = '2030-11-02', sunday = '2030-11-03', monday = '2030-11-04';
  assert.equal(new Date(`${saturday}T12:00:00Z`).getUTCDay(), 6);
  for (const point of ['mendieta', 'salta', 'carrodilla']) fails(() => command('save_order', payload(point, sunday)), 'PICKUP_CLOSED');
  for (const point of ['salta', 'carrodilla']) fails(() => command('save_order', payload(point, saturday)), 'PICKUP_CLOSED');
  const saturdayOrder = command('save_order', payload('mendieta', saturday)).id;
  const openingId = randomUUID();
  const opened = command('set_pickup_closure', { location_id: 'salta', pickup_date: sunday, closed: false }, 0, admin, openingId);
  assert.equal(command('set_pickup_closure', { location_id: 'salta', pickup_date: sunday, closed: false }, 0, admin, openingId).id, opened.id, 'opening is idempotent');
  let override = JSON.parse(authenticated('select public.app_snapshot();')).pickup_closures.find(row => row.location_id === 'salta' && row.pickup_date === sunday);
  assert.equal(override.closed, false);
  assert.equal(override.version, 1);
  fails(() => command('set_pickup_closure', { location_id: 'salta', pickup_date: sunday, closed: true }, 0), 'VERSION_CONFLICT');
  const sundayOrder = command('save_order', payload('salta', sunday)).id;
  fails(() => command('set_pickup_closure', { location_id: 'salta', pickup_date: sunday, closed: true }, 1), 'INVALID_TRANSITION');
  command('reschedule_order', { id: sundayOrder, pickup_date: monday, allow_stock_shortage: true }, 1);
  command('set_pickup_closure', { location_id: 'salta', pickup_date: sunday, closed: true }, 1);
  fails(() => command('set_pickup_closure', { location_id: 'salta', pickup_date: sunday, closed: false }, 1), 'VERSION_CONFLICT');
  fails(() => command('save_order', payload('salta', sunday)), 'PICKUP_CLOSED');
  command('set_pickup_closure', { location_id: 'salta', pickup_date: sunday, closed: false }, 2, pointUser);
  fails(() => command('set_pickup_closure', { location_id: 'mendieta', pickup_date: sunday, closed: false }, null, pointUser), 'FORBIDDEN');
  fails(() => command('save_order', payload('salta', '2030-11-10')), 'PICKUP_CLOSED');
  fails(() => command('reschedule_order', { id: saturdayOrder, pickup_date: sunday }, 1), 'PICKUP_CLOSED');
  override = JSON.parse(authenticated('select public.app_snapshot();')).pickup_closures.find(row => row.location_id === 'salta' && row.pickup_date === sunday);
  assert.equal(override.closed, false);
  assert.equal(override.version, 3);
  assert.equal(authenticated("select jsonb_array_length(public.app_snapshot()->'orders');"), '2');
  console.log('PASS: weekend defaults, explicit openings/closures, persistence, pending-order protection, rescheduling, optimistic concurrency, idempotency and point scope.');
} finally {
  if (created) sql(`drop database ${database} with (force);`, 'postgres');
}
