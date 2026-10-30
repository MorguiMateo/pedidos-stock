-- Explicit settlement and pickup availability. Additive: existing money and stock ledgers survive.
alter table public.orders add column transfer_name text check(transfer_name is null or length(transfer_name)<=200);
alter table public.financial_movements add column transfer_name text check(transfer_name is null or length(transfer_name)<=200);
create table public.pickup_closures(
 id uuid primary key default gen_random_uuid(),
 location_id text not null references public.locations,
 pickup_date date not null,
 reason text not null default '' check(length(reason)<=1000),
 version integer not null default 1 check(version>0),
 unique(location_id,pickup_date)
);
alter table public.pickup_closures enable row level security;
revoke all on public.pickup_closures from public,anon,authenticated;
grant select on public.pickup_closures to anon,authenticated;
grant select,insert,update,delete on public.pickup_closures to pedidos_stock_backend;
create policy public_read on public.pickup_closures for select to anon,authenticated using(true);
create policy backend_access on public.pickup_closures for all to pedidos_stock_backend using(true) with check(true);

-- Called only within the command's shared advisory transaction lock.
create function app_private.assert_pickup_open(location text,pickup date) returns void language plpgsql set search_path=pg_catalog,public as $$begin
if exists(select 1 from public.pickup_closures where location_id=location and pickup_date=pickup) then
raise exception 'PICKUP_CLOSED: % está cerrado el %; elegir otra fecha o local',(select name from public.locations where id=location),pickup;
end if;end$$;

-- Remaining balance is always derived from immutable financial entries, never a UI flag.
-- The parent order command owns its single optimistic-version increment and idempotency key.
create function app_private.collect_order_balance(order_id uuid,payment_status text,method text) returns void language plpgsql set search_path=pg_catalog,public as $$
declare balance numeric; sale public.orders%rowtype;begin
if payment_status is distinct from 'pagado' then return;end if;
select * into sale from public.orders where id=order_id;
select sale.total-coalesce(sum(f.amount),0) into balance from public.financial_movements f where f.order_id=sale.id;
if balance>0 then
if method is null or method not in ('efectivo','transferencia') then raise exception 'VALIDATION_ERROR: medio de cobro inválido';end if;
insert into public.financial_movements(kind,order_id,amount,method,category,transfer_name) values('payment',sale.id,balance,method,'venta',case when method='transferencia' then sale.transfer_name else null end);
end if;end$$;
revoke all on function app_private.assert_pickup_open(text,date),app_private.collect_order_balance(uuid,text,text) from public,anon,authenticated;
grant execute on function app_private.assert_pickup_open(text,date),app_private.collect_order_balance(uuid,text,text) to pedidos_stock_backend;

create or replace function public.app_command(p_command_id uuid,p_operation text,p_payload jsonb,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private,extensions as $$
declare entity uuid; old public.orders%rowtype; pur public.purchases%rowtype; prod public.productions%rowtype; item public.items%rowtype; recipe public.recipes%rowtype; rowdata jsonb; line record; qty numeric; unitprice numeric; actual integer; ver integer; h text; previous app_private.commands%rowtype; result jsonb; affected uuid[]; source text; destination text; expected_keys text[]; loc text; fin public.financial_movements%rowtype; mov public.movements%rowtype; amount numeric; consumed numeric; waste numeric; snap jsonb; closure public.pickup_closures%rowtype;
begin
perform pg_advisory_xact_lock(742019630182::bigint);
if p_operation is null or p_command_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'VALIDATION_ERROR: comando inválido';end if;
h:=encode(extensions.digest(p_operation||':'||p_payload::text||':'||coalesce(p_expected_version::text,'null'),'sha256'),'hex');
select * into previous from app_private.commands where id=p_command_id;
if found then if previous.payload_hash is distinct from h then raise exception 'IDEMPOTENCY_CONFLICT: identificador reutilizado con otro contenido';end if;return previous.result;end if;
expected_keys:=case p_operation
when 'save_client' then array['id','name','phone','email','address','notes','pets'] when 'save_item' then array['id','kind','name','unit','price','minimum','active','category','code','presentation','weight_kg'] when 'save_recipe' then array['product_id','yield_quantity','lines']
when 'save_order' then array['id','client_id','pickup_date','location_id','payment_method','notes','lines','pickup_time','uber','packages','prepared_packages','delivery_notes','payment_status','transfer_name']
when 'save_purchase' then array['id','supplier','expected_date','notes','lines']
when 'plan_production' then array['product_id','recipe_id','planned_date','target_quantity','notes']
when 'finish_production' then array['id','actual_quantity','actual_ingredients','manufactured_on','batch_code','notes'] when 'cancel_production' then array['id','reason']
when 'transfer_stock' then array['item_id','from_location_id','to_location_id','quantity','reason']
when 'adjust_stock' then array['item_id','location_id','quantity','reason','manufactured_on','batch_code']
when 'deliver_order' then array['id','payment_status','method','transfer_name']
when 'reschedule_order' then array['id','pickup_date']
when 'set_pickup_closure' then array['location_id','pickup_date','closed','reason'] when 'cancel_order' then array['id'] when 'receive_purchase' then array['id','manufactured_on','batch_code'] when 'cancel_purchase' then array['id'] when 'start_production' then array['id']
when 'save_location' then array['id','name','color','active','is_pickup']
when 'record_payment' then array['order_id','amount','method','occurred_on','notes','transfer_name']
when 'record_refund' then array['order_id','amount','method','occurred_on','notes']
when 'record_expense' then array['amount','method','category','occurred_on','notes','purchase_id']
when 'reconcile_movement' then array['id','reconciled']
when 'return_order' then array['id','reason','restock','refund_amount','method']
when 'reverse_movement' then array['id','reason']
when 'reverse_financial_movement' then array['id','reason']
else null end;
if expected_keys is null then raise exception 'VALIDATION_ERROR: operación desconocida';end if;
perform app_private.keys(p_payload,expected_keys);
if p_payload ? 'payment_status' and (jsonb_typeof(p_payload->'payment_status') is distinct from 'string' or p_payload->>'payment_status' not in ('pagado','no_pagado')) then raise exception 'VALIDATION_ERROR: estado de pago inválido';end if;
if p_payload ? 'transfer_name' and (jsonb_typeof(p_payload->'transfer_name') not in ('string','null') or length(coalesce(p_payload->>'transfer_name',''))>200) then raise exception 'VALIDATION_ERROR: nombre de transferencia inválido';end if;
entity:=case when p_operation='save_location' then gen_random_uuid() else coalesce((p_payload->>'id')::uuid,gen_random_uuid()) end;
case p_operation
when 'save_client' then
if p_payload ? 'id' then select version into ver from public.clients where id=entity;if not found then raise exception 'VALIDATION_ERROR: cliente inexistente';end if;perform app_private.version(ver,p_expected_version);update public.clients set name=trim(p_payload->>'name'),version=version+1 where id=entity;
else insert into public.clients(id,name) values(entity,trim(p_payload->>'name'));end if;
update public.clients set phone=coalesce(p_payload->>'phone',phone),email=coalesce(p_payload->>'email',email),address=coalesce(p_payload->>'address',address),notes=coalesce(p_payload->>'notes',notes),pets=coalesce(p_payload->'pets',pets) where id=entity;
perform app_private.validate_pets((select pets from public.clients where id=entity));
update public.clients set pets=coalesce((select jsonb_agg(jsonb_build_object('name',pet->>'name','diet',coalesce(pet->>'diet',''),'weight_kg',nullif(pet->>'weight_kg',''))) from jsonb_array_elements(pets) pet),'[]'::jsonb) where id=entity;
when 'save_item' then
qty:=app_private.decimal(p_payload->>'minimum');unitprice:=app_private.decimal(p_payload->>'price');
if p_payload->>'kind'='product' and unitprice<>round(unitprice,2) then raise exception 'VALIDATION_ERROR: precio de producto admite hasta 2 decimales';end if;
if p_payload ? 'id' then select * into item from public.items where id=entity;if not found then raise exception 'VALIDATION_ERROR: artículo inexistente';end if;perform app_private.version(item.version,p_expected_version);
if item.kind<>p_payload->>'kind' then raise exception 'VALIDATION_ERROR: no se puede cambiar el tipo';end if;
if item.unit<>p_payload->>'unit' and (exists(select 1 from public.movements where item_id=entity) or exists(select 1 from public.recipe_lines where ingredient_id=entity) or exists(select 1 from public.purchase_lines where ingredient_id=entity)) then raise exception 'VALIDATION_ERROR: unidad usada en historial';end if;
update public.items set name=trim(p_payload->>'name'),unit=p_payload->>'unit',price=unitprice,minimum=qty,active=(p_payload->>'active')::boolean,version=version+1 where id=entity;
else insert into public.items(id,kind,name,unit,price,minimum,active) values(entity,p_payload->>'kind',trim(p_payload->>'name'),p_payload->>'unit',unitprice,qty,(p_payload->>'active')::boolean);end if;
update public.items set category=coalesce(p_payload->>'category',category),code=coalesce(p_payload->>'code',code),presentation=coalesce(p_payload->>'presentation',presentation),weight_kg=case when p_payload ? 'weight_kg' then case when nullif(p_payload->>'weight_kg','') is null then null else app_private.decimal(p_payload->>'weight_kg',true) end else weight_kg end where id=entity;
when 'save_recipe' then
select * into item from public.items where id=(p_payload->>'product_id')::uuid and kind='product' and active;if not found then raise exception 'VALIDATION_ERROR: producto inexistente o inactivo';end if;
select coalesce(max(revision),0) into ver from public.recipes where product_id=item.id;perform app_private.version(ver,p_expected_version);
insert into public.recipes(id,product_id,yield_quantity,revision) values(entity,item.id,app_private.whole(p_payload->>'yield_quantity'),ver+1);
if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'VALIDATION_ERROR: ingredientes requeridos';end if;
for rowdata in select value from jsonb_array_elements(p_payload->'lines') loop
perform app_private.keys(rowdata,array['ingredient_id','quantity','unit']);
select * into item from public.items where id=(rowdata->>'ingredient_id')::uuid and kind='ingredient' and active;if not found then raise exception 'VALIDATION_ERROR: ingrediente inexistente o inactivo';end if;
qty:=app_private.decimal(rowdata->>'quantity',true);perform app_private.convert(qty,rowdata->>'unit',item.unit);
insert into public.recipe_lines values(entity,item.id,qty,rowdata->>'unit');end loop;
when 'save_order' then
perform app_private.assert_pickup_open(p_payload->>'location_id',(p_payload->>'pickup_date')::date);
if not exists(select 1 from public.locations where id=p_payload->>'location_id' and ((active and is_pickup) or exists(select 1 from public.orders where id=(p_payload->>'id')::uuid and location_id=p_payload->>'location_id' and status='pendiente_entrega'))) then raise exception 'VALIDATION_ERROR: local de retiro inactivo o inválido';end if;
if p_payload ? 'id' then select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;perform app_private.version(old.version,p_expected_version);if old.status<>'pendiente_entrega' then raise exception 'INVALID_TRANSITION: pedido cerrado';end if;
update public.orders set client_id=(p_payload->>'client_id')::uuid,pickup_date=(p_payload->>'pickup_date')::date,location_id=p_payload->>'location_id',payment_method=p_payload->>'payment_method',notes=coalesce(p_payload->>'notes',''),version=version+1 where id=entity;
else insert into public.orders(id,client_id,pickup_date,location_id,payment_method,notes) values(entity,(p_payload->>'client_id')::uuid,(p_payload->>'pickup_date')::date,p_payload->>'location_id',p_payload->>'payment_method',coalesce(p_payload->>'notes',''));end if;
update public.orders set pickup_time=case when p_payload ? 'pickup_time' then nullif(p_payload->>'pickup_time','')::time else pickup_time end,uber=coalesce((p_payload->>'uber')::boolean,uber),packages=coalesce((p_payload->>'packages')::integer,packages),prepared_packages=coalesce((p_payload->>'prepared_packages')::integer,prepared_packages),delivery_notes=coalesce(p_payload->>'delivery_notes',delivery_notes) where id=entity;
if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'VALIDATION_ERROR: productos requeridos';end if;
if (select count(*)<>count(distinct value->>'product_id') from jsonb_array_elements(p_payload->'lines')) then raise exception 'VALIDATION_ERROR: productos duplicados';end if;
for rowdata in select value from jsonb_array_elements(p_payload->'lines') loop
perform app_private.keys(rowdata,array['product_id','quantity']);select * into item from public.items where id=(rowdata->>'product_id')::uuid and kind='product';if not found or (not item.active and not exists(select 1 from public.order_lines where order_id=entity and product_id=item.id)) then raise exception 'VALIDATION_ERROR: producto inexistente o inactivo';end if;
insert into public.order_lines(order_id,product_id,quantity,unit_price,product_name,product_unit) values(entity,item.id,app_private.whole(rowdata->>'quantity'),item.price,item.name,item.unit) on conflict(order_id,product_id) do update set quantity=excluded.quantity;end loop;
delete from public.order_lines where order_id=entity and product_id not in (select (value->>'product_id')::uuid from jsonb_array_elements(p_payload->'lines'));
update public.orders set total=(select sum(quantity*unit_price) from public.order_lines where order_id=entity) where id=entity;
if (select total from public.orders where id=entity)<coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0) then raise exception 'VALIDATION_ERROR: total menor a cobros registrados; revertir el cobro antes de editar';end if;
-- An unpaid selection means a remaining balance, not deletion of historical receipts.
if p_payload->>'payment_status'='no_pagado' and exists(select 1 from public.orders o where o.id=entity and o.total>0 and o.total<=coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0)) then raise exception 'INVALID_TRANSITION: pedido ya pagado; revertir el cobro antes de marcar no pagado';end if;
update public.orders set transfer_name=case when p_payload ? 'transfer_name' then nullif(trim(p_payload->>'transfer_name'),'') else transfer_name end where id=entity;
perform app_private.collect_order_balance(entity,p_payload->>'payment_status',p_payload->>'payment_method');
when 'reschedule_order' then
select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;
perform app_private.version(old.version,p_expected_version);
if old.status<>'pendiente_entrega' then raise exception 'INVALID_TRANSITION: solo se reprograman pedidos pendientes';end if;
perform app_private.assert_pickup_open(old.location_id,(p_payload->>'pickup_date')::date);
update public.orders set pickup_date=(p_payload->>'pickup_date')::date,version=version+1 where id=entity;
when 'set_pickup_closure' then
loc:=p_payload->>'location_id';
if not exists(select 1 from public.locations where id=loc and is_pickup) then raise exception 'VALIDATION_ERROR: local de retiro inválido';end if;
if jsonb_typeof(p_payload->'closed') is distinct from 'boolean' or nullif(p_payload->>'pickup_date','') is null then raise exception 'VALIDATION_ERROR: fecha y cierre requeridos';end if;
if p_payload ? 'reason' and (jsonb_typeof(p_payload->'reason') not in ('string','null') or length(coalesce(p_payload->>'reason',''))>1000) then raise exception 'VALIDATION_ERROR: motivo de cierre inválido';end if;
select * into closure from public.pickup_closures where location_id=loc and pickup_date=(p_payload->>'pickup_date')::date;
if found then entity:=closure.id;if p_expected_version is not null then perform app_private.version(closure.version,p_expected_version);end if;
elsif p_expected_version is not null then perform app_private.version(0,p_expected_version);end if;
if (p_payload->>'closed')::boolean then
if exists(select 1 from public.orders where location_id=loc and pickup_date=(p_payload->>'pickup_date')::date and status='pendiente_entrega') then raise exception 'INVALID_TRANSITION: no se puede cerrar % el %: hay pedidos pendientes; reprogramarlos primero',(select name from public.locations where id=loc),p_payload->>'pickup_date';end if;
insert into public.pickup_closures(id,location_id,pickup_date,reason) values(entity,loc,(p_payload->>'pickup_date')::date,trim(coalesce(p_payload->>'reason',''))) on conflict(location_id,pickup_date) do update set reason=excluded.reason,version=public.pickup_closures.version+1;
else delete from public.pickup_closures where location_id=loc and pickup_date=(p_payload->>'pickup_date')::date;end if;
when 'deliver_order','cancel_order' then
select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;perform app_private.version(old.version,p_expected_version);if old.status<>'pendiente_entrega' then raise exception 'INVALID_TRANSITION: pedido cerrado';end if;
if p_operation='deliver_order' then
if p_payload ? 'method' and (p_payload->>'method' is null or p_payload->>'method' not in ('efectivo','transferencia')) then raise exception 'VALIDATION_ERROR: medio de cobro inválido';end if;
update public.orders set payment_method=coalesce(p_payload->>'method',payment_method),transfer_name=case when p_payload ? 'transfer_name' then nullif(trim(p_payload->>'transfer_name'),'') else transfer_name end where id=entity;
perform app_private.collect_order_balance(entity,p_payload->>'payment_status',coalesce(p_payload->>'method',old.payment_method));
perform app_private.rebalance();if exists(select 1 from public.order_lines where order_id=entity and reserved<quantity) then raise exception 'INSUFFICIENT_RESERVED_STOCK: pedido sin reserva completa en el local elegido';end if;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) select product_id,old.location_id,-quantity,'delivery','Entrega de pedido',entity from public.order_lines where order_id=entity;
update public.orders set status='entregado',delivered_at=now(),version=version+1 where id=entity;
else
if coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0)>0 then raise exception 'INVALID_TRANSITION: pedido con cobros; revertir el cobro antes de cancelar';end if;
update public.orders set status='cancelado',version=version+1 where id=entity;end if;
when 'save_purchase' then
if p_payload ? 'id' then select * into pur from public.purchases where id=entity;if not found then raise exception 'VALIDATION_ERROR: compra inexistente';end if;perform app_private.version(pur.version,p_expected_version);if pur.status<>'planificada' then raise exception 'INVALID_TRANSITION: compra cerrada';end if;
update public.purchases set supplier=trim(coalesce(p_payload->>'supplier','')),expected_date=(p_payload->>'expected_date')::date,notes=coalesce(p_payload->>'notes',''),version=version+1 where id=entity;delete from public.purchase_lines where purchase_id=entity;
else insert into public.purchases(id,supplier,expected_date,notes) values(entity,trim(coalesce(p_payload->>'supplier','')),(p_payload->>'expected_date')::date,coalesce(p_payload->>'notes',''));end if;
if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'VALIDATION_ERROR: ingredientes requeridos';end if;
for rowdata in select value from jsonb_array_elements(p_payload->'lines') loop
perform app_private.keys(rowdata,array['ingredient_id','quantity','unit','unit_price']);select * into item from public.items where id=(rowdata->>'ingredient_id')::uuid and kind='ingredient' and active;if not found then raise exception 'VALIDATION_ERROR: ingrediente inexistente o inactivo';end if;
qty:=app_private.decimal(rowdata->>'quantity',true);perform app_private.convert(qty,rowdata->>'unit',item.unit);unitprice:=app_private.decimal(rowdata->>'unit_price');
insert into public.purchase_lines values(entity,item.id,qty,rowdata->>'unit',unitprice);end loop;
update public.purchases set total=(select round(sum(quantity*unit_price),2) from public.purchase_lines where purchase_id=entity) where id=entity;
when 'receive_purchase','cancel_purchase' then
select * into pur from public.purchases where id=entity;if not found then raise exception 'VALIDATION_ERROR: compra inexistente';end if;perform app_private.version(pur.version,p_expected_version);if pur.status<>'planificada' then raise exception 'INVALID_TRANSITION: compra cerrada';end if;
if p_operation='receive_purchase' then
update public.purchases set manufactured_on=(p_payload->>'manufactured_on')::date,batch_code=nullif(trim(p_payload->>'batch_code'),'') where id=entity;
if (p_payload->>'manufactured_on')::date>(now() at time zone 'America/Argentina/Mendoza')::date then raise exception 'VALIDATION_ERROR: fabricación no puede ser futura';end if;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) select l.ingredient_id,'cocina',app_private.convert(l.quantity,l.unit,i.unit),'purchase','Recepción de compra',entity from public.purchase_lines l join public.items i on i.id=l.ingredient_id where purchase_id=entity;
update public.purchases set status='recibida',received_at=now(),version=version+1 where id=entity;
else update public.purchases set status='cancelada',version=version+1 where id=entity;end if;
when 'plan_production' then
select * into recipe from public.recipes where id=(p_payload->>'recipe_id')::uuid and product_id=(p_payload->>'product_id')::uuid;if not found then raise exception 'VALIDATION_ERROR: receta no corresponde al producto';end if;
if not exists(select 1 from public.items where id=recipe.product_id and active) then raise exception 'VALIDATION_ERROR: producto inactivo';end if;
select to_jsonb(recipe)||jsonb_build_object('lines',(select jsonb_agg(jsonb_build_object('ingredient_id',l.ingredient_id,'quantity',l.quantity::text,'unit',l.unit,'name',i.name,'catalog_unit',i.unit) order by l.ingredient_id) from public.recipe_lines l join public.items i on i.id=l.ingredient_id where recipe_id=recipe.id)) into snap;
insert into public.productions(id,product_id,recipe_id,planned_date,target_quantity,notes,recipe_snapshot) values(entity,recipe.product_id,recipe.id,(p_payload->>'planned_date')::date,app_private.whole(p_payload->>'target_quantity'),coalesce(p_payload->>'notes',''),snap);
when 'start_production','finish_production','cancel_production' then
select * into prod from public.productions where id=entity;if not found then raise exception 'VALIDATION_ERROR: producción inexistente';end if;perform app_private.version(prod.version,p_expected_version);
if p_operation='start_production' then
if prod.status<>'planificado' then raise exception 'INVALID_TRANSITION: producción no planificada';end if;
select * into recipe from public.recipes where id=prod.recipe_id;
for line in select l.*,i.unit catalog_unit from public.recipe_lines l join public.items i on i.id=l.ingredient_id where recipe_id=prod.recipe_id order by l.ingredient_id loop
qty:=round(app_private.convert(line.quantity,line.unit,line.catalog_unit)*prod.target_quantity/recipe.yield_quantity,6);
if qty<=0 then raise exception 'VALIDATION_ERROR: consumo menor que precisión de stock';end if;
if app_private.balance(line.ingredient_id,'cocina')<qty then raise exception 'INSUFFICIENT_STOCK: ingredientes insuficientes';end if;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) values(line.ingredient_id,'cocina',-qty,'production_consumption','Inicio de producción',entity);end loop;
update public.productions set status='en_produccion',started_at=now(),version=version+1 where id=entity;
elsif p_operation='finish_production' then
if prod.status<>'en_produccion' then raise exception 'INVALID_TRANSITION: producción no iniciada';end if;actual:=app_private.whole(p_payload->>'actual_quantity');
if p_payload ? 'actual_ingredients' then
if jsonb_typeof(p_payload->'actual_ingredients')<>'array' or jsonb_array_length(p_payload->'actual_ingredients')=0 then raise exception 'VALIDATION_ERROR: consumos reales requeridos';end if;
if (select count(*)<>count(distinct value->>'ingredient_id') from jsonb_array_elements(p_payload->'actual_ingredients')) then raise exception 'VALIDATION_ERROR: ingredientes duplicados';end if;
for rowdata in select value from jsonb_array_elements(p_payload->'actual_ingredients') loop
perform app_private.keys(rowdata,array['ingredient_id','quantity','unit','waste_quantity']);
select * into item from public.items where id=(rowdata->>'ingredient_id')::uuid and kind='ingredient';if not found then raise exception 'VALIDATION_ERROR: ingrediente inexistente';end if;
qty:=app_private.convert(app_private.decimal(rowdata->>'quantity'),rowdata->>'unit',item.unit);waste:=app_private.convert(app_private.decimal(coalesce(rowdata->>'waste_quantity','0')),rowdata->>'unit',item.unit);
if qty<0 or waste<0 then raise exception 'VALIDATION_ERROR: consumo y merma no negativos';end if;
insert into public.production_ingredients(production_id,ingredient_id,quantity,unit,waste_quantity) values(entity,item.id,qty,item.unit,waste);
end loop;
else
insert into public.production_ingredients(production_id,ingredient_id,quantity,unit,waste_quantity) select entity,m.item_id,-sum(m.quantity),i.unit,0 from public.movements m join public.items i on i.id=m.item_id where m.event_id=entity and m.kind='production_consumption' group by m.item_id,i.unit;
end if;
-- Replace estimated start quantities with exact used + wasted quantities, append-only.
for line in select i.id ingredient_id,coalesce(a.quantity,0) quantity,coalesce(a.waste_quantity,0) waste_quantity,coalesce((select -sum(m.quantity) from public.movements m where m.event_id=entity and m.item_id=i.id and m.kind='production_consumption'),0) consumed from public.items i left join public.production_ingredients a on a.ingredient_id=i.id and a.production_id=entity where i.kind='ingredient' and (a.ingredient_id is not null or exists(select 1 from public.movements m where m.event_id=entity and m.item_id=i.id and m.kind='production_consumption')) loop
qty:=line.consumed-line.quantity-line.waste_quantity;
if app_private.balance(line.ingredient_id,'cocina')+qty<0 then raise exception 'INSUFFICIENT_STOCK: consumo real supera ingredientes disponibles';end if;
if qty<>0 then insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) values(line.ingredient_id,'cocina',qty,'production_correction','Diferencia de consumo real y merma',entity);end if;
end loop;
update public.productions set manufactured_on=coalesce((p_payload->>'manufactured_on')::date,(now() at time zone 'America/Argentina/Mendoza')::date),batch_code=coalesce(nullif(trim(p_payload->>'batch_code'),''),'L-'||left(entity::text,8)),notes=coalesce(p_payload->>'notes',notes) where id=entity;
if (select manufactured_on from public.productions where id=entity)>(now() at time zone 'America/Argentina/Mendoza')::date then raise exception 'VALIDATION_ERROR: fabricación no puede ser futura';end if;
update public.productions set expires_on=(manufactured_on+interval '4 months')::date where id=entity;
insert into public.batches(item_id,code,manufactured_on,expires_on,production_id) select product_id,batch_code,manufactured_on,expires_on,id from public.productions where id=entity;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) values(prod.product_id,'cocina',actual,'production_output','Producción finalizada',entity);
update public.productions set status='finalizado',actual_quantity=actual,finished_at=now(),version=version+1 where id=entity;
else
if prod.status not in ('planificado','en_produccion') then raise exception 'INVALID_TRANSITION: producción cerrada';end if;
if length(trim(coalesce(p_payload->>'reason','')))=0 then raise exception 'VALIDATION_ERROR: motivo requerido';end if;
update public.productions set status='cancelado',cancellation_reason=trim(p_payload->>'reason'),version=version+1 where id=entity;end if;
when 'transfer_stock','adjust_stock' then
entity:=p_command_id;select * into item from public.items where id=(p_payload->>'item_id')::uuid;if not found then raise exception 'VALIDATION_ERROR: artículo inexistente';end if;
if length(trim(coalesce(p_payload->>'reason','')))=0 then raise exception 'VALIDATION_ERROR: motivo requerido';end if;
if p_operation='transfer_stock' then
if item.kind<>'product' then raise exception 'VALIDATION_ERROR: solo productos terminados';end if;
qty:=app_private.whole(p_payload->>'quantity');source:=p_payload->>'from_location_id';destination:=p_payload->>'to_location_id';
if source is null or destination is null or source=destination then raise exception 'VALIDATION_ERROR: origen y destino diferentes requeridos';end if;
perform app_private.rebalance();
if app_private.balance(item.id,source)-coalesce((select sum(l.reserved) from public.order_lines l join public.orders o on o.id=l.order_id where product_id=item.id and o.location_id=source and status='pendiente_entrega'),0)<qty then raise exception 'INSUFFICIENT_STOCK: solo se puede trasladar stock libre';end if;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) values(item.id,source,-qty,'transfer',trim(p_payload->>'reason'),entity),(item.id,destination,qty,'transfer',trim(p_payload->>'reason'),entity);
else
qty:=app_private.decimal(p_payload->>'quantity');source:=p_payload->>'location_id';if qty=0 or (item.kind='product' and qty<>trunc(qty)) then raise exception 'VALIDATION_ERROR: ajuste inválido';end if;
if item.kind='ingredient' and source<>'cocina' then raise exception 'VALIDATION_ERROR: ingredientes solo en cocina';end if;
if app_private.balance(item.id,source)+qty<0 then raise exception 'INSUFFICIENT_STOCK: ajuste dejaría stock negativo';end if;
if qty<0 and (p_payload ? 'manufactured_on' or p_payload ? 'batch_code') then raise exception 'VALIDATION_ERROR: fecha y lote solo para ingreso positivo';end if;
if nullif(p_payload->>'manufactured_on','')::date>(now() at time zone 'America/Argentina/Mendoza')::date then raise exception 'VALIDATION_ERROR: fabricación no puede ser futura';end if;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id,manufactured_on,batch_code) values(item.id,source,qty,'adjustment',trim(p_payload->>'reason'),entity,nullif(p_payload->>'manufactured_on','')::date,nullif(trim(p_payload->>'batch_code'),''));end if;
when 'save_location' then
loc:=coalesce(nullif(trim(p_payload->>'id'),''),'local-'||left(entity::text,8));
if p_payload ? 'id' then
select version into ver from public.locations where id=loc;if not found then raise exception 'VALIDATION_ERROR: local inexistente';end if;perform app_private.version(ver,p_expected_version);
if coalesce((p_payload->>'active')::boolean,true)=false and exists(select 1 from public.orders where location_id=loc and status='pendiente_entrega') then raise exception 'INVALID_TRANSITION: local con pedidos pendientes';end if;
update public.locations set name=trim(p_payload->>'name'),color=p_payload->>'color',active=coalesce((p_payload->>'active')::boolean,active),is_pickup=coalesce((p_payload->>'is_pickup')::boolean,is_pickup),version=version+1 where id=loc;
else insert into public.locations(id,name,color,active,is_pickup) values(loc,trim(p_payload->>'name'),p_payload->>'color',coalesce((p_payload->>'active')::boolean,true),coalesce((p_payload->>'is_pickup')::boolean,true));end if;
when 'record_payment','record_expense','record_refund' then
amount:=app_private.decimal(p_payload->>'amount',true);if amount<>round(amount,2) then raise exception 'VALIDATION_ERROR: importe admite hasta 2 decimales';end if;
if p_operation in ('record_payment','record_refund') then
select * into old from public.orders where id=(p_payload->>'order_id')::uuid;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;
if p_expected_version is not null then perform app_private.version(old.version,p_expected_version);end if;
if p_operation='record_payment' then
if p_payload->>'method' is null or p_payload->>'method' not in ('efectivo','transferencia') then raise exception 'VALIDATION_ERROR: medio de cobro inválido';end if;
if old.status='cancelado' or old.returned_at is not null then raise exception 'INVALID_TRANSITION: pedido cancelado o devuelto';end if;
if amount+coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=old.id),0)>old.total then raise exception 'VALIDATION_ERROR: pago supera saldo del pedido';end if;
else
if old.returned_at is null and old.status<>'cancelado' then raise exception 'INVALID_TRANSITION: reintegro requiere pedido devuelto o cancelado';end if;
if amount>coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=old.id),0) then raise exception 'VALIDATION_ERROR: reintegro supera cobros';end if;
end if;
end if;
insert into public.financial_movements(id,kind,order_id,purchase_id,amount,method,category,occurred_on,notes,transfer_name)
values(entity,case when p_operation='record_payment' then 'payment' when p_operation='record_refund' then 'refund' else 'expense' end,case when p_operation in ('record_payment','record_refund') then old.id else null end,(p_payload->>'purchase_id')::uuid,case when p_operation='record_payment' then amount else -amount end,p_payload->>'method',coalesce(p_payload->>'category',case when p_operation='record_payment' then 'venta' when p_operation='record_refund' then 'devolucion' else 'general' end),coalesce((p_payload->>'occurred_on')::date,(now() at time zone 'America/Argentina/Mendoza')::date),coalesce(p_payload->>'notes',''),case when p_operation='record_payment' and p_payload->>'method'='transferencia' then case when p_payload ? 'transfer_name' then nullif(trim(p_payload->>'transfer_name'),'') else old.transfer_name end else null end);
if p_operation='record_payment' then update public.orders set payment_method=p_payload->>'method',transfer_name=case when p_payload ? 'transfer_name' then nullif(trim(p_payload->>'transfer_name'),'') else transfer_name end where id=old.id;end if;
if p_operation in ('record_payment','record_refund') then update public.orders set version=version+1 where id=old.id;end if;
when 'reconcile_movement' then
select * into fin from public.financial_movements where id=entity;if not found then raise exception 'VALIDATION_ERROR: movimiento financiero inexistente';end if;perform app_private.version(fin.version,p_expected_version);
if not p_payload ? 'reconciled' then raise exception 'VALIDATION_ERROR: conciliación requerida';end if;
update public.financial_movements set reconciled=(p_payload->>'reconciled')::boolean,version=version+1 where id=entity;
when 'reverse_financial_movement' then
select * into fin from public.financial_movements where id=entity;if not found then raise exception 'VALIDATION_ERROR: movimiento financiero inexistente';end if;
if fin.kind='reversal' or exists(select 1 from public.financial_movements where reverses_id=entity) then raise exception 'INVALID_TRANSITION: movimiento ya revertido';end if;
if length(trim(coalesce(p_payload->>'reason','')))=0 then raise exception 'VALIDATION_ERROR: motivo requerido';end if;
if fin.order_id is not null and coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=fin.order_id),0)-fin.amount<0 then raise exception 'INVALID_TRANSITION: reversión dejaría cobros negativos';end if;
insert into public.financial_movements(id,kind,order_id,purchase_id,amount,method,category,occurred_on,notes,reverses_id,transfer_name) values(p_command_id,'reversal',fin.order_id,fin.purchase_id,-fin.amount,fin.method,fin.category,(now() at time zone 'America/Argentina/Mendoza')::date,trim(p_payload->>'reason'),entity,fin.transfer_name);if fin.order_id is not null then update public.orders set version=version+1 where id=fin.order_id;end if;entity:=p_command_id;
when 'return_order' then
select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;perform app_private.version(old.version,p_expected_version);
if old.status<>'entregado' or old.returned_at is not null then raise exception 'INVALID_TRANSITION: solo se devuelve una entrega no devuelta';end if;
if length(trim(coalesce(p_payload->>'reason','')))=0 or not p_payload ? 'restock' then raise exception 'VALIDATION_ERROR: motivo y decisión de stock requeridos';end if;
if (p_payload->>'restock')::boolean then
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) select product_id,old.location_id,quantity,'return',trim(p_payload->>'reason'),entity from public.order_lines where order_id=entity;
end if;
amount:=app_private.decimal(coalesce(p_payload->>'refund_amount','0'));if amount<0 or amount<>round(amount,2) then raise exception 'VALIDATION_ERROR: reintegro inválido';end if;
if amount>coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0) then raise exception 'VALIDATION_ERROR: reintegro supera cobros';end if;
if amount>0 then insert into public.financial_movements(kind,order_id,amount,method,category,notes) values('refund',entity,-amount,coalesce(p_payload->>'method',old.payment_method),'devolucion',trim(p_payload->>'reason'));end if;
update public.orders set returned_at=now(),return_reason=trim(p_payload->>'reason'),restocked=(p_payload->>'restock')::boolean,version=version+1 where id=entity;
when 'reverse_movement' then
select * into mov from public.movements where id=entity;if not found then raise exception 'VALIDATION_ERROR: movimiento inexistente';end if;
if mov.kind not in ('adjustment','transfer') or mov.reversal_of is not null or exists(select 1 from public.movements where reversal_of=entity) then raise exception 'INVALID_TRANSITION: solo ajustes y traslados no revertidos';end if;
if length(trim(coalesce(p_payload->>'reason','')))=0 then raise exception 'VALIDATION_ERROR: motivo requerido';end if;
perform app_private.rebalance();
for line in select * from public.movements where id=mov.id or (mov.kind='transfer' and event_id=mov.event_id and kind='transfer') order by quantity desc loop
if exists(select 1 from public.movements where reversal_of=line.id) then raise exception 'INVALID_TRANSITION: traslado ya revertido';end if;
qty:=coalesce((select sum(a.quantity) from public.movement_batches a join public.batches b on b.id=a.batch_id where a.movement_id=line.id and b.expires_on>=(now() at time zone 'America/Argentina/Mendoza')::date),0);
if line.quantity>0 and app_private.usable_balance(line.item_id,line.location_id)-qty<coalesce((select sum(l.reserved) from public.order_lines l join public.orders o on o.id=l.order_id where l.product_id=line.item_id and o.location_id=line.location_id and o.status='pendiente_entrega'),0) then raise exception 'INSUFFICIENT_STOCK: reversión afecta stock consumido o reservado';end if;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id,reversal_of) values(line.item_id,line.location_id,-line.quantity,'reversal',trim(p_payload->>'reason'),p_command_id,line.id);
end loop;entity:=p_command_id;

end case;
affected:=app_private.rebalance();
if p_operation in ('save_order','deliver_order','cancel_order','reschedule_order') and not entity=any(affected) then affected:=array_append(affected,entity);end if;
if p_operation in ('record_payment','record_refund') and not old.id=any(affected) then affected:=array_append(affected,old.id);end if;
if p_operation='reverse_financial_movement' and fin.order_id is not null and not fin.order_id=any(affected) then affected:=array_append(affected,fin.order_id);end if;
result:=jsonb_build_object('id',case when p_operation='save_location' then to_jsonb(loc) else to_jsonb(entity) end,'affected_order_ids',to_jsonb(affected));
insert into public.audit_events(command_id,operation,entity_id,actor_id,reason) values(p_command_id,p_operation,case when p_operation='save_location' then loc else entity::text end,nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',coalesce(p_payload->>'reason',p_payload->>'notes',''));
update public.workspace_events set revision=revision+1,updated_at=clock_timestamp() where id=1;
insert into app_private.commands values(p_command_id,h,result,now());return result;
exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or foreign_key_violation or unique_violation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR: datos inválidos o referencia inexistente (%)',SQLERRM;
end$$;

create or replace function public.app_snapshot() returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
'schema_version',2,
'pickup_closures',coalesce((select jsonb_agg(to_jsonb(t) order by pickup_date,location_id) from public.pickup_closures t),'[]'::jsonb),
'locations',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.locations t),'[]'::jsonb),
'clients',coalesce((select jsonb_agg(to_jsonb(t) order by name,id) from public.clients t),'[]'::jsonb),
'items',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('price',price::text,'minimum',minimum::text,'weight_kg',weight_kg::text) order by name,id) from public.items t),'[]'::jsonb),
'recipes',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('lines',coalesce((select jsonb_agg(jsonb_build_object('ingredient_id',ingredient_id,'quantity',quantity::text,'unit',unit) order by ingredient_id) from public.recipe_lines where recipe_id=t.id),'[]'::jsonb)) order by product_id,revision) from public.recipes t),'[]'::jsonb),
'orders',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('total',total::text,'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('unit_price',unit_price::text,'reserved',a.reserved,'shortage',a.shortage) order by id) from public.order_lines l join app_private.order_allocations() a on a.line_id=l.id where order_id=t.id),'[]'::jsonb)) order by pickup_date,created_at,id) from public.orders t),'[]'::jsonb),
'purchases',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('total',total::text,'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',quantity::text,'unit_price',unit_price::text) order by ingredient_id) from public.purchase_lines l where purchase_id=t.id),'[]'::jsonb)) order by expected_date,id) from public.purchases t),'[]'::jsonb),
'productions',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('actual_ingredients',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('quantity',quantity::text,'waste_quantity',waste_quantity::text) order by ingredient_id) from public.production_ingredients a where a.production_id=t.id),'[]'::jsonb)) order by planned_date,created_at,id) from public.productions t),'[]'::jsonb),
'stock',coalesce((select jsonb_agg(jsonb_build_object('item_id',item_id,'location_id',location_id,'on_hand',on_hand::text,'reserved',reserved::text,'shortage',shortage::text) order by item_id,location_id) from public.stock_balances),'[]'::jsonb),
'movements',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('quantity',quantity::text,'reversed_by',(select id from public.movements where reversal_of=t.id)) order by created_at,id) from public.movements t),'[]'::jsonb),
'batches',coalesce((select jsonb_agg(to_jsonb(t) order by manufactured_on,id) from public.batches t),'[]'::jsonb),
'batch_stock',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('quantity',quantity::text) order by batch_id,location_id) from public.batch_stock t),'[]'::jsonb),
'movement_batches',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('quantity',quantity::text) order by movement_id,batch_id) from public.movement_batches t),'[]'::jsonb),
'financial_movements',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('amount',amount::text) order by occurred_on,created_at,id) from public.financial_movements t),'[]'::jsonb),
'audit_events',coalesce((select jsonb_agg(to_jsonb(t) order by occurred_at,id) from public.audit_events t),'[]'::jsonb),
'updated_at',statement_timestamp());
$$;

create or replace function public.app_export() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,app_private as $$
declare raw jsonb:='{}'; t text; rows jsonb;begin
foreach t in array array['locations','pickup_closures','clients','items','recipes','recipe_lines','orders','order_lines','purchases','purchase_lines','productions','production_ingredients','movements','batches','movement_batches','financial_movements','audit_events','workspace_events'] loop
-- Stringify decimal columns to preserve all six digits through JavaScript JSON parsing.
execute format('select coalesce(jsonb_agg(to_jsonb(x)%s),''[]''::jsonb) from public.%I x',case t when 'items' then '||jsonb_build_object(''price'',price::text,''minimum'',minimum::text,''weight_kg'',weight_kg::text)' when 'recipe_lines' then '||jsonb_build_object(''quantity'',quantity::text)' when 'order_lines' then '||jsonb_build_object(''unit_price'',unit_price::text)' when 'orders' then '||jsonb_build_object(''total'',total::text)' when 'purchases' then '||jsonb_build_object(''total'',total::text)' when 'purchase_lines' then '||jsonb_build_object(''quantity'',quantity::text,''unit_price'',unit_price::text)' when 'production_ingredients' then '||jsonb_build_object(''quantity'',quantity::text,''waste_quantity'',waste_quantity::text)' when 'movements' then '||jsonb_build_object(''quantity'',quantity::text)' when 'movement_batches' then '||jsonb_build_object(''quantity'',quantity::text)' when 'financial_movements' then '||jsonb_build_object(''amount'',amount::text)' else '' end,t) into rows;
raw:=raw||jsonb_build_object(t,rows);
end loop;
return jsonb_build_object('format','pedidos-stock','schema_version',2,'exported_at',statement_timestamp(),'data',public.app_snapshot(),'raw_tables',raw,'idempotency_commands',coalesce((select jsonb_agg(to_jsonb(c) order by created_at,id) from app_private.commands c),'[]'::jsonb));
end$$;

