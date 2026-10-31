begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('d1000000-0000-4000-8000-000000000001','revert-admin@invalid.test'),('d1000000-0000-4000-8000-000000000002','revert-point@invalid.test');
insert into app_members(id,role,location_id,display_name) values('d1000000-0000-4000-8000-000000000001','admin',null,'Revert admin'),('d1000000-0000-4000-8000-000000000002','responsable','salta','Revert pickup');
set local request.jwt.claim.sub='d1000000-0000-4000-8000-000000000001';
create temporary table revert_fixture(key text primary key,id uuid);
create function pg_temp.cmd(op text,p jsonb,v integer default null) returns uuid language sql as $$select (app_command(gen_random_uuid(),op,p,v)->>'id')::uuid$$;
create function pg_temp.id(k text) returns uuid language sql as $$select id from revert_fixture where key=k$$;
-- Weekdays within the stock shelf life: farther dates fall outside the coverage window.
create function pg_temp.wed(weeks integer default 0) returns date language sql as $$select current_date+1+((3-extract(dow from current_date+1)::int+7)%7)+7*weeks$$;
create function pg_temp.sale(day date default pg_temp.wed(0),qty text default '2') returns jsonb language sql as $$select jsonb_build_object('client_id',pg_temp.id('client'),'pickup_date',day,'location_id','mendieta','payment_method','efectivo','lines',jsonb_build_array(jsonb_build_object('product_id',pg_temp.id('food'),'quantity',qty)))$$;
insert into revert_fixture values
('food',pg_temp.cmd('save_item','{"kind":"product","name":"Revert test food","unit":"unidad","price":"100","minimum":"0","active":true}')),
('client',pg_temp.cmd('save_client','{"name":"Revert buyer"}'));
do $$begin perform pg_temp.cmd('adjust_stock',jsonb_build_object('item_id',pg_temp.id('food'),'location_id','mendieta','quantity','20','reason','Revert test'));end$$;

-- Delivered order -> pending: stock is restored once, the order reserves stock again and collections stay.
insert into revert_fixture values('order',pg_temp.cmd('save_order',pg_temp.sale()));
do $$begin perform pg_temp.cmd('deliver_order',jsonb_build_object('id',pg_temp.id('order'),'payment_status','pagado'),1);end$$;
select is(app_private.balance(pg_temp.id('food'),'mendieta'),18::numeric,'delivery consumed the sold units');
select throws_like($$select pg_temp.cmd('revert_delivery',jsonb_build_object('id',pg_temp.id('order'),'target','pendiente_entrega'),1)$$,'VERSION_CONFLICT:%','stale version is rejected');
select throws_like($$select pg_temp.cmd('revert_delivery',jsonb_build_object('id',pg_temp.id('order'),'target','entregado'),2)$$,'VALIDATION_ERROR:%destino%','only pending or cancelled targets exist');
do $$begin perform pg_temp.cmd('revert_delivery',jsonb_build_object('id',pg_temp.id('order'),'target','pendiente_entrega'),2);end$$;
select is((select status from orders where id=pg_temp.id('order')),'pendiente_entrega','order is pending again');
select is((select delivered_at from orders where id=pg_temp.id('order')),null,'delivery timestamp is cleared');
select is(app_private.balance(pg_temp.id('food'),'mendieta'),20::numeric,'delivered units return to stock');
select is((select reserved from order_lines where order_id=pg_temp.id('order')),2::numeric,'pending order reserves stock again');
select is((select coalesce(sum(amount),0) from financial_movements where order_id=pg_temp.id('order')),200::numeric,'collections are untouched');
select throws_like($$select pg_temp.cmd('revert_delivery',jsonb_build_object('id',pg_temp.id('order'),'target','pendiente_entrega'),3)$$,'INVALID_TRANSITION:%','a pending order cannot be reverted');

-- Re-delivery and a second revert reverse only the new movement, never the first one twice.
do $$begin perform pg_temp.cmd('deliver_order',jsonb_build_object('id',pg_temp.id('order'),'payment_status','pagado'),3);end$$;
select is(app_private.balance(pg_temp.id('food'),'mendieta'),18::numeric,'second delivery consumes again');
do $$begin perform pg_temp.cmd('revert_delivery',jsonb_build_object('id',pg_temp.id('order'),'target','pendiente_entrega'),4);end$$;
select is(app_private.balance(pg_temp.id('food'),'mendieta'),20::numeric,'second revert restores exactly once');
select is((select count(*) from movements where reversal_of in (select id from movements where event_id=pg_temp.id('order') and kind='delivery')),2::bigint,'each delivery movement is reversed exactly once');

-- Delivered with collections cannot be cancelled until the collection is reverted.
do $$begin perform pg_temp.cmd('deliver_order',jsonb_build_object('id',pg_temp.id('order'),'payment_status','pagado'),5);end$$;
select throws_like($$select pg_temp.cmd('revert_delivery',jsonb_build_object('id',pg_temp.id('order'),'target','cancelado'),6)$$,'INVALID_TRANSITION:%cobros%','paid delivery cannot be cancelled');
select is(app_private.balance(pg_temp.id('food'),'mendieta'),18::numeric,'failed cancellation leaves the delivery intact');

-- Unpaid delivery -> cancelled restores stock.
insert into revert_fixture values('unpaid',pg_temp.cmd('save_order',pg_temp.sale(pg_temp.wed(1),'3')));
do $$begin perform pg_temp.cmd('deliver_order',jsonb_build_object('id',pg_temp.id('unpaid'),'payment_status','no_pagado'),1);end$$;
select is(app_private.balance(pg_temp.id('food'),'mendieta'),15::numeric,'unpaid delivery consumed stock');
do $$begin perform pg_temp.cmd('revert_delivery',jsonb_build_object('id',pg_temp.id('unpaid'),'target','cancelado'),2);end$$;
select is((select status from orders where id=pg_temp.id('unpaid')),'cancelado','unpaid delivery becomes cancelled');
select is(app_private.balance(pg_temp.id('food'),'mendieta'),18::numeric,'cancellation restores stock');

-- Spontaneous sales accept any date, in the past and the future.
insert into revert_fixture values('past',pg_temp.cmd('save_order',pg_temp.sale(current_date-14,'1')||'{"sale_kind":"espontanea"}'));
insert into revert_fixture values('future_sunday',pg_temp.cmd('save_order',pg_temp.sale(current_date+14,'1')||'{"sale_kind":"espontanea"}'));
select is((select pickup_date from orders where id=pg_temp.id('past')),current_date-14,'past spontaneous sale keeps its date');
select is((select pickup_date from orders where id=pg_temp.id('future_sunday')),current_date+14,'future spontaneous sale keeps its date');
select is((select status from orders where id=pg_temp.id('past')),'entregado','spontaneous sales are delivered immediately');
select is(app_private.balance(pg_temp.id('food'),'mendieta'),16::numeric,'both spontaneous sales consumed stock');
select throws_like($$select pg_temp.cmd('revert_delivery',jsonb_build_object('id',pg_temp.id('past'),'target','pendiente_entrega'),(select version from orders where id=pg_temp.id('past')))$$,'INVALID_TRANSITION:%espont%','a spontaneous sale cannot become pending');
do $$begin perform pg_temp.cmd('revert_delivery',jsonb_build_object('id',pg_temp.id('past'),'target','cancelado'),(select version from orders where id=pg_temp.id('past')));end$$;
select is(app_private.balance(pg_temp.id('food'),'mendieta'),17::numeric,'cancelling a spontaneous sale restores its stock');

-- Pickup points only act on their own orders.
set local request.jwt.claim.sub='d1000000-0000-4000-8000-000000000002';
select throws_like($$select pg_temp.cmd('revert_delivery',jsonb_build_object('id',pg_temp.id('order'),'target','pendiente_entrega'),(select version from orders where id=pg_temp.id('order')))$$,'FORBIDDEN:%','another point cannot revert this delivery');
select * from finish();
rollback;
