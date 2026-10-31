-- 1) revert_delivery: an administrator or the assigned pickup point can move a delivered order back
--    to "pendiente_entrega" or to "cancelado". Every consumed stock movement is reversed exactly once
--    (lot allocations included) and collections are left untouched.
-- 2) Spontaneous sales may be registered on any past or future date and are never blocked by pickup closures.

create function app_private.revert_delivery(entity uuid,p jsonb,command uuid,expected_version integer) returns void
language plpgsql set search_path=pg_catalog,public,app_private as $$
declare old public.orders%rowtype;target text;mov record;begin
select * into old from public.orders where id=entity for update;
if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;
perform app_private.version(old.version,expected_version);
target:=p->>'target';
if target is null or target not in ('pendiente_entrega','cancelado') then raise exception 'VALIDATION_ERROR: estado destino inválido';end if;
if old.status<>'entregado' or old.returned_at is not null then raise exception 'INVALID_TRANSITION: solo se revierte una entrega vigente';end if;
if target='cancelado' and coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0)>0 then raise exception 'INVALID_TRANSITION: pedido con cobros; revertir el cobro antes de cancelar';end if;
if target='pendiente_entrega' and old.sale_kind='espontanea' then raise exception 'INVALID_TRANSITION: una venta espontánea no vuelve a pendiente; cancelala';end if;
if target='pendiente_entrega' then perform app_private.assert_pickup_open(old.location_id,old.pickup_date);end if;
-- Positive corrections are reversed last so a restored lot is never consumed twice in the same command.
for mov in select * from public.movements m where m.event_id=entity and m.kind in ('delivery','delivery_edit') and m.reversal_of is null and not exists(select 1 from public.movements r where r.reversal_of=m.id) order by m.quantity,m.created_at,m.id loop
insert into public.movements(item_id,location_id,quantity,kind,reason,event_id,reversal_of) values(mov.item_id,mov.location_id,-mov.quantity,'reversal','Entrega revertida',command,mov.id);
end loop;
if target='cancelado' then
update public.orders set status='cancelado',delivered_at=null,delivered_by=null,cancelled_at=now(),cancelled_by=app_private.actor_id(),first_purchase_commercial_at=null,updated_by=app_private.actor_id(),version=version+1 where id=entity;
else
update public.orders set status='pendiente_entrega',delivered_at=null,delivered_by=null,first_purchase_commercial_at=null,updated_by=app_private.actor_id(),version=version+1 where id=entity;
end if;
end$$;

do $migration$
declare original text;definition text;
begin
original:=pg_get_functiondef('public.app_command(uuid,text,jsonb,integer)'::regprocedure);definition:=original;
definition:=replace(definition,'when ''delete_order'' then array[''id'']','when ''delete_order'' then array[''id'']'||chr(10)||'when ''revert_delivery'' then array[''id'',''target'']');
definition:=replace(definition,'''delete_order'',''append_spontaneous_sale'') then raise exception ''FORBIDDEN: operación reservada','''delete_order'',''append_spontaneous_sale'',''revert_delivery'') then raise exception ''FORBIDDEN: operación reservada');
definition:=replace(definition,'if p_operation in (''deliver_order'',''cancel_order'',''reschedule_order'',''record_payment'',''set_order_payment_method'',''delete_order'',''append_spontaneous_sale'') or (p_operation=''save_order'' and p_payload ? ''id'') then','if p_operation in (''deliver_order'',''cancel_order'',''reschedule_order'',''record_payment'',''set_order_payment_method'',''delete_order'',''append_spontaneous_sale'',''revert_delivery'') or (p_operation=''save_order'' and p_payload ? ''id'') then');
definition:=replace(definition,'if p_operation in (''save_order'',''deliver_order'',''cancel_order'',''reschedule_order'',''set_order_payment_method'',''delete_order'',''append_spontaneous_sale'') and exists(select 1 from public.orders where id=entity and deleted_at is not null)','if p_operation in (''save_order'',''deliver_order'',''cancel_order'',''reschedule_order'',''set_order_payment_method'',''delete_order'',''append_spontaneous_sale'',''revert_delivery'') and exists(select 1 from public.orders where id=entity and deleted_at is not null)');
definition:=replace(definition,'when ''return_order'' then'||chr(10)||'select * into old','when ''revert_delivery'' then'||chr(10)||'perform app_private.revert_delivery(entity,p_payload,p_command_id,p_expected_version);'||chr(10)||'when ''return_order'' then'||chr(10)||'select * into old');
definition:=replace(definition,'''delete_order'',''append_spontaneous_sale'') and not entity=any(affected)','''delete_order'',''append_spontaneous_sale'',''revert_delivery'') and not entity=any(affected)');
if (length(definition)-length(replace(definition,'revert_delivery','')))/length('revert_delivery')<>7 then raise exception 'Unsupported app_command contract for revert_delivery';end if;
execute definition;
end $migration$;

do $migration$
declare definition text;
begin
definition:=pg_get_functiondef('app_private.save_editable_order(uuid,jsonb,integer)'::regprocedure);
if position('if sale=''espontanea'' and old.id is null then pickup:=today;end if;' in definition)=0 or position('if old.id is null or old.status=''pendiente_entrega'' then perform app_private.assert_pickup_open(loc,pickup);end if;' in definition)=0 then raise exception 'Unsupported save_editable_order contract for spontaneous dates';end if;
definition:=replace(definition,'if sale=''espontanea'' and old.id is null then pickup:=today;end if;','if sale=''espontanea'' and old.id is null then pickup:=coalesce((p->>''pickup_date'')::date,today);end if;');
definition:=replace(definition,'if old.id is null or old.status=''pendiente_entrega'' then perform app_private.assert_pickup_open(loc,pickup);end if;','if sale<>''espontanea'' and (old.id is null or old.status=''pendiente_entrega'') then perform app_private.assert_pickup_open(loc,pickup);end if;');
execute definition;
end $migration$;

revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on all functions in schema app_private to pedidos_stock_backend;
notify pgrst,'reload schema';
