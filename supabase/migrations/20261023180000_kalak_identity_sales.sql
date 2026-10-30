-- KALAK: additive identity boundaries, commercial quantities and immutable sale history.
-- Deploy after the four existing migrations; no operational rows are deleted.
create table public.app_members (
 id uuid primary key references auth.users(id),
 role text not null check(role in ('admin','responsable')),
 location_id text references public.locations(id),
 display_name text not null check(length(trim(display_name)) between 1 and 200),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((role='admin' and location_id is null) or (role='responsable' and location_id is not null and location_id<>'cocina'))
);
alter table public.app_members enable row level security;
create policy backend_access on public.app_members for all to pedidos_stock_backend using(true) with check(true);
grant select,insert,update on public.app_members to pedidos_stock_backend;
grant usage on schema auth to pedidos_stock_backend;
grant execute on function auth.uid() to pedidos_stock_backend;
grant select(id,email,raw_user_meta_data) on auth.users to pedidos_stock_backend;
alter table app_private.commands add column actor_id uuid;
alter table public.clients add column created_at timestamptz,add column created_by uuid;
alter table public.clients alter column created_at set default now();
-- Existing duplicate phones are retained and flagged by this invariant on subsequent writes.
-- The advisory command lock makes normalized duplicate checks race-safe without deleting history.
create function app_private.normalized_phone(phone text) returns text language sql immutable set search_path=pg_catalog as $$
select regexp_replace(coalesce(phone,''),'[^0-9]','','g')$$;
alter table public.clients add column normalized_phone text generated always as (app_private.normalized_phone(phone)) stored;
create index clients_normalized_phone_idx on public.clients(normalized_phone) where normalized_phone<>'';
alter table public.items add column package_size numeric(24,6) check(package_size>0);
do $$declare c record;begin
for c in select conname from pg_constraint where conrelid='public.items'::regclass and contype='c' and pg_get_constraintdef(oid) like '%kind%product%unit%' loop
execute format('alter table public.items drop constraint %I',c.conname);end loop;end$$;
alter table public.items add constraint commercial_product_unit check(kind<>'product' or unit in ('kg','unidad'));
alter table public.orders alter column client_id drop not null;
alter table public.orders add column sale_kind text not null default 'pedido' check(sale_kind in ('pedido','espontanea')),add column stock_shortage_confirmed boolean not null default false,
 add column created_by uuid,add column updated_by uuid,add column delivered_by uuid,add column cancelled_at timestamptz,add column cancelled_by uuid,add column payment_confirmed_at timestamptz,add column payment_confirmed_by uuid;
alter table public.financial_movements add column actor_id uuid;
alter table public.movements add column actor_id uuid;
alter table public.audit_events add column before_data jsonb,add column after_data jsonb,add column request_data jsonb,add column location_id text references public.locations;
-- The old view/function have integer return types; rebuild dependent allocation views below.
drop view public.stock_balances;
drop function app_private.order_allocations();
drop view public.order_allocations;
alter table public.order_lines alter column quantity type numeric(24,6),alter column reserved type numeric(24,6),alter column shortage type numeric(24,6);
alter table public.order_lines add column product_package_size numeric(24,6),add column price_effective_on date;
create table public.product_prices (
 id uuid primary key default gen_random_uuid(),product_id uuid not null references public.items,
 price numeric(24,2) not null check(price>=0),effective_on date not null,
 created_at timestamptz not null default clock_timestamp(),actor_id uuid
);
create index product_prices_effective_idx on public.product_prices(product_id,effective_on desc,created_at desc,id desc);
insert into public.product_prices(product_id,price,effective_on) select id,price,'0001-01-01' from public.items where kind='product';
alter table public.product_prices enable row level security;
create policy backend_access on public.product_prices for all to pedidos_stock_backend using(true) with check(true);
grant select,insert on public.product_prices to pedidos_stock_backend;
create trigger immutable_rows before update or delete on public.product_prices for each row execute function app_private.immutable();
create trigger immutable_truncate before truncate on public.product_prices for each statement execute function app_private.immutable();
create function app_private.product_price(product uuid,on_date date) returns numeric language sql stable set search_path=pg_catalog,public as $$
select p.price from public.product_prices p where p.product_id=product and p.effective_on<=on_date order by p.effective_on desc,p.created_at desc,p.id desc limit 1$$;
create function app_private.product_quantity(product uuid,value text) returns numeric language plpgsql stable set search_path=pg_catalog,public,app_private as $$
declare n numeric;u text;begin n:=app_private.decimal(value,true);select unit into u from public.items where id=product;
if u='unidad' and n<>trunc(n) then raise exception 'VALIDATION_ERROR: cantidad por unidad debe ser entera';end if;return n;end$$;
create function app_private.order_audit_snapshot(order_id uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
select to_jsonb(o)||jsonb_build_object('order_id',o.id,'total',o.total::text,'paid_amount',(select coalesce(sum(f.amount),0)::text from public.financial_movements f where f.order_id=o.id),'payment_status',case when o.total<=coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=o.id),0) then 'pagado' else 'no_pagado' end,'lines',(select jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',l.quantity::text,'unit_price',l.unit_price::text,'product_package_size',l.product_package_size::text)) from public.order_lines l where l.order_id=o.id)) from public.orders o where o.id=order_id$$;
create function app_private.require_member() returns public.app_members language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare member public.app_members;begin
if auth.uid() is null then raise exception 'AUTH_REQUIRED: iniciar sesión';end if;
select * into member from public.app_members where id=auth.uid() and active;
if not found then raise exception 'FORBIDDEN: usuario sin acceso asignado';end if;
return member;end$$;
create function app_private.stamp_actor() returns trigger language plpgsql set search_path=pg_catalog as $$begin new.actor_id:=auth.uid();return new;end$$;
create trigger stamp_actor before insert on public.movements for each row execute function app_private.stamp_actor();
create trigger stamp_actor before insert on public.financial_movements for each row execute function app_private.stamp_actor();
create function app_private.sync_payment_confirmation() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin
if new.order_id is not null then
update public.orders o set payment_confirmed_at=case when o.total>0 and (select coalesce(sum(f.amount),0) from public.financial_movements f where f.order_id=o.id)>=o.total then coalesce(o.payment_confirmed_at,new.created_at) else null end,
payment_confirmed_by=case when o.total>0 and (select coalesce(sum(f.amount),0) from public.financial_movements f where f.order_id=o.id)>=o.total then coalesce(o.payment_confirmed_by,new.actor_id) else null end where o.id=new.order_id;
end if;return new;end$$;
create trigger sync_payment_confirmation after insert on public.financial_movements for each row execute function app_private.sync_payment_confirmation();
update public.orders o set payment_confirmed_at=(select max(created_at) from public.financial_movements f where f.order_id=o.id) where o.total>0 and (select coalesce(sum(amount),0) from public.financial_movements f where f.order_id=o.id)>=o.total;

create view public.order_allocations with(security_invoker=true) as
with pending as (
select l.id,l.quantity,greatest(least(l.quantity,(select coalesce(sum(s.quantity),0) from public.batch_stock s join public.batches b on b.id=s.batch_id where s.item_id=l.product_id and s.location_id=o.location_id and b.expires_on>=(now() at time zone 'America/Argentina/Mendoza')::date)-coalesce(sum(l.quantity) over(partition by l.product_id,o.location_id order by o.stock_shortage_confirmed,o.pickup_date,o.created_at,o.id,l.id rows between unbounded preceding and 1 preceding),0)),0)::numeric assigned
from public.order_lines l join public.orders o on o.id=l.order_id where o.status='pendiente_entrega' and o.sale_kind='pedido')
select id line_id,assigned reserved,quantity-assigned shortage from pending
union all select l.id,0,0 from public.order_lines l join public.orders o on o.id=l.order_id where o.status<>'pendiente_entrega' or o.sale_kind='espontanea';
create function app_private.order_allocations() returns table(line_id uuid,reserved numeric,shortage numeric) language sql stable set search_path=pg_catalog,public as $$select * from public.order_allocations$$;
create or replace function app_private.rebalance() returns uuid[] language plpgsql set search_path=pg_catalog,public,app_private as $$
declare changed uuid[];begin
with updated as(update public.order_lines l set reserved=a.reserved,shortage=a.shortage from app_private.order_allocations() a where l.id=a.line_id and (l.reserved<>a.reserved or l.shortage<>a.shortage) returning l.order_id)
select coalesce(array_agg(distinct order_id),'{}') into changed from updated;
update public.orders set allocation_version=allocation_version+1 where id=any(changed);update public.orders o set stock_shortage_confirmed=false where o.stock_shortage_confirmed and o.status='pendiente_entrega' and not exists(select 1 from public.order_lines l where l.order_id=o.id and l.reserved<l.quantity);return changed;
end$$;
create or replace view public.stock_balances with(security_invoker=true) as
select i.id item_id,l.id location_id,coalesce((select sum(quantity) from public.movements where item_id=i.id and location_id=l.id),0) on_hand,
coalesce((select sum(a.reserved) from public.order_allocations a join public.order_lines ol on ol.id=a.line_id join public.orders o on o.id=ol.order_id where ol.product_id=i.id and o.location_id=l.id),0) reserved,
coalesce((select sum(a.shortage) from public.order_allocations a join public.order_lines ol on ol.id=a.line_id join public.orders o on o.id=ol.order_id where ol.product_id=i.id and o.location_id=l.id),0) shortage
from public.items i cross join public.locations l where i.kind='product' or l.id='cocina';

create or replace function public.app_command(p_command_id uuid,p_operation text,p_payload jsonb,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private,extensions as $$
declare entity uuid; old public.orders%rowtype; pur public.purchases%rowtype; prod public.productions%rowtype; item public.items%rowtype; recipe public.recipes%rowtype; rowdata jsonb; line record; qty numeric; unitprice numeric; actual integer; ver integer; h text; previous app_private.commands%rowtype; result jsonb; affected uuid[]; source text; destination text; expected_keys text[]; loc text; fin public.financial_movements%rowtype; mov public.movements%rowtype; amount numeric; consumed numeric; waste numeric; snap jsonb; closure public.pickup_closures%rowtype; member public.app_members; order_location text; sale text; today date:=(now() at time zone 'America/Argentina/Mendoza')::date; effective date; prior_reservations jsonb; before_snapshot jsonb; after_snapshot jsonb; audit_location text;
begin
member:=app_private.require_member();
perform pg_advisory_xact_lock(742019630182::bigint);
if p_operation is null or p_command_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'VALIDATION_ERROR: comando inválido';end if;
h:=encode(extensions.digest(auth.uid()::text||':'||p_operation||':'||p_payload::text||':'||coalesce(p_expected_version::text,'null'),'sha256'),'hex');
select * into previous from app_private.commands where id=p_command_id;
if found then if previous.actor_id is distinct from auth.uid() then raise exception 'FORBIDDEN: comando de otro usuario';end if;if previous.payload_hash is distinct from h then raise exception 'IDEMPOTENCY_CONFLICT: identificador reutilizado con otro contenido';end if;return previous.result;end if;
expected_keys:=case p_operation
when 'save_client' then array['id','name','phone','email','address','notes','pets'] when 'save_item' then array['id','kind','name','unit','price','minimum','active','category','code','presentation','weight_kg','package_size','price_effective_on'] when 'save_recipe' then array['product_id','yield_quantity','lines']
when 'save_order' then array['id','client_id','pickup_date','location_id','payment_method','notes','lines','pickup_time','uber','packages','prepared_packages','delivery_notes','payment_status','transfer_name','sale_kind','allow_stock_shortage']
when 'save_purchase' then array['id','supplier','expected_date','notes','lines']
when 'plan_production' then array['product_id','recipe_id','planned_date','target_quantity','notes']
when 'finish_production' then array['id','actual_quantity','actual_ingredients','manufactured_on','batch_code','notes'] when 'cancel_production' then array['id','reason']
when 'transfer_stock' then array['item_id','from_location_id','to_location_id','quantity','reason']
when 'adjust_stock' then array['item_id','location_id','quantity','reason','manufactured_on','batch_code']
when 'deliver_order' then array['id','payment_status','method','transfer_name']
when 'reschedule_order' then array['id','pickup_date','allow_stock_shortage']
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
if p_payload ? 'allow_stock_shortage' and jsonb_typeof(p_payload->'allow_stock_shortage')<>'boolean' then raise exception 'VALIDATION_ERROR: confirmación de stock inválida';end if;
if member.role<>'admin' then
if p_operation not in ('save_client','save_order','deliver_order','cancel_order','reschedule_order','record_payment','set_pickup_closure') then raise exception 'FORBIDDEN: operación reservada a administración';end if;
if p_operation in ('save_order','set_pickup_closure') and p_payload->>'location_id' is distinct from member.location_id then raise exception 'FORBIDDEN: local fuera de alcance';end if;
if p_operation in ('deliver_order','cancel_order','reschedule_order','record_payment') or (p_operation='save_order' and p_payload ? 'id') then
select location_id into order_location from public.orders where id=case when p_operation='record_payment' then (p_payload->>'order_id')::uuid else (p_payload->>'id')::uuid end;
if order_location is distinct from member.location_id then raise exception 'FORBIDDEN: pedido fuera de alcance';end if;end if;
if p_operation='save_order' and nullif(p_payload->>'client_id','') is not null and not exists(select 1 from public.clients c where c.id=nullif(p_payload->>'client_id','')::uuid and (c.created_by=auth.uid() or exists(select 1 from public.orders o where o.client_id=c.id and o.location_id=member.location_id))) then raise exception 'FORBIDDEN: cliente fuera de alcance';end if;
if p_operation='save_client' and p_payload ? 'id' and not exists(select 1 from public.clients c where c.id=(p_payload->>'id')::uuid and (c.created_by=auth.uid() or exists(select 1 from public.orders o where o.client_id=c.id and o.location_id=member.location_id))) then raise exception 'FORBIDDEN: cliente fuera de alcance';end if;
end if;
entity:=case when p_operation='save_location' then gen_random_uuid() else coalesce((p_payload->>'id')::uuid,gen_random_uuid()) end;
select coalesce(jsonb_object_agg(product_id::text||'|'||location_id,reserved),'{}'::jsonb) into prior_reservations from (select l.product_id,o.location_id,sum(a.reserved) reserved from app_private.order_allocations() a join public.order_lines l on l.id=a.line_id join public.orders o on o.id=l.order_id where o.id<>entity and o.status='pendiente_entrega' group by l.product_id,o.location_id) x;
select app_private.order_audit_snapshot(o.id) into before_snapshot from public.orders o where o.id=case when p_operation in ('record_payment','record_refund') then (p_payload->>'order_id')::uuid when p_operation='reverse_financial_movement' then (select order_id from public.financial_movements where id=entity) else entity end;
case p_operation
when 'save_client' then
if app_private.normalized_phone(p_payload->>'phone')<>'' and exists(select 1 from public.clients where normalized_phone=app_private.normalized_phone(p_payload->>'phone') and id<>entity) then raise exception 'DUPLICATE_PHONE: ya existe un cliente con este teléfono';end if;
if p_payload ? 'id' then select version into ver from public.clients where id=entity;if not found then raise exception 'VALIDATION_ERROR: cliente inexistente';end if;perform app_private.version(ver,p_expected_version);update public.clients set name=trim(p_payload->>'name'),version=version+1 where id=entity;
else insert into public.clients(id,name,created_by) values(entity,trim(p_payload->>'name'),auth.uid());end if;
update public.clients set phone=coalesce(p_payload->>'phone',phone),email=coalesce(p_payload->>'email',email),address=coalesce(p_payload->>'address',address),notes=coalesce(p_payload->>'notes',notes),pets=coalesce(p_payload->'pets',pets) where id=entity;
perform app_private.validate_pets((select pets from public.clients where id=entity));
update public.clients set pets=coalesce((select jsonb_agg(jsonb_build_object('name',pet->>'name','diet',coalesce(pet->>'diet',''),'weight_kg',nullif(pet->>'weight_kg',''))) from jsonb_array_elements(pets) pet),'[]'::jsonb) where id=entity;
when 'save_item' then
effective:=coalesce(nullif(p_payload->>'price_effective_on','')::date,today);
qty:=app_private.decimal(p_payload->>'minimum');unitprice:=app_private.decimal(p_payload->>'price');
if p_payload->>'kind'='product' and unitprice<>round(unitprice,2) then raise exception 'VALIDATION_ERROR: precio de producto admite hasta 2 decimales';end if;
if p_payload ? 'id' then select * into item from public.items where id=entity;if not found then raise exception 'VALIDATION_ERROR: artículo inexistente';end if;perform app_private.version(item.version,p_expected_version);
if item.kind<>p_payload->>'kind' then raise exception 'VALIDATION_ERROR: no se puede cambiar el tipo';end if;
if item.unit<>p_payload->>'unit' and (exists(select 1 from public.movements where item_id=entity) or exists(select 1 from public.recipe_lines where ingredient_id=entity) or exists(select 1 from public.purchase_lines where ingredient_id=entity) or exists(select 1 from public.order_lines where product_id=entity) or exists(select 1 from public.recipes where product_id=entity)) then raise exception 'VALIDATION_ERROR: unidad usada en historial';end if;
update public.items set name=trim(p_payload->>'name'),unit=p_payload->>'unit',price=unitprice,minimum=qty,active=(p_payload->>'active')::boolean,version=version+1 where id=entity;
else insert into public.items(id,kind,name,unit,price,minimum,active) values(entity,p_payload->>'kind',trim(p_payload->>'name'),p_payload->>'unit',unitprice,qty,(p_payload->>'active')::boolean);end if;
update public.items set category=coalesce(p_payload->>'category',category),code=coalesce(p_payload->>'code',code),presentation=coalesce(p_payload->>'presentation',presentation),weight_kg=case when p_payload ? 'weight_kg' then case when nullif(p_payload->>'weight_kg','') is null then null else app_private.decimal(p_payload->>'weight_kg',true) end else weight_kg end where id=entity;
update public.items set package_size=case when p_payload ? 'package_size' then case when nullif(p_payload->>'package_size','') is null then null else app_private.decimal(p_payload->>'package_size',true) end else package_size end where id=entity;
if p_payload->>'kind'='product' then
if p_payload ? 'id' and effective>today and exists(select 1 from public.items where id=entity and unit is distinct from item.unit) then raise exception 'VALIDATION_ERROR: unidad no puede cambiar con precio futuro';end if;
if not (p_payload ? 'id') and effective>today then raise exception 'VALIDATION_ERROR: producto nuevo requiere precio vigente';end if;
insert into public.product_prices(product_id,price,effective_on,actor_id) values(entity,unitprice,effective,auth.uid());
update public.items set price=app_private.product_price(entity,today) where id=entity;
end if;
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
sale:=coalesce(p_payload->>'sale_kind','pedido');
if sale not in ('pedido','espontanea') then raise exception 'VALIDATION_ERROR: tipo de venta inválido';end if;
if p_payload ? 'allow_stock_shortage' and jsonb_typeof(p_payload->'allow_stock_shortage')<>'boolean' then raise exception 'VALIDATION_ERROR: confirmación de stock inválida';end if;
if sale='espontanea' then
if p_payload ? 'id' then raise exception 'INVALID_TRANSITION: venta inmediata cerrada; utilizar devolución';end if;
p_payload:=jsonb_set(p_payload,'{pickup_date}',to_jsonb(today::text));
end if;
if sale='pedido' and nullif(p_payload->>'client_id','') is null then raise exception 'VALIDATION_ERROR: cliente requerido para pedido';end if;
perform app_private.assert_pickup_open(p_payload->>'location_id',(p_payload->>'pickup_date')::date);
if not exists(select 1 from public.locations where id=p_payload->>'location_id' and ((active and is_pickup) or exists(select 1 from public.orders where id=(p_payload->>'id')::uuid and location_id=p_payload->>'location_id' and status='pendiente_entrega'))) then raise exception 'VALIDATION_ERROR: local de retiro inactivo o inválido';end if;
if p_payload ? 'id' then select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;perform app_private.version(old.version,p_expected_version);if old.status<>'pendiente_entrega' then raise exception 'INVALID_TRANSITION: pedido cerrado';end if;
if old.sale_kind<>sale then raise exception 'INVALID_TRANSITION: tipo de venta no puede cambiar';end if;
update public.orders set updated_by=auth.uid(),client_id=nullif(p_payload->>'client_id','')::uuid,pickup_date=(p_payload->>'pickup_date')::date,location_id=p_payload->>'location_id',payment_method=p_payload->>'payment_method',notes=coalesce(p_payload->>'notes',''),version=version+1 where id=entity;
else insert into public.orders(id,sale_kind,created_by,updated_by,client_id,pickup_date,location_id,payment_method,notes) values(entity,sale,auth.uid(),auth.uid(),nullif(p_payload->>'client_id','')::uuid,(p_payload->>'pickup_date')::date,p_payload->>'location_id',p_payload->>'payment_method',coalesce(p_payload->>'notes',''));end if;
update public.orders set pickup_time=case when p_payload ? 'pickup_time' then nullif(p_payload->>'pickup_time','')::time else pickup_time end,uber=coalesce((p_payload->>'uber')::boolean,uber),packages=coalesce((p_payload->>'packages')::integer,packages),prepared_packages=coalesce((p_payload->>'prepared_packages')::integer,prepared_packages),delivery_notes=coalesce(p_payload->>'delivery_notes',delivery_notes) where id=entity;
if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'VALIDATION_ERROR: productos requeridos';end if;
if (select count(*)<>count(distinct value->>'product_id') from jsonb_array_elements(p_payload->'lines')) then raise exception 'VALIDATION_ERROR: productos duplicados';end if;
for rowdata in select value from jsonb_array_elements(p_payload->'lines') loop
perform app_private.keys(rowdata,array['product_id','quantity']);select * into item from public.items where id=(rowdata->>'product_id')::uuid and kind='product';if not found or (not item.active and not exists(select 1 from public.order_lines where order_id=entity and product_id=item.id)) then raise exception 'VALIDATION_ERROR: producto inexistente o inactivo';end if;
insert into public.order_lines(order_id,product_id,quantity,unit_price,product_name,product_unit,product_package_size,price_effective_on) values(entity,item.id,app_private.product_quantity(item.id,rowdata->>'quantity'),app_private.product_price(item.id,today),item.name,item.unit,item.package_size,(select effective_on from public.product_prices where product_id=item.id and effective_on<=today order by effective_on desc,created_at desc,id desc limit 1)) on conflict(order_id,product_id) do update set quantity=excluded.quantity;end loop;
delete from public.order_lines where order_id=entity and product_id not in (select (value->>'product_id')::uuid from jsonb_array_elements(p_payload->'lines'));
update public.orders set total=(select round(sum(quantity*unit_price),2) from public.order_lines where order_id=entity) where id=entity;
if (select total from public.orders where id=entity)<coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0) then raise exception 'VALIDATION_ERROR: total menor a cobros registrados; revertir el cobro antes de editar';end if;
-- An unpaid selection means a remaining balance, not deletion of historical receipts.
if p_payload->>'payment_status'='no_pagado' and exists(select 1 from public.orders o where o.id=entity and o.total>0 and o.total<=coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0)) then raise exception 'INVALID_TRANSITION: pedido ya pagado; revertir el cobro antes de marcar no pagado';end if;
update public.orders set transfer_name=case when p_payload ? 'transfer_name' then nullif(trim(p_payload->>'transfer_name'),'') else transfer_name end where id=entity;
update public.orders o set payment_confirmed_at=null,payment_confirmed_by=null where o.id=entity and o.total>coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0);
update public.orders set stock_shortage_confirmed=stock_shortage_confirmed or (sale='pedido' and (p_payload->>'pickup_date')::date=today and coalesce((p_payload->>'allow_stock_shortage')::boolean,false) and exists(select 1 from public.order_lines l where l.order_id=entity and app_private.usable_balance(l.product_id,p_payload->>'location_id')-coalesce((prior_reservations->>(l.product_id::text||'|'||(p_payload->>'location_id')))::numeric,0)<l.quantity)) where id=entity;
perform app_private.collect_order_balance(entity,p_payload->>'payment_status',p_payload->>'payment_method');
if sale='espontanea' then
-- Check ALL pending reservations, not just orders preceding the immediate sale by date.
perform app_private.rebalance();
for line in select * from public.order_lines where order_id=entity loop
if app_private.usable_balance(line.product_id,p_payload->>'location_id')-coalesce((select sum(l.reserved) from public.order_lines l join public.orders o on o.id=l.order_id where l.product_id=line.product_id and o.location_id=p_payload->>'location_id' and o.status='pendiente_entrega' and o.sale_kind='pedido'),0)<line.quantity then raise exception 'INSUFFICIENT_STOCK: venta inmediata supera stock libre';end if;
end loop;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) select product_id,p_payload->>'location_id',-quantity,'delivery','Venta espontánea',entity from public.order_lines where order_id=entity;
update public.orders set status='entregado',delivered_at=now(),delivered_by=auth.uid() where id=entity;
elsif (p_payload->>'pickup_date')::date=today and not coalesce((p_payload->>'allow_stock_shortage')::boolean,false) then
-- A new same-day reservation must not displace a reservation already promised to a future order.
if exists(select 1 from public.order_lines l where l.order_id=entity and app_private.usable_balance(l.product_id,p_payload->>'location_id')-coalesce((prior_reservations->>(l.product_id::text||'|'||(p_payload->>'location_id')))::numeric,0)<l.quantity) then raise exception 'STOCK_CONFIRMATION_REQUIRED: stock insuficiente; confirmar pedido con faltante';end if;
end if;

when 'reschedule_order' then
select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;
perform app_private.version(old.version,p_expected_version);
if old.status<>'pendiente_entrega' then raise exception 'INVALID_TRANSITION: solo se reprograman pedidos pendientes';end if;
perform app_private.assert_pickup_open(old.location_id,(p_payload->>'pickup_date')::date);
if (p_payload->>'pickup_date')::date=today and not coalesce((p_payload->>'allow_stock_shortage')::boolean,false) and exists(select 1 from public.order_lines l where l.order_id=entity and app_private.usable_balance(l.product_id,old.location_id)-coalesce((prior_reservations->>(l.product_id::text||'|'||old.location_id))::numeric,0)<l.quantity) then raise exception 'STOCK_CONFIRMATION_REQUIRED: stock insuficiente; confirmar pedido con faltante';end if;
update public.orders set stock_shortage_confirmed=stock_shortage_confirmed or ((p_payload->>'pickup_date')::date=today and coalesce((p_payload->>'allow_stock_shortage')::boolean,false) and exists(select 1 from public.order_lines l where l.order_id=entity and app_private.usable_balance(l.product_id,old.location_id)-coalesce((prior_reservations->>(l.product_id::text||'|'||old.location_id))::numeric,0)<l.quantity)),pickup_date=(p_payload->>'pickup_date')::date,updated_by=auth.uid(),version=version+1 where id=entity;
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
update public.orders set status='entregado',delivered_at=now(),delivered_by=auth.uid(),updated_by=auth.uid(),version=version+1 where id=entity;
else
if coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0)>0 then raise exception 'INVALID_TRANSITION: pedido con cobros; revertir el cobro antes de cancelar';end if;
update public.orders set status='cancelado',cancelled_at=now(),cancelled_by=auth.uid(),updated_by=auth.uid(),version=version+1 where id=entity;end if;
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
qty:=app_private.product_quantity(item.id,p_payload->>'quantity');source:=p_payload->>'from_location_id';destination:=p_payload->>'to_location_id';
if source is null or destination is null or source=destination then raise exception 'VALIDATION_ERROR: origen y destino diferentes requeridos';end if;
perform app_private.rebalance();
if app_private.balance(item.id,source)-coalesce((select sum(l.reserved) from public.order_lines l join public.orders o on o.id=l.order_id where product_id=item.id and o.location_id=source and status='pendiente_entrega'),0)<qty then raise exception 'INSUFFICIENT_STOCK: solo se puede trasladar stock libre';end if;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) values(item.id,source,-qty,'transfer',trim(p_payload->>'reason'),entity),(item.id,destination,qty,'transfer',trim(p_payload->>'reason'),entity);
else
qty:=app_private.decimal(p_payload->>'quantity');source:=p_payload->>'location_id';if qty=0 or (item.kind='product' and item.unit='unidad' and qty<>trunc(qty)) then raise exception 'VALIDATION_ERROR: ajuste inválido';end if;
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
if amount<>old.total-coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=old.id),0) then raise exception 'VALIDATION_ERROR: cobrar el saldo completo; pagos parciales deshabilitados';end if;
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
select app_private.order_audit_snapshot(o.id),o.location_id into after_snapshot,audit_location from public.orders o where o.id=case when p_operation in ('record_payment','record_refund') then old.id when p_operation='reverse_financial_movement' then fin.order_id else entity end;
insert into public.audit_events(command_id,operation,entity_id,actor_id,reason,before_data,after_data,request_data,location_id) values(p_command_id,p_operation,case when p_operation='save_location' then loc else entity::text end,auth.uid()::text,coalesce(p_payload->>'reason',p_payload->>'notes',''),before_snapshot,after_snapshot,p_payload,audit_location);
update public.workspace_events set revision=revision+1,updated_at=clock_timestamp() where id=1;
insert into app_private.commands(id,payload_hash,result,created_at,actor_id) values(p_command_id,h,result,now(),auth.uid());return result;
exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or foreign_key_violation or unique_violation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR: datos inválidos o referencia inexistente (%)',SQLERRM;
end$$;

create function app_private.snapshot_all() returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
'schema_version',2,
'pickup_closures',coalesce((select jsonb_agg(to_jsonb(t) order by pickup_date,location_id) from public.pickup_closures t),'[]'::jsonb),
'locations',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.locations t),'[]'::jsonb),
'clients',coalesce((select jsonb_agg(to_jsonb(t) order by name,id) from public.clients t),'[]'::jsonb),
'items',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('price',case when kind='product' then app_private.product_price(id,(now() at time zone 'America/Argentina/Mendoza')::date)::text else price::text end,'package_size',package_size::text,'price_effective_on',(select p.effective_on from public.product_prices p where p.product_id=t.id and p.effective_on<=(now() at time zone 'America/Argentina/Mendoza')::date order by p.effective_on desc,p.created_at desc,p.id desc limit 1),'minimum',minimum::text,'weight_kg',weight_kg::text) order by name,id) from public.items t),'[]'::jsonb),
'recipes',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('lines',coalesce((select jsonb_agg(jsonb_build_object('ingredient_id',ingredient_id,'quantity',quantity::text,'unit',unit) order by ingredient_id) from public.recipe_lines where recipe_id=t.id),'[]'::jsonb)) order by product_id,revision) from public.recipes t),'[]'::jsonb),
'orders',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('total',total::text,'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',quantity::text,'unit_price',unit_price::text,'product_package_size',product_package_size::text,'reserved',a.reserved::text,'shortage',a.shortage::text) order by id) from public.order_lines l join app_private.order_allocations() a on a.line_id=l.id where order_id=t.id),'[]'::jsonb)) order by pickup_date,created_at,id) from public.orders t),'[]'::jsonb),
'purchases',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('total',total::text,'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',quantity::text,'unit_price',unit_price::text) order by ingredient_id) from public.purchase_lines l where purchase_id=t.id),'[]'::jsonb)) order by expected_date,id) from public.purchases t),'[]'::jsonb),
'productions',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('actual_ingredients',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('quantity',quantity::text,'waste_quantity',waste_quantity::text) order by ingredient_id) from public.production_ingredients a where a.production_id=t.id),'[]'::jsonb)) order by planned_date,created_at,id) from public.productions t),'[]'::jsonb),
'stock',coalesce((select jsonb_agg(jsonb_build_object('item_id',item_id,'location_id',location_id,'on_hand',on_hand::text,'usable',app_private.usable_balance(item_id,location_id)::text,'reserved',reserved::text,'shortage',shortage::text) order by item_id,location_id) from public.stock_balances),'[]'::jsonb),
'movements',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('quantity',quantity::text,'reversed_by',(select id from public.movements where reversal_of=t.id)) order by created_at,id) from public.movements t),'[]'::jsonb),
'batches',coalesce((select jsonb_agg(to_jsonb(t) order by manufactured_on,id) from public.batches t),'[]'::jsonb),
'batch_stock',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('quantity',quantity::text) order by batch_id,location_id) from public.batch_stock t),'[]'::jsonb),
'movement_batches',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('quantity',quantity::text) order by movement_id,batch_id) from public.movement_batches t),'[]'::jsonb),
'financial_movements',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('amount',amount::text) order by occurred_on,created_at,id) from public.financial_movements t),'[]'::jsonb),
'audit_events',coalesce((select jsonb_agg(to_jsonb(t) order by occurred_at,id) from public.audit_events t),'[]'::jsonb),
'updated_at',statement_timestamp());
$$;

create or replace function public.app_export() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,app_private as $$
declare raw jsonb:='{}'; t text; rows jsonb; member public.app_members;begin
member:=app_private.require_member();if member.role<>'admin' then raise exception 'FORBIDDEN: exportación solo administración';end if;
foreach t in array array['app_members','product_prices','locations','pickup_closures','clients','items','recipes','recipe_lines','orders','order_lines','purchases','purchase_lines','productions','production_ingredients','movements','batches','movement_batches','financial_movements','audit_events','workspace_events'] loop
-- Stringify decimal columns to preserve all six digits through JavaScript JSON parsing.
execute format('select coalesce(jsonb_agg(to_jsonb(x)%s),''[]''::jsonb) from public.%I x',case t when 'product_prices' then '||jsonb_build_object(''price'',price::text)' when 'items' then '||jsonb_build_object(''price'',price::text,''minimum'',minimum::text,''weight_kg'',weight_kg::text,''package_size'',package_size::text)' when 'recipe_lines' then '||jsonb_build_object(''quantity'',quantity::text)' when 'order_lines' then '||jsonb_build_object(''quantity'',quantity::text,''reserved'',reserved::text,''shortage'',shortage::text,''product_package_size'',product_package_size::text,''unit_price'',unit_price::text)' when 'orders' then '||jsonb_build_object(''total'',total::text)' when 'purchases' then '||jsonb_build_object(''total'',total::text)' when 'purchase_lines' then '||jsonb_build_object(''quantity'',quantity::text,''unit_price'',unit_price::text)' when 'production_ingredients' then '||jsonb_build_object(''quantity'',quantity::text,''waste_quantity'',waste_quantity::text)' when 'movements' then '||jsonb_build_object(''quantity'',quantity::text)' when 'movement_batches' then '||jsonb_build_object(''quantity'',quantity::text)' when 'financial_movements' then '||jsonb_build_object(''amount'',amount::text)' else '' end,t) into rows;
raw:=raw||jsonb_build_object(t,rows);
end loop;
return jsonb_build_object('format','pedidos-stock','schema_version',2,'exported_at',statement_timestamp(),'data',public.app_snapshot(),'raw_tables',raw,'idempotency_commands',coalesce((select jsonb_agg(to_jsonb(c) order by created_at,id) from app_private.commands c),'[]'::jsonb));
end$$;


-- No operational table or view is anonymously readable. Clients use authenticated vetted RPCs.
do $$declare r record;begin
for r in select c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v') loop
execute format('revoke all on public.%I from public,anon,authenticated',r.relname);
if r.relkind='r' then
execute format('alter table public.%I enable row level security',r.relname);
execute format('drop policy if exists public_read on public.%I',r.relname);
end if;end loop;end$$;
grant select on public.order_allocations,public.stock_balances to pedidos_stock_backend;
-- Realtime only carries an invalidation revision, never an operational payload.
grant select on public.workspace_events to authenticated;
create policy member_revision on public.workspace_events for select to authenticated using(exists(select 1 from public.app_members m where m.id=auth.uid() and m.active));
-- A security-definer lookup is needed by the realtime policy, without exposing membership enumeration.
create function public.app_has_access() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from public.app_members where id=auth.uid() and active)$$;
alter policy member_revision on public.workspace_events using(public.app_has_access());
create or replace function public.app_snapshot() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,app_private as $$
declare member public.app_members; result jsonb; key text;begin
member:=app_private.require_member();result:=app_private.snapshot_all();
result:=result||jsonb_build_object('profile',jsonb_build_object('id',member.id,'role',member.role,'location_id',member.location_id,'display_name',member.display_name));
result:=result||jsonb_build_object('product_prices',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('price',p.price::text) order by effective_on,created_at,id) from public.product_prices p),'[]'::jsonb));
if member.role='admin' then
return result||jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'display_name',coalesce(m.display_name,u.raw_user_meta_data->>'display_name',u.email),'role',m.role,'location_id',m.location_id,'active',coalesce(m.active,false)) order by u.email,u.id) from auth.users u left join public.app_members m on m.id=u.id),'[]'::jsonb));end if;
foreach key in array array['orders','stock','movements','batch_stock','pickup_closures','audit_events'] loop
result:=jsonb_set(result,array[key],coalesce((select jsonb_agg(x) from jsonb_array_elements(result->key) x where x->>'location_id'=member.location_id),'[]'::jsonb));end loop;
result:=jsonb_set(result,'{locations}',coalesce((select jsonb_agg(x) from jsonb_array_elements(result->'locations') x where x->>'id'=member.location_id),'[]'::jsonb));
result:=jsonb_set(result,'{financial_movements}',coalesce((select jsonb_agg(x) from jsonb_array_elements(result->'financial_movements') x where exists(select 1 from public.orders o where o.id=(x->>'order_id')::uuid and o.location_id=member.location_id)),'[]'::jsonb));
result:=jsonb_set(result,'{clients}',coalesce((select jsonb_agg(x) from jsonb_array_elements(result->'clients') x where x->>'created_by'=member.id::text or exists(select 1 from public.orders o where o.client_id=(x->>'id')::uuid and o.location_id=member.location_id)),'[]'::jsonb));
foreach key in array array['purchases','productions','recipes','movement_batches'] loop result:=jsonb_set(result,array[key],'[]'::jsonb);end loop;
result:=jsonb_set(result,'{items}',coalesce((select jsonb_agg(x) from jsonb_array_elements(result->'items') x where x->>'kind'='product'),'[]'::jsonb));
result:=jsonb_set(result,'{batches}',coalesce((select jsonb_agg(x) from jsonb_array_elements(result->'batches') x where exists(select 1 from public.batch_stock s where s.batch_id=(x->>'id')::uuid and s.location_id=member.location_id)),'[]'::jsonb));
return result;end$$;
create function public.app_set_member(p_user_id uuid,p_role text,p_location_id text,p_display_name text,p_active boolean default true) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare member public.app_members;begin
member:=app_private.require_member();if member.role<>'admin' then raise exception 'FORBIDDEN: solo administración';end if;
perform pg_advisory_xact_lock(742019630182::bigint);
if p_user_id=auth.uid() and (p_role<>'admin' or not p_active) then raise exception 'INVALID_TRANSITION: no puede retirar su propio acceso administrador';end if;
if p_role='responsable' and not exists(select 1 from public.locations where id=p_location_id and active and is_pickup) then raise exception 'VALIDATION_ERROR: local activo de retiro requerido';end if;
insert into public.app_members(id,role,location_id,display_name,active) values(p_user_id,p_role,p_location_id,trim(p_display_name),p_active)
on conflict(id) do update set role=excluded.role,location_id=excluded.location_id,display_name=excluded.display_name,active=excluded.active,updated_at=now();
insert into public.audit_events(command_id,operation,entity_id,actor_id,reason) values(gen_random_uuid(),'set_member',p_user_id::text,auth.uid()::text,'Asignación de acceso');
update public.workspace_events set revision=revision+1,updated_at=clock_timestamp() where id=1;
return (select to_jsonb(m) from public.app_members m where id=p_user_id);end$$;
-- Run only from a trusted server/Admin API after creating the first individual Auth user.
create function public.app_bootstrap_admin(p_user_id uuid,p_display_name text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin perform pg_advisory_xact_lock(742019630182::bigint);
if exists(select 1 from public.app_members where role='admin') then raise exception 'INVALID_TRANSITION: administrador inicial ya configurado';end if;
insert into public.app_members(id,role,display_name) values(p_user_id,'admin',trim(p_display_name));
return jsonb_build_object('id',p_user_id,'role','admin');end$$;
revoke all on function public.app_bootstrap_admin(uuid,text) from public,anon,authenticated;
grant execute on function public.app_bootstrap_admin(uuid,text) to service_role;
revoke all on function public.app_set_member(uuid,text,text,text,boolean),public.app_has_access() from public,anon;
grant execute on function public.app_set_member(uuid,text,text,text,boolean),public.app_has_access() to authenticated;
revoke all on function public.app_command(uuid,text,jsonb,integer),public.app_snapshot(),public.app_export() from public,anon;
grant execute on function public.app_command(uuid,text,jsonb,integer),public.app_snapshot(),public.app_export() to authenticated;
revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on all functions in schema app_private to pedidos_stock_backend;
grant create on schema app_private,public to pedidos_stock_backend;
alter function app_private.require_member() owner to pedidos_stock_backend;
alter function app_private.snapshot_all() owner to pedidos_stock_backend;
alter function public.app_has_access() owner to pedidos_stock_backend;
alter function public.app_set_member(uuid,text,text,text,boolean) owner to pedidos_stock_backend;
revoke create on schema app_private,public from pedidos_stock_backend;
