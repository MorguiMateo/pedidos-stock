begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select to_regclass('public.app_members') is not null as kalak_schema \gset
\if :kalak_schema
select '1..0 # SKIP Legacy anonymous/partial-payment contract superseded by kalak_identity_sales.test.sql and test-kalak-backend.mjs';
rollback;
\quit
\endif

select no_plan();
create function pg_temp.cmd(op text,p jsonb,v integer default null) returns uuid language sql as $$select (app_command(gen_random_uuid(),op,p,v)->>'id')::uuid$$;
create temporary table fixture(key text primary key,id uuid);
insert into fixture values('client',pg_temp.cmd('save_client','{"name":"Payment calendar fixture"}'));
insert into fixture values('product',pg_temp.cmd('save_item','{"kind":"product","name":"Payment calendar product","unit":"unidad","price":"100.00","minimum":"0","active":true}'));
create function pg_temp.order_payload(q integer default 1) returns jsonb language sql as $$select jsonb_build_object('client_id',(select id from fixture where key='client'),'pickup_date',current_date+20,'location_id','salta','payment_method','transferencia','lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='product'),'quantity',q)))$$;
create function pg_temp.edit_payload(k text,q integer default 1) returns jsonb language sql as $$select pg_temp.order_payload(q)||jsonb_build_object('id',(select id from fixture where key=k))$$;
insert into fixture values('paid_command',gen_random_uuid());
insert into fixture values('paid',(app_command((select id from fixture where key='paid_command'),'save_order',pg_temp.order_payload()||'{"payment_status":"pagado","transfer_name":"  Ana Pérez  "}'::jsonb)->>'id')::uuid);
select is((select sum(amount) from public.financial_movements where order_id=(select id from fixture where key='paid')),100::numeric,'paid creation collects full exact order total');
select is((select version from public.orders where id=(select id from fixture where key='paid')),1,'atomic paid creation has one document version');
select is((select transfer_name from public.orders where id=(select id from fixture where key='paid')),'Ana Pérez','transfer payer trimmed and stored on order');
select ok(exists(select 1 from public.financial_movements where order_id=(select id from fixture where key='paid') and method='transferencia' and transfer_name='Ana Pérez'),'transfer payer stored on immutable receipt');
select lives_ok($$select app_command((select id from fixture where key='paid_command'),'save_order',pg_temp.order_payload()||'{"payment_status":"pagado","transfer_name":"  Ana Pérez  "}'::jsonb)$$,'paid creation retry succeeds');
select is((select count(*)::integer from public.financial_movements where order_id=(select id from fixture where key='paid')),1,'paid creation retry never duplicates receipt');
select throws_ok($$select pg_temp.cmd('save_order',pg_temp.edit_payload('paid')||'{"payment_status":"no_pagado"}'::jsonb,1)$$,'P0001','INVALID_TRANSITION: pedido ya pagado; revertir el cobro antes de marcar no pagado','paid edit cannot erase a historical receipt');
select is((select version from public.orders where id=(select id from fixture where key='paid')),1,'failed payment downgrade rolls back version');
select lives_ok($$select pg_temp.cmd('save_order',pg_temp.edit_payload('paid')||'{"payment_status":"pagado"}'::jsonb,1)$$,'editing a settled order as paid collects nothing');
select is((select count(*)::integer from public.financial_movements where order_id=(select id from fixture where key='paid')),1,'settled edit adds no zero or duplicate receipt');
insert into fixture values('partial',pg_temp.cmd('save_order',pg_temp.order_payload()||'{"payment_status":"no_pagado"}'::jsonb));
select is((select count(*)::integer from public.financial_movements where order_id=(select id from fixture where key='partial')),0,'explicit unpaid creation records no receipt');
do $$begin perform pg_temp.cmd('record_payment',jsonb_build_object('order_id',(select id from fixture where key='partial'),'amount','30','method','efectivo'),1);end$$;
select lives_ok($$select pg_temp.cmd('save_order',pg_temp.edit_payload('partial')||'{"payment_status":"no_pagado","transfer_name":"Remaining transfer"}'::jsonb,2)$$,'unpaid edit preserves a partial payment');
select is((select sum(amount) from public.financial_movements where order_id=(select id from fixture where key='partial')),30::numeric,'partial amount never silently reversed');
select lives_ok($$select pg_temp.cmd('save_order',pg_temp.edit_payload('partial')||'{"payment_status":"pagado","transfer_name":"Remaining transfer"}'::jsonb,3)$$,'paid edit atomically fills partial remainder');
select is((select amount from public.financial_movements where order_id=(select id from fixture where key='partial') and method='transferencia'),70::numeric,'paid edit collects only remaining balance');
select is((select transfer_name from public.financial_movements where order_id=(select id from fixture where key='partial') and method='transferencia'),'Remaining transfer','remaining payment uses supplied transfer name');
select is((select version from public.orders where id=(select id from fixture where key='partial')),4,'settled edit increments version once');
select throws_ok($$select pg_temp.cmd('save_order',pg_temp.edit_payload('partial')||'{"payment_status":"pagado"}'::jsonb,3)$$,'P0001','VERSION_CONFLICT: versión cambió; actualizar e intentar nuevamente','stale settlement rejected');
select throws_ok($$select pg_temp.cmd('save_order',pg_temp.order_payload()||'{"payment_status":"invalid"}'::jsonb)$$,'P0001','VALIDATION_ERROR: estado de pago inválido','invalid payment status rejected');
select throws_ok($$select pg_temp.cmd('save_order',pg_temp.order_payload()||'{"payment_status":"pagado","payment_method":"desconocido"}'::jsonb)$$,'P0001','VALIDATION_ERROR: medio de cobro inválido','actual payment requires supported collection method');
select lives_ok($$select pg_temp.cmd('save_order',pg_temp.order_payload()||'{"payment_status":"pagado"}'::jsonb)$$,'transfer name remains optional on paid creation');
select throws_ok($$select pg_temp.cmd('save_order',pg_temp.order_payload()||'{"transfer_name":[]}'::jsonb)$$,'P0001','VALIDATION_ERROR: nombre de transferencia inválido','invalid transfer name structure rejected');

-- Delivery and collection are one transaction; delivery without collection remains settleable.
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from fixture where key='product'),'location_id','salta','quantity','20','reason','payment delivery fixture'));end$$;
insert into fixture values('unpaid_delivery',pg_temp.cmd('save_order',pg_temp.order_payload()||'{"payment_status":"no_pagado"}'::jsonb));
select lives_ok($$select pg_temp.cmd('deliver_order',jsonb_build_object('id',(select id from fixture where key='unpaid_delivery'),'payment_status','no_pagado','method','transferencia','transfer_name','Pago de Lucía'),1)$$,'unpaid delivery may retain optional future transfer payer');
select ok((select status='entregado' and version=2 and transfer_name='Pago de Lucía' from public.orders where id=(select id from fixture where key='unpaid_delivery')),'unpaid delivery persisted with one version change');
select is((select count(*)::integer from public.financial_movements where order_id=(select id from fixture where key='unpaid_delivery')),0,'unpaid delivery creates no fictitious payment');
select lives_ok($$select pg_temp.cmd('record_payment',jsonb_build_object('order_id',(select id from fixture where key='unpaid_delivery'),'amount','100','method','transferencia'),2)$$,'delivered debt can be settled later');
select is((select transfer_name from public.financial_movements where order_id=(select id from fixture where key='unpaid_delivery')),'Pago de Lucía','later transfer inherits stored pending payer name');
insert into fixture values('collect_delivery',pg_temp.cmd('save_order',pg_temp.order_payload()||'{"payment_status":"no_pagado"}'::jsonb));
do $$begin perform pg_temp.cmd('record_payment',jsonb_build_object('order_id',(select id from fixture where key='collect_delivery'),'amount','40','method','efectivo'),1);end$$;
insert into fixture values('delivery_command',gen_random_uuid());
select lives_ok($$select app_command((select id from fixture where key='delivery_command'),'deliver_order',jsonb_build_object('id',(select id from fixture where key='collect_delivery'),'payment_status','pagado','method','transferencia','transfer_name','Nico'),2)$$,'delivery atomically collects partial outstanding balance');
select is((select amount from public.financial_movements where order_id=(select id from fixture where key='collect_delivery') and method='transferencia'),60::numeric,'delivery receipt only covers remaining amount');
select is((select version from public.orders where id=(select id from fixture where key='collect_delivery')),3,'paid delivery increments version once');
select lives_ok($$select app_command((select id from fixture where key='delivery_command'),'deliver_order',jsonb_build_object('id',(select id from fixture where key='collect_delivery'),'payment_status','pagado','method','transferencia','transfer_name','Nico'),2)$$,'paid delivery retry is idempotent despite stale version');
select is((select count(*)::integer from public.movements where event_id=(select id from fixture where key='collect_delivery') and kind='delivery'),1,'delivery retry debits stock exactly once');
select is((select sum(amount) from public.financial_movements where order_id=(select id from fixture where key='collect_delivery')),100::numeric,'delivery retry collects money exactly once');
insert into fixture values('short_delivery',pg_temp.cmd('save_order',pg_temp.order_payload(100)));
select throws_ok($$select pg_temp.cmd('deliver_order',jsonb_build_object('id',(select id from fixture where key='short_delivery'),'payment_status','pagado','method','efectivo','transfer_name','Rollback'),1)$$,'P0001','INSUFFICIENT_RESERVED_STOCK: pedido sin reserva completa en el local elegido','stock failure rolls back atomic collection');
select is((select count(*)::integer from public.financial_movements where order_id=(select id from fixture where key='short_delivery')),0,'failed delivery has no cash side effect');
select ok((select status='pendiente_entrega' and version=1 and transfer_name is null from public.orders where id=(select id from fixture where key='short_delivery')),'failed delivery restores status version and payer');
select is((select count(*)::integer from public.movements where event_id=(select id from fixture where key='short_delivery')),0,'failed delivery has no stock side effect');
insert into fixture values('legacy',pg_temp.cmd('save_order',pg_temp.order_payload()||jsonb_build_object('pickup_date',current_date+10)));
select lives_ok($$select pg_temp.cmd('deliver_order',jsonb_build_object('id',(select id from fixture where key='legacy')),1)$$,'legacy deliver payload without payment status remains supported');
select is((select count(*)::integer from public.financial_movements where order_id=(select id from fixture where key='legacy')),0,'legacy delivery never invents a payment');
select throws_ok($$update public.financial_movements set transfer_name='Rewrite' where order_id=(select id from fixture where key='unpaid_delivery')$$,'P0001','INVALID_TRANSITION: movimiento financiero inmutable','payer attribution on receipt is immutable');

-- Minimal reschedule preserves document and prices, and reallocates scarce stock by pickup date.
insert into fixture values('scarce',pg_temp.cmd('save_item','{"kind":"product","name":"Calendar scarce product","unit":"unidad","price":"123.45","minimum":"0","active":true}'));
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from fixture where key='scarce'),'location_id','mendieta','quantity','1','reason','calendar fixture'));end$$;
insert into fixture values('earlier',pg_temp.cmd('save_order',pg_temp.order_payload()||jsonb_build_object('pickup_date',current_date+30,'location_id','mendieta','pickup_time','16:00','notes','Keep me','packages',2,'lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='scarce'),'quantity',1)))));
insert into fixture values('later',pg_temp.cmd('save_order',pg_temp.order_payload()||jsonb_build_object('pickup_date',current_date+31,'location_id','mendieta','lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='scarce'),'quantity',1)))));
create temporary table before_reschedule as select to_jsonb(o)-'pickup_date'-'version'-'allocation_version' document,(select jsonb_agg(to_jsonb(l)-'reserved'-'shortage' order by id) from public.order_lines l where order_id=o.id) lines from public.orders o where id=(select id from fixture where key='earlier');
select is((select reserved from public.order_lines where order_id=(select id from fixture where key='earlier')),1,'earlier pickup initially owns scarce unit');
insert into fixture values('reschedule_command',gen_random_uuid());
select lives_ok($$select app_command((select id from fixture where key='reschedule_command'),'reschedule_order',jsonb_build_object('id',(select id from fixture where key='earlier'),'pickup_date',current_date+32),1)$$,'pending order accepts minimal date-only reschedule');
select is((select to_jsonb(o)-'pickup_date'-'version'-'allocation_version' from public.orders o where id=(select id from fixture where key='earlier')),(select document from before_reschedule),'reschedule preserves every other order field');
select is((select jsonb_agg(to_jsonb(l)-'reserved'-'shortage' order by id) from public.order_lines l where order_id=(select id from fixture where key='earlier')),(select lines from before_reschedule),'reschedule preserves line IDs quantities and historical prices');
select is((select reserved from public.order_lines where order_id=(select id from fixture where key='earlier')),0,'moved later order releases its reservation');
select is((select reserved from public.order_lines where order_id=(select id from fixture where key='later')),1,'new earliest order receives scarce stock');
select is((select version from public.orders where id=(select id from fixture where key='earlier')),2,'date change advances optimistic document version');
select lives_ok($$select app_command((select id from fixture where key='reschedule_command'),'reschedule_order',jsonb_build_object('id',(select id from fixture where key='earlier'),'pickup_date',current_date+32),1)$$,'reschedule retry accepts original optimistic version');
select throws_ok($$select pg_temp.cmd('reschedule_order',jsonb_build_object('id',(select id from fixture where key='earlier'),'pickup_date',current_date+33),1)$$,'P0001','VERSION_CONFLICT: versión cambió; actualizar e intentar nuevamente','stale date change rejected');
select throws_ok($$select pg_temp.cmd('reschedule_order',jsonb_build_object('id',(select id from fixture where key='legacy'),'pickup_date',current_date+33),2)$$,'P0001','INVALID_TRANSITION: solo se reprograman pedidos pendientes','delivered order cannot be rescheduled');

-- Location/date closures never strand pending orders, but can be reopened.
select throws_like($$select pg_temp.cmd('set_pickup_closure',jsonb_build_object('location_id','mendieta','pickup_date',current_date+32,'closed',true))$$,'%hay pedidos pendientes%','closure refuses a date with any pending order');
select is((select count(*)::integer from public.pickup_closures where location_id='mendieta' and pickup_date=current_date+32),0,'rejected closure leaves no closed date');
do $$begin perform pg_temp.cmd('reschedule_order',jsonb_build_object('id',(select id from fixture where key='earlier'),'pickup_date',current_date+33),2);end$$;
insert into fixture values('closure_command',gen_random_uuid());
insert into fixture values('closure',(app_command((select id from fixture where key='closure_command'),'set_pickup_closure',jsonb_build_object('location_id','mendieta','pickup_date',current_date+32,'closed',true,'reason','Feriado'))->>'id')::uuid);
select ok((select reason='Feriado' and version=1 from public.pickup_closures where id=(select id from fixture where key='closure')),'closure persists per location/date with reason and version');
select throws_like($$select pg_temp.cmd('reschedule_order',jsonb_build_object('id',(select id from fixture where key='earlier'),'pickup_date',current_date+32),3)$$,'PICKUP_CLOSED:%Mendieta%','reschedule closed error identifies location');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.order_payload()||jsonb_build_object('location_id','mendieta','pickup_date',current_date+32))$$,'PICKUP_CLOSED:%','new order cannot be scheduled on closure');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.edit_payload('earlier')||jsonb_build_object('location_id','mendieta','pickup_date',current_date+32),3)$$,'PICKUP_CLOSED:%','editing an order cannot bypass closure');
select lives_ok($$select pg_temp.cmd('save_order',pg_temp.order_payload()||jsonb_build_object('location_id','carrodilla','pickup_date',current_date+32))$$,'same date at another location remains open');
select lives_ok($$select app_command((select id from fixture where key='closure_command'),'set_pickup_closure',jsonb_build_object('location_id','mendieta','pickup_date',current_date+32,'closed',true,'reason','Feriado'))$$,'closure retry remains idempotent');
select is((select version from public.pickup_closures where id=(select id from fixture where key='closure')),1,'closure retry increments no version');
select throws_ok($$select pg_temp.cmd('set_pickup_closure',jsonb_build_object('location_id','mendieta','pickup_date',current_date+32,'closed',false),0)$$,'P0001','VERSION_CONFLICT: versión cambió; actualizar e intentar nuevamente','optional optimistic closure version is respected');
select lives_ok($$select pg_temp.cmd('set_pickup_closure',jsonb_build_object('location_id','mendieta','pickup_date',current_date+32,'closed',false),1)$$,'closure can be reopened');
select is((select count(*)::integer from public.pickup_closures where id=(select id from fixture where key='closure')),0,'reopened date removed from active closures');
select lives_ok($$select pg_temp.cmd('reschedule_order',jsonb_build_object('id',(select id from fixture where key='earlier'),'pickup_date',current_date+32),3)$$,'reopened date accepts reschedule again');
select throws_ok($$select pg_temp.cmd('set_pickup_closure','{"location_id":"mendieta","pickup_date":"2026-12-25","closed":"true"}')$$,'P0001','VALIDATION_ERROR: fecha y cierre requeridos','closure requires actual boolean not string');
select is(jsonb_typeof(app_snapshot()->'pickup_closures'),'array','snapshot exposes closures array');
select is(jsonb_typeof(app_export()->'raw_tables'->'pickup_closures'),'array','export includes restorable raw closure table');
select is((app_snapshot()->>'schema_version')::integer,2,'snapshot retains compatible schema version');
select ok(exists(select 1 from jsonb_array_elements(app_snapshot()->'orders') o where o->>'id'=(select id::text from fixture where key='paid') and o->>'transfer_name'='Ana Pérez'),'snapshot includes order transfer name');
select ok(exists(select 1 from jsonb_array_elements(app_export()->'raw_tables'->'financial_movements') f where f->>'order_id'=(select id::text from fixture where key='paid') and f->>'transfer_name'='Ana Pérez'),'export includes immutable receipt payer');
select ok(not has_table_privilege('anon','public.pickup_closures','INSERT'),'direct anonymous closure insertion denied');
select ok(not has_function_privilege('anon','app_private.collect_order_balance(uuid,text,text)','EXECUTE'),'anonymous caller cannot bypass settlement RPC');
set local role anon;
select lives_ok($$select * from public.pickup_closures limit 1$$,'closure calendar directly readable with RLS');
reset role;
select * from finish();
rollback;
