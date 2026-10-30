-- ARS document totals use cents; ingredient unit costs retain six decimals.
create or replace function public.app_command(p_command_id uuid,p_operation text,p_payload jsonb,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private,extensions as $$
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
if p_payload->>'kind'='product' and unitprice<>round(unitprice,2) then raise exception 'VALIDATION_ERROR: precio de producto admite hasta 2 decimales';end if;
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
update public.purchases set total=(select round(sum(quantity*unit_price),2) from public.purchase_lines where purchase_id=entity) where id=entity;
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

alter table public.items add constraint product_price_cents check(kind<>'product' or price=round(price,2));
update public.purchases p set total=(select round(sum(quantity*unit_price),2) from public.purchase_lines l where l.purchase_id=p.id);
