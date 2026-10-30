-- Additive business expansion. Existing rows, prices, UUIDs and immutable ledgers are retained.
alter table public.clients add column phone text not null default '',add column email text not null default '',add column address text not null default '',add column notes text not null default '',add column pets jsonb not null default '[]' check(jsonb_typeof(pets)='array');
alter table public.locations add column active boolean not null default true,add column is_pickup boolean not null default true,add column version integer not null default 1;
update public.locations set is_pickup=false where id='cocina';
alter table public.locations add constraint location_central_active check(id<>'cocina' or (active and not is_pickup)),add constraint location_name_present check(length(trim(name)) between 1 and 200),add constraint location_color_hex check(color ~ '^#[0-9a-fA-F]{6}$');
alter table public.items add column category text not null default 'alimento' check(category in ('alimento','suplemento','accesorio')),add column code text not null default '',add column presentation text not null default '',add column weight_kg numeric(24,6) check(weight_kg>0);
alter table public.recipes add column approved_at timestamptz not null default now();
alter table public.orders add column pickup_time time,add column uber boolean not null default false,add column packages integer not null default 1 check(packages between 1 and 9999),add column prepared_packages integer not null default 0,add column delivery_notes text not null default '',add column returned_at timestamptz,add column return_reason text,add column restocked boolean not null default false,add constraint packages_prepared_valid check(prepared_packages between 0 and packages);
alter table public.purchases add column manufactured_on date,add column batch_code text;
alter table public.order_lines add column product_name text not null default '',add column product_unit text not null default 'unidad';
update public.order_lines l set product_name=i.name,product_unit=i.unit from public.items i where i.id=l.product_id;
alter table public.productions add column recipe_snapshot jsonb,add column manufactured_on date,add column expires_on date,add column batch_code text;
update public.productions p set recipe_snapshot=(select to_jsonb(r)||jsonb_build_object('lines',(select jsonb_agg(jsonb_build_object('ingredient_id',l.ingredient_id,'quantity',l.quantity::text,'unit',l.unit,'name',i.name,'catalog_unit',i.unit) order by l.ingredient_id) from public.recipe_lines l join public.items i on i.id=l.ingredient_id where l.recipe_id=r.id)) from public.recipes r where r.id=p.recipe_id);
alter table public.productions alter column recipe_snapshot set not null;
create table public.production_ingredients(production_id uuid not null references public.productions,ingredient_id uuid not null references public.items,quantity numeric(24,6) not null check(quantity>=0),unit text not null check(unit in ('g','kg','ml','l','unidad')),waste_quantity numeric(24,6) not null default 0 check(waste_quantity>=0),primary key(production_id,ingredient_id));
create table public.batches(id uuid primary key default gen_random_uuid(),item_id uuid not null references public.items,code text not null check(length(trim(code)) between 1 and 200),manufactured_on date not null,expires_on date not null,production_id uuid references public.productions,created_at timestamptz not null default now(),date_source text not null default 'recorded' check(date_source in ('recorded','estimated')),check(expires_on=(manufactured_on+interval '4 months')::date));
create unique index batches_production_unique on public.batches(production_id) where production_id is not null;
create table public.movement_batches(movement_id uuid not null references public.movements,batch_id uuid not null references public.batches,quantity numeric(24,6) not null check(quantity<>0),primary key(movement_id,batch_id));
alter table public.movements add column reversal_of uuid references public.movements,add column manufactured_on date,add column batch_code text;
create unique index movement_reversed_once on public.movements(reversal_of) where reversal_of is not null;
create table public.financial_movements(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('payment','expense','refund','reversal')),order_id uuid references public.orders,purchase_id uuid references public.purchases,amount numeric(24,2) not null check(amount<>0),method text not null check(method in ('transferencia','efectivo','desconocido')),category text not null default '',occurred_on date not null default (now() at time zone 'America/Argentina/Mendoza')::date,notes text not null default '',reconciled boolean not null default false,version integer not null default 1,reverses_id uuid unique references public.financial_movements,created_at timestamptz not null default now(),check((kind='payment' and amount>0 and order_id is not null) or (kind='expense' and amount<0) or (kind='refund' and amount<0 and order_id is not null) or (kind='reversal' and reverses_id is not null)));
create table public.audit_events(id uuid primary key default gen_random_uuid(),command_id uuid not null unique,operation text not null,entity_id text not null,actor_id text,reason text not null default '',occurred_at timestamptz not null default now());
create index financial_order_idx on public.financial_movements(order_id);
create index batch_allocations_batch_idx on public.movement_batches(batch_id);
create view public.batch_stock with(security_invoker=true) as select a.batch_id,b.item_id,m.location_id,sum(a.quantity) quantity from public.movement_batches a join public.movements m on m.id=a.movement_id join public.batches b on b.id=a.batch_id group by a.batch_id,b.item_id,m.location_id having sum(a.quantity)<>0;

create function app_private.validate_pets(pets jsonb) returns void language plpgsql set search_path=pg_catalog,app_private as $$declare pet jsonb;begin
if jsonb_typeof(pets)<>'array' or jsonb_array_length(pets)>100 then raise exception 'VALIDATION_ERROR: mascotas inválidas';end if;
for pet in select value from jsonb_array_elements(pets) loop
perform app_private.keys(pet,array['name','weight_kg','diet']);
if length(trim(coalesce(pet->>'name','')))=0 or length(pet->>'name')>200 then raise exception 'VALIDATION_ERROR: nombre de mascota requerido';end if;
if nullif(pet->>'weight_kg','') is not null then perform app_private.decimal(pet->>'weight_kg',true);end if;
end loop;end$$;
create function app_private.keep_recipe_snapshot() returns trigger language plpgsql set search_path=pg_catalog as $$begin if new.recipe_snapshot is distinct from old.recipe_snapshot then raise exception 'INVALID_TRANSITION: receta aprobada inmutable';end if;return new;end$$;
create trigger production_snapshot_immutable before update on public.productions for each row execute function app_private.keep_recipe_snapshot();
create function app_private.financial_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin if (to_jsonb(new)-'reconciled'-'version') is distinct from (to_jsonb(old)-'reconciled'-'version') then raise exception 'INVALID_TRANSITION: movimiento financiero inmutable';end if;return new;end$$;
create trigger financial_immutable before update on public.financial_movements for each row execute function app_private.financial_immutable();
create trigger financial_delete_immutable before delete on public.financial_movements for each row execute function app_private.immutable();
create trigger financial_truncate_immutable before truncate on public.financial_movements for each statement execute function app_private.immutable();
do $$declare t text;begin foreach t in array array['batches','movement_batches','production_ingredients','audit_events'] loop
execute format('create trigger immutable_rows before update or delete on public.%I for each row execute function app_private.immutable()',t);
execute format('create trigger immutable_truncate before truncate on public.%I for each statement execute function app_private.immutable()',t);
end loop;end$$;

-- Allocate the existing stock ledger, not a parallel balance. Transfers and returns retain lot identity.
create function app_private.allocate_movement(m public.movements) returns void language plpgsql set search_path=pg_catalog,public,app_private as $$
declare batch uuid; remaining numeric; take numeric; r record; isproduct boolean;begin
-- Ingredient and product movements share exactly the same traceability ledger.
if m.reversal_of is not null then
insert into public.movement_batches(movement_id,batch_id,quantity) select m.id,batch_id,-quantity from public.movement_batches where movement_id=m.reversal_of;
if exists(select 1 from public.batch_stock where quantity<0) then raise exception 'INSUFFICIENT_STOCK: lote ya consumido o trasladado';end if;
return;
end if;
if m.quantity>0 then
if m.kind='production_correction' then
remaining:=m.quantity;
for r in select a.batch_id,-sum(a.quantity) quantity,b.expires_on from public.movement_batches a join public.movements source on source.id=a.movement_id join public.batches b on b.id=a.batch_id where source.event_id=m.event_id and source.item_id=m.item_id and source.kind='production_consumption' group by a.batch_id,b.expires_on order by b.expires_on desc,a.batch_id loop
take:=least(remaining,r.quantity);insert into public.movement_batches values(m.id,r.batch_id,take);remaining:=remaining-take;exit when remaining=0;
end loop;
if remaining>0 then raise exception 'VALIDATION_ERROR: correction de consommation sans lot source';end if;
elsif m.kind in ('transfer','return') then
insert into public.movement_batches(movement_id,batch_id,quantity)
select m.id,a.batch_id,-sum(a.quantity) from public.movement_batches a join public.movements source on source.id=a.movement_id where source.event_id=m.event_id and source.item_id=m.item_id and source.kind=case when m.kind='return' then 'delivery' else 'transfer' end and source.quantity<0 group by a.batch_id;
if coalesce((select sum(quantity) from public.movement_batches where movement_id=m.id),0)<>m.quantity then raise exception 'VALIDATION_ERROR: trazabilidad de traslado/devolución inconsistente';end if;
else
select id into batch from public.batches where production_id=m.event_id and item_id=m.item_id;
if batch is null then
insert into public.batches(item_id,code,manufactured_on,expires_on,date_source,production_id)
select m.item_id,coalesce(m.batch_code,(select batch_code from public.purchases where id=m.event_id),'A-'||left(m.id::text,8)),coalesce(m.manufactured_on,(select manufactured_on from public.purchases where id=m.event_id),(m.created_at at time zone 'America/Argentina/Mendoza')::date),(coalesce(m.manufactured_on,(select manufactured_on from public.purchases where id=m.event_id),(m.created_at at time zone 'America/Argentina/Mendoza')::date)+interval '4 months')::date,case when m.manufactured_on is not null or exists(select 1 from public.purchases where id=m.event_id and manufactured_on is not null) then 'recorded' else 'estimated' end,(select id from public.productions where id=m.event_id and product_id=m.item_id) returning id into batch;
end if;
insert into public.movement_batches values(m.id,batch,m.quantity);
end if;
else
remaining:=-m.quantity;
for r in select s.batch_id,s.quantity,b.expires_on from public.batch_stock s join public.batches b on b.id=s.batch_id where s.item_id=m.item_id and s.location_id=m.location_id and s.quantity>0 order by b.expires_on,b.manufactured_on,b.id loop
if coalesce(current_setting('app_private.backfill',true),'false')<>'true' and m.kind in ('delivery','production_consumption','production_correction') and r.expires_on<(m.created_at at time zone 'America/Argentina/Mendoza')::date then continue;end if;
take:=least(remaining,r.quantity);insert into public.movement_batches values(m.id,r.batch_id,-take);remaining:=remaining-take;exit when remaining=0;
end loop;
if remaining>0 then raise exception 'INSUFFICIENT_STOCK: lotes disponibles insuficientes o vencidos';end if;
end if;end$$;
-- Backfill historical outputs and allocations in causal insertion order; date-expiry enforcement is for new deliveries.
do $$declare m public.movements; pending uuid[]; progressed boolean;begin
perform set_config('app_private.backfill','true',true);
select coalesce(array_agg(id),'{}') into pending from public.movements;
while cardinality(pending)>0 loop
progressed:=false;
for m in select * from public.movements where id=any(pending) order by created_at,case when quantity>0 and kind<>'transfer' then 0 when quantity<0 and kind='transfer' then 1 when kind='transfer' then 2 else 3 end,id loop
begin
perform app_private.allocate_movement(m);pending:=array_remove(pending,m.id);progressed:=true;
exception when raise_exception then if SQLERRM not like 'INSUFFICIENT_STOCK:%' and SQLERRM not like 'VALIDATION_ERROR: trazabilidad%' then raise;end if;
end;
end loop;
if not progressed then raise exception 'VALIDATION_ERROR: historial de stock no se puede conciliar por lote';end if;
end loop;perform set_config('app_private.backfill','false',true);end$$;
update public.productions p set manufactured_on=b.manufactured_on,expires_on=b.expires_on,batch_code=b.code from public.batches b where b.production_id=p.id and p.status='finalizado';
create function app_private.allocate_movement_trigger() returns trigger language plpgsql set search_path=pg_catalog,app_private as $$begin perform app_private.allocate_movement(new);return new;end$$;
create trigger allocate_product_batches after insert on public.movements for each row execute function app_private.allocate_movement_trigger();

-- Canonical available stock excludes expired lots, while physical on_hand remains auditable.
create function app_private.usable_balance(item uuid,location text) returns numeric language sql stable set search_path=pg_catalog,public as $$
select coalesce(sum(s.quantity),0) from public.batch_stock s join public.batches b on b.id=s.batch_id where s.item_id=item and s.location_id=location and b.expires_on>=(now() at time zone 'America/Argentina/Mendoza')::date
$$;
create view public.order_allocations with(security_invoker=true) as
with pending as (
select l.id,l.quantity,greatest(least(l.quantity,(select coalesce(sum(s.quantity),0) from public.batch_stock s join public.batches b on b.id=s.batch_id where s.item_id=l.product_id and s.location_id=o.location_id and b.expires_on>=(now() at time zone 'America/Argentina/Mendoza')::date)-coalesce(sum(l.quantity) over(partition by l.product_id,o.location_id order by o.pickup_date,o.created_at,o.id,l.id rows between unbounded preceding and 1 preceding),0)),0)::integer assigned
from public.order_lines l join public.orders o on o.id=l.order_id where o.status='pendiente_entrega')
select id line_id,assigned reserved,quantity-assigned shortage from pending
union all select l.id,0,0 from public.order_lines l join public.orders o on o.id=l.order_id where o.status<>'pendiente_entrega';
create function app_private.order_allocations() returns table(line_id uuid,reserved integer,shortage integer) language sql stable set search_path=pg_catalog,public as $$select * from public.order_allocations$$;
create or replace function app_private.rebalance() returns uuid[] language plpgsql set search_path=pg_catalog,public,app_private as $$
declare changed uuid[];begin
with updated as(update public.order_lines l set reserved=a.reserved,shortage=a.shortage from app_private.order_allocations() a where l.id=a.line_id and (l.reserved<>a.reserved or l.shortage<>a.shortage) returning l.order_id)
select coalesce(array_agg(distinct order_id),'{}') into changed from updated;
update public.orders set allocation_version=allocation_version+1 where id=any(changed);return changed;
end$$;
create or replace view public.stock_balances with(security_invoker=true) as
select i.id item_id,l.id location_id,coalesce((select sum(quantity) from public.movements where item_id=i.id and location_id=l.id),0) on_hand,
coalesce((select sum(a.reserved) from public.order_allocations a join public.order_lines ol on ol.id=a.line_id join public.orders o on o.id=ol.order_id where ol.product_id=i.id and o.location_id=l.id),0) reserved,
coalesce((select sum(a.shortage) from public.order_allocations a join public.order_lines ol on ol.id=a.line_id join public.orders o on o.id=ol.order_id where ol.product_id=i.id and o.location_id=l.id),0) shortage
from public.items i cross join public.locations l where i.kind='product' or l.id='cocina';

revoke all on public.order_allocations from public,anon,authenticated;
grant select on public.order_allocations to anon,authenticated,pedidos_stock_backend;

create or replace function public.app_command(p_command_id uuid,p_operation text,p_payload jsonb,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private,extensions as $$
declare entity uuid; old public.orders%rowtype; pur public.purchases%rowtype; prod public.productions%rowtype; item public.items%rowtype; recipe public.recipes%rowtype; rowdata jsonb; line record; qty numeric; unitprice numeric; actual integer; ver integer; h text; previous app_private.commands%rowtype; result jsonb; affected uuid[]; source text; destination text; expected_keys text[]; loc text; fin public.financial_movements%rowtype; mov public.movements%rowtype; amount numeric; consumed numeric; waste numeric; snap jsonb;
begin
perform pg_advisory_xact_lock(742019630182::bigint);
if p_operation is null or p_command_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'VALIDATION_ERROR: comando inválido';end if;
h:=encode(extensions.digest(p_operation||':'||p_payload::text||':'||coalesce(p_expected_version::text,'null'),'sha256'),'hex');
select * into previous from app_private.commands where id=p_command_id;
if found then if previous.payload_hash is distinct from h then raise exception 'IDEMPOTENCY_CONFLICT: identificador reutilizado con otro contenido';end if;return previous.result;end if;
expected_keys:=case p_operation
when 'save_client' then array['id','name','phone','email','address','notes','pets'] when 'save_item' then array['id','kind','name','unit','price','minimum','active','category','code','presentation','weight_kg'] when 'save_recipe' then array['product_id','yield_quantity','lines']
when 'save_order' then array['id','client_id','pickup_date','location_id','payment_method','notes','lines','pickup_time','uber','packages','prepared_packages','delivery_notes']
when 'save_purchase' then array['id','supplier','expected_date','notes','lines']
when 'plan_production' then array['product_id','recipe_id','planned_date','target_quantity','notes']
when 'finish_production' then array['id','actual_quantity','actual_ingredients','manufactured_on','batch_code','notes'] when 'cancel_production' then array['id','reason']
when 'transfer_stock' then array['item_id','from_location_id','to_location_id','quantity','reason']
when 'adjust_stock' then array['item_id','location_id','quantity','reason','manufactured_on','batch_code']
when 'deliver_order' then array['id'] when 'cancel_order' then array['id'] when 'receive_purchase' then array['id','manufactured_on','batch_code'] when 'cancel_purchase' then array['id'] when 'start_production' then array['id']
when 'save_location' then array['id','name','color','active','is_pickup']
when 'record_payment' then array['order_id','amount','method','occurred_on','notes']
when 'record_refund' then array['order_id','amount','method','occurred_on','notes']
when 'record_expense' then array['amount','method','category','occurred_on','notes','purchase_id']
when 'reconcile_movement' then array['id','reconciled']
when 'return_order' then array['id','reason','restock','refund_amount','method']
when 'reverse_movement' then array['id','reason']
when 'reverse_financial_movement' then array['id','reason']
else null end;
if expected_keys is null then raise exception 'VALIDATION_ERROR: operación desconocida';end if;
perform app_private.keys(p_payload,expected_keys);
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
when 'deliver_order','cancel_order' then
select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;perform app_private.version(old.version,p_expected_version);if old.status<>'pendiente_entrega' then raise exception 'INVALID_TRANSITION: pedido cerrado';end if;
if p_operation='deliver_order' then
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
if old.status='cancelado' or old.returned_at is not null then raise exception 'INVALID_TRANSITION: pedido cancelado o devuelto';end if;
if amount+coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=old.id),0)>old.total then raise exception 'VALIDATION_ERROR: pago supera saldo del pedido';end if;
else
if old.returned_at is null and old.status<>'cancelado' then raise exception 'INVALID_TRANSITION: reintegro requiere pedido devuelto o cancelado';end if;
if amount>coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=old.id),0) then raise exception 'VALIDATION_ERROR: reintegro supera cobros';end if;
end if;
end if;
insert into public.financial_movements(id,kind,order_id,purchase_id,amount,method,category,occurred_on,notes)
values(entity,case when p_operation='record_payment' then 'payment' when p_operation='record_refund' then 'refund' else 'expense' end,case when p_operation in ('record_payment','record_refund') then old.id else null end,(p_payload->>'purchase_id')::uuid,case when p_operation='record_payment' then amount else -amount end,p_payload->>'method',coalesce(p_payload->>'category',case when p_operation='record_payment' then 'venta' when p_operation='record_refund' then 'devolucion' else 'general' end),coalesce((p_payload->>'occurred_on')::date,(now() at time zone 'America/Argentina/Mendoza')::date),coalesce(p_payload->>'notes',''));
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
insert into public.financial_movements(id,kind,order_id,purchase_id,amount,method,category,occurred_on,notes,reverses_id) values(p_command_id,'reversal',fin.order_id,fin.purchase_id,-fin.amount,fin.method,fin.category,(now() at time zone 'America/Argentina/Mendoza')::date,trim(p_payload->>'reason'),entity);if fin.order_id is not null then update public.orders set version=version+1 where id=fin.order_id;end if;entity:=p_command_id;
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
if p_operation in ('save_order','deliver_order','cancel_order') and not entity=any(affected) then affected:=array_append(affected,entity);end if;
if p_operation in ('record_payment','record_refund') and not old.id=any(affected) then affected:=array_append(affected,old.id);end if;
if p_operation='reverse_financial_movement' and fin.order_id is not null and not fin.order_id=any(affected) then affected:=array_append(affected,fin.order_id);end if;
result:=jsonb_build_object('id',case when p_operation='save_location' then to_jsonb(loc) else to_jsonb(entity) end,'affected_order_ids',to_jsonb(affected));
insert into public.audit_events(command_id,operation,entity_id,actor_id,reason) values(p_command_id,p_operation,case when p_operation='save_location' then loc else entity::text end,nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',coalesce(p_payload->>'reason',p_payload->>'notes',''));
update public.workspace_events set revision=revision+1,updated_at=clock_timestamp() where id=1;
insert into app_private.commands values(p_command_id,h,result,now());return result;
exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or foreign_key_violation or unique_violation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR: datos inválidos o referencia inexistente (%)',SQLERRM;
end$$;

-- Server-side catalog bootstrap, safe on existing business data and repeated explicit seed runs.
insert into public.items(kind,name,unit,price,minimum,active,category,code,presentation)
select 'product',v.name,'unidad',v.price,0,true,v.category,v.code,'' from (values
('Bolsa de tela',2000,'accesorio','BOLSA-TELA'),('Calcio',1500,'suplemento','CALCIO'),('Caldo colageno',2800,'suplemento','CALDO-COLAGENO'),('Formula gato',6000,'suplemento','FORMULA-GATO'),('Formula perro',5000,'suplemento','FORMULA-PERRO'),('Semillas zapallo',1300,'suplemento','SEMILLAS-ZAPALLO'),('Vinagre sidra manzana',3000,'suplemento','VINAGRE-SIDRA')) v(name,price,category,code)
where not exists(select 1 from public.items i where lower(trim(i.name))=lower(v.name));

create or replace function public.app_snapshot() returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
'schema_version',2,
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

create function public.app_export() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,app_private as $$
declare raw jsonb:='{}'; t text; rows jsonb;begin
foreach t in array array['locations','clients','items','recipes','recipe_lines','orders','order_lines','purchases','purchase_lines','productions','production_ingredients','movements','batches','movement_batches','financial_movements','audit_events','workspace_events'] loop
-- Stringify decimal columns to preserve all six digits through JavaScript JSON parsing.
execute format('select coalesce(jsonb_agg(to_jsonb(x)%s),''[]''::jsonb) from public.%I x',case t when 'items' then '||jsonb_build_object(''price'',price::text,''minimum'',minimum::text,''weight_kg'',weight_kg::text)' when 'recipe_lines' then '||jsonb_build_object(''quantity'',quantity::text)' when 'order_lines' then '||jsonb_build_object(''unit_price'',unit_price::text)' when 'orders' then '||jsonb_build_object(''total'',total::text)' when 'purchases' then '||jsonb_build_object(''total'',total::text)' when 'purchase_lines' then '||jsonb_build_object(''quantity'',quantity::text,''unit_price'',unit_price::text)' when 'production_ingredients' then '||jsonb_build_object(''quantity'',quantity::text,''waste_quantity'',waste_quantity::text)' when 'movements' then '||jsonb_build_object(''quantity'',quantity::text)' when 'movement_batches' then '||jsonb_build_object(''quantity'',quantity::text)' when 'financial_movements' then '||jsonb_build_object(''amount'',amount::text)' else '' end,t) into rows;
raw:=raw||jsonb_build_object(t,rows);
end loop;
return jsonb_build_object('format','pedidos-stock','schema_version',2,'exported_at',statement_timestamp(),'data',public.app_snapshot(),'raw_tables',raw,'idempotency_commands',coalesce((select jsonb_agg(to_jsonb(c) order by created_at,id) from app_private.commands c),'[]'::jsonb));
end$$;

-- Every new table is public read / vetted RPC write, matching the established no-auth policy.
do $$declare t text;begin foreach t in array array['batches','movement_batches','production_ingredients','financial_movements','audit_events'] loop
execute format('alter table public.%I enable row level security',t);
execute format('revoke all on public.%I from public,anon,authenticated',t);
execute format('grant select on public.%I to anon,authenticated,pedidos_stock_backend',t);
execute format('grant insert on public.%I to pedidos_stock_backend',t);
execute format('create policy public_read on public.%I for select to anon,authenticated using(true)',t);
execute format('create policy backend_access on public.%I for all to pedidos_stock_backend using(true) with check(true)',t);
end loop;end$$;
grant update on public.financial_movements to pedidos_stock_backend;
grant insert,update on public.locations to pedidos_stock_backend;
revoke all on public.batch_stock from public,anon,authenticated;
grant select on public.batch_stock to anon,authenticated,pedidos_stock_backend;
revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on all functions in schema app_private to pedidos_stock_backend;
revoke all on function public.app_export() from public,anon,authenticated;
grant execute on function public.app_export() to anon,authenticated;
grant create on schema public to pedidos_stock_backend;
alter function public.app_export() owner to pedidos_stock_backend;
revoke create on schema public from pedidos_stock_backend;
