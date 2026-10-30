begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('c1000000-0000-4000-8000-000000000001','gift-admin@invalid.test'),('c1000000-0000-4000-8000-000000000002','gift-point@invalid.test');
insert into app_members(id,role,location_id,display_name) values('c1000000-0000-4000-8000-000000000001','admin',null,'Gift admin'),('c1000000-0000-4000-8000-000000000002','responsable','salta','Gift pickup');
set local request.jwt.claim.sub='c1000000-0000-4000-8000-000000000001';
create temporary table gift_fixture(key text primary key,id uuid);
create function pg_temp.cmd(op text,p jsonb,v integer default null) returns uuid language sql as $$select (app_command(gen_random_uuid(),op,p,v)->>'id')::uuid$$;
create function pg_temp.id(k text) returns uuid language sql as $$select id from gift_fixture where key=k$$;
insert into gift_fixture values
('food',pg_temp.cmd('save_item','{"kind":"product","name":"Gift test food","unit":"unidad","price":"100","minimum":"0","active":true}')),
('bag',pg_temp.cmd('save_item','{"kind":"product","name":"Gift test bag","unit":"unidad","price":"20","minimum":"0","active":true,"first_purchase_gift_eligible":true}')),
('client',pg_temp.cmd('save_client','{"name":"Gift buyer"}'));
create function pg_temp.payload(food text default '2',bag text default '2',gift boolean default true) returns jsonb language sql as $$select jsonb_build_object('client_id',pg_temp.id('client'),'pickup_date',current_date,'location_id','mendieta','payment_method','efectivo','lines',jsonb_build_array(jsonb_build_object('product_id',pg_temp.id('food'),'quantity',food),jsonb_build_object('product_id',pg_temp.id('bag'),'quantity',bag,'is_gift',gift)))$$;
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',pg_temp.id('food'),'location_id','mendieta','quantity','20','reason','Gift test'));perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',pg_temp.id('bag'),'location_id','mendieta','quantity','20','reason','Gift test'));end$$;
select ok((app_snapshot()->'features'->>'first_purchase_gifts')::boolean,'feature marker is present');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload()||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('product_id',pg_temp.id('bag'),'quantity','2','is_gift',true))))$$,'VALIDATION_ERROR:%pedido real%','gift bags cannot create fake standalone order');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload()||'{"payment_method":"gratis"}')$$,'VALIDATION_ERROR:%pedido real%','whole order gratis sample cannot claim first-purchase bag');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload()||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('product_id',pg_temp.id('food'),'quantity','2','is_gift',true))))$$,'VALIDATION_ERROR:%no habilitado%','only configured eligible bags may be gifted');
insert into gift_fixture values('order',pg_temp.cmd('save_order',pg_temp.payload()));
select is((select total from orders where id=pg_temp.id('order')),200::numeric,'only paid food contributes to order total');
select is((select reserved from order_lines where order_id=pg_temp.id('order') and product_id=pg_temp.id('bag')),2::numeric,'multiple gift bags reserve actual inventory');
select is((app_private.first_purchase_gift(pg_temp.id('client'))->>'order_id')::uuid,pg_temp.id('order'),'global pending claim points to same real order');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload()||'{"location_id":"salta","allow_stock_shortage":true}')$$,'FIRST_PURCHASE_GIFT_NOT_ELIGIBLE:%','second point cannot claim gift twice');
do $$begin perform pg_temp.cmd('deliver_order',jsonb_build_object('id',pg_temp.id('order'),'payment_status','pagado'),1);end$$;
select is(app_private.balance(pg_temp.id('bag'),'mendieta'),18::numeric,'delivery deducts every gift bag once');
insert into gift_fixture values('delivered_at',gen_random_uuid());
create temporary table original_gift_order as select * from orders where id=pg_temp.id('order');
do $$begin perform pg_temp.cmd('save_order',pg_temp.payload('1','3')||jsonb_build_object('id',pg_temp.id('order')),2);end$$;
select is(app_private.balance(pg_temp.id('food'),'mendieta'),19::numeric,'reducing delivered quantity restores exact stock delta');
select is(app_private.balance(pg_temp.id('bag'),'mendieta'),17::numeric,'increasing gift bags deducts only extra unit');
select is((select sum(amount) from financial_movements where order_id=pg_temp.id('order')),100::numeric,'lower delivered total generates compensating refund');
select is((select count(*) from financial_movements where order_id=pg_temp.id('order') and kind='refund'),1::bigint,'refund is one immutable ledger entry');
select ok((select o.status='entregado' and o.delivered_at=b.delivered_at and o.created_at=b.created_at and o.pickup_date=b.pickup_date from orders o,original_gift_order b where o.id=b.id),'delivered edit preserves status and original dates');
select throws_like($$select pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',pg_temp.id('order'),'method','gratis'),3)$$,'VALIDATION_ERROR:%pedido real%','method-only command cannot turn active gifted purchase into gratis sample');
create temporary table edit_movements as select count(*) n from movements where event_id=pg_temp.id('order');
do $$begin perform pg_temp.cmd('save_order',pg_temp.payload('1','3')||jsonb_build_object('id',pg_temp.id('order'),'notes','metadata only'),3);end$$;
select is((select count(*) from movements where event_id=pg_temp.id('order')),(select n from edit_movements),'metadata edit never deducts physical stock again');
do $$begin perform pg_temp.cmd('save_item',jsonb_build_object('id',pg_temp.id('bag'),'kind','product','name','Gift test bag','unit','unidad','price','50','minimum','0','active',true,'first_purchase_gift_eligible',false),1);end$$;
select lives_ok($$select pg_temp.cmd('save_order',pg_temp.payload('1','3')||jsonb_build_object('id',pg_temp.id('order'),'notes','old gift remains valid'),4)$$,'catalog eligibility change does not invalidate historical gift');
do $$begin perform pg_temp.cmd('save_order',pg_temp.payload('1','3',false)||jsonb_build_object('id',pg_temp.id('order')),5);end$$;
select is((select total from orders where id=pg_temp.id('order')),160::numeric,'removing gift restores agreed historical bag price, not changed catalog');
select ok((select (b->>'is_gift')::boolean and not (a->>'is_gift')::boolean from audit_events e cross join lateral jsonb_array_elements(e.before_data->'lines') b cross join lateral jsonb_array_elements(e.after_data->'lines') a where e.operation='save_order' and e.entity_id=pg_temp.id('order')::text and e.request_data->'lines'->1->>'is_gift'='false' and b->>'product_id'=pg_temp.id('bag')::text and a->>'product_id'=pg_temp.id('bag')::text),'audit before/after snapshots retain gift toggle flag');
select is((select jsonb_typeof(l->'list_unit_price') from jsonb_array_elements(app_snapshot()->'orders') o cross join lateral jsonb_array_elements(o->'lines') l where o->>'id'=pg_temp.id('order')::text and l->>'product_id'=pg_temp.id('bag')::text),'string','normal snapshot list price is exact decimal string');

select is((select list_unit_price from order_lines where order_id=pg_temp.id('order') and product_id=pg_temp.id('bag')),20::numeric,'historical list price retained');
select is((select jsonb_typeof(x->'list_unit_price') from jsonb_array_elements(app_export()->'raw_tables'->'order_lines') x where x->>'order_id'=pg_temp.id('order')::text and x->>'product_id'=pg_temp.id('bag')::text),'string','raw list price JSON remains a string without IEEE loss');
select is((select x->>'list_unit_price' from jsonb_array_elements(app_export()->'raw_tables'->'order_lines') x where x->>'order_id'=pg_temp.id('order')::text and x->>'product_id'=pg_temp.id('bag')::text),'20.000000','backup snapshots exact price as decimal string');
do $$begin perform pg_temp.cmd('return_order',jsonb_build_object('id',pg_temp.id('order'),'reason','Test return','restock',true,'refund_amount','100'),6);end$$;
select is(app_private.balance(pg_temp.id('food'),'mendieta'),20::numeric,'return uses edited food quantity and original lots');
select is(app_private.balance(pg_temp.id('bag'),'mendieta'),20::numeric,'return uses net edited bag consumption');
select ok(not (app_private.first_purchase_gift(pg_temp.id('client'))->>'eligible')::boolean,'return does not grant another first-purchase gift');
select lives_ok($$select pg_temp.cmd('save_order',pg_temp.payload('1','3',false)||jsonb_build_object('id',pg_temp.id('order'),'notes','Returned metadata'),7)$$,'returned order allows descriptive corrections');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload('2','3',false)||jsonb_build_object('id',pg_temp.id('order')),8)$$,'INVALID_TRANSITION:%solo datos descriptivos%','returned quantities cannot silently invalidate return ledger');
-- Previous complimentary samples do not consume commercial first purchase.
insert into gift_fixture values('sample_client',pg_temp.cmd('save_client','{"name":"Sample first"}'));
insert into gift_fixture values('sample',pg_temp.cmd('save_order',pg_temp.payload('1','1',false)||jsonb_build_object('client_id',pg_temp.id('sample_client'),'payment_method','gratis','sale_kind','espontanea')));
select is(app_private.first_purchase_gift(pg_temp.id('sample_client'))->>'state','available','gratis sample is not commercial first purchase');
do $$begin perform pg_temp.cmd('save_item',jsonb_build_object('id',pg_temp.id('bag'),'kind','product','name','Gift test bag','unit','unidad','price','50','minimum','0','active',true,'first_purchase_gift_eligible',true),2);end$$;
insert into gift_fixture values('sample_purchase',pg_temp.cmd('save_order',pg_temp.payload('1','1')||jsonb_build_object('client_id',pg_temp.id('sample_client'))));
select lives_ok($$select pg_temp.cmd('cancel_order',jsonb_build_object('id',pg_temp.id('sample_purchase')),1)$$,'cancel pending gift releases claim');
select is(app_private.first_purchase_gift(pg_temp.id('sample_client'))->>'state','available','cancelled pending claim is reusable');
insert into gift_fixture values('replace_purchase',pg_temp.cmd('save_order',pg_temp.payload('1','1')||jsonb_build_object('client_id',pg_temp.id('sample_client'))));
do $$begin perform pg_temp.cmd('delete_order',jsonb_build_object('id',pg_temp.id('replace_purchase')),1);end$$;
select is(app_private.first_purchase_gift(pg_temp.id('sample_client'))->>'state','available','deleting pending claim releases gift eligibility');
-- First actual delivered historical order can receive bag in the same order.
insert into gift_fixture values('historical_client',pg_temp.cmd('save_client','{"name":"Historical real buyer"}'));
insert into gift_fixture values('historical_order',pg_temp.cmd('save_order',pg_temp.payload('1','1',false)||jsonb_build_object('client_id',pg_temp.id('historical_client'),'sale_kind','espontanea')));
select lives_ok($$select pg_temp.cmd('save_order',pg_temp.payload('1','1')||jsonb_build_object('id',pg_temp.id('historical_order'),'client_id',pg_temp.id('historical_client'),'sale_kind','espontanea'),1)$$,'existing first delivered spontaneous purchase receives gift via edit, no second sale');
select is((select count(*) from orders where client_id=pg_temp.id('historical_client')),1::bigint,'gift remains in the one real historical order');
-- Restore then move a delivery to another point: returns must ignore zero net old lot rows.
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',pg_temp.id('food'),'location_id','salta','quantity','10','reason','Move fixture'));perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',pg_temp.id('bag'),'location_id','salta','quantity','10','reason','Move fixture'));perform pg_temp.cmd('save_order',pg_temp.payload('1','2')||jsonb_build_object('id',pg_temp.id('historical_order'),'client_id',pg_temp.id('historical_client'),'sale_kind','espontanea','location_id','salta'),2);end$$;
select lives_ok($$select pg_temp.cmd('return_order',jsonb_build_object('id',pg_temp.id('historical_order'),'reason','Moved return','restock',true),3)$$,'return after location and quantity edits retains net original batch identity');
-- A new SKU added to an old delivered order uses today's price/date, without repricing old lines.
insert into gift_fixture values('new_sku',pg_temp.cmd('save_item','{"kind":"product","name":"New edit SKU","unit":"unidad","price":"17.25","minimum":"0","active":true}'));
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',pg_temp.id('new_sku'),'location_id','mendieta','quantity','10','reason','New SKU'));end$$;
insert into gift_fixture values('new_client',pg_temp.cmd('save_client','{"name":"New SKU old order"}'));
insert into gift_fixture values('new_order',pg_temp.cmd('save_order',pg_temp.payload('1','1',false)||jsonb_build_object('client_id',pg_temp.id('new_client'),'sale_kind','espontanea','payment_status','pagado')));
update orders set pickup_date=current_date-10 where id=pg_temp.id('new_order');
select lives_ok($$select pg_temp.cmd('save_order',pg_temp.payload('1','1',false)||jsonb_build_object('id',pg_temp.id('new_order'),'client_id',pg_temp.id('new_client'),'sale_kind','espontanea','pickup_date',current_date-10,'lines',(pg_temp.payload('1','1',false)->'lines')||jsonb_build_array(jsonb_build_object('product_id',pg_temp.id('new_sku'),'quantity','2'))),1)$$,'new product on historical delivered order uses a current price');
select is((select unit_price from order_lines where order_id=pg_temp.id('new_order') and product_id=pg_temp.id('new_sku')),17.25::numeric,'new SKU price comes from today, even when original order predates product');
select is((select price_effective_on from order_lines where order_id=pg_temp.id('new_order') and product_id=pg_temp.id('new_sku')),current_date,'price date matches the actual new SKU price');
select lives_ok($$select pg_temp.cmd('delete_order',jsonb_build_object('id',pg_temp.id('new_order')),2)$$,'delete compensates delivered order including edit movement and partial historical collections');
select is(app_private.balance(pg_temp.id('new_sku'),'mendieta'),10::numeric,'delete restores edited SKU quantity exactly');
select is((select sum(amount) from financial_movements where order_id=pg_temp.id('new_order')),0::numeric,'delete reverses genuine paid receipts after delivered edit');
-- Commercial history survives complimentary reclassification; a previous real purchase cannot be erased to gift another order.
insert into gift_fixture values('history_client',pg_temp.cmd('save_client','{"name":"Persistent buyer history"}'));
insert into gift_fixture values('history_order',pg_temp.cmd('save_order',pg_temp.payload('1','1',false)||jsonb_build_object('client_id',pg_temp.id('history_client'),'sale_kind','espontanea')));
do $$begin perform pg_temp.cmd('set_order_payment_method',jsonb_build_object('id',pg_temp.id('history_order'),'method','gratis'),1);end$$;
select is((app_private.first_purchase_gift(pg_temp.id('history_client'))->>'order_id')::uuid,pg_temp.id('history_order'),'later gratis reclassification retains first actual purchase identity');
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload()||jsonb_build_object('client_id',pg_temp.id('history_client')))$$,'FIRST_PURCHASE_GIFT_NOT_ELIGIBLE:%','cannot create second gifted order by repricing the first purchase gratis');
-- Pending gift must be resolved before another purchase is delivered first.
insert into gift_fixture values('claim_client',pg_temp.cmd('save_client','{"name":"Pending claimant"}'));
insert into gift_fixture values('claim_order',pg_temp.cmd('save_order',pg_temp.payload('1','1')||jsonb_build_object('client_id',pg_temp.id('claim_client'))));
select throws_like($$select pg_temp.cmd('save_order',pg_temp.payload('1','1',false)||jsonb_build_object('client_id',pg_temp.id('claim_client'),'sale_kind','espontanea'))$$,'FIRST_PURCHASE_GIFT_NOT_ELIGIBLE:%','another delivery cannot silently make a reserved gift a second purchase');
-- The append path also snapshots list price, without mutating the existing gifted line.
do $$begin perform pg_temp.cmd('append_spontaneous_sale',jsonb_build_object('id',pg_temp.id('claim_order'),'lines',jsonb_build_array(jsonb_build_object('product_id',pg_temp.id('new_sku'),'quantity','1'))),1);end$$;
select is((select list_unit_price from order_lines where order_id=pg_temp.id('claim_order') and product_id=pg_temp.id('new_sku')),17.25::numeric,'appended SKU snapshots its list price');
select is((select jsonb_typeof(x->'list_unit_price') from jsonb_array_elements(app_export()->'raw_tables'->'order_lines') x where x->>'order_id'=pg_temp.id('claim_order')::text and x->>'product_id'=pg_temp.id('new_sku')::text),'string','append list price survives raw export as exact decimal');
-- Role receives global eligibility without seeing the other-point order.
set local request.jwt.claim.sub='c1000000-0000-4000-8000-000000000002';
select ok((app_snapshot()->'features'->>'first_purchase_gifts')::boolean,'pickup feature marker retained');
select ok(not exists(select 1 from jsonb_array_elements(app_snapshot()->'orders') x where x->>'id'=pg_temp.id('order')::text),'other point order stays hidden');
select ok(not (select (x->'first_purchase_gift'->>'eligible')::boolean from jsonb_array_elements(app_snapshot()->'clients') x where x->>'id'=pg_temp.id('historical_client')::text),'visible cross-point client receives globally used eligibility');
select * from finish();
rollback;
