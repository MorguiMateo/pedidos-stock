
-- All mutations are serialized in app_command. Business data is intentionally public-read;
-- no credential or command payload is exposed through the public API.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;
create table public.locations(id text primary key, name text not null, color text not null);
insert into public.locations values ('cocina','Cocina central','#255B46'),('mendieta','Mendieta','#8757D5'),('salta','Salta','#D95555'),('carrodilla','Carrodilla','#319C75');
create table public.clients(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 200),version integer not null default 1);
create table public.items(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('ingredient','product')),name text not null check(length(trim(name)) between 1 and 200),unit text not null check(unit in ('g','kg','ml','l','unidad')),price numeric(24,6) not null check(price>=0),minimum numeric(24,6) not null check(minimum>=0),active boolean not null default true,version integer not null default 1,check(kind<>'product' or unit='unidad'));
create table public.recipes(id uuid primary key default gen_random_uuid(),product_id uuid not null references public.items, yield_quantity integer not null check(yield_quantity>0),revision integer not null check(revision>0),created_at timestamptz not null default now(),unique(product_id,revision));
create table public.recipe_lines(recipe_id uuid not null references public.recipes,ingredient_id uuid not null references public.items,quantity numeric(24,6) not null check(quantity>0),unit text not null check(unit in ('g','kg','ml','l','unidad')),primary key(recipe_id,ingredient_id));
create table public.orders(id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients,pickup_date date not null,location_id text not null references public.locations check(location_id<>'cocina'),payment_method text not null check(payment_method in ('transferencia','efectivo','desconocido')),status text not null default 'pendiente_entrega' check(status in ('pendiente_entrega','entregado','cancelado')),notes text not null default '',total numeric(24,6) not null default 0,version integer not null default 1,allocation_version integer not null default 0,created_at timestamptz not null default now(),delivered_at timestamptz);
create table public.order_lines(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders,product_id uuid not null references public.items,quantity integer not null check(quantity>0),unit_price numeric(24,6) not null check(unit_price>=0),reserved integer not null default 0 check(reserved>=0),shortage integer not null default 0 check(shortage>=0),unique(order_id,product_id));
create table public.purchases(id uuid primary key default gen_random_uuid(),supplier text not null default '' check(length(supplier)<=200),expected_date date not null,received_at timestamptz,status text not null default 'planificada' check(status in ('planificada','recibida','cancelada')),notes text not null default '',total numeric(24,6) not null default 0,version integer not null default 1);
create table public.purchase_lines(purchase_id uuid not null references public.purchases,ingredient_id uuid not null references public.items,quantity numeric(24,6) not null check(quantity>0),unit text not null check(unit in ('g','kg','ml','l','unidad')),unit_price numeric(24,6) not null check(unit_price>=0),primary key(purchase_id,ingredient_id));
create table public.productions(id uuid primary key default gen_random_uuid(),product_id uuid not null references public.items,recipe_id uuid not null references public.recipes,planned_date date not null,target_quantity integer not null check(target_quantity>0),actual_quantity integer check(actual_quantity>0),status text not null default 'planificado' check(status in ('planificado','en_produccion','finalizado','cancelado')),notes text not null default '',cancellation_reason text,version integer not null default 1,created_at timestamptz not null default now(),started_at timestamptz,finished_at timestamptz);
create table public.movements(id uuid primary key default gen_random_uuid(),item_id uuid not null references public.items,location_id text not null references public.locations,quantity numeric(24,6) not null check(quantity<>0),kind text not null,reason text not null,event_id uuid not null,created_at timestamptz not null default now());
create index movements_balance_idx on public.movements(item_id,location_id);
create index order_priority_idx on public.orders(status,pickup_date,created_at,id);
create index order_lines_order_idx on public.order_lines(order_id);
create table app_private.commands(id uuid primary key, payload_hash text not null,result jsonb not null,created_at timestamptz not null default now());

create table public.workspace_events(id smallint primary key check(id=1),revision bigint not null default 0,updated_at timestamptz not null default now());
insert into public.workspace_events(id) values(1);
alter publication supabase_realtime add table public.workspace_events;

create function app_private.immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'INVALID_TRANSITION: immutable ledger or recipe'; end$$;
create trigger immutable_movements before update or delete on public.movements for each row execute function app_private.immutable();
create trigger immutable_movements_truncate before truncate on public.movements for each statement execute function app_private.immutable();
create trigger immutable_recipes before update or delete on public.recipes for each row execute function app_private.immutable();
create trigger immutable_recipe_lines before update or delete on public.recipe_lines for each row execute function app_private.immutable();
create trigger immutable_recipes_truncate before truncate on public.recipes for each statement execute function app_private.immutable();
create trigger immutable_recipe_lines_truncate before truncate on public.recipe_lines for each statement execute function app_private.immutable();
create function app_private.decimal(v text, positive boolean default false) returns numeric language plpgsql immutable set search_path=pg_catalog as $$declare n numeric; begin if v is null or v !~ '^-?[0-9]{1,18}(\.[0-9]{1,6})?$' then raise exception 'VALIDATION_ERROR: decimal con hasta 6 decimales'; end if; n:=v::numeric; if positive and n<=0 then raise exception 'VALIDATION_ERROR: cantidad debe ser positiva'; end if; return n; end$$;
create function app_private.whole(v text) returns integer language plpgsql immutable set search_path=pg_catalog as $$begin if v is null or v !~ '^[0-9]{1,9}$' or v::bigint<=0 then raise exception 'VALIDATION_ERROR: entero positivo requerido'; end if; return v::integer; end$$;
create function app_private.convert(q numeric,source_unit text,destination_unit text) returns numeric language plpgsql immutable set search_path=pg_catalog as $$declare n numeric;begin
if source_unit=destination_unit then n:=q; elsif source_unit='kg' and destination_unit='g' or source_unit='l' and destination_unit='ml' then n:=q*1000; elsif source_unit='g' and destination_unit='kg' or source_unit='ml' and destination_unit='l' then n:=q/1000; else raise exception 'VALIDATION_ERROR: unidades incompatibles'; end if;
if n<>round(n,6) then raise exception 'VALIDATION_ERROR: conversión excede precisión de stock';end if;return n;end$$;
create function app_private.keys(payload jsonb,allowed text[]) returns void language plpgsql set search_path=pg_catalog as $$begin if jsonb_typeof(payload)<>'object' or exists(select 1 from jsonb_object_keys(payload) k where not k=any(allowed)) then raise exception 'VALIDATION_ERROR: campos no permitidos'; end if; end$$;
create function app_private.version(actual integer,expected integer) returns void language plpgsql set search_path=pg_catalog as $$begin if expected is null or actual<>expected then raise exception 'VERSION_CONFLICT: versión cambió; actualizar e intentar nuevamente'; end if; end$$;
create function app_private.balance(item uuid,location text) returns numeric language sql stable set search_path=pg_catalog,public as $$select coalesce(sum(quantity),0) from public.movements where item_id=item and location_id=location$$;
create function app_private.rebalance() returns uuid[] language plpgsql set search_path=pg_catalog,public,app_private as $$
declare r record; available numeric; allocation integer; changed uuid[]:='{}'; prev_item uuid; prev_location text;
begin
-- Group stock buckets, then assign strictly by pickup, creation, order and line IDs.
for r in select l.*,o.location_id,o.status from public.order_lines l join public.orders o on o.id=l.order_id order by l.product_id,o.location_id,o.pickup_date,o.created_at,o.id,l.id loop
if prev_item is distinct from r.product_id or prev_location is distinct from r.location_id then available:=app_private.balance(r.product_id,r.location_id); prev_item:=r.product_id;prev_location:=r.location_id; end if;
allocation:=case when r.status='pendiente_entrega' then least(r.quantity,greatest(available,0))::integer else 0 end;
if r.status='pendiente_entrega' then available:=available-allocation; end if;
if r.reserved<>allocation or r.shortage<>(case when r.status='pendiente_entrega' then r.quantity-allocation else 0 end) then
update public.order_lines set reserved=allocation,shortage=case when r.status='pendiente_entrega' then r.quantity-allocation else 0 end where id=r.id;
if not r.order_id=any(changed) then changed:=array_append(changed,r.order_id);end if;
end if;
end loop;
update public.orders set allocation_version=allocation_version+1 where id=any(changed);
return changed;
end$$;

create function public.app_command(p_command_id uuid,p_operation text,p_payload jsonb,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private,extensions as $$
declare entity uuid; old public.orders%rowtype; pur public.purchases%rowtype; prod public.productions%rowtype; item public.items%rowtype; recipe public.recipes%rowtype; rowdata jsonb; line record; qty numeric; unitprice numeric; actual integer; ver integer; h text; previous app_private.commands%rowtype; result jsonb; affected uuid[]; source text; destination text; expected_keys text[];
begin
perform pg_advisory_xact_lock(742019630182::bigint);
if p_operation is null or p_command_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'VALIDATION_ERROR: comando inválido';end if;
h:=encode(extensions.digest(p_operation||':'||p_payload::text||':'||coalesce(p_expected_version::text,'null'),'sha256'),'hex');
select * into previous from app_private.commands where id=p_command_id;
if found then if previous.payload_hash is distinct from h then raise exception 'IDEMPOTENCY_CONFLICT: identificador reutilizado con otro contenido';end if;return previous.result;end if;
expected_keys:=case p_operation
when 'save_client' then array['id','name'] when 'save_item' then array['id','kind','name','unit','price','minimum','active'] when 'save_recipe' then array['product_id','yield_quantity','lines']
when 'save_order' then array['id','client_id','pickup_date','location_id','payment_method','notes','lines']
when 'save_purchase' then array['id','supplier','expected_date','notes','lines']
when 'plan_production' then array['product_id','recipe_id','planned_date','target_quantity','notes']
when 'finish_production' then array['id','actual_quantity'] when 'cancel_production' then array['id','reason']
when 'transfer_stock' then array['item_id','from_location_id','to_location_id','quantity','reason']
when 'adjust_stock' then array['item_id','location_id','quantity','reason']
when 'deliver_order' then array['id'] when 'cancel_order' then array['id'] when 'receive_purchase' then array['id'] when 'cancel_purchase' then array['id'] when 'start_production' then array['id']
else null end;
if expected_keys is null then raise exception 'VALIDATION_ERROR: operación desconocida';end if;
perform app_private.keys(p_payload,expected_keys);
entity:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
case p_operation
when 'save_client' then
if p_payload ? 'id' then select version into ver from public.clients where id=entity;if not found then raise exception 'VALIDATION_ERROR: cliente inexistente';end if;perform app_private.version(ver,p_expected_version);update public.clients set name=trim(p_payload->>'name'),version=version+1 where id=entity;
else insert into public.clients(id,name) values(entity,trim(p_payload->>'name'));end if;
when 'save_item' then
qty:=app_private.decimal(p_payload->>'minimum');unitprice:=app_private.decimal(p_payload->>'price');
if p_payload ? 'id' then select * into item from public.items where id=entity;if not found then raise exception 'VALIDATION_ERROR: artículo inexistente';end if;perform app_private.version(item.version,p_expected_version);
if item.kind<>p_payload->>'kind' then raise exception 'VALIDATION_ERROR: no se puede cambiar el tipo';end if;
if item.unit<>p_payload->>'unit' and (exists(select 1 from public.movements where item_id=entity) or exists(select 1 from public.recipe_lines where ingredient_id=entity) or exists(select 1 from public.purchase_lines where ingredient_id=entity)) then raise exception 'VALIDATION_ERROR: unidad usada en historial';end if;
update public.items set name=trim(p_payload->>'name'),unit=p_payload->>'unit',price=unitprice,minimum=qty,active=(p_payload->>'active')::boolean,version=version+1 where id=entity;
else insert into public.items(id,kind,name,unit,price,minimum,active) values(entity,p_payload->>'kind',trim(p_payload->>'name'),p_payload->>'unit',unitprice,qty,(p_payload->>'active')::boolean);end if;
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
if p_payload ? 'id' then select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;perform app_private.version(old.version,p_expected_version);if old.status<>'pendiente_entrega' then raise exception 'INVALID_TRANSITION: pedido cerrado';end if;
update public.orders set client_id=(p_payload->>'client_id')::uuid,pickup_date=(p_payload->>'pickup_date')::date,location_id=p_payload->>'location_id',payment_method=p_payload->>'payment_method',notes=coalesce(p_payload->>'notes',''),version=version+1 where id=entity;
else insert into public.orders(id,client_id,pickup_date,location_id,payment_method,notes) values(entity,(p_payload->>'client_id')::uuid,(p_payload->>'pickup_date')::date,p_payload->>'location_id',p_payload->>'payment_method',coalesce(p_payload->>'notes',''));end if;
if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'VALIDATION_ERROR: productos requeridos';end if;
if (select count(*)<>count(distinct value->>'product_id') from jsonb_array_elements(p_payload->'lines')) then raise exception 'VALIDATION_ERROR: productos duplicados';end if;
for rowdata in select value from jsonb_array_elements(p_payload->'lines') loop
perform app_private.keys(rowdata,array['product_id','quantity']);select * into item from public.items where id=(rowdata->>'product_id')::uuid and kind='product';if not found or (not item.active and not exists(select 1 from public.order_lines where order_id=entity and product_id=item.id)) then raise exception 'VALIDATION_ERROR: producto inexistente o inactivo';end if;
insert into public.order_lines(order_id,product_id,quantity,unit_price) values(entity,item.id,app_private.whole(rowdata->>'quantity'),item.price) on conflict(order_id,product_id) do update set quantity=excluded.quantity;end loop;
delete from public.order_lines where order_id=entity and product_id not in (select (value->>'product_id')::uuid from jsonb_array_elements(p_payload->'lines'));
update public.orders set total=(select sum(quantity*unit_price) from public.order_lines where order_id=entity) where id=entity;
when 'deliver_order','cancel_order' then
select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;perform app_private.version(old.version,p_expected_version);if old.status<>'pendiente_entrega' then raise exception 'INVALID_TRANSITION: pedido cerrado';end if;
if p_operation='deliver_order' then
perform app_private.rebalance();if exists(select 1 from public.order_lines where order_id=entity and reserved<quantity) then raise exception 'INSUFFICIENT_RESERVED_STOCK: pedido sin reserva completa en el local elegido';end if;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) select product_id,old.location_id,-quantity,'delivery','Entrega de pedido',entity from public.order_lines where order_id=entity;
update public.orders set status='entregado',delivered_at=now(),version=version+1 where id=entity;
else update public.orders set status='cancelado',version=version+1 where id=entity;end if;
when 'save_purchase' then
if p_payload ? 'id' then select * into pur from public.purchases where id=entity;if not found then raise exception 'VALIDATION_ERROR: compra inexistente';end if;perform app_private.version(pur.version,p_expected_version);if pur.status<>'planificada' then raise exception 'INVALID_TRANSITION: compra cerrada';end if;
update public.purchases set supplier=trim(coalesce(p_payload->>'supplier','')),expected_date=(p_payload->>'expected_date')::date,notes=coalesce(p_payload->>'notes',''),version=version+1 where id=entity;delete from public.purchase_lines where purchase_id=entity;
else insert into public.purchases(id,supplier,expected_date,notes) values(entity,trim(coalesce(p_payload->>'supplier','')),(p_payload->>'expected_date')::date,coalesce(p_payload->>'notes',''));end if;
if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'VALIDATION_ERROR: ingredientes requeridos';end if;
for rowdata in select value from jsonb_array_elements(p_payload->'lines') loop
perform app_private.keys(rowdata,array['ingredient_id','quantity','unit','unit_price']);select * into item from public.items where id=(rowdata->>'ingredient_id')::uuid and kind='ingredient' and active;if not found then raise exception 'VALIDATION_ERROR: ingrediente inexistente o inactivo';end if;
qty:=app_private.decimal(rowdata->>'quantity',true);perform app_private.convert(qty,rowdata->>'unit',item.unit);unitprice:=app_private.decimal(rowdata->>'unit_price');
insert into public.purchase_lines values(entity,item.id,qty,rowdata->>'unit',unitprice);end loop;
update public.purchases set total=(select sum(quantity*unit_price) from public.purchase_lines where purchase_id=entity) where id=entity;
when 'receive_purchase','cancel_purchase' then
select * into pur from public.purchases where id=entity;if not found then raise exception 'VALIDATION_ERROR: compra inexistente';end if;perform app_private.version(pur.version,p_expected_version);if pur.status<>'planificada' then raise exception 'INVALID_TRANSITION: compra cerrada';end if;
if p_operation='receive_purchase' then
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) select l.ingredient_id,'cocina',app_private.convert(l.quantity,l.unit,i.unit),'purchase','Recepción de compra',entity from public.purchase_lines l join public.items i on i.id=l.ingredient_id where purchase_id=entity;
update public.purchases set status='recibida',received_at=now(),version=version+1 where id=entity;
else update public.purchases set status='cancelada',version=version+1 where id=entity;end if;
when 'plan_production' then
select * into recipe from public.recipes where id=(p_payload->>'recipe_id')::uuid and product_id=(p_payload->>'product_id')::uuid;if not found then raise exception 'VALIDATION_ERROR: receta no corresponde al producto';end if;
if not exists(select 1 from public.items where id=recipe.product_id and active) then raise exception 'VALIDATION_ERROR: producto inactivo';end if;
insert into public.productions(id,product_id,recipe_id,planned_date,target_quantity,notes) values(entity,recipe.product_id,recipe.id,(p_payload->>'planned_date')::date,app_private.whole(p_payload->>'target_quantity'),coalesce(p_payload->>'notes',''));
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
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) values(item.id,source,qty,'adjustment',trim(p_payload->>'reason'),entity);end if;
end case;
affected:=app_private.rebalance();
if p_operation in ('save_order','deliver_order','cancel_order') and not entity=any(affected) then affected:=array_append(affected,entity);end if;
result:=jsonb_build_object('id',entity,'affected_order_ids',to_jsonb(affected));
update public.workspace_events set revision=revision+1,updated_at=clock_timestamp() where id=1;
insert into app_private.commands values(p_command_id,h,result,now());return result;
exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or foreign_key_violation or unique_violation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR: datos inválidos o referencia inexistente (%)',SQLERRM;
end$$;

create view public.stock_balances with (security_invoker=true) as
select i.id item_id,l.id location_id,coalesce((select sum(m.quantity) from public.movements m where m.item_id=i.id and m.location_id=l.id),0) on_hand,
coalesce((select sum(ol.reserved) from public.order_lines ol join public.orders o on o.id=ol.order_id where ol.product_id=i.id and o.location_id=l.id and o.status='pendiente_entrega'),0) reserved,
coalesce((select sum(ol.shortage) from public.order_lines ol join public.orders o on o.id=ol.order_id where ol.product_id=i.id and o.location_id=l.id and o.status='pendiente_entrega'),0) shortage
from public.items i cross join public.locations l where i.kind='product' or l.id='cocina';

create function public.app_snapshot() returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
'locations',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.locations t),'[]'::jsonb),
'clients',coalesce((select jsonb_agg(to_jsonb(t) order by name,id) from public.clients t),'[]'::jsonb),
'items',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('price',price::text,'minimum',minimum::text) order by name,id) from public.items t),'[]'::jsonb),
'recipes',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('lines',coalesce((select jsonb_agg(jsonb_build_object('ingredient_id',ingredient_id,'quantity',quantity::text,'unit',unit) order by ingredient_id) from public.recipe_lines where recipe_id=t.id),'[]'::jsonb)) order by product_id,revision) from public.recipes t),'[]'::jsonb),
'orders',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('total',total::text,'lines',coalesce((select jsonb_agg(jsonb_build_object('id',id,'product_id',product_id,'quantity',quantity,'unit_price',unit_price::text,'reserved',reserved,'shortage',shortage) order by id) from public.order_lines where order_id=t.id),'[]'::jsonb)) order by pickup_date,created_at,id) from public.orders t),'[]'::jsonb),
'purchases',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('total',total::text,'lines',coalesce((select jsonb_agg(jsonb_build_object('ingredient_id',ingredient_id,'quantity',quantity::text,'unit',unit,'unit_price',unit_price::text) order by ingredient_id) from public.purchase_lines where purchase_id=t.id),'[]'::jsonb)) order by expected_date,id) from public.purchases t),'[]'::jsonb),
'productions',coalesce((select jsonb_agg(to_jsonb(t) order by planned_date,created_at,id) from public.productions t),'[]'::jsonb),
'stock',coalesce((select jsonb_agg(jsonb_build_object('item_id',item_id,'location_id',location_id,'on_hand',on_hand::text,'reserved',reserved::text,'shortage',shortage::text) order by item_id,location_id) from public.stock_balances),'[]'::jsonb),
'movements',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('quantity',quantity::text) order by created_at,id) from public.movements t),'[]'::jsonb),
'updated_at',statement_timestamp());
$$;

-- RLS and ACL both block table writes. No internal helper is callable by an API role.
do $$declare t text;begin foreach t in array array['locations','clients','items','recipes','recipe_lines','orders','order_lines','purchases','purchase_lines','productions','movements','workspace_events'] loop
execute format('alter table public.%I enable row level security',t);
execute format('create policy public_read on public.%I for select to anon, authenticated using (true)',t);
execute format('revoke all on public.%I from public, anon, authenticated',t);
execute format('grant select on public.%I to anon, authenticated',t);end loop;end$$;
revoke all on public.stock_balances from public,anon,authenticated;
grant select on public.stock_balances to anon,authenticated;
revoke all on all functions in schema app_private from public,anon,authenticated;
revoke all on function public.app_command(uuid,text,jsonb,integer) from public;
revoke all on function public.app_snapshot() from public;
grant execute on function public.app_command(uuid,text,jsonb,integer) to anon,authenticated;
grant execute on function public.app_snapshot() to anon,authenticated;
alter default privileges in schema app_private revoke execute on functions from public;

-- The exposed definer functions run as a no-login, non-superuser role, not postgres.
-- RLS policies admit this internal role; table ACLs limit it to required operations.
do $$begin if not exists(select 1 from pg_roles where rolname='pedidos_stock_backend') then
create role pedidos_stock_backend nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
end if;end$$;
grant pedidos_stock_backend to postgres;
revoke create on schema public from public,anon,authenticated;
grant usage on schema public,app_private,extensions to pedidos_stock_backend;
grant select on public.locations,public.clients,public.items,public.recipes,public.recipe_lines,public.orders,public.order_lines,public.purchases,public.purchase_lines,public.productions,public.movements,public.workspace_events,public.stock_balances to pedidos_stock_backend;
grant insert,update on public.clients,public.items,public.orders,public.purchases,public.productions to pedidos_stock_backend;
grant insert,update,delete on public.order_lines,public.purchase_lines to pedidos_stock_backend;
grant insert on public.recipes,public.recipe_lines,public.movements to pedidos_stock_backend;
grant update on public.workspace_events to pedidos_stock_backend;
grant select,insert on app_private.commands to pedidos_stock_backend;
grant execute on all functions in schema app_private to pedidos_stock_backend;
do $$declare t text;begin foreach t in array array['locations','clients','items','recipes','recipe_lines','orders','order_lines','purchases','purchase_lines','productions','movements','workspace_events'] loop
execute format('create policy backend_access on public.%I for all to pedidos_stock_backend using (true) with check (true)',t);
end loop;end$$;
grant create on schema public to pedidos_stock_backend;
alter function public.app_command(uuid,text,jsonb,integer) owner to pedidos_stock_backend;
alter function public.app_snapshot() owner to pedidos_stock_backend;
revoke create on schema public from pedidos_stock_backend;
