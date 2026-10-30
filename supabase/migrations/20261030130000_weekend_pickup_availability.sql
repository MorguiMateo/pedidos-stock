-- Explicit openings and closures override recurring weekend defaults. Existing orders,
-- quantities, payments and stock are never cancelled or rewritten by this migration.
alter table public.pickup_closures add column closed boolean not null default true;

create or replace function app_private.assert_pickup_open(location text,pickup date)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare is_closed boolean;begin
select coalesce(
  (select c.closed from public.pickup_closures c where c.location_id=location and c.pickup_date=pickup),
  extract(dow from pickup)=0 or (extract(dow from pickup)=6 and not exists(
    select 1 from public.locations l where l.id=location and (lower(trim(l.name))='mendieta' or lower(trim(l.id))='mendieta')
  ))
) into is_closed;
if is_closed then
  raise exception 'PICKUP_CLOSED: % está cerrado el %; elegir otra fecha o habilitar el punto para ese día',(select name from public.locations where id=location),pickup;
end if;end$$;

do $migration$
declare definition text; original text; old_branch text; new_branch text;
begin
  original:=pg_get_functiondef('public.app_command(uuid,text,jsonb,integer)'::regprocedure);
  old_branch:=$old$insert into public.pickup_closures(id,location_id,pickup_date,reason) values(entity,loc,(p_payload->>'pickup_date')::date,trim(coalesce(p_payload->>'reason',''))) on conflict(location_id,pickup_date) do update set reason=excluded.reason,version=public.pickup_closures.version+1;
else delete from public.pickup_closures where location_id=loc and pickup_date=(p_payload->>'pickup_date')::date;end if;$old$;
  new_branch:=$new$insert into public.pickup_closures(id,location_id,pickup_date,reason,closed) values(entity,loc,(p_payload->>'pickup_date')::date,trim(coalesce(p_payload->>'reason','')),true) on conflict(location_id,pickup_date) do update set reason=excluded.reason,closed=true,version=public.pickup_closures.version+1;
else
insert into public.pickup_closures(id,location_id,pickup_date,reason,closed) values(entity,loc,(p_payload->>'pickup_date')::date,'',false) on conflict(location_id,pickup_date) do update set reason='',closed=false,version=public.pickup_closures.version+1;
end if;$new$;
  if position(old_branch in original)=0 then raise exception 'Unsupported app_command contract for weekend pickup availability';end if;
  definition:=replace(original,old_branch,new_branch);
  execute definition;
end $migration$;

notify pgrst,'reload schema';
