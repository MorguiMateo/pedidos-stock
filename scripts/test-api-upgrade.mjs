/** Local-only upgrade regression: preserves historical ledger, including post-expiry legacy usage. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
process.chdir(new URL('../', import.meta.url).pathname);
const project = readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "([a-zA-Z0-9_-]+)"/m)[1];
const container = `supabase_db_${project}`;
const database = `upgrade_test_${randomUUID().replaceAll('-', '')}`;
const run = (db, source) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-X', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const migrations = readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort();
const expansion = migrations.indexOf('20261023120000_business_expansion.sql');
assert.ok(expansion > 0, 'additive expansion migration exists after baseline');
let created = false;
try {
  run('postgres', `create database ${database};`);
  created = true;
  run(database, `create schema extensions;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create publication supabase_realtime;`);
  for (const file of migrations.slice(0, expansion)) run(database, `begin;\n${readFileSync(`supabase/migrations/${file}`, 'utf8')}\ncommit;`);
  run(database, `
    insert into public.items(id,kind,name,unit,price,minimum) values
    ('90000000-0000-4000-8000-000000000001','ingredient','Historic ingredient','kg',1,0),
    ('90000000-0000-4000-8000-000000000002','product','Historic product','unidad',1,0);
    insert into public.recipes(id,product_id,yield_quantity,revision,created_at) values
    ('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000002',1,1,'2020-01-01');
    insert into public.recipe_lines values('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001',1,'kg');
    insert into public.productions(id,product_id,recipe_id,planned_date,target_quantity,actual_quantity,status,started_at,finished_at)
    values('90000000-0000-4000-8000-000000000004','90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000003','2021-01-01',1,1,'finalizado','2021-01-01','2021-01-01');
    insert into public.movements(item_id,location_id,quantity,kind,reason,event_id,created_at) values
    ('90000000-0000-4000-8000-000000000001','cocina',1,'purchase','Legacy purchase','90000000-0000-4000-8000-000000000005','2020-01-01'),
    ('90000000-0000-4000-8000-000000000001','cocina',-1,'production_consumption','Legacy consumption after four months','90000000-0000-4000-8000-000000000004','2021-01-01'),
    ('90000000-0000-4000-8000-000000000002','cocina',1,'production_output','Legacy output','90000000-0000-4000-8000-000000000004','2021-01-01'),
    ('90000000-0000-4000-8000-000000000002','cocina',-1,'transfer','Legacy transfer','90000000-0000-4000-8000-000000000006','2021-01-02'),
    ('90000000-0000-4000-8000-000000000002','mendieta',1,'transfer','Legacy transfer','90000000-0000-4000-8000-000000000006','2021-01-02'),
    ('90000000-0000-4000-8000-000000000002','mendieta',-1,'delivery','Legacy delivery after four months','90000000-0000-4000-8000-000000000007','2022-01-01');
  `);
  for (const file of migrations.slice(expansion)) run(database, `begin;\n${readFileSync(`supabase/migrations/${file}`, 'utf8')}\ncommit;`);
  run(database, `insert into auth.users(id,email) values('90000000-0000-4000-8000-000000000099','upgrade@test.invalid');select app_bootstrap_admin('90000000-0000-4000-8000-000000000099','Upgrade');`);
  const report = JSON.parse(run(database, `set request.jwt.claim.sub='90000000-0000-4000-8000-000000000099';select jsonb_build_object(
    'movement_count',(select count(*) from public.movements),
    'allocation_count',(select count(*) from public.movement_batches),
    'quantity_sum',(select sum(quantity)::text from public.movement_batches),
    'production_batch_linked',exists(select 1 from public.batches where production_id='90000000-0000-4000-8000-000000000004'),
    'production_recipe_snapshot',exists(select 1 from public.productions where recipe_snapshot->>'id'='90000000-0000-4000-8000-000000000003'),
    'estimated_legacy_lots',(select bool_and(date_source='estimated') from public.batches),
    'schema_version',app_snapshot()->'schema_version',
    'export_numeric_strings',(select bool_and(jsonb_typeof(x->'quantity')='string') from jsonb_array_elements(app_export()->'raw_tables'->'movements') x));`));
  assert.equal(report.movement_count, 6, 'all historical immutable rows preserved');
  assert.equal(report.allocation_count, 6, 'all historical ingredient/product paths allocated');
  assert.equal(Number(report.quantity_sum), 0, 'net lot balances remain exact');
  assert.equal(report.production_batch_linked, true, 'historical output linked to production');
  assert.equal(report.production_recipe_snapshot, true, 'historical approved recipe snapshotted');
  assert.equal(report.estimated_legacy_lots, true, 'unknown legacy manufacture dates explicitly estimated');
  assert.equal(report.schema_version, 2);
  assert.equal(report.export_numeric_strings, true);
  console.log('PASS: isolated upgrade preserves six historical movements, recipe and lot lineage, expired legacy usage, and exact portable export.');
} finally {
  if (created) run('postgres', `drop database ${database};`);
}
