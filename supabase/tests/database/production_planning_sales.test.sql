begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
-- This suite isolates stock/planning rules; explicitly open its fixture dates.
-- Weekend availability has its own RPC suite, so calendar weekdays cannot mask stock failures.
insert into public.pickup_closures(location_id,pickup_date,closed)
select l.id,current_date+d,false from public.locations l cross join generate_series(0,10) d where l.is_pickup
on conflict(location_id,pickup_date) do update set closed=false;
insert into auth.users(id,email) values('b1000000-0000-4000-8000-000000000001','planning-admin@invalid.test'),('b1000000-0000-4000-8000-000000000002','planning-pickup@invalid.test');
insert into public.app_members(id,role,display_name,location_id) values('b1000000-0000-4000-8000-000000000001','admin','Planning admin',null),('b1000000-0000-4000-8000-000000000002','responsable','Planning pickup','mendieta');
set local request.jwt.claim.sub='b1000000-0000-4000-8000-000000000001';
create function pg_temp.cmd(op text,p jsonb,v integer default null) returns uuid language sql as $$select (app_command(gen_random_uuid(),op,p,v)->>'id')::uuid$$;
create temporary table fixture(key text primary key,id uuid);
insert into fixture values('product',pg_temp.cmd('save_item','{"kind":"product","name":"Planning kg","unit":"kg","price":"100","minimum":"0","active":true}'));
insert into fixture values('client',pg_temp.cmd('save_client','{"name":"Planning client","pets":[{"name":"Cat","species":"gato","diet":"","weight_kg":"3"}],"preferred_location_id":"mendieta"}'));
create function pg_temp.product() returns uuid language sql as $$select id from fixture where key='product'$$;
create function pg_temp.payload(q text,pickup date,loc text default 'mendieta') returns jsonb language sql as $$select jsonb_build_object('client_id',(select id from fixture where key='client'),'pickup_date',pickup,'location_id',loc,'payment_method','efectivo','payment_status','no_pagado','lines',jsonb_build_array(jsonb_build_object('product_id',pg_temp.product(),'quantity',q)))$$;
select is((select pets->0->>'species' from clients where id=(select id from fixture where key='client')),'gato','pet species persisted');
select is((select preferred_location_id from clients where id=(select id from fixture where key='client')),'mendieta','preferred pickup persisted');
select throws_like($$select pg_temp.cmd('save_client','{"name":"bad pet","pets":[{"name":"Bird","species":"ave"}]}')$$,'%especie de mascota inválida%','invalid pet species rejected');
insert into fixture values('plan',pg_temp.cmd('save_production_plan',jsonb_build_object('product_id',pg_temp.product(),'quantity','10','available_on',current_date+3)));
select is((select app_private.balance(pg_temp.product(),'mendieta')),0::numeric,'planning never changes physical pickup stock');
select is((select app_private.balance(pg_temp.product(),'cocina')),0::numeric,'planning never changes kitchen stock');
select throws_like($$select pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',pg_temp.product(),'location_id','cocina','quantity','1','reason','Wrong location'))$$,'VALIDATION_ERROR: ingresar producción real%','server rejects new physical product inventory in planning kitchen');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload('1',current_date+2))$$,'STOCK_CONFIRMATION_REQUIRED:%','production after pickup cannot cover order');
insert into fixture values('first',pg_temp.cmd('save_order',pg_temp.payload('6',current_date+3)));
insert into fixture values('second',pg_temp.cmd('save_order',pg_temp.payload('4',current_date+4,'salta')));
select is((select future_reserved from order_lines where order_id=(select id from fixture where key='first')),6::numeric,'first pickup receives future coverage');
select is((select future_reserved from order_lines where order_id=(select id from fixture where key='second')),4::numeric,'shared future pool spans locations');
select is((select reserved from order_lines where order_id=(select id from fixture where key='first')),0::numeric,'future coverage does not masquerade as physical reservation');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload('1',current_date+4))$$,'STOCK_CONFIRMATION_REQUIRED:%','shared plan cannot be promised twice');
select throws_like($$select pg_temp.cmd('deliver_order',jsonb_build_object('id',(select id from fixture where key='first')),1)$$,'INSUFFICIENT_RESERVED_STOCK:%','future coverage cannot be delivered before physical receipt');
select is((select (x->>'available_quantity')::numeric from jsonb_array_elements(app_snapshot()->'production_plans') x where x->>'id'=(select id::text from fixture where key='plan')),0::numeric,'plan remaining capacity uses canonical allocator');
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',pg_temp.product(),'location_id','mendieta','quantity','6','reason','Actual output'));end$$;
select is((select fulfilled_quantity from production_plans where id=(select id from fixture where key='plan')),6::numeric,'actual pickup receipt consumes same shared promise');
select is((select reserved from order_lines where order_id=(select id from fixture where key='first')),6::numeric,'actual physical replaces future coverage');
select is((select future_reserved from order_lines where order_id=(select id from fixture where key='second')),4::numeric,'remaining plan allocated once');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload('1',current_date+4))$$,'STOCK_CONFIRMATION_REQUIRED:%','actual receipt does not double future capacity');
do $$begin perform pg_temp.cmd('reconcile_production_plan',jsonb_build_object('id',(select id from fixture where key='plan'),'actual_quantity','6'),2);end$$;
select is((select shortage from order_lines where order_id=(select id from fixture where key='second')),4::numeric,'below-plan actual completion uncovers commitments explicitly');
select is((select app_private.balance(pg_temp.product(),'mendieta')),6::numeric,'closing plan never adds physical twice');
-- Metadata-only edit of an existing uncovered commitment does not require a new override.
do $$begin perform pg_temp.cmd('save_order',pg_temp.payload('4',current_date+4,'salta')||jsonb_build_object('id',(select id from fixture where key='second'),'notes','Metadata only'),1);end$$;
select is((select notes from orders where id=(select id from fixture where key='second')),'Metadata only','metadata save preserves unchanged uncovered legacy promise');
-- Complimentary delivery is paid without a revenue movement, method changes reclassify receipts.
do $$begin perform pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='first'),'method','gratis'),1);end$$;
select ok((select payment_confirmed_at is not null from orders where id=(select id from fixture where key='first')),'complimentary order independently marked paid');
select is((select coalesce(sum(amount),0) from financial_movements where order_id=(select id from fixture where key='first')),0::numeric,'gratis creates no revenue receipt');
do $$begin perform pg_temp.cmd('deliver_order',jsonb_build_object('id',(select id from fixture where key='first'),'payment_status','pagado','method','gratis'),2);end$$;
select is((select status from orders where id=(select id from fixture where key='first')),'entregado','free physically reserved order delivers');
do $$begin perform pg_temp.cmd('delete_order',jsonb_build_object('id',(select id from fixture where key='first')),3);end$$;
select ok(not exists(select 1 from jsonb_array_elements(app_snapshot()->'orders') o where o->>'id'=(select id::text from fixture where key='first')),'deleted order absent from normal snapshot');
select is(app_private.balance(pg_temp.product(),'mendieta'),6::numeric,'delete restores delivery exactly once');
select ok(exists(select 1 from audit_events where operation='delete_order' and entity_id=(select id::text from fixture where key='first')),'delete retains immutable reviewable audit');
select throws_like($$select pg_temp.cmd('delete_order',jsonb_build_object('id',(select id from fixture where key='first')),4)$$,'INVALID_TRANSITION: pedido eliminado','cannot delete twice');
insert into fixture values('paid',pg_temp.cmd('save_order',pg_temp.payload('2',current_date)||'{"payment_status":"pagado"}'));
do $$begin perform pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='paid'),'method','transferencia'),1);end$$;
select is((select coalesce(sum(amount),0) from financial_movements where order_id=(select id from fixture where key='paid') and method='efectivo'),0::numeric,'paid method correction zeros old cash');
select is((select coalesce(sum(amount),0) from financial_movements where order_id=(select id from fixture where key='paid') and method='transferencia'),200::numeric,'paid method correction posts new transfer once');
do $$begin perform pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='paid'),'method','gratis'),2);end$$;
select is((select coalesce(sum(amount),0) from financial_movements where order_id=(select id from fixture where key='paid')),0::numeric,'changing paid order to gratis reverses revenue');
do $$begin perform pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',(select id from fixture where key='paid'),'method','efectivo'),3);end$$;
select ok((select payment_confirmed_at is null from orders where id=(select id from fixture where key='paid')),'changing gratis to cash leaves collectible unpaid balance');
-- Append aggregates a single combined receipt, preserving the original line price.
do $$begin perform pg_temp.cmd('save_item',jsonb_build_object('id',pg_temp.product(),'kind','product','name','Planning kg','unit','kg','price','150','minimum','0','active',true),1);end$$;
do $$begin perform pg_temp.cmd('append_spontaneous_sale',jsonb_build_object('id',(select id from fixture where key='paid'),'lines',jsonb_build_array(jsonb_build_object('product_id',pg_temp.product(),'quantity','1')),'payment_status','pagado','method','efectivo','deliver',true),4);end$$;
select is((select quantity from order_lines where order_id=(select id from fixture where key='paid')),3::numeric,'append increases existing quantity atomically');
select is((select unit_price from order_lines where order_id=(select id from fixture where key='paid')),100::numeric,'append keeps original historical price');
select is((select total from orders where id=(select id from fixture where key='paid')),300::numeric,'combined total uses historical price');
select is((select coalesce(sum(amount),0) from financial_movements where order_id=(select id from fixture where key='paid')),300::numeric,'combined final order paid once');
select is((select count(*) from movements where event_id=(select id from fixture where key='paid') and kind='delivery'),1::bigint,'combined delivery deducts stock once');
do $$begin perform pg_temp.cmd('delete_order',jsonb_build_object('id',(select id from fixture where key='paid')),5);end$$;
select is((select coalesce(sum(amount),0) from financial_movements where order_id=(select id from fixture where key='paid')),0::numeric,'delete compensates genuine collections');
select is(app_private.balance(pg_temp.product(),'mendieta'),6::numeric,'delete restores combined delivery');
-- Production quantities cannot be reinterpreted by changing catalog units.
insert into fixture values('flow_product',pg_temp.cmd('save_item','{"kind":"product","name":"Receipt flow","unit":"kg","price":"2","minimum":"0","active":true}'));
insert into fixture values('flow_plan',pg_temp.cmd('save_production_plan',jsonb_build_object('product_id',(select id from fixture where key='flow_product'),'quantity','1.5','available_on',current_date+2)));
select throws_like($$select pg_temp.cmd('save_item',jsonb_build_object('id',(select id from fixture where key='flow_product'),'kind','product','name','Receipt flow','unit','unidad','price','2','minimum','0','active',true),1)$$,'%unidad usada en historial%','plans preserve commercial unit even before stock or orders');
insert into fixture values('flow_receipt',pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from fixture where key='flow_product'),'location_id','mendieta','quantity','1','reason','Early actual production')));
select is((select fulfilled_quantity from production_plans where id=(select id from fixture where key='flow_plan')),1::numeric,'early output consumes future-dated plan');
select throws_like($$select pg_temp.cmd('transfer_stock',jsonb_build_object('item_id',(select id from fixture where key='flow_product'),'from_location_id','mendieta','to_location_id','cocina','quantity','1','reason','Wrong destination'))$$,'VALIDATION_ERROR: destino debe ser%','server rejects routing physical products into planning kitchen');
insert into fixture values('flow_transfer',pg_temp.cmd('transfer_stock',jsonb_build_object('item_id',(select id from fixture where key='flow_product'),'from_location_id','mendieta','to_location_id','salta','quantity','1','reason','Already real stock')));
select is((select fulfilled_quantity from production_plans where id=(select id from fixture where key='flow_plan')),1::numeric,'point-to-point stock never consumes shared promise twice');
do $$begin perform pg_temp.cmd('reverse_movement',jsonb_build_object('id',(select id from movements where event_id=(select id from fixture where key='flow_transfer') and quantity>0),'reason','Transfer correction'));end$$;
select is((select fulfilled_quantity from production_plans where id=(select id from fixture where key='flow_plan')),1::numeric,'reversing a physical transfer leaves production fulfillment unchanged');
do $$begin perform pg_temp.cmd('reverse_movement',jsonb_build_object('id',(select id from movements where event_id=(select id from fixture where key='flow_receipt') and quantity>0),'reason','Output correction'));end$$;
select is((select fulfilled_quantity from production_plans where id=(select id from fixture where key='flow_plan')),0::numeric,'reversing actual receipt restores planned capacity');
select is(app_private.balance((select id from fixture where key='flow_product'),'mendieta'),0::numeric,'receipt reversal also restores actual physical balance');
-- Future pickup excludes physical lots that will already have expired.
insert into fixture values('expiry_product',pg_temp.cmd('save_item','{"kind":"product","name":"Expiry flow","unit":"unidad","price":"1","minimum":"0","active":true}'));
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from fixture where key='expiry_product'),'location_id','mendieta','quantity','5','manufactured_on',(current_date-interval '4 months')::date,'reason','Expiry fixture'));end$$;
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload('1',current_date+2)||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='expiry_product'),'quantity','1'))))$$,'STOCK_CONFIRMATION_REQUIRED:%','future pickup cannot reserve lots expiring before pickup');
-- Backup preserves exact fractional future reservations and the new plan receipt evidence.
insert into fixture values('fractional_order',pg_temp.cmd('save_order',pg_temp.payload('0.123456',current_date+2)||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='flow_product'),'quantity','0.123456')))));
select ok((app_export()->'raw_tables') ? 'production_plans' and (app_export()->'raw_tables') ? 'production_plan_receipts','complete export retains planning and reconciliation evidence');
select is((select jsonb_typeof(x->'future_reserved') from jsonb_array_elements(app_export()->'raw_tables'->'order_lines') x where x->>'order_id'=(select id::text from fixture where key='fractional_order')),'string','raw future reservation is an exact decimal string');
select is((select x->>'future_reserved' from jsonb_array_elements(app_export()->'raw_tables'->'order_lines') x where x->>'order_id'=(select id::text from fixture where key='fractional_order')),'0.123456','six-decimal future reservation survives backup');
select ok(exists(select 1 from jsonb_array_elements(app_snapshot()->'financial_movements') f where f->>'order_id'=(select id::text from fixture where key='paid') and f->>'location_id'='mendieta'),'hidden order ledger retains location for per-point accounting');
select is((select after_data->>'payment_status' from audit_events where operation='set_order_payment_method' and request_data->>'method'='gratis' and entity_id=(select id::text from fixture where key='paid') order by occurred_at desc limit 1),'pagado','audit recognizes gratis settlement without revenue');

-- Backend permissions: production/settings/export and other-point deletion unavailable.
set local request.jwt.claim.sub='b1000000-0000-4000-8000-000000000002';
select is(jsonb_array_length(app_snapshot()->'production_plans'),0,'pickup role cannot inspect global production plans');
select throws_like($$select pg_temp.cmd('save_production_plan',jsonb_build_object('product_id',pg_temp.product(),'quantity','1','available_on',current_date))$$,'FORBIDDEN:%','pickup role cannot mutate central planning');
select throws_like($$select pg_temp.cmd('delete_order',jsonb_build_object('id',(select id from fixture where key='second')),2)$$,'FORBIDDEN:%','pickup role cannot delete another point order');
select lives_ok($$select pg_temp.cmd('delete_order',jsonb_build_object('id',(select id from fixture where key='fractional_order')),1)$$,'pickup role can delete mistaken own-point pending order');
select throws_like($$select app_export()$$,'FORBIDDEN:%','pickup role cannot export reports or settings data');
select * from finish();
rollback;
