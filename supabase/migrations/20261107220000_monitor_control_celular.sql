-- Control del celular (Mano derecha): ver los números en vivo desde el teléfono
-- sin iniciar sesión en la web, con una llave privada que crea el dueño.
-- - La llave se muestra una sola vez al crearla; aquí solo se guarda su huella (sha256).
-- - monitor_live(llave) devuelve lo mismo que ve el panel Mano derecha (dinero de la
--   última hora, hoy y el mes, problemas, movimiento, últimos días y reportes de las 12).
-- - Solo lee: no mueve dinero, no cambia cuentas, no escribe nada salvo "último uso".
-- - El dueño revoca una llave desde el panel y deja de servir al instante.
-- Se puede volver a ejecutar sin problema.

create table if not exists public.monitor_access_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  label text not null check (length(trim(label)) between 1 and 40),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  uses integer not null default 0,
  revoked_at timestamptz
);
alter table public.monitor_access_keys enable row level security;
revoke all on public.monitor_access_keys from public, anon, authenticated;

-- Solo el dueño (no otros administradores): son los números del negocio.
create or replace function public.monitor_is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin() and exists (select 1 from security_private.owner_account where user_id = auth.uid());
$$;
revoke execute on function public.monitor_is_owner() from public, anon, authenticated;

create or replace function public.monitor_key_hash(p_key text)
returns text
language sql immutable set search_path = ''
as $$
  select encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
$$;
revoke execute on function public.monitor_key_hash(text) from public, anon, authenticated;

-- Crear una llave (máximo 3 activas). Devuelve la llave en claro una sola vez.
create or replace function public.monitor_key_create(p_label text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := 'frc_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_label text := left(coalesce(nullif(trim(p_label), ''), 'Mi celular'), 40);
  v_id uuid;
begin
  if not public.monitor_is_owner() then raise exception 'Solo el dueño puede crear la llave del celular'; end if;
  if (select count(*) from public.monitor_access_keys where revoked_at is null) >= 3 then
    raise exception 'Ya hay 3 llaves activas: revoca una antes de crear otra';
  end if;
  insert into public.monitor_access_keys (key_hash, label, created_by)
  values (public.monitor_key_hash(v_key), v_label, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'label', v_label, 'key', v_key);
end;
$$;
revoke execute on function public.monitor_key_create(text) from public, anon;
grant execute on function public.monitor_key_create(text) to authenticated;

create or replace function public.monitor_key_list()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.monitor_is_owner() then raise exception 'Solo el dueño'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'created_at', created_at,
             'last_used_at', last_used_at, 'uses', uses) order by created_at desc)
      from public.monitor_access_keys where revoked_at is null), '[]'::jsonb);
end;
$$;
revoke execute on function public.monitor_key_list() from public, anon;
grant execute on function public.monitor_key_list() to authenticated;

create or replace function public.monitor_key_revoke(p_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.monitor_is_owner() then raise exception 'Solo el dueño'; end if;
  update public.monitor_access_keys set revoked_at = now() where id = p_id and revoked_at is null;
  return found;
end;
$$;
revoke execute on function public.monitor_key_revoke(uuid) from public, anon;
grant execute on function public.monitor_key_revoke(uuid) to authenticated;

-- Lo que ve la página del celular. Con una llave que no existe o revocada devuelve null
-- (sin decir por qué). Calcula al momento: no espera a la foto de cada hora.
create or replace function public.monitor_live(p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_key is null or length(p_key) not between 60 and 80 then return null; end if;
  select id into v_id from public.monitor_access_keys
   where key_hash = public.monitor_key_hash(p_key) and revoked_at is null;
  if v_id is null then return null; end if;
  update public.monitor_access_keys set last_used_at = now(), uses = uses + 1 where id = v_id;

  return jsonb_build_object(
    'ahora', public.monitor_build(),
    'horas', coalesce((
      select jsonb_agg(jsonb_build_object('at', taken_at, 'cobrado', data->'ultima_hora'->'cobrado') order by taken_at)
        from public.monitor_snapshots
       where kind = 'hourly' and taken_at > now() - interval '24 hours'), '[]'::jsonb),
    'dias', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'closed', closed, 'dinero', data->'dinero') order by day desc)
        from (select day, closed, data from public.monitor_daily order by day desc limit 14) d), '[]'::jsonb),
    'reportes', coalesce((
      select jsonb_agg(jsonb_build_object('kind', kind, 'day', day, 'title', title, 'body', body,
               'created_at', created_at, 'emailed_at', emailed_at) order by created_at desc)
        from (select * from public.monitor_reports order by created_at desc limit 4) r), '[]'::jsonb),
    'ultima_revision', (select max(taken_at) from public.monitor_snapshots)
  );
end;
$$;
revoke execute on function public.monitor_live(text) from public;
grant execute on function public.monitor_live(text) to anon, authenticated;
