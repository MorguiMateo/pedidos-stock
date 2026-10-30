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
insert into fixture values ('client',pg_temp.cmd('save_client','{"name":"Expansion full flow","phone":"123","email":"test@example.test","address":"Mendoza","notes":"BARF","pets":[{"name":"Luna","weight_kg":"10.5","diet":"perro"}]}'));
insert into fixture values ('ingredient',pg_temp.cmd('save_item','{"kind":"ingredient","name":"Expansion chicken","unit":"kg","price":"1.123456","minimum":"0","active":true}'));
insert into fixture values ('product',pg_temp.cmd('save_item','{"kind":"product","name":"Expansion food","unit":"unidad","price":"2000","minimum":"1","active":true,"category":"alimento","weight_kg":"0.5"}'));
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from fixture where key='ingredient'),'location_id','cocina','quantity','10','reason','test ingredient stock'));end$$;
insert into fixture values ('recipe',pg_temp.cmd('save_recipe',jsonb_build_object('product_id',(select id from fixture where key='product'),'yield_quantity',10,'lines',jsonb_build_array(jsonb_build_object('ingredient_id',(select id from fixture where key='ingredient'),'quantity','5','unit','kg'))),0));
insert into fixture values ('production',pg_temp.cmd('plan_production',jsonb_build_object('product_id',(select id from fixture where key='product'),'recipe_id',(select id from fixture where key='recipe'),'planned_date',current_date,'target_quantity',10)));
do $$begin perform pg_temp.cmd('start_production',jsonb_build_object('id',(select id from fixture where key='production')),1);end$$;
do $$begin perform pg_temp.cmd('finish_production',jsonb_build_object('id',(select id from fixture where key='production'),'actual_quantity',9,'manufactured_on',current_date,'batch_code','TEST-2026','actual_ingredients',jsonb_build_array(jsonb_build_object('ingredient_id',(select id from fixture where key='ingredient'),'quantity','4','unit','kg','waste_quantity','0.5'))),2);end$$;
do $$begin perform pg_temp.cmd('transfer_stock',jsonb_build_object('item_id',(select id from fixture where key='product'),'from_location_id','cocina','to_location_id','mendieta','quantity',9,'reason','test transfer'));end$$;
insert into fixture values ('order',pg_temp.cmd('save_order',jsonb_build_object('client_id',(select id from fixture where key='client'),'pickup_date',current_date,'location_id','mendieta','payment_method','efectivo','pickup_time','15:30','uber',true,'packages',2,'prepared_packages',1,'lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='product'),'quantity',2)))));
insert into fixture values ('payment',pg_temp.cmd('record_payment',jsonb_build_object('order_id',(select id from fixture where key='order'),'amount','4000','method','efectivo')));
do $$begin perform pg_temp.cmd('reconcile_movement',jsonb_build_object('id',(select id from fixture where key='payment'),'reconciled',true),1);end$$;
do $$begin perform pg_temp.cmd('deliver_order',jsonb_build_object('id',(select id from fixture where key='order')),2);end$$;
do $$begin perform pg_temp.cmd('return_order',jsonb_build_object('id',(select id from fixture where key='order'),'reason','customer return','restock',true,'refund_amount','4000','method','efectivo'),3);end$$;
insert into fixture values ('expense',pg_temp.cmd('record_expense','{"amount":"500.20","method":"transferencia","category":"logistica","occurred_on":"2026-10-23"}'));
do $$begin perform pg_temp.cmd('reverse_financial_movement',jsonb_build_object('id',(select id from fixture where key='expense'),'reason','wrong expense'));end$$;
select is((select pets->0->>'weight_kg' from public.clients where id=(select id from fixture where key='client')),'10.5','pet weight precision retained');
select is((select phone from public.clients where id=(select id from fixture where key='client')),'123','client contact retained');
select is((select weight_kg::text from public.items where id=(select id from fixture where key='product')),'0.500000','product package weight retained');
select is((select count(*)::integer from public.items where code in ('BOLSA-TELA','CALCIO','CALDO-COLAGENO','FORMULA-GATO','FORMULA-PERRO','SEMILLAS-ZAPALLO','VINAGRE-SIDRA')),7,'all seven supplemental catalog products seeded');
select ok((select price=2000 and category='accesorio' from public.items where code='BOLSA-TELA'),'supplement catalog exact bag price and category');
select ok((select pickup_time='15:30'::time and uber and packages=2 and prepared_packages=1 from public.orders where id=(select id from fixture where key='order')),'order time Uber and preparation persisted');
select is((select product_name from public.order_lines where order_id=(select id from fixture where key='order')),'Expansion food','sale name snapshot retained');
select is((select product_unit from public.order_lines where order_id=(select id from fixture where key='order')),'unidad','sale unit snapshot retained');
select is((select app_private.balance(id,'cocina') from fixture where key='ingredient'),5.5::numeric,'actual consumption plus waste replaces estimate');
select is((select quantity from public.production_ingredients where production_id=(select id from fixture where key='production')),4::numeric,'actual used quantity audited');
select is((select waste_quantity from public.production_ingredients where production_id=(select id from fixture where key='production')),0.5::numeric,'actual ingredient waste audited separately');
select ok((select recipe_snapshot->>'id'=recipe_id::text from public.productions where id=(select id from fixture where key='production')),'approved recipe revision snapshot retained');
select throws_ok($$update public.productions set recipe_snapshot='{}' where id=(select id from fixture where key='production')$$,'P0001','INVALID_TRANSITION: receta aprobada inmutable','approved production recipe cannot mutate');
select is((select expires_on from public.batches where production_id=(select id from fixture where key='production')),(current_date+interval '4 months')::date,'finished lot expires exactly four calendar months later');
select ok(not exists(select 1 from public.movements m where m.item_id in (select id from fixture where key in ('ingredient','product')) and m.quantity is distinct from (select sum(a.quantity) from public.movement_batches a where a.movement_id=m.id)),'every ingredient and product ledger row allocated exactly to lots');
select ok(not exists(select 1 from public.batch_stock where quantity<0),'no lot balance negative');
select is((select count(distinct a.batch_id)::integer from public.movement_batches a join public.movements m on m.id=a.movement_id where m.item_id=(select id from fixture where key='product')),1,'transfer delivery and return retain original manufactured lot');
select is((select app_private.balance(id,'mendieta') from fixture where key='product'),9::numeric,'returned order restocks same outlet');
select is((select sum(amount) from public.financial_movements where order_id=(select id from fixture where key='order')),0::numeric,'refund cancels paid order cash balance');
select ok((select reconciled and version=2 from public.financial_movements where id=(select id from fixture where key='payment')),'reconciliation uses financial version');
select throws_ok($$select pg_temp.cmd('reconcile_movement',jsonb_build_object('id',(select id from fixture where key='payment'),'reconciled',false),1)$$,'P0001','VERSION_CONFLICT: versión cambió; actualizar e intentar nuevamente','stale reconciliation rejected');
select throws_ok($$update public.financial_movements set amount=1 where id=(select id from fixture where key='payment')$$,'P0001','INVALID_TRANSITION: movimiento financiero inmutable','cash amount cannot be overwritten');
select throws_ok($$select pg_temp.cmd('return_order',jsonb_build_object('id',(select id from fixture where key='order'),'reason','again','restock',true),4)$$,'P0001','INVALID_TRANSITION: solo se devuelve una entrega no devuelta','double return rejected');
select throws_ok($$select pg_temp.cmd('reverse_financial_movement',jsonb_build_object('id',(select id from fixture where key='expense'),'reason','again'))$$,'P0001','INVALID_TRANSITION: movimiento ya revertido','double cash reversal rejected');
select is((select sum(amount) from public.financial_movements where id=(select id from fixture where key='expense') or reverses_id=(select id from fixture where key='expense')),0::numeric,'expense correction uses opposite immutable entry');
select throws_ok($$select pg_temp.cmd('record_payment',jsonb_build_object('order_id',(select id from fixture where key='order'),'amount','1','method','efectivo'))$$,'P0001','INVALID_TRANSITION: pedido cancelado o devuelto','returned order cannot receive more payment');
select throws_ok($$select pg_temp.cmd('reverse_movement',jsonb_build_object('id',(select id from public.movements where event_id=(select id from fixture where key='order') and kind='delivery'),'reason','unsafe'))$$,'P0001','INVALID_TRANSITION: solo ajustes y traslados no revertidos','delivery must use order return rather than raw reversal');
select lives_ok($$select app_command(gen_random_uuid(),'save_location','{"name":"Expansion pickup","color":"#123456","active":true,"is_pickup":true}')$$,'configurable pickup can be created');
select ok(exists(select 1 from public.locations where name='Expansion pickup' and active and is_pickup and version=1),'new location is active pickup');
select throws_ok($$select app_command(gen_random_uuid(),'save_client','{"name":"Bad pet","pets":[{"name":"Dog","weight_kg":"-1","diet":""}]}')$$,'P0001','VALIDATION_ERROR: cantidad debe ser positiva','negative pet weight rejected');
select is(jsonb_typeof(app_export()->'raw_tables'->'movement_batches'),'array','portable export includes raw lot allocations');
select is(jsonb_typeof(app_export()->'raw_tables'->'production_ingredients'),'array','portable export includes actual use and waste');
select ok((select bool_and(jsonb_typeof(x->'quantity')='string') from jsonb_array_elements(app_export()->'raw_tables'->'movements') x),'export quantities are strings, never lossy JSON numbers');
select ok((select bool_and(jsonb_typeof(x->'amount')='string') from jsonb_array_elements(app_export()->'raw_tables'->'financial_movements') x),'export money is string encoded');
select is((app_export()->>'schema_version')::integer,2,'portable export schema version stable');
select ok(jsonb_array_length(app_export()->'idempotency_commands')>0,'portable export preserves retry identities');
select ok(not has_table_privilege('anon','public.financial_movements','INSERT'),'anonymous direct cash writes forbidden');
select ok(not has_table_privilege('anon','public.movement_batches','INSERT'),'anonymous direct lot allocations forbidden');
select ok(not has_function_privilege('anon','app_private.allocate_movement(public.movements)','EXECUTE'),'lot allocation helper remains private');
select is((select proowner::regrole::text from pg_proc where oid='public.app_export()'::regprocedure),'pedidos_stock_backend','export uses restricted backend role');
select ok(exists(select 1 from public.audit_events where operation='return_order' and entity_id=(select id::text from fixture where key='order') and actor_id is null),'anonymous command audited without invented identity');

-- Opposite-entry stock correction also preserves the exact original lot.
insert into fixture values('adjustment',pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from fixture where key='product'),'location_id','salta','quantity','3','reason','correctable stock')));
insert into fixture values('adjustment_movement',(select id from public.movements where event_id=(select id from fixture where key='adjustment')));
select lives_ok($$select pg_temp.cmd('reverse_movement',jsonb_build_object('id',(select id from fixture where key='adjustment_movement'),'reason','wrong count'))$$,'unused stock adjustment reversible');
select is((select app_private.balance(id,'salta') from fixture where key='product'),0::numeric,'stock reversal net zero');
select ok(exists(select 1 from public.movements where reversal_of=(select id from fixture where key='adjustment_movement')),'stock reversal links original movement');
select throws_ok($$select pg_temp.cmd('reverse_movement',jsonb_build_object('id',(select id from fixture where key='adjustment_movement'),'reason','again'))$$,'P0001','INVALID_TRANSITION: solo ajustes y traslados no revertidos','stock reversal cannot duplicate');

-- Expired stock must not be delivered even when a coarse aggregate reservation exists.
insert into fixture values('expired_purchase',pg_temp.cmd('save_purchase',jsonb_build_object('supplier','test','expected_date',current_date,'lines',jsonb_build_array(jsonb_build_object('ingredient_id',(select id from fixture where key='ingredient'),'quantity','1','unit','kg','unit_price','1')))));
select lives_ok($$select pg_temp.cmd('receive_purchase',jsonb_build_object('id',(select id from fixture where key='expired_purchase'),'manufactured_on','2020-01-01','batch_code','KNOWN-OLD'),1)$$,'known receipt batch manufacturing date supported');
select ok(exists(select 1 from public.batches where code='KNOWN-OLD' and date_source='recorded' and expires_on='2020-05-01'),'known receipt manufacturing and expiry explicit');
select ok(exists(select 1 from public.batches where date_source='estimated' and item_id=(select id from fixture where key='ingredient')),'unknown imported stock dates visibly estimated');


-- Payment edits, exactly-once retries and cancellation preserve document/cash consistency.
insert into fixture values('paid_order',pg_temp.cmd('save_order',jsonb_build_object('client_id',(select id from fixture where key='client'),'pickup_date',current_date,'location_id','mendieta','payment_method','efectivo','lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='product'),'quantity',2)))));
insert into fixture values('payment_command',gen_random_uuid());
insert into fixture values('second_payment',(app_command((select id from fixture where key='payment_command'),'record_payment',jsonb_build_object('order_id',(select id from fixture where key='paid_order'),'amount','3000','method','efectivo'),1)->>'id')::uuid);
select lives_ok($$select app_command((select id from fixture where key='payment_command'),'record_payment',jsonb_build_object('order_id',(select id from fixture where key='paid_order'),'amount','3000','method','efectivo'),1)$$,'payment retry succeeds before stale document version check');
select is((select version from public.orders where id=(select id from fixture where key='paid_order')),2,'payment increments document version exactly once');
select is((select count(*)::integer from public.audit_events where command_id=(select id from fixture where key='payment_command')),1,'idempotent payment audited exactly once');
select throws_ok($$select pg_temp.cmd('record_payment',jsonb_build_object('order_id',(select id from fixture where key='paid_order'),'amount','1','method','efectivo'),1)$$,'P0001','VERSION_CONFLICT: versión cambió; actualizar e intentar nuevamente','stale payment form rejected');
select throws_ok($$select pg_temp.cmd('record_payment',jsonb_build_object('order_id',(select id from fixture where key='paid_order'),'amount','1001','method','efectivo'),2)$$,'P0001','VALIDATION_ERROR: pago supera saldo del pedido','payment cannot exceed outstanding balance');
select throws_ok($$select pg_temp.cmd('save_order',jsonb_build_object('id',(select id from fixture where key='paid_order'),'client_id',(select id from fixture where key='client'),'pickup_date',current_date,'location_id','mendieta','payment_method','efectivo','lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='product'),'quantity',1))),2)$$,'P0001','VALIDATION_ERROR: total menor a cobros registrados; revertir el cobro antes de editar','editing order cannot create overpayment');
select is((select total from public.orders where id=(select id from fixture where key='paid_order')),4000::numeric,'failed paid edit rolls back total and line changes');
select throws_ok($$select pg_temp.cmd('cancel_order',jsonb_build_object('id',(select id from fixture where key='paid_order')),2)$$,'P0001','INVALID_TRANSITION: pedido con cobros; revertir el cobro antes de cancelar','paid cancellation requires receipt correction');
select lives_ok($$select pg_temp.cmd('reverse_financial_movement',jsonb_build_object('id',(select id from fixture where key='second_payment'),'reason','customer canceled'))$$,'receipt reversal corrects paid balance');
select lives_ok($$select pg_temp.cmd('cancel_order',jsonb_build_object('id',(select id from fixture where key='paid_order')),(select version from public.orders where id=(select id from fixture where key='paid_order')))$$,'order can cancel after cash correction');

-- Synthetic historical stock is only created with privileged fixture writes. New operations cannot falsify dates.
insert into fixture values('expired_product',pg_temp.cmd('save_item','{"kind":"product","name":"Expansion expired","unit":"unidad","price":"1","minimum":"0","active":true}'));
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id,created_at) values((select id from fixture where key='expired_product'),'salta',2,'adjustment','historical fixture',gen_random_uuid(),'2020-01-01T12:00:00Z');
insert into fixture values('expired_order',pg_temp.cmd('save_order',jsonb_build_object('client_id',(select id from fixture where key='client'),'pickup_date',current_date,'location_id','salta','payment_method','efectivo','lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='expired_product'),'quantity',2)))));
select is((select a.reserved from public.order_allocations a join public.order_lines l on l.id=a.line_id where l.order_id=(select id from fixture where key='expired_order')),0,'expired physical stock never becomes a usable reservation');
select is((select a.shortage from public.order_allocations a join public.order_lines l on l.id=a.line_id where l.order_id=(select id from fixture where key='expired_order')),2,'expired-only order displays full shortage');
select throws_ok($$select pg_temp.cmd('deliver_order',jsonb_build_object('id',(select id from fixture where key='expired_order')),1)$$,'P0001','INSUFFICIENT_RESERVED_STOCK: pedido sin reserva completa en el local elegido','expired delivery rejected before ledger changes');
select is((select on_hand from public.stock_balances where item_id=(select id from fixture where key='expired_product') and location_id='salta'),2::numeric,'expired physical balance preserved for disposal');
set local role anon;
select lives_ok($$select * from public.stock_balances limit 1$$,'public stock view stays readable without private function access');
select lives_ok($$select * from public.order_allocations limit 1$$,'public computed reservation view read-only access works');
reset role;


-- An expired unrelated lot cannot hide that a reversal would take reserved usable units.
insert into fixture values('fresh_for_reversal',pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from fixture where key='expired_product'),'location_id','salta','quantity','2','reason','fresh reserved stock')));
select is((select a.reserved from public.order_allocations a join public.order_lines l on l.id=a.line_id where l.order_id=(select id from fixture where key='expired_order')),2,'fresh lot fills expired order shortage');
select throws_ok($$select pg_temp.cmd('reverse_movement',jsonb_build_object('id',(select id from public.movements where event_id=(select id from fixture where key='fresh_for_reversal')),'reason','would consume reserve'))$$,'P0001','INSUFFICIENT_STOCK: reversión afecta stock consumido o reservado','reversal cannot replace a usable reservation with expired physical stock');


insert into fixture values('known_lot_adjustment',pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from public.items where code='CALCIO'),'location_id','cocina','quantity','2','reason','known supplier lot','manufactured_on',(current_date-1)::text,'batch_code','SUPP-KNOWN')));
select ok(exists(select 1 from public.batches where code='SUPP-KNOWN' and date_source='recorded' and manufactured_on=current_date-1 and expires_on=((current_date-1)+interval '4 months')::date),'supplement initial stock keeps real manufacture and four-month expiry');
select ok(exists(select 1 from public.movements where event_id=(select id from fixture where key='known_lot_adjustment') and manufactured_on=current_date-1 and batch_code='SUPP-KNOWN'),'known manufacturing input remains in immutable movement audit');
select throws_ok($$select pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from public.items where code='CALCIO'),'location_id','cocina','quantity','-1','reason','loss','batch_code','wrong'))$$,'P0001','VALIDATION_ERROR: fecha y lote solo para ingreso positivo','loss cannot relabel an existing batch');
select throws_ok($$select pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',(select id from public.items where code='CALCIO'),'location_id','cocina','quantity','1','reason','future','manufactured_on',(current_date+1)::text))$$,'P0001','VALIDATION_ERROR: fabricación no puede ser futura','future known manufacturing rejected');
select is((app_snapshot()->>'schema_version')::integer,2,'snapshot signals backend schema compatibility');

-- Historical migration allocation may predate expiry enforcement; new writes must never bypass it.
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id,created_at) values((select id from fixture where key='expired_product'),'carrodilla',1,'adjustment','historical pre-expiry-rule fixture',gen_random_uuid(),'2020-01-01T12:00:00Z');
do $$begin perform set_config('app_private.backfill','true',true);end$$;
select lives_ok($$insert into public.movements(item_id,location_id,quantity,kind,reason,event_id,created_at) values((select id from fixture where key='expired_product'),'carrodilla',-1,'delivery','historical pre-expiry-rule fixture',gen_random_uuid(),'2021-01-01T12:00:00Z')$$,'legacy delivery after estimated expiry can backfill');
do $$begin perform set_config('app_private.backfill','false',true);end$$;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id,created_at) values((select id from fixture where key='expired_product'),'carrodilla',1,'adjustment','old stock again',gen_random_uuid(),'2020-01-01T12:00:00Z');
select throws_ok($$insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) values((select id from fixture where key='expired_product'),'carrodilla',-1,'delivery','new expired delivery forbidden',gen_random_uuid())$$,'P0001','INSUFFICIENT_STOCK: lotes disponibles insuficientes o vencidos','expiry enforcement resumes after historical backfill');


-- Returning now and reimbursing later retains a visible, fully settleable customer credit.
insert into fixture values('deferred_order',pg_temp.cmd('save_order',jsonb_build_object('client_id',(select id from fixture where key='client'),'pickup_date',current_date,'location_id','mendieta','payment_method','efectivo','lines',jsonb_build_array(jsonb_build_object('product_id',(select id from fixture where key='product'),'quantity',1)))));
do $$begin perform pg_temp.cmd('record_payment',jsonb_build_object('order_id',(select id from fixture where key='deferred_order'),'amount','2000','method','efectivo'),1);end$$;
select throws_ok($$select pg_temp.cmd('record_refund',jsonb_build_object('order_id',(select id from fixture where key='deferred_order'),'amount','1','method','efectivo'),2)$$,'P0001','INVALID_TRANSITION: reintegro requiere pedido devuelto o cancelado','active sale uses receipt correction rather than return reimbursement');
do $$begin perform pg_temp.cmd('deliver_order',jsonb_build_object('id',(select id from fixture where key='deferred_order')),2);end$$;
do $$begin perform pg_temp.cmd('return_order',jsonb_build_object('id',(select id from fixture where key='deferred_order'),'reason','refund later','restock',false,'refund_amount','0'),3);end$$;
select is((select sum(amount) from public.financial_movements where order_id=(select id from fixture where key='deferred_order')),2000::numeric,'zero-immediate-refund return retains customer credit');
select lives_ok($$select pg_temp.cmd('record_refund',jsonb_build_object('order_id',(select id from fixture where key='deferred_order'),'amount','1000','method','efectivo','notes','first half'),4)$$,'partial deferred reimbursement accepted');
select is((select version from public.orders where id=(select id from fixture where key='deferred_order')),5,'deferred reimbursement advances document version');
select throws_ok($$select pg_temp.cmd('record_refund',jsonb_build_object('order_id',(select id from fixture where key='deferred_order'),'amount','1','method','efectivo'),4)$$,'P0001','VERSION_CONFLICT: versión cambió; actualizar e intentar nuevamente','stale deferred reimbursement rejected');
select throws_ok($$select pg_temp.cmd('record_refund',jsonb_build_object('order_id',(select id from fixture where key='deferred_order'),'amount','1001','method','efectivo'),5)$$,'P0001','VALIDATION_ERROR: reintegro supera cobros','deferred reimbursement cannot exceed residual credit');
select lives_ok($$select pg_temp.cmd('record_refund',jsonb_build_object('order_id',(select id from fixture where key='deferred_order'),'amount','1000','method','transferencia','notes','remaining half'),5)$$,'remaining customer credit can be reimbursed separately');
select is((select sum(amount) from public.financial_movements where order_id=(select id from fixture where key='deferred_order')),0::numeric,'split reimbursements exactly settle original credit');
select * from finish();
rollback;
