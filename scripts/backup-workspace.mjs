/** Portable export; uses only the public RPC and never logs credentials. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const envPath = value('--env', '.env');
const config = Object.fromEntries((existsSync(envPath) || args.includes('--env') ? readFileSync(envPath, 'utf8') : '').split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => {
  const index = line.indexOf('=');
  if (index < 1) throw new Error('Invalid environment configuration');
  return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
}));
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || config.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || config.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || !/^https?:\/\//.test(url)) throw new Error('Supabase public URL/key not configured');
const token = process.env.SUPABASE_USER_ACCESS_TOKEN;
if (!token) throw new Error('Set SUPABASE_USER_ACCESS_TOKEN to an authenticated administrator session JWT; anonymous and service-role export is not supported');
const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/app_export`, {
  method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(60_000),
});
if (!response.ok) throw new Error(`Export failed (HTTP ${response.status}); check migration and connectivity`);
const data = await response.json();
if (data.format !== 'pedidos-stock' || data.schema_version !== 2 || !data.raw_tables || !Array.isArray(data.idempotency_commands)) throw new Error('Unrecognized or incomplete export');
const path = resolve(value('--out', `artifacts/backups/pedidos-stock-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
const body = JSON.stringify(data, null, 2) + '\n';
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
writeFileSync(path, body, { mode: 0o600, flag: 'wx' });
writeFileSync(`${path}.sha256`, createHash('sha256').update(body).digest('hex') + '\n', { mode: 0o600, flag: 'wx' });
console.log(`Backup saved: ${path}`);
console.log(`Integrity checksum: ${path}.sha256`);
console.log('Contains client and business data. Store an additional copy outside this device.');
