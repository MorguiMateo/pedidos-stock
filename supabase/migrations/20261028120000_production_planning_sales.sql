-- Additive production promises and corrections. Physical stock remains exclusively in movements.
alter table public.clients add column preferred_location_id text references public.locations(id);
alter table public.orders add column deleted_at timestamptz, add column deleted_by uuid;
alter table public.order_lines add column future_reserved numeric(24,6) not null default 0 check(future_reserved>=0);
alter table public.orders drop constraint orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check(payment_method in ('transferencia','efectivo','desconocido','gratis'));
create table public.production_plans(
 id uuid primary key default gen_random_uuid(),product_id uuid not null references public.items(id),
 quantity numeric(24,6) not null check(quantity>0),available_on date not null,
 fulfilled_quantity numeric(24,6) not null default 0 check(fulfilled_quantity>=0),
 actual_quantity numeric(24,6) check(actual_quantity>=0),
 status text not null default 'planificado' check(status in ('planificado','finalizado','cancelado')),
 notes text not null default '',version integer not null default 1,created_at timestamptz not null default now(),created_by uuid,
 check(fulfilled_quantity<=quantity)
);
create table public.production_plan_receipts(
 movement_id uuid not null references public.movements(id),plan_id uuid not null references public.production_plans(id),
 quantity numeric(24,6) not null check(quantity>0),primary key(movement_id,plan_id)
);
alter table public.production_plans enable row level security;
alter table public.production_plan_receipts enable row level security;
create policy backend_access on public.production_plans for all to pedidos_stock_backend using(true) with check(true);
create policy backend_access on public.production_plan_receipts for all to pedidos_stock_backend using(true) with check(true);
revoke all on public.production_plans,public.production_plan_receipts from public,anon,authenticated;
grant select,insert,update on public.production_plans to pedidos_stock_backend;
grant select,insert on public.production_plan_receipts to pedidos_stock_backend;

create or replace function app_private.validate_pets(pets jsonb) returns void language plpgsql set search_path=pg_catalog,app_private as $$declare pet jsonb;begin
if jsonb_typeof(pets)<>'array' or jsonb_array_length(pets)>100 then raise exception 'VALIDATION_ERROR: mascotas inválidas';end if;
for pet in select value from jsonb_array_elements(pets) loop
perform app_private.keys(pet,array['name','weight_kg','diet','species']);
if length(trim(coalesce(pet->>'name','')))=0 or length(pet->>'name')>200 then raise exception 'VALIDATION_ERROR: nombre de mascota requerido';end if;
if pet ? 'species' and (jsonb_typeof(pet->'species') is distinct from 'string' or pet->>'species' not in ('perro','gato')) then raise exception 'VALIDATION_ERROR: especie de mascota inválida';end if;
if nullif(pet->>'weight_kg','') is not null then perform app_private.decimal(pet->>'weight_kg',true);end if;
end loop;end$$;

-- One global deterministic allocation. Each physical lot and each shared future plan is consumed once.
-- A future-dated pickup cannot reserve a lot that expires before that pickup.
create function app_private.coverage_allocations() returns table(line_id uuid,reserved numeric,future_reserved numeric,shortage numeric,plan_allocations jsonb)
language plpgsql stable set search_path=pg_catalog,public,app_private as $$
declare demand record; supply record; used jsonb:='{}'; planned jsonb:='{}'; remaining numeric; take numeric; k text;begin
for demand in select l.id,l.product_id,l.quantity,o.location_id,o.pickup_date,o.status,o.sale_kind,o.deleted_at
 from public.order_lines l join public.orders o on o.id=l.order_id
 order by o.stock_shortage_confirmed,o.pickup_date,o.created_at,o.id,l.id loop
 line_id:=demand.id;reserved:=0;future_reserved:=0;shortage:=0;plan_allocations:='{}';
 if demand.status='pendiente_entrega' and demand.sale_kind='pedido' and demand.deleted_at is null then
 remaining:=demand.quantity;
 for supply in select s.batch_id,s.quantity,b.expires_on from public.batch_stock s join public.batches b on b.id=s.batch_id
 where s.item_id=demand.product_id and s.location_id=demand.location_id and s.quantity>0
 and b.expires_on>=greatest(demand.pickup_date,(now() at time zone 'America/Argentina/Mendoza')::date)
 order by b.expires_on,b.manufactured_on,b.id loop
 k:=supply.batch_id::text||'|'||demand.location_id;
 take:=least(remaining,greatest(supply.quantity-coalesce((used->>k)::numeric,0),0));
 if take>0 then used:=jsonb_set(used,array[k],to_jsonb(coalesce((used->>k)::numeric,0)+take));reserved:=reserved+take;remaining:=remaining-take;end if;
 exit when remaining=0;
 end loop;
 if remaining>0 then
 for supply in select p.* from public.production_plans p where p.product_id=demand.product_id and p.status='planificado' and p.available_on<=demand.pickup_date order by p.available_on,p.created_at,p.id loop
 k:=supply.id::text;take:=least(remaining,greatest(supply.quantity-supply.fulfilled_quantity-coalesce((planned->>k)::numeric,0),0));
 if take>0 then planned:=jsonb_set(planned,array[k],to_jsonb(coalesce((planned->>k)::numeric,0)+take));plan_allocations:=jsonb_set(plan_allocations,array[k],to_jsonb(take));future_reserved:=future_reserved+take;remaining:=remaining-take;end if;
 exit when remaining=0;
 end loop;
 end if;
 shortage:=remaining;
 end if;
 return next;
end loop;end$$;
create or replace view public.order_allocations with(security_invoker=true) as select line_id,reserved,shortage,future_reserved from app_private.coverage_allocations();
create or replace function app_private.order_allocations() returns table(line_id uuid,reserved numeric,shortage numeric) language sql stable set search_path=pg_catalog,public as $$select line_id,reserved,shortage from public.order_allocations$$;
create or replace function app_private.rebalance() returns uuid[] language plpgsql set search_path=pg_catalog,public,app_private as $$
declare changed uuid[];begin
with updated as(update public.order_lines l set reserved=a.reserved,future_reserved=a.future_reserved,shortage=a.shortage from app_private.coverage_allocations() a where l.id=a.line_id and (l.reserved<>a.reserved or l.future_reserved<>a.future_reserved or l.shortage<>a.shortage) returning l.order_id)
select coalesce(array_agg(distinct order_id),'{}') into changed from updated;
update public.orders set allocation_version=allocation_version+1 where id=any(changed);
update public.orders o set stock_shortage_confirmed=false where o.stock_shortage_confirmed and o.status='pendiente_entrega' and not exists(select 1 from public.order_lines l where l.order_id=o.id and l.shortage>0);
return changed;end$$;

-- A recorded new product inflow at pickup converts a shared promise into real stock.
-- Point-to-point transfers and returns are already physical: they never fulfill a plan again.
create function app_private.reconcile_plan_receipt() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare plan record; remaining numeric; take numeric;begin
if new.reversal_of is not null then
 for plan in select * from public.production_plan_receipts where movement_id=new.reversal_of loop
 update public.production_plans set fulfilled_quantity=greatest(fulfilled_quantity-plan.quantity,0),version=version+1 where id=plan.plan_id;
 end loop;return new;
end if;
if new.quantity<=0 or new.kind not in ('adjustment','transfer','production_output') or not exists(select 1 from public.items where id=new.item_id and kind='product') or not exists(select 1 from public.locations where id=new.location_id and is_pickup) then return new;end if;
if new.kind='transfer' and exists(select 1 from public.movements m join public.locations l on l.id=m.location_id where m.event_id=new.event_id and m.item_id=new.item_id and m.quantity<0 and l.is_pickup) then return new;end if;
remaining:=new.quantity;
for plan in select * from public.production_plans where product_id=new.item_id and status='planificado' and quantity>fulfilled_quantity order by available_on,created_at,id for update loop
 take:=least(remaining,plan.quantity-plan.fulfilled_quantity);
 insert into public.production_plan_receipts values(new.id,plan.id,take);
 update public.production_plans set fulfilled_quantity=fulfilled_quantity+take,version=version+1 where id=plan.id;
 remaining:=remaining-take;exit when remaining=0;
end loop;return new;end$$;
create trigger reconcile_production_promises after insert on public.movements for each row execute function app_private.reconcile_plan_receipt();

-- Financial history is immutable: reclassifications are compensating entries, never UPDATEs.
create function app_private.change_order_method(order_id uuid,new_method text) returns void language plpgsql set search_path=pg_catalog,public,app_private as $$
declare sale public.orders; entry record; was_paid boolean;begin
if new_method is null or new_method not in ('efectivo','transferencia','gratis') then raise exception 'VALIDATION_ERROR: medio de pago previsto inválido';end if;
select * into sale from public.orders where id=order_id;
if sale.payment_method=new_method then return;end if;
was_paid:=sale.total<=coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=sale.id),0);
if sale.payment_method<>'gratis' then
 for entry in select f.* from public.financial_movements f where f.order_id=sale.id and f.kind in ('payment','refund') and not exists(select 1 from public.financial_movements r where r.reverses_id=f.id) order by f.created_at,f.id loop
 insert into public.financial_movements(kind,order_id,amount,method,category,notes,reverses_id,transfer_name)
 values('reversal',sale.id,-entry.amount,entry.method,entry.category,'Corrección de medio de pago',entry.id,entry.transfer_name);
 if new_method<>'gratis' then
 insert into public.financial_movements(kind,order_id,amount,method,category,notes,transfer_name)
 values(entry.kind,sale.id,entry.amount,new_method,entry.category,'Reclasificación de medio de pago',case when new_method='transferencia' then sale.transfer_name else null end);
 end if;
 end loop;
end if;
update public.orders set payment_method=new_method,transfer_name=case when new_method='transferencia' then transfer_name else null end,
 payment_confirmed_at=case when new_method='gratis' then coalesce(payment_confirmed_at,now()) when sale.payment_method='gratis' then null when was_paid then payment_confirmed_at else null end,
 payment_confirmed_by=case when new_method='gratis' then app_private.actor_id() when sale.payment_method='gratis' then null else payment_confirmed_by end where id=sale.id;
end$$;
create or replace function app_private.collect_order_balance(order_id uuid,payment_status text,method text) returns void language plpgsql set search_path=pg_catalog,public,app_private as $$
declare balance numeric;sale public.orders;begin
select * into sale from public.orders where id=order_id;
if method='gratis' or sale.payment_method='gratis' then
 update public.orders set payment_confirmed_at=coalesce(payment_confirmed_at,now()),payment_confirmed_by=coalesce(payment_confirmed_by,app_private.actor_id()) where id=sale.id;return;
end if;
if payment_status is distinct from 'pagado' then return;end if;
select sale.total-coalesce(sum(f.amount),0) into balance from public.financial_movements f where f.order_id=sale.id;
if balance>0 then
if method is null or method not in ('efectivo','transferencia') then raise exception 'VALIDATION_ERROR: medio de cobro inválido';end if;
insert into public.financial_movements(kind,order_id,amount,method,category,transfer_name) values('payment',sale.id,balance,method,'venta',case when method='transferencia' then sale.transfer_name else null end);
end if;end$$;

-- Extend the established authenticated/idempotent dispatcher without bypassing its audit boundary.
do $migration$
declare original text;definition text;begin
original:=pg_get_functiondef('public.app_command(uuid,text,jsonb,integer)'::regprocedure);definition:=original;
definition:=replace(definition,'audit_location text;','audit_location text; plan public.production_plans%rowtype; prior_shortages jsonb;');
definition:=replace(definition,'perform pg_advisory_xact_lock(742019630182::bigint);', $patch$
perform pg_advisory_xact_lock(742019630182::bigint);
select coalesce(jsonb_object_agg(line_id::text,shortage),'{}') into prior_shortages from app_private.coverage_allocations();
$patch$);
definition:=replace(definition,'''notes'',''pets'']','''notes'',''pets'',''preferred_location_id'']');
definition:=replace(definition,'when ''save_purchase'' then array[', $patch$
when 'save_production_plan' then array['id','product_id','quantity','available_on','notes']
when 'cancel_production_plan' then array['id']
when 'reconcile_production_plan' then array['id','actual_quantity']
when 'delete_order' then array['id']
when 'append_spontaneous_sale' then array['id','lines','payment_status','method','transfer_name','deliver']
when 'save_purchase' then array[$patch$);
definition:=replace(definition,'''set_order_payment_method'') then raise exception ''FORBIDDEN', '''set_order_payment_method'',''delete_order'',''append_spontaneous_sale'') then raise exception ''FORBIDDEN');
definition:=replace(definition,'''record_payment'',''set_order_payment_method'') or', '''record_payment'',''set_order_payment_method'',''delete_order'',''append_spontaneous_sale'') or');
definition:=replace(definition,chr(10)||'case p_operation
when ''save_client'' then', $patch$
if p_operation in ('plan_production','start_production','finish_production') then raise exception 'INVALID_TRANSITION: usar planificación de producción e ingresar producción real en el punto de retiro';end if;
if p_operation in ('save_order','deliver_order','cancel_order','reschedule_order','set_order_payment_method','delete_order','append_spontaneous_sale') and exists(select 1 from public.orders where id=entity and deleted_at is not null) then raise exception 'INVALID_TRANSITION: pedido eliminado';end if;
case p_operation
when 'save_production_plan' then
select * into item from public.items where id=(p_payload->>'product_id')::uuid and kind='product' and active;
if not found then raise exception 'VALIDATION_ERROR: producto inexistente o inactivo';end if;
qty:=app_private.product_quantity(item.id,p_payload->>'quantity');
if p_payload ? 'id' then
select * into plan from public.production_plans where id=entity;if not found then raise exception 'VALIDATION_ERROR: planificación inexistente';end if;
perform app_private.version(plan.version,p_expected_version);
if plan.status<>'planificado' then raise exception 'INVALID_TRANSITION: planificación cerrada';end if;
if qty<plan.fulfilled_quantity or (item.id<>plan.product_id and plan.fulfilled_quantity>0) then raise exception 'INVALID_TRANSITION: planificación ya tiene ingresos registrados';end if;
update public.production_plans set product_id=item.id,quantity=qty,available_on=(p_payload->>'available_on')::date,notes=coalesce(p_payload->>'notes',''),version=version+1 where id=entity;
else insert into public.production_plans(id,product_id,quantity,available_on,notes,created_by) values(entity,item.id,qty,(p_payload->>'available_on')::date,coalesce(p_payload->>'notes',''),app_private.actor_id());end if;
when 'cancel_production_plan','reconcile_production_plan' then
select * into plan from public.production_plans where id=entity;if not found then raise exception 'VALIDATION_ERROR: planificación inexistente';end if;
perform app_private.version(plan.version,p_expected_version);
if plan.status<>'planificado' then raise exception 'INVALID_TRANSITION: planificación cerrada';end if;
if p_operation='reconcile_production_plan' then
qty:=app_private.decimal(p_payload->>'actual_quantity');
if qty<plan.fulfilled_quantity or qty<0 or (select unit='unidad' from public.items where id=plan.product_id) and qty<>trunc(qty) then raise exception 'VALIDATION_ERROR: cantidad real menor a ingresos o unidad inválida';end if;
update public.production_plans set status='finalizado',actual_quantity=qty,version=version+1 where id=entity;
else update public.production_plans set status='cancelado',version=version+1 where id=entity;end if;
when 'delete_order' then
select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;
perform app_private.version(old.version,p_expected_version);
if old.returned_at is not null then raise exception 'INVALID_TRANSITION: pedido devuelto; requiere revisar devolución antes de eliminar';end if;
for mov in select * from public.movements m where m.event_id=entity and m.kind='delivery' order by m.created_at,m.id loop
if exists(select 1 from public.movements where reversal_of=mov.id) then raise exception 'INVALID_TRANSITION: entrega ya corregida; revisar historial antes de eliminar';end if;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id,reversal_of) values(mov.item_id,mov.location_id,-mov.quantity,'reversal','Eliminación de pedido cargado por error',p_command_id,mov.id);
end loop;
for fin in select * from public.financial_movements f where f.order_id=entity and f.kind in ('payment','refund') and not exists(select 1 from public.financial_movements r where r.reverses_id=f.id) order by f.created_at,f.id loop
insert into public.financial_movements(kind,order_id,purchase_id,amount,method,category,notes,reverses_id,transfer_name) values('reversal',entity,fin.purchase_id,-fin.amount,fin.method,fin.category,'Eliminación de pedido cargado por error',fin.id,fin.transfer_name);
end loop;
if coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0)<>0 then raise exception 'INVALID_TRANSITION: historial financiero requiere revisión antes de eliminar';end if;
update public.orders set status='cancelado',deleted_at=now(),deleted_by=app_private.actor_id(),updated_by=app_private.actor_id(),cancelled_at=coalesce(cancelled_at,now()),cancelled_by=app_private.actor_id(),payment_confirmed_at=null,payment_confirmed_by=null,version=version+1 where id=entity;
when 'append_spontaneous_sale' then
select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;
perform app_private.version(old.version,p_expected_version);
if old.status<>'pendiente_entrega' or old.sale_kind<>'pedido' then raise exception 'INVALID_TRANSITION: solo se agregan productos a pedidos pendientes';end if;
if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'VALIDATION_ERROR: productos requeridos';end if;
if (select count(*)<>count(distinct value->>'product_id') from jsonb_array_elements(p_payload->'lines')) then raise exception 'VALIDATION_ERROR: productos duplicados';end if;
if p_payload ? 'deliver' and jsonb_typeof(p_payload->'deliver')<>'boolean' then raise exception 'VALIDATION_ERROR: entrega inválida';end if;
if p_payload ? 'method' and p_payload->>'method' is distinct from old.payment_method then perform app_private.change_order_method(entity,p_payload->>'method');end if;
for rowdata in select value from jsonb_array_elements(p_payload->'lines') loop
perform app_private.keys(rowdata,array['product_id','quantity']);
select * into item from public.items where id=(rowdata->>'product_id')::uuid and kind='product' and active;if not found then raise exception 'VALIDATION_ERROR: producto inexistente o inactivo';end if;
qty:=app_private.product_quantity(item.id,rowdata->>'quantity');
insert into public.order_lines(order_id,product_id,quantity,unit_price,product_name,product_unit,product_package_size,price_effective_on)
values(entity,item.id,qty,app_private.product_price(item.id,today),item.name,item.unit,item.package_size,(select effective_on from public.product_prices where product_id=item.id and effective_on<=today order by effective_on desc,created_at desc,id desc limit 1))
on conflict(order_id,product_id) do update set quantity=public.order_lines.quantity+excluded.quantity;
end loop;
update public.orders set total=(select round(sum(quantity*unit_price),2) from public.order_lines where order_id=entity),transfer_name=case when p_payload ? 'transfer_name' then nullif(trim(p_payload->>'transfer_name'),'') else transfer_name end,version=version+1,updated_by=app_private.actor_id() where id=entity;
update public.orders o set payment_confirmed_at=null,payment_confirmed_by=null where o.id=entity and o.payment_method<>'gratis' and o.total>coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0);
perform app_private.collect_order_balance(entity,p_payload->>'payment_status',(select payment_method from public.orders where id=entity));
perform app_private.rebalance();
if coalesce((p_payload->>'deliver')::boolean,false) then
for line in select * from public.order_lines where order_id=entity loop
if app_private.usable_balance(line.product_id,old.location_id)-coalesce((select sum(l.reserved) from public.order_lines l join public.orders o on o.id=l.order_id where l.product_id=line.product_id and o.location_id=old.location_id and o.id<>entity and o.status='pendiente_entrega' and o.deleted_at is null),0)<line.quantity then raise exception 'INSUFFICIENT_STOCK: entrega conjunta supera stock libre';end if;
end loop;
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id) select product_id,old.location_id,-quantity,'delivery','Entrega conjunta con venta espontánea',entity from public.order_lines where order_id=entity;
update public.orders set status='entregado',delivered_at=now(),delivered_by=app_private.actor_id() where id=entity;
end if;
when 'save_client' then$patch$);
-- Persist nullable client preference; retain unchanged inactive historical references.
definition:=replace(definition,'perform app_private.validate_pets((select pets from public.clients where id=entity));', $patch$
if p_payload ? 'preferred_location_id' then
if nullif(p_payload->>'preferred_location_id','') is not null and not exists(select 1 from public.locations where id=p_payload->>'preferred_location_id' and active and is_pickup) and not exists(select 1 from public.clients where id=entity and preferred_location_id=p_payload->>'preferred_location_id') then raise exception 'VALIDATION_ERROR: punto preferido inválido';end if;
update public.clients set preferred_location_id=nullif(p_payload->>'preferred_location_id','') where id=entity;
end if;
perform app_private.validate_pets((select pets from public.clients where id=entity));$patch$);
definition:=replace(definition,'''weight_kg'',nullif(pet->>''weight_kg'',''''))', '''weight_kg'',nullif(pet->>''weight_kg'',''''))||case when pet ? ''species'' then jsonb_build_object(''species'',pet->>''species'') else ''{}''::jsonb end');
-- Plans snapshot a product's commercial unit implicitly; never reinterpret their quantities.
definition:=replace(definition,'or exists(select 1 from public.recipes where product_id=entity)) then raise exception ''VALIDATION_ERROR: unidad usada en historial''', 'or exists(select 1 from public.recipes where product_id=entity) or exists(select 1 from public.production_plans where product_id=entity)) then raise exception ''VALIDATION_ERROR: unidad usada en historial''');
-- Coherent method edits apply to metadata saves too, including previously paid orders.
definition:=replace(definition,'update public.orders set updated_by=app_private.actor_id(),client_id=', 'if p_payload->>''payment_method'' is distinct from old.payment_method then perform app_private.change_order_method(entity,p_payload->>''payment_method'');end if;
update public.orders set updated_by=app_private.actor_id(),client_id=');
definition:=replace(definition,'if p_payload->>''payment_status''=''no_pagado'' and exists(', 'if p_payload->>''payment_method''<>''gratis'' and p_payload->>''payment_status''=''no_pagado'' and exists(');
-- Cocina central is a planning context, not a destination for new physical products.
definition:=replace(definition,'if item.kind=''ingredient'' and source<>''cocina'' then', 'if item.kind=''product'' and source=''cocina'' and qty>0 then raise exception ''VALIDATION_ERROR: ingresar producción real en un punto de retiro, no en Cocina central'';end if;
if item.kind=''ingredient'' and source<>''cocina'' then');
definition:=replace(definition,'if source is null or destination is null or source=destination then', 'if destination=''cocina'' then raise exception ''VALIDATION_ERROR: destino debe ser un punto de retiro, no Cocina central'';end if;
if source is null or destination is null or source=destination then');
-- Remove the old today-only admission check; replace with coverage-preserving admission below.
definition:=regexp_replace(definition,'elsif \(p_payload->>''pickup_date''\)::date=today and not coalesce\(\(p_payload->>''allow_stock_shortage''\)::boolean,false\) then.*?end if;\nend if;\n\nwhen ''reschedule_order''', 'end if;

when ''reschedule_order''','s');
definition:=regexp_replace(definition,'if \(p_payload->>''pickup_date''\)::date=today and not coalesce\(\(p_payload->>''allow_stock_shortage''\)::boolean,false\) and exists\(.*?then raise exception ''STOCK_CONFIRMATION_REQUIRED: stock insuficiente; confirmar pedido con faltante'';end if;\nupdate public.orders set stock_shortage_confirmed=', 'update public.orders set stock_shortage_confirmed=','s');
-- Replace the payment-method branch introduced by the preceding migration.
definition:=regexp_replace(definition,'when ''set_order_payment_method'' then\n.*?when ''deliver_order'',''cancel_order'' then', $patch$
when 'set_order_payment_method' then
select * into old from public.orders where id=entity;if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;
perform app_private.version(old.version,p_expected_version);
if old.status='cancelado' or old.returned_at is not null then raise exception 'INVALID_TRANSITION: pedido cerrado';end if;
perform app_private.change_order_method(entity,p_payload->>'method');
update public.orders set updated_by=app_private.actor_id(),version=version+1 where id=entity;
when 'deliver_order','cancel_order' then$patch$,'s');
definition:=replace(definition,'''efectivo'',''transferencia'')) then raise exception ''VALIDATION_ERROR: medio de cobro inválido''', '''efectivo'',''transferencia'',''gratis'')) then raise exception ''VALIDATION_ERROR: medio de cobro inválido''');
definition:=replace(definition,'update public.orders set payment_method=coalesce(p_payload->>''method'',payment_method),transfer_name=', 'if p_payload ? ''method'' and p_payload->>''method'' is distinct from old.payment_method then perform app_private.change_order_method(entity,p_payload->>''method'');end if;
update public.orders set payment_method=coalesce(p_payload->>''method'',payment_method),transfer_name=');
definition:=replace(definition,'end case;
affected:=app_private.rebalance();', $patch$
end case;
if p_operation in ('save_order','reschedule_order') and coalesce((p_payload->>'allow_stock_shortage')::boolean,false) then
update public.orders set stock_shortage_confirmed=true where id=entity;
end if;
if p_operation in ('save_order','reschedule_order','append_spontaneous_sale') and not coalesce((p_payload->>'allow_stock_shortage')::boolean,false) and exists(
select 1 from app_private.coverage_allocations() a join public.order_lines l on l.id=a.line_id join public.orders o on o.id=l.order_id
where o.status='pendiente_entrega' and o.deleted_at is null and (a.shortage>coalesce((prior_shortages->>a.line_id::text)::numeric,0) or (o.id=entity and a.shortage>0 and before_snapshot is not null and ((p_payload ? 'pickup_date' and p_payload->>'pickup_date' is distinct from before_snapshot->>'pickup_date') or (p_payload ? 'location_id' and p_payload->>'location_id' is distinct from before_snapshot->>'location_id'))))) then
raise exception 'STOCK_CONFIRMATION_REQUIRED: stock insuficiente; confirmar pedido con faltante';
end if;
affected:=app_private.rebalance();$patch$);
definition:=replace(definition,'''reschedule_order'',''set_order_payment_method'') and not entity=any(affected)', '''reschedule_order'',''set_order_payment_method'',''delete_order'',''append_spontaneous_sale'') and not entity=any(affected)');
if definition=original or position('when ''save_production_plan'' then array[' in definition)=0 or position('prior_shortages jsonb' in definition)=0 or position('when ''delete_order'' then'||chr(10)||'select' in definition)=0 or position('prior_shortages->>' in definition)=0 then raise exception 'Unsupported dispatcher contract for production planning migration';end if;
execute definition;
end $migration$;

-- Audited settlement treats complimentary orders as paid without inventing money.
do $$declare definition text;begin
definition:=pg_get_functiondef('app_private.order_audit_snapshot(uuid)'::regprocedure);
definition:=replace(definition,'case when o.total<=','case when o.payment_method=''gratis'' or o.total<=');execute definition;
end$$;

-- Normal operational views omit deleted orders; the ledger, backup and audit retain evidence.
do $migration$
declare definition text;begin
definition:=pg_get_functiondef('app_private.snapshot_all()'::regprocedure);
definition:=replace(definition,'from public.orders t)', 'from public.orders t where t.deleted_at is null)');
definition:=replace(definition,'''shortage'',a.shortage::text)', '''shortage'',a.shortage::text,''future_reserved'',a.future_reserved::text)');
definition:=replace(definition,'''amount'',amount::text) order by occurred_on,created_at,id) from public.financial_movements t)', '''amount'',amount::text,''location_id'',(select o.location_id from public.orders o where o.id=t.order_id)) order by occurred_on,created_at,id) from public.financial_movements t)');
definition:=replace(definition,'''updated_at'',statement_timestamp()', $patch$
'production_plans',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('quantity',p.quantity::text,'fulfilled_quantity',p.fulfilled_quantity::text,'actual_quantity',p.actual_quantity::text,'unit',i.unit,'allocated_quantity',coalesce((select sum((a.plan_allocations->>p.id::text)::numeric) from app_private.coverage_allocations() a),0)::text,'available_quantity',case when p.status='planificado' then greatest(p.quantity-p.fulfilled_quantity-coalesce((select sum((a.plan_allocations->>p.id::text)::numeric) from app_private.coverage_allocations() a),0),0)::text else '0' end) order by p.available_on,p.created_at,p.id) from public.production_plans p join public.items i on i.id=p.product_id),'[]'::jsonb),
'updated_at',statement_timestamp()$patch$);
definition:=replace(definition,'join app_private.order_allocations() a on a.line_id=l.id','join app_private.coverage_allocations() a on a.line_id=l.id');
execute definition;
-- Non-admins see promises only as allocation on their own orders, never organization-wide production.
definition:=pg_get_functiondef('public.app_snapshot()'::regprocedure);
definition:=replace(definition,'''purchases'',''productions'',''recipes'',''movement_batches''', '''purchases'',''productions'',''recipes'',''movement_batches'',''production_plans''');execute definition;
definition:=pg_get_functiondef('public.app_export()'::regprocedure);
definition:=replace(definition,'''production_ingredients'',''movements''', '''production_ingredients'',''production_plans'',''production_plan_receipts'',''movements''');
definition:=replace(definition,$from$''shortage'',shortage::text,$from$,$to$''shortage'',shortage::text,''future_reserved'',future_reserved::text,$to$);
definition:=replace(definition,'case t when ''product_prices''', 'case t when ''production_plans'' then ''||jsonb_build_object(''''quantity'''',quantity::text,''''fulfilled_quantity'''',fulfilled_quantity::text,''''actual_quantity'''',actual_quantity::text)'' when ''production_plan_receipts'' then ''||jsonb_build_object(''''quantity'''',quantity::text)'' when ''product_prices''');execute definition;
end $migration$;
revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on all functions in schema app_private to pedidos_stock_backend;
notify pgrst,'reload schema';
