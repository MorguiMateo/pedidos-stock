-- Managed Supabase owns the auth schema with supabase_admin. Project postgres
-- cannot delegate its schema USAGE to a custom role. Keep the constrained
-- business owner (NOINHERIT/NOBYPASSRLS), without granting authenticated or
-- service_role membership and without exposing Auth tables to the frontend.
create function app_private.actor_id() returns uuid
language sql stable set search_path=pg_catalog as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'
  )::uuid
$$;

-- A deliberately narrow bridge owned by the migration administrator. Password
-- hashes, identities, refresh tokens and sessions can never pass through it.
create function app_private.auth_directory()
returns table(id uuid,email text,raw_user_meta_data jsonb)
language sql stable security definer set search_path=pg_catalog as $$
  select u.id,u.email,u.raw_user_meta_data from auth.users u
$$;

revoke all on function app_private.actor_id(),app_private.auth_directory()
  from public,anon,authenticated;
grant execute on function app_private.actor_id(),app_private.auth_directory()
  to pedidos_stock_backend;

-- Preserve all owners, security-definer flags, signatures and contracts while
-- replacing their dependency on the nondelegable managed schema permission.
do $$
declare routine record; definition text;
begin
  for routine in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='app_private' or (n.nspname='public' and p.proname in ('app_command','app_snapshot','app_has_access','app_set_member')))
      and p.prokind='f'
      and p.oid not in ('app_private.actor_id()'::regprocedure,'app_private.auth_directory()'::regprocedure)
  loop
    definition:=pg_get_functiondef(routine.oid);
    if position('auth.uid()' in definition)>0 or position('from auth.users u' in definition)>0 then
      definition:=replace(definition,'auth.uid()','app_private.actor_id()');
      definition:=replace(definition,'from auth.users u','from app_private.auth_directory() u');
      execute definition;
    end if;
  end loop;
end $$;

notify pgrst,'reload schema';
