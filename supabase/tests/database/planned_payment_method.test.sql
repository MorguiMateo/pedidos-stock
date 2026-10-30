begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
 ('b1000000-0000-4000-8000-000000000001','payment-admin@invalid.test'),
 ('b1000000-0000-4000-8000-000000000002','payment-pickup@invalid.test'),
 ('b1000000-0000-4000-8000-000000000003','payment-unassigned@invalid.test');
insert into public.app_members(id,role,display_name,location_id) values
 ('b1000000-0000-4000-8000-000000000001','admin','Payment admin',null),
 ('b1000000-0000-4000-8000-000000000002','responsable','Payment pickup','mendieta');
set local request.jwt.claim.sub='b1000000-0000-4000-8000-000000000001';
create function pg_temp.cmd(op text,p jsonb,v integer default null,c uuid default gen_random_uuid()) returns uuid language sql as $$
 select (app_command(c,op,p,v)->>'id')::uuid$$;
create temporary table fixture(key text primary key,id uuid);
insert into fixture values('product',pg_temp.cmd('save_item','{"kind":"product","name":"Payment product","unit":"unidad","price":"100","minimum":"0","active":true}'));
insert into fixture values('client',pg_temp.cmd('save_client','{"name":"Payment client","phone":"2615552199"}'));
create function pg_temp.payload(point text) returns jsonb language sql as $$
 select jsonb_build_object('client_id',(select id from fixture where key='client'),'pickup_date',current_date+10,'location_id',point,'payment_method','desconocido','lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='product'),'quantity','1')))$$;
-- This suite tests payment classification, not intentional inventory overbooking.
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from fixture where key='product'),'location_id','mendieta','quantity','2','reason','Payment fixture'));perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from fixture where key='product'),'location_id','salta','quantity','1','reason','Payment fixture'));end$$;
insert into fixture values('pending',pg_temp.cmd('save_order',pg_temp.payload('mendieta')));
insert into fixture values('other',pg_temp.cmd('save_order',pg_temp.payload('salta')));
insert into fixture values('cancelled',pg_temp.cmd('save_order',pg_temp.payload('mendieta')));
do $$begin perform pg_temp.cmd('cancel_order',jsonb_build_object('id',(select id from fixture where key='cancelled')),1);end$$;
create temporary table original_state as select
 (select count(*) from public.financial_movements) collections,
 (select count(*) from public.movements) movements,
 (select total from public.orders where id=(select id from fixture where key='pending')) total;
select lives_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='pending'),'method','transferencia'),1,'b2000000-0000-4000-8000-000000000001')$$,'admin can plan a transfer');
select is((select payment_method from public.orders where id=(select id from fixture where key='pending')),'transferencia','planned method persisted');
select is((select version from public.orders where id=(select id from fixture where key='pending')),2,'version incremented');
select lives_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='pending'),'method','transferencia'),1,'b2000000-0000-4000-8000-000000000001')$$,'retry returns same command result without a second update');
select is((select version from public.orders where id=(select id from fixture where key='pending')),2,'retry did not increment version again');
select is((select count(*) from public.financial_movements),(select collections from original_state),'planning never collects money');
select is((select count(*) from public.movements),(select movements from original_state),'planning does not move stock');
select is((select total from public.orders where id=(select id from fixture where key='pending')),(select total from original_state),'planning preserves total');
select is((select status from public.orders where id=(select id from fixture where key='pending')),'pendiente_entrega','planning preserves delivery state');
select ok((select payment_confirmed_at is null from public.orders where id=(select id from fixture where key='pending')),'planned transfer is still unpaid');
select ok(exists(select 1 from public.audit_events where operation='set_order_payment_method' and before_data->>'payment_method'='desconocido' and after_data->>'payment_method'='transferencia' and location_id='mendieta'),'audit retains before and after payment method');
select throws_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='pending'),'method','efectivo'),1)$$,'P0001','VERSION_CONFLICT: versión cambió; actualizar e intentar nuevamente','stale edits are rejected');
select throws_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='pending'),'method','desconocido'),2)$$,'P0001','VALIDATION_ERROR: medio de pago previsto inválido','unknown payment method rejected');
select throws_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='pending'),'method',null),2)$$,'P0001','VALIDATION_ERROR: medio de pago previsto inválido','null payment method rejected');
select throws_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='cancelled'),'method','efectivo'),2)$$,'P0001','INVALID_TRANSITION: pedido cerrado','cancelled orders cannot change method');
set local request.jwt.claim.sub='b1000000-0000-4000-8000-000000000002';
select lives_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='pending'),'method','efectivo'),2)$$,'pickup member can plan cash at own point');
select throws_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='other'),'method','efectivo'),1)$$,'P0001','FORBIDDEN: pedido fuera de alcance','other pickup stays inaccessible');
set local request.jwt.claim.sub='b1000000-0000-4000-8000-000000000003';
select throws_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='pending'),'method','efectivo'),3)$$,'P0001','FORBIDDEN: usuario sin acceso asignado','unassigned identity rejected');
set local request.jwt.claim.sub='b1000000-0000-4000-8000-000000000001';
-- Real command creates a delivered/unpaid sale; planning must work after delivery too.
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from fixture where key='product'),'location_id','mendieta','quantity','10','reason','Payment fixture'));end$$;
insert into fixture values('delivered',pg_temp.cmd('save_order',pg_temp.payload('mendieta')||'{"sale_kind":"espontanea"}'::jsonb));
select lives_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='delivered'),'method','transferencia'),1)$$,'delivered unpaid order accepts planned method');
select is((select status from public.orders where id=(select id from fixture where key='delivered')),'entregado','planning does not undo delivery');
do $$begin perform pg_temp.cmd('record_payment',jsonb_build_object('order_id',(select id from fixture where key='delivered'),'amount','100','method','transferencia'),2);end$$;
select lives_ok($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='delivered'),'method','efectivo'),3)$$,'paid method correction uses ledger compensation');
select is((select coalesce(sum(amount),0) from financial_movements where order_id=(select id from fixture where key='delivered') and method='transferencia'),0::numeric,'previous paid transfer reversed');
select is((select coalesce(sum(amount),0) from financial_movements where order_id=(select id from fixture where key='delivered') and method='efectivo'),100::numeric,'corrected paid method collected exactly once');
select * from finish();
rollback;
