-- Extend the existing dispatcher, keeping its actor, idempotency, version,
-- audit and permission boundaries. A planned payment never creates a collection.
do $migration$
declare definition text; original text;
begin
  original := pg_get_functiondef('public.app_command(uuid,text,jsonb,integer)'::regprocedure);
  definition := replace(original,
    'when ''deliver_order'' then array[''id'',''payment_status'',''method'',''transfer_name'']',
    'when ''set_order_payment_method'' then array[''id'',''method'']
when ''deliver_order'' then array[''id'',''payment_status'',''method'',''transfer_name'']');
  definition := replace(definition,
    '(''save_client'',''save_order'',''deliver_order'',''cancel_order'',''reschedule_order'',''record_payment'',''set_pickup_closure'')',
    '(''save_client'',''save_order'',''deliver_order'',''cancel_order'',''reschedule_order'',''record_payment'',''set_pickup_closure'',''set_order_payment_method'')');
  definition := replace(definition,
    '(''deliver_order'',''cancel_order'',''reschedule_order'',''record_payment'')',
    '(''deliver_order'',''cancel_order'',''reschedule_order'',''record_payment'',''set_order_payment_method'')');
  definition := replace(definition, 'when ''deliver_order'',''cancel_order'' then', $branch$
when 'set_order_payment_method' then
select * into old from public.orders where id=entity;
if not found then raise exception 'VALIDATION_ERROR: pedido inexistente';end if;
perform app_private.version(old.version,p_expected_version);
if p_payload->>'method' is null or p_payload->>'method' not in ('efectivo','transferencia') then raise exception 'VALIDATION_ERROR: medio de pago previsto inválido';end if;
if old.status='cancelado' or old.returned_at is not null then raise exception 'INVALID_TRANSITION: pedido cerrado';end if;
if old.total<=coalesce((select sum(f.amount) from public.financial_movements f where f.order_id=entity),0) then raise exception 'INVALID_TRANSITION: pedido ya pagado';end if;
update public.orders set payment_method=p_payload->>'method',transfer_name=case when p_payload->>'method'='efectivo' then null else transfer_name end,updated_by=app_private.actor_id(),version=version+1 where id=entity;
when 'deliver_order','cancel_order' then$branch$);
  definition := replace(definition,
    '(''save_order'',''deliver_order'',''cancel_order'',''reschedule_order'')',
    '(''save_order'',''deliver_order'',''cancel_order'',''reschedule_order'',''set_order_payment_method'')');
  -- Fail atomically if the dispatcher no longer matches the supported contract.
  if definition = original
    or position('when ''set_order_payment_method'' then array[''id'',''method'']' in definition) = 0
    or position('set_order_payment_method'') then raise exception ''FORBIDDEN' in definition) = 0
    or position('''record_payment'',''set_order_payment_method'') or' in definition) = 0
    or position('''reschedule_order'',''set_order_payment_method'') and not entity=any(affected)' in definition) = 0
    or position('VALIDATION_ERROR: medio de pago previsto inválido' in definition) = 0 then
    raise exception 'Unsupported app_command contract for planned payment method migration';
  end if;
  execute definition;
end $migration$;

notify pgrst,'reload schema';
