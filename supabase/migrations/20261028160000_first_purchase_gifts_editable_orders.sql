-- Additive gifts and audited edits. Never rewrite physical or financial history.
alter table public.items add column first_purchase_gift_eligible boolean not null default false;
update public.items set first_purchase_gift_eligible=true where kind='product' and unit='unidad' and lower(trim(name))='bolsa de tela';
alter table public.items add constraint gift_item_unit check(not first_purchase_gift_eligible or (kind='product' and unit='unidad'));
alter table public.order_lines add column is_gift boolean not null default false, add column list_unit_price numeric(24,6);
update public.order_lines set list_unit_price=unit_price;
alter table public.order_lines add constraint gift_line_price check((not is_gift or unit_price=0) and (list_unit_price is null or list_unit_price>=0));

alter table public.orders add column first_purchase_commercial_at timestamptz;
update public.orders set first_purchase_commercial_at=coalesce(delivered_at,created_at) where (status='entregado' or delivered_at is not null) and total>0 and payment_method<>'gratis';

-- Global history is evaluated before point-scoped snapshot filtering. Returned/deleted delivered
-- purchases remain purchases; cancelling/deleting an undelivered claim releases it.
create function app_private.first_purchase_gift(client uuid) returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare first_order public.orders; claim uuid;begin
select * into first_order from public.orders where client_id=client and first_purchase_commercial_at is not null
 order by first_purchase_commercial_at,created_at,id limit 1;
if found then return jsonb_build_object('eligible',first_order.deleted_at is null and first_order.returned_at is null and first_order.status='entregado','order_id',first_order.id,'state',case when first_order.deleted_at is null and first_order.returned_at is null and first_order.status='entregado' then 'first_purchase' else 'unavailable' end);end if;
select o.id into claim from public.orders o where o.client_id=client and o.status='pendiente_entrega' and o.deleted_at is null and exists(select 1 from public.order_lines l where l.order_id=o.id and l.is_gift) order by o.created_at,o.id limit 1;
return jsonb_build_object('eligible',true,'order_id',claim,'state',case when claim is null then 'available' else 'reserved' end);
end$$;
create function app_private.validate_order_gifts(order_id uuid) returns void language plpgsql set search_path=pg_catalog,public,app_private as $$
declare sale public.orders; eligibility jsonb;begin
select * into sale from public.orders where id=order_id;
if sale.deleted_at is not null or sale.status='cancelado' or sale.returned_at is not null or not exists(select 1 from public.order_lines l where l.order_id=sale.id and l.is_gift) then return;end if;
if sale.client_id is null then raise exception 'FIRST_PURCHASE_GIFT_NOT_ELIGIBLE: regalo requiere cliente';end if;
if not exists(select 1 from public.order_lines l where l.order_id=sale.id and not l.is_gift and l.unit_price>0) or sale.payment_method='gratis' then raise exception 'VALIDATION_ERROR: agregar la bolsa de regalo al pedido real con otros productos';end if;
eligibility:=app_private.first_purchase_gift(sale.client_id);
if not (eligibility->>'eligible')::boolean or (eligibility->>'order_id')::uuid is distinct from sale.id or exists(select 1 from public.orders o join public.order_lines l on l.order_id=o.id where o.client_id=sale.client_id and o.id<>sale.id and o.deleted_at is null and o.status='pendiente_entrega' and l.is_gift) then raise exception 'FIRST_PURCHASE_GIFT_NOT_ELIGIBLE: regalo reservado para otro pedido o cliente con compra previa';end if;
end$$;

-- Positive edit deltas restore the exact original consumed lots, including expired lots;
-- negative deltas use ordinary FEFO and cannot consume expired units.
do $migration$ declare definition text;begin
definition:=pg_get_functiondef('app_private.allocate_movement(public.movements)'::regprocedure);
definition:=replace(definition,'if m.quantity>0 then', $patch$
if m.kind='delivery_edit' and m.quantity>0 then
remaining:=m.quantity;
for r in select a.batch_id,-sum(a.quantity) quantity from public.movement_batches a join public.movements source on source.id=a.movement_id where source.event_id=m.event_id and source.item_id=m.item_id and source.location_id=m.location_id and source.kind in ('delivery','delivery_edit') group by a.batch_id having sum(a.quantity)<0 order by a.batch_id loop
take:=least(remaining,r.quantity);insert into public.movement_batches values(m.id,r.batch_id,take);remaining:=remaining-take;exit when remaining=0;
end loop;
if remaining>0 then raise exception 'VALIDATION_ERROR: corrección supera entrega original';end if;return;
end if;
if m.quantity>0 then$patch$);
definition:=replace(definition,'and source.kind=case when m.kind=''return'' then ''delivery'' else ''transfer'' end and source.quantity<0', 'and ((m.kind=''return'' and source.kind in (''delivery'',''delivery_edit'')) or (m.kind=''transfer'' and source.kind=''transfer'' and source.quantity<0))');
definition:=replace(definition,'m.kind in (''delivery'',''production_consumption''', 'm.kind in (''delivery'',''delivery_edit'',''production_consumption''');
definition:=replace(definition,'and source.quantity<0)) group by a.batch_id;', 'and source.quantity<0)) group by a.batch_id having sum(a.quantity)<0;');
execute definition;
end $migration$;

create function app_private.save_editable_order(entity uuid,p jsonb,expected_version integer) returns void language plpgsql set search_path=pg_catalog,public,app_private as $$
declare old public.orders; item public.items; previous public.order_lines; rowdata jsonb; line record; delta record; qty numeric; price numeric; gifted boolean; sale text; loc text; pickup date; client uuid; method text; paid numeric; excess numeric; entry record; take numeric; today date:=(now() at time zone 'America/Argentina/Mendoza')::date; prior jsonb; closed boolean:=false;begin
if p ? 'id' then
select * into old from public.orders where id=entity;
if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;
perform app_private.version(old.version,expected_version);
if old.deleted_at is not null then raise exception 'INVALID_TRANSITION: pedido eliminado';end if;
closed:=old.status='cancelado' or old.returned_at is not null;
end if;
sale:=coalesce(p->>'sale_kind',old.sale_kind,'pedido');loc:=coalesce(p->>'location_id',old.location_id);pickup:=coalesce((p->>'pickup_date')::date,old.pickup_date,today);client:=case when p ? 'client_id' then nullif(p->>'client_id','')::uuid else old.client_id end;method:=coalesce(p->>'payment_method',old.payment_method,'desconocido');
if sale not in ('pedido','espontanea') or (old.id is not null and sale<>old.sale_kind) then raise exception 'INVALID_TRANSITION: tipo de venta no puede cambiar';end if;
if sale='espontanea' and old.id is null then pickup:=today;end if;
if sale='pedido' and client is null then raise exception 'VALIDATION_ERROR: cliente requerido para pedido';end if;
if method not in ('efectivo','transferencia','gratis','desconocido') then raise exception 'VALIDATION_ERROR: medio de pago inválido';end if;
if not exists(select 1 from public.locations where id=loc and is_pickup and (active or loc=old.location_id)) then raise exception 'VALIDATION_ERROR: local de retiro inactivo o inválido';end if;
if old.id is null or old.status='pendiente_entrega' then perform app_private.assert_pickup_open(loc,pickup);end if;
if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines')=0 then raise exception 'VALIDATION_ERROR: productos requeridos';end if;
if (select count(*)<>count(distinct value->>'product_id') from jsonb_array_elements(p->'lines')) then raise exception 'VALIDATION_ERROR: productos duplicados';end if;
-- Preserve the complete previous line snapshots for stock deltas and closed-order validation.
select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) into prior from public.order_lines l where order_id=entity;
if closed and (client is distinct from old.client_id or loc<>old.location_id or method<>old.payment_method or sale<>old.sale_kind or pickup<>old.pickup_date) then raise exception 'INVALID_TRANSITION: pedido cancelado o devuelto; solo datos descriptivos';end if;
if old.id is null then
insert into public.orders(id,sale_kind,created_by,updated_by,client_id,pickup_date,location_id,payment_method,notes) values(entity,sale,app_private.actor_id(),app_private.actor_id(),client,pickup,loc,method,coalesce(p->>'notes',''));
else
update public.orders set client_id=client,pickup_date=pickup,location_id=loc,updated_by=app_private.actor_id(),notes=coalesce(p->>'notes',notes),version=version+1 where id=entity;
if method<>old.payment_method then
if method='desconocido' and exists(select 1 from public.financial_movements where order_id=entity) then raise exception 'VALIDATION_ERROR: cobros requieren medio válido';end if;
if method='desconocido' then update public.orders set payment_method=method where id=entity;else perform app_private.change_order_method(entity,method);end if;
end if;
end if;
update public.orders set pickup_time=case when p ? 'pickup_time' then nullif(p->>'pickup_time','')::time else pickup_time end,uber=coalesce((p->>'uber')::boolean,uber),packages=coalesce((p->>'packages')::integer,packages),prepared_packages=coalesce((p->>'prepared_packages')::integer,prepared_packages),delivery_notes=coalesce(p->>'delivery_notes',delivery_notes),transfer_name=case when p ? 'transfer_name' then nullif(trim(p->>'transfer_name'),'') else transfer_name end where id=entity;
for rowdata in select value from jsonb_array_elements(p->'lines') loop
perform app_private.keys(rowdata,array['product_id','quantity','is_gift']);
if rowdata ? 'is_gift' and jsonb_typeof(rowdata->'is_gift') is distinct from 'boolean' then raise exception 'VALIDATION_ERROR: regalo inválido';end if;
select * into previous from public.order_lines where order_id=entity and product_id=(rowdata->>'product_id')::uuid;
select * into item from public.items where id=(rowdata->>'product_id')::uuid and kind='product';
if not found or (not item.active and previous.id is null) then raise exception 'VALIDATION_ERROR: producto inexistente o inactivo';end if;
qty:=app_private.product_quantity(item.id,rowdata->>'quantity');gifted:=coalesce((rowdata->>'is_gift')::boolean,previous.is_gift,false);
if gifted and not coalesce(previous.is_gift,false) and not item.first_purchase_gift_eligible then raise exception 'VALIDATION_ERROR: producto no habilitado como regalo de primera compra';end if;
price:=coalesce(previous.list_unit_price,previous.unit_price,app_private.product_price(item.id,today));
if previous.id is null and old.id is null then price:=app_private.product_price(item.id,today);end if;
if closed and (previous.id is null or previous.quantity<>qty or previous.is_gift<>gifted) then raise exception 'INVALID_TRANSITION: pedido cancelado o devuelto; solo datos descriptivos';end if;
insert into public.order_lines(order_id,product_id,quantity,unit_price,list_unit_price,is_gift,product_name,product_unit,product_package_size,price_effective_on)
values(entity,item.id,qty,case when gifted then 0 else price end,price,gifted,item.name,item.unit,item.package_size,(select effective_on from public.product_prices where product_id=item.id and effective_on<=today order by effective_on desc,created_at desc,id desc limit 1))
on conflict(order_id,product_id) do update set quantity=excluded.quantity,unit_price=excluded.unit_price,list_unit_price=excluded.list_unit_price,is_gift=excluded.is_gift;
end loop;
if closed and exists(select 1 from public.order_lines where order_id=entity and product_id not in(select (value->>'product_id')::uuid from jsonb_array_elements(p->'lines'))) then raise exception 'INVALID_TRANSITION: pedido cancelado o devuelto; solo datos descriptivos';end if;
delete from public.order_lines where order_id=entity and product_id not in(select (value->>'product_id')::uuid from jsonb_array_elements(p->'lines'));
perform app_private.validate_order_gifts(entity);
if closed then return;end if;
update public.orders set total=(select round(sum(quantity*unit_price),2) from public.order_lines where order_id=entity) where id=entity;
-- Refund only the excess, preserving original methods and immutable receipts.
select coalesce(sum(amount),0) into paid from public.financial_movements where order_id=entity;
select paid-total into excess from public.orders where id=entity;
if excess>0 then
for entry in select f.method,sum(f.amount) amount from public.financial_movements f where f.order_id=entity group by f.method having sum(f.amount)>0 order by f.method loop
take:=least(excess,entry.amount);insert into public.financial_movements(kind,order_id,amount,method,category,notes) values('refund',entity,-take,entry.method,'correccion_pedido','Reintegro por edición de pedido');excess:=excess-take;exit when excess=0;
end loop;
end if;
if p->>'payment_status'='no_pagado' and exists(select 1 from public.orders o where o.id=entity and o.total>0 and o.total<=coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0)) then raise exception 'INVALID_TRANSITION: pedido ya pagado; revertir el cobro antes de marcar no pagado';end if;
update public.orders o set payment_confirmed_at=null,payment_confirmed_by=null where o.id=entity and o.payment_method<>'gratis' and o.total>coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0);
perform app_private.collect_order_balance(entity,p->>'payment_status',method);
-- Edit only the physical difference. Metadata/payment/gift toggles never deduct twice.
if old.status='entregado' then
for delta in
select product_id,location_id,sum(quantity) quantity from (
 select (x->>'product_id')::uuid product_id,old.location_id location_id,(x->>'quantity')::numeric quantity from jsonb_array_elements(prior) x
 union all select product_id,loc,-quantity from public.order_lines where order_id=entity
) d group by product_id,location_id having sum(quantity)<>0 order by sum(quantity) desc,product_id,location_id loop
if delta.quantity<0 and app_private.usable_balance(delta.product_id,delta.location_id)+delta.quantity<coalesce((select sum(a.reserved) from app_private.coverage_allocations() a join public.order_lines l on l.id=a.line_id join public.orders o on o.id=l.order_id where l.product_id=delta.product_id and o.location_id=delta.location_id and o.status='pendiente_entrega'),0) then raise exception 'INSUFFICIENT_STOCK: edición afecta stock reservado';end if;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) values(delta.product_id,delta.location_id,delta.quantity,'delivery_edit','Corrección de pedido entregado',entity);
end loop;
elsif sale='espontanea' then
perform app_private.rebalance();
for line in select * from public.order_lines where order_id=entity loop
if app_private.usable_balance(line.product_id,loc)-coalesce((select sum(l.reserved) from public.order_lines l join public.orders o on o.id=l.order_id where l.product_id=line.product_id and o.location_id=loc and o.status='pendiente_entrega' and o.id<>entity),0)<line.quantity then raise exception 'INSUFFICIENT_STOCK: venta inmediata supera stock libre';end if;
end loop;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) select product_id,loc,-quantity,'delivery','Venta espontánea',entity from public.order_lines where order_id=entity;
update public.orders set status='entregado',delivered_at=now(),delivered_by=app_private.actor_id() where id=entity;
end if;
end$$;

-- Keep the established authentication, global serialization, idempotence and audit boundary.
do $migration$ declare original text;definition text;begin
original:=pg_get_functiondef('public.app_command(uuid,text,jsonb,integer)'::regprocedure);definition:=original;
definition:=replace(definition,'''package_size'',''price_effective_on'']', '''package_size'',''price_effective_on'',''first_purchase_gift_eligible'']');
definition:=replace(definition,'update public.items set package_size=', $patch$
if p_payload ? 'first_purchase_gift_eligible' and jsonb_typeof(p_payload->'first_purchase_gift_eligible') is distinct from 'boolean' then raise exception 'VALIDATION_ERROR: elegibilidad de regalo inválida';end if;
update public.items set first_purchase_gift_eligible=coalesce((p_payload->>'first_purchase_gift_eligible')::boolean,first_purchase_gift_eligible) where id=entity;
update public.items set package_size=$patch$);
definition:=regexp_replace(definition, E'when ''save_order'' then\nsale:=.*?when ''reschedule_order'' then', $patch$
when 'save_order' then
perform app_private.save_editable_order(entity,p_payload,p_expected_version);
when 'reschedule_order' then$patch$,'s');
definition:=replace(definition,'m.kind=''delivery'' order by m.created_at,m.id', 'm.kind in (''delivery'',''delivery_edit'') order by m.quantity,m.created_at,m.id');
definition:=replace(definition,'order_id,product_id,quantity,unit_price,product_name,product_unit,product_package_size,price_effective_on)', 'order_id,product_id,quantity,unit_price,list_unit_price,product_name,product_unit,product_package_size,price_effective_on)');
definition:=replace(definition,'qty,app_private.product_price(item.id,today),item.name', 'qty,app_private.product_price(item.id,today),app_private.product_price(item.id,today),item.name');
definition:=replace(definition,'end case;'||chr(10)||'if p_operation in (''save_order'',''reschedule_order'')', $patch$
end case;
update public.orders set first_purchase_commercial_at=coalesce(delivered_at,created_at) where id=entity and first_purchase_commercial_at is null and status='entregado' and total>0 and payment_method<>'gratis';
if p_operation in ('save_order','deliver_order','append_spontaneous_sale','set_order_payment_method') then
for line in select distinct o.id from public.orders o join public.order_lines l on l.order_id=o.id where l.is_gift and o.deleted_at is null and o.status in ('pendiente_entrega','entregado') and o.returned_at is null loop
perform app_private.validate_order_gifts(line.id);
end loop;
end if;
if p_operation in ('save_order','reschedule_order')$patch$);
if definition=original or position('perform app_private.save_editable_order' in definition)=0 or position('unit_price,list_unit_price,product_name' in definition)=0 or position('app_private.validate_order_gifts(line.id)' in definition)=0 or position('first_purchase_commercial_at=coalesce' in definition)=0 then raise exception 'Unsupported editable order dispatcher';end if;
execute definition;
end $migration$;

-- Decimal snapshots and backups stay exact, and eligibility exposes no other-point sales detail.
do $migration$ declare definition text;begin
definition:=pg_get_functiondef('app_private.snapshot_all()'::regprocedure);
definition:=replace(definition,'''unit_price'',unit_price::text,''product_package_size''', '''unit_price'',unit_price::text,''list_unit_price'',list_unit_price::text,''product_package_size''');
definition:=replace(definition,'''clients'',coalesce((select jsonb_agg(to_jsonb(t)','''clients'',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object(''first_purchase_gift'',app_private.first_purchase_gift(t.id))');
definition:=replace(definition,'''updated_at'',statement_timestamp()', '''features'',jsonb_build_object(''first_purchase_gifts'',true,''editable_delivered_orders'',true),''updated_at'',statement_timestamp()');execute definition;
definition:=pg_get_functiondef('app_private.order_audit_snapshot(uuid)'::regprocedure);
definition:=replace(definition,'''unit_price'',l.unit_price::text', '''unit_price'',l.unit_price::text,''list_unit_price'',l.list_unit_price::text,''is_gift'',l.is_gift');execute definition;
definition:=pg_get_functiondef('public.app_export()'::regprocedure);
definition:=replace(definition,$from$''product_package_size'',product_package_size::text,''unit_price'',unit_price::text)$from$,$to$''product_package_size'',product_package_size::text,''unit_price'',unit_price::text,''list_unit_price'',list_unit_price::text)$to$);
if position('list_unit_price' in definition)=0 then raise exception 'Unsupported gift price export contract';end if;execute definition;
end $migration$;
revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on all functions in schema app_private to pedidos_stock_backend;
notify pgrst,'reload schema';
