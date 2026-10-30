/** Disposable RPC database + real existing local GoTrue Auth; never migrates/resets the app DB.
 * Run: node scripts/preview-kalak.mjs. Ctrl-C removes preview DB/container/test Auth identity.
 * Config + login live in a mode-0600 temp file; no private keys/tokens/passwords are logged.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const project = readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "([a-zA-Z0-9_-]+)"/m)?.[1];
if (!project) throw new Error('Missing local project ID.');
const id = randomUUID().replaceAll('-', '');
const database = `kalak_preview_${id}`, restName = `kalak-preview-rest-${id}`;
const directory = mkdtempSync(join(tmpdir(), 'kalak-preview-'));
const configPath = join(directory, 'preview.json');
const dbContainer = `supabase_db_${project}`;
const args = db => ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', db, '-X', '-v', 'ON_ERROR_STOP=1', '-Atq'];
const sql = (text, db = database) => execFileSync('docker', args(db), { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const json = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
let status, identity, created = false, restStarted = false, gateway, closing = false;
async function cleanup() {
  if (closing) return; closing = true;
  gateway?.closeAllConnections(); gateway?.close();
  if (restStarted) { try { execFileSync('docker', ['rm', '-f', restName], { stdio: 'ignore' }); } catch {} }
  if (created) { try { sql(`drop database ${database} with (force);`, 'postgres'); } catch { console.error('Preview DB cleanup failed:', database); } }
  if (identity && status) {
    try { const result = await fetch(`${status.API_URL}/auth/v1/admin/users/${identity.id}`, { method: 'DELETE', headers: { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}` } }); if (!result.ok) console.error('Test identity cleanup failed:', identity.id); }
    catch { console.error('Test identity cleanup failed:', identity.id); }
  }
  rmSync(directory, { recursive: true, force: true });
}
process.on('SIGINT', () => void cleanup().then(() => process.exit(0)));
process.on('SIGTERM', () => void cleanup().then(() => process.exit(0)));
async function freePort() { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
try {
  status = JSON.parse(execFileSync('npx', ['supabase', 'status', '--output', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(status.API_URL)) throw new Error('Refusing non-local Auth API.');
  const inspection = JSON.parse(execFileSync('docker', ['inspect', `supabase_rest_${project}`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }))[0];
  const restEnv = Object.fromEntries(inspection.Config.Env.map(entry => { const split = entry.indexOf('='); return [entry.slice(0, split), entry.slice(split + 1)]; }));
  const network = Object.keys(inspection.NetworkSettings.Networks)[0];
  const email = `kalak-preview-${id}@example.invalid`, password = `Preview-${randomBytes(18).toString('base64url')}!`;
  const authResponse = await fetch(`${status.API_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: 'Administración · prueba aislada' } }) });
  if (!authResponse.ok) throw new Error(`Local Auth fixture creation failed (${authResponse.status}).`);
  identity = await authResponse.json();
  if (!identity.id) throw new Error('Local Auth did not create a fixture identity.');
  sql(`create database ${database};`, 'postgres'); created = true;
  sql(`create schema extensions; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$; create publication supabase_realtime;`);
  for (const migration of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) sql(`begin;${readFileSync(`supabase/migrations/${migration}`, 'utf8')}commit;`);
  sql(`insert into auth.users(id,email,raw_user_meta_data) values('${identity.id}','${email}',${json({ display_name: 'Administración · prueba aislada' })}); set role service_role;select public.app_bootstrap_admin('${identity.id}','Administración · prueba aislada');`);
  const command = (operation, payload, version = null) => JSON.parse(sql(`set role authenticated;set request.jwt.claim.sub='${identity.id}';select public.app_command('${randomUUID()}','${operation}',${json(payload)},${version ?? 'null'});`));
  const today = sql("select (now() at time zone 'America/Argentina/Mendoza')::date::text;");
  const product = command('save_item', { kind: 'product', name: 'Menú natural pollo · prueba aislada', unit: 'kg', category: 'alimento', presentation: 'Bolsa de 500 g', package_size: '0.5', price: '12500', price_effective_on: today, minimum: '3', active: true }).id;
  const accessory = command('save_item', { kind: 'product', name: 'Pote reutilizable · prueba aislada', unit: 'unidad', category: 'accesorio', presentation: 'Pote individual', package_size: '1', price: '1500', minimum: '2', active: true }).id;
  const client = command('save_client', { name: 'Camila · cliente de prueba aislada', phone: '+54 261 555 0101', pets: [{ name: 'Mora', weight_kg: '12.5', diet: 'Natural' }] }).id;
  for (const [item_id, quantity] of [[product, '20'], [accessory, '12']]) command('adjust_stock', { item_id, location_id: 'mendieta', quantity, reason: 'Fixture temporal del navegador, fuera de la base de la app' });
  const pending = command('save_order', { client_id: client, location_id: 'mendieta', pickup_date: today, pickup_time: '18:00', payment_method: 'desconocido', payment_status: 'no_pagado', sale_kind: 'pedido', packages: 3, prepared_packages: 1, lines: [{ product_id: product, quantity: '1.5' }], notes: 'Fixture temporal: verificar preparación y cobro independiente' }).id;
  const delivered = command('save_order', { client_id: client, location_id: 'mendieta', pickup_date: today, payment_method: 'desconocido', payment_status: 'no_pagado', sale_kind: 'espontanea', lines: [{ product_id: accessory, quantity: '2' }], notes: 'Fixture temporal: entregado por cobrar' }).id;
  const paid = command('save_order', { client_id: null, location_id: 'mendieta', pickup_date: today, payment_method: 'efectivo', payment_status: 'pagado', sale_kind: 'espontanea', lines: [{ product_id: product, quantity: '0.5' }], notes: 'Fixture temporal: venta inmediata anónima pagada' }).id;
  const restPort = await freePort(); const uri = new URL(restEnv.PGRST_DB_URI); uri.pathname = `/${database}`;
  const envPath = join(directory, 'rest.env');
  writeFileSync(envPath, `PGRST_DB_URI=${uri}\nPGRST_DB_SCHEMAS=public\nPGRST_DB_EXTRA_SEARCH_PATH=public,extensions\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=${restEnv.PGRST_JWT_SECRET}\nPGRST_DB_MAX_ROWS=10000\n`, { mode: 0o600 });
  execFileSync('docker', ['run', '--rm', '-d', '--name', restName, '--network', network, '-p', `127.0.0.1:${restPort}:3000`, '--env-file', envPath, inspection.Config.Image], { stdio: ['pipe', 'pipe', 'pipe'] }); restStarted = true;
  for (let attempt = 0; attempt < 30; attempt++) { try { const response = await fetch(`http://127.0.0.1:${restPort}/`); if (response.status < 500) break; } catch {} await new Promise(resolve => setTimeout(resolve, 200)); }
  gateway = createServer((incoming, outgoing) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range,x-total-count' };
    if (incoming.method === 'OPTIONS') { outgoing.writeHead(204, cors); outgoing.end(); return; }
    const auth = incoming.url.startsWith('/auth/v1/'); const rest = incoming.url.startsWith('/rest/v1/');
    if (!auth && !rest) { outgoing.writeHead(404, cors); outgoing.end('Preview gateway: Auth and RPC only.'); return; }
    const base = new URL(auth ? status.API_URL : `http://127.0.0.1:${restPort}`);
    const path = auth ? incoming.url : incoming.url.slice('/rest/v1'.length);
    const headers = { ...incoming.headers, host: base.host }; delete headers.connection;
    const proxy = request({ hostname: base.hostname, port: base.port, path, method: incoming.method, headers }, response => { outgoing.writeHead(response.statusCode, { ...response.headers, ...cors }); response.pipe(outgoing); });
    proxy.on('error', () => { outgoing.writeHead(502, cors); outgoing.end('Preview upstream unavailable.'); }); incoming.pipe(proxy);
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
  const publicKey = status.ANON_KEY;
  writeFileSync(configPath, JSON.stringify({ pid: process.pid, url: gatewayUrl, publicKey, email, password, database, dbContainer, restName, fixtures: { product, accessory, client, pending, delivered, paid, today } }, null, 2), { mode: 0o600 });
  // Verify full real Auth -> signed token -> PostgREST JWT verification -> new SQL RPC chain.
  const login = await fetch(`${gatewayUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: publicKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const session = await login.json();
  if (!login.ok || !session.access_token) throw new Error(`Real local Auth login failed (${login.status}).`);
  const snapshotResponse = await fetch(`${gatewayUrl}/rest/v1/rpc/app_snapshot`, { method: 'POST', headers: { apikey: publicKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' });
  const snapshot = await snapshotResponse.json();
  if (snapshotResponse.headers.get('access-control-allow-origin') !== '*') throw new Error('Preview gateway CORS origin must be singular.');
  const preflight = await fetch(`${gatewayUrl}/rest/v1/rpc/app_snapshot`, { method: 'OPTIONS', headers: { origin: 'http://localhost:8082', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,apikey,content-type,x-client-info' } });
  if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== '*') throw new Error('Preview gateway CORS preflight failed.');
  if (!snapshotResponse.ok || snapshot.profile?.id !== identity.id || snapshot.orders?.length !== 3) throw new Error(`Disposable signed-JWT RPC verification failed (${snapshotResponse.status}, ${snapshot.code ?? 'unknown'}).`);
  console.log(JSON.stringify({ ready: true, pid: process.pid, url: gatewayUrl, configPath, database, restName, verified: 'real local Auth -> signed JWT -> isolated PostgREST -> migrated SQL snapshot, 3 orders' }));
  console.log('Keep this process alive for browser verification. Ctrl-C performs cleanup. Do not deploy these fixtures.');
} catch (error) {
  // Child-process exceptions may include credentials in command arguments; never dump them.
  console.error(error instanceof Error ? error.message.split('\n')[0] : 'Preview setup failed.');
  await cleanup(); process.exit(1);
}
