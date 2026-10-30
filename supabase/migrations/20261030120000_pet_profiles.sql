-- Pets remain in clients.pets and snapshots/exports; no public image bucket is required.
create or replace function app_private.validate_pets(pets jsonb) returns void language plpgsql set search_path=pg_catalog,app_private as $$
declare pet jsonb; observed date;
begin
if jsonb_typeof(pets) is distinct from 'array' or jsonb_array_length(pets)>100 or octet_length(pets::text)>4000000 then raise exception 'VALIDATION_ERROR: mascotas inválidas o fotos demasiado grandes';end if;
for pet in select value from jsonb_array_elements(pets) loop
perform app_private.keys(pet,array['name','weight_kg','diet','species','notes','photo_data_url','age_years','age_recorded_on']);
if jsonb_typeof(pet->'name') is distinct from 'string' or length(trim(coalesce(pet->>'name','')))=0 or length(pet->>'name')>200 then raise exception 'VALIDATION_ERROR: nombre de mascota requerido';end if;
if pet ? 'species' and (jsonb_typeof(pet->'species') is distinct from 'string' or pet->>'species' not in ('perro','gato')) then raise exception 'VALIDATION_ERROR: especie de mascota inválida';end if;
if nullif(pet->>'weight_kg','') is not null then perform app_private.decimal(pet->>'weight_kg',true);end if;
if pet ? 'diet' and (jsonb_typeof(pet->'diet') is distinct from 'string' or length(pet->>'diet')>5000) then raise exception 'VALIDATION_ERROR: dieta inválida';end if;
if pet ? 'notes' and (jsonb_typeof(pet->'notes') is distinct from 'string' or length(pet->>'notes')>5000) then raise exception 'VALIDATION_ERROR: anotaciones inválidas';end if;
if pet ? 'photo_data_url' and (jsonb_typeof(pet->'photo_data_url') is distinct from 'string' or length(pet->>'photo_data_url')>550000 or pet->>'photo_data_url' !~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/]*={0,2}$') then raise exception 'VALIDATION_ERROR: foto de mascota inválida';end if;
if (pet ? 'age_years') <> (pet ? 'age_recorded_on') then raise exception 'VALIDATION_ERROR: edad requiere fecha de referencia';end if;
if pet ? 'age_years' then
if jsonb_typeof(pet->'age_years') is distinct from 'string' or pet->>'age_years' !~ '^[0-9]+(\.[0-9]{1,4})?$' then raise exception 'VALIDATION_ERROR: edad inválida';end if;
if (pet->>'age_years')::numeric > 50 then raise exception 'VALIDATION_ERROR: edad inválida';end if;
if jsonb_typeof(pet->'age_recorded_on') is distinct from 'string' or pet->>'age_recorded_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'VALIDATION_ERROR: fecha de edad inválida';end if;
begin observed := (pet->>'age_recorded_on')::date; exception when others then raise exception 'VALIDATION_ERROR: fecha de edad inválida';end;
if observed > (now() at time zone 'America/Argentina/Mendoza')::date or observed < date '1900-01-01' then raise exception 'VALIDATION_ERROR: fecha de edad inválida';end if;
end if;
end loop;
end$$;

-- The previous normalizer retained only name, diet, weight and species. Preserve validated metadata too.
do $patch$
declare definition text; original text;
begin
select pg_get_functiondef('public.app_command(uuid,text,jsonb,integer)'::regprocedure) into definition;
original := definition;
definition := replace(definition,
  'else ''{}''::jsonb end) from jsonb_array_elements(pets) pet)',
  'else ''{}''::jsonb end||(pet - ''name'' - ''diet'' - ''weight_kg'' - ''species'')) from jsonb_array_elements(pets) pet)');
if definition = original then raise exception 'Pet metadata normalizer patch did not match';end if;
execute definition;
end $patch$;
