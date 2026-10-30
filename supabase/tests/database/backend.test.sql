begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select to_regclass('public.app_members') is not null as kalak_schema \gset
\if :kalak_schema
select '1..0 # SKIP Legacy anonymous/partial-payment contract superseded by kalak_identity_sales.test.sql and test-kalak-backend.mjs';
rollback;
\quit
\endif

select plan(32);
select is((select count(*)::integer from public.locations where id in ('cocina','mendieta','salta','carrodilla')),4,'four original locations remain with configurable additions');
select ok(not has_table_privilege('anon','public.movements','INSERT'),'anon cannot insert movements');
select ok(not has_table_privilege('anon','public.orders','UPDATE'),'anon cannot update orders');
select ok(not has_table_privilege('anon','app_private.commands','SELECT'),'command log private');
select ok(not has_schema_privilege('anon','app_private','USAGE'),'internal schema private');
select ok(not has_function_privilege('anon','app_private.rebalance()','EXECUTE'),'internal functions private');
select ok(has_function_privilege('anon','public.app_snapshot()','EXECUTE'),'anonymous snapshot allowed');
select ok(has_function_privilege('anon','public.app_command(uuid,text,jsonb,integer)','EXECUTE'),'anonymous vetted commands allowed');
select is(app_private.convert(2,'kg','g'),2000::numeric,'kg to g');
select is(app_private.convert(250,'ml','l'),0.25::numeric,'ml to l');
select throws_ok($$select app_private.convert(1,'g','ml')$$,'P0001','VALIDATION_ERROR: unidades incompatibles','different dimensions rejected');
select throws_ok($$select app_private.decimal('NaN')$$,'P0001','VALIDATION_ERROR: decimal con hasta 6 decimales','NaN rejected');
select throws_ok($$select app_private.whole('1.5')$$,'P0001','VALIDATION_ERROR: entero positivo requerido','fractional products rejected');
select is(jsonb_typeof(app_snapshot()->'orders'),'array','empty arrays present');
select is(jsonb_typeof(app_snapshot()->'stock'),'array','stock array present');
create temporary table original_revision as select revision from public.workspace_events;
select lives_ok($$select app_command('10000000-0000-4000-8000-000000000001','save_client','{"name":"Test SQL"}')$$,'client command works');
select is((select count(*)::integer from public.clients where name='Test SQL'),1,'client saved');
select lives_ok($$select app_command('10000000-0000-4000-8000-000000000001','save_client','{"name":"Test SQL"}')$$,'identical retry succeeds');
select is((select count(*)::integer from public.clients where name='Test SQL'),1,'identical retry creates no duplicate');
select throws_ok($$select app_command('10000000-0000-4000-8000-000000000001','save_client','{"name":"Collision"}')$$,'P0001','IDEMPOTENCY_CONFLICT: identificador reutilizado con otro contenido','different payload collision rejected');
select throws_ok($$select app_command(gen_random_uuid(),'save_order','{"unit_price":"0"}')$$,'P0001','VALIDATION_ERROR: campos no permitidos','price tampering rejected');
select throws_ok($$update public.locations set name='Mutated' where id='cocina'; set local role anon; update public.orders set notes='tamper'$$,'42501',null,'anon direct update denied');
select is((select proowner::regrole::text from pg_proc where oid='public.app_command(uuid,text,jsonb,integer)'::regprocedure),'pedidos_stock_backend','command owner is restricted backend role');
select ok(not (select rolsuper or rolbypassrls or rolcanlogin from pg_roles where rolname='pedidos_stock_backend'),'backend role cannot login or bypass RLS');
select ok(not has_schema_privilege('anon','public','CREATE'),'anon cannot create search-path objects');
select ok(exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='workspace_events'),'workspace invalidation is published');
select throws_ok($$select app_private.convert(0.0005,'g','kg')$$,'P0001','VALIDATION_ERROR: conversión excede precisión de stock','subprecision conversion rejected without rounding');
select throws_ok($$select app_command('10000000-0000-4000-8000-000000000001',null,'{"name":"different"}')$$,'P0001','VALIDATION_ERROR: comando inválido','NULL operation cannot bypass idempotency');
select is((select revision from public.workspace_events),(select revision+1 from original_revision),'successful retry invalidates realtime only once');
select throws_ok($$select app_command(gen_random_uuid(),'save_item','{"kind":"product","name":"Precision","unit":"unidad","price":"1.001","minimum":"0","active":true}')$$,'P0001','VALIDATION_ERROR: precio de producto admite hasta 2 decimales','product price beyond cents rejected');
create temporary table financial_ingredients as
select (app_command(gen_random_uuid(),'save_item',jsonb_build_object('kind','ingredient','name',name,'unit','g','price','0.123456','minimum','0','active',true))->>'id')::uuid id
from (values ('Precision ingredient A'),('Precision ingredient B')) n(name);
create temporary table fractional_purchase as
select (app_command(gen_random_uuid(),'save_purchase',jsonb_build_object('supplier','','expected_date','2026-01-01','lines',
(select jsonb_agg(jsonb_build_object('ingredient_id',id,'quantity','1','unit','g','unit_price','0.005')) from financial_ingredients)))->>'id')::uuid id;
select is((select total from public.purchases where id=(select id from fractional_purchase)),0.01::numeric,'purchase rounds final exact sum once, not individual lines');
select is((select sum(l.unit_price) from public.purchase_lines l where purchase_id=(select id from fractional_purchase)),0.010000::numeric,'fractional ingredient costs preserved');
select * from finish();
rollback;
