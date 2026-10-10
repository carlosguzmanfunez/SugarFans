-- Numeral 3 (creator onboarding, 2026-10-10): every creator has their own
-- @usuario, unique across Fans Reserve, which they can change; fansreserve.com/@usuario
-- opens their profile. Their social networks live in settings.socials (handles
-- only; the app builds the links). Additive and safe to re-run.

alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles (username);

-- Names nobody can take: the team's words and the demo creators' handles.
create or replace function public.username_reserved(p_username text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_username = any (array[
    'admin', 'administrador', 'soporte', 'support', 'ayuda', 'help', 'fansreserve', 'fans_reserve', 'reserve', 'oficial', 'official',
    'legal', 'explore', 'explorar', 'login', 'register', 'settings', 'creator', 'creador', 'creadores', 'staff', 'moderador', 'root',
    'valentina_rose', 'diego_fit', 'sofia_art', 'mariana_s', 'andres_music', 'camila_r', 'mateo_plays', 'isabela_beauty', 'profe_daniel'
  ]);
$$;

-- A free handle from the creator's name: "Ana López" → ana_lopez, ana_lopez2, …
create or replace function public.free_username(p_name text)
returns text
language plpgsql
volatile -- sees handles given earlier in the same statement
security definer
set search_path = ''
as $$
declare
  v_base text := left(trim(both '_' from regexp_replace(lower(translate(coalesce(p_name, ''),
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc')), '[^a-z0-9]+', '_', 'g')), 24);
  v_try text;
  v_n integer := 1;
begin
  if char_length(v_base) < 3 then
    v_base := left(coalesce(nullif(v_base, ''), 'creador') || '_fr', 24);
  end if;
  v_try := v_base;
  while public.username_reserved(v_try)
     or exists (select 1 from public.profiles where username = v_try)
     or exists (select 1 from public.managed_profiles where username = v_try) loop
    v_n := v_n + 1;
    v_try := v_base || v_n;
  end loop;
  return v_try;
end;
$$;
revoke execute on function public.free_username(text) from public, anon, authenticated;

-- Creators always have a handle; a chosen one must be valid and free.
create or replace function public.check_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only creators have a public handle.
  if new.role <> 'creator' then
    new.username := null;
    return new;
  end if;
  if new.username is not null then
    new.username := lower(trim(new.username));
  end if;
  if new.username is null and new.role = 'creator' then
    new.username := case when new.creator_profile_id = '1' and not exists (select 1 from public.profiles where username = 'valentina_rose' and id <> new.id)
                         then 'valentina_rose' else public.free_username(new.name) end;
  elsif new.username is distinct from (case when tg_op = 'UPDATE' then old.username end) and new.username is not null then
    if new.username !~ '^[a-z0-9_]{3,30}$' then
      raise exception 'Tu @usuario debe tener de 3 a 30 letras, números o "_" (sin espacios ni acentos)';
    end if;
    if public.username_reserved(new.username) and not (new.creator_profile_id = '1' and new.username = 'valentina_rose') then
      raise exception 'Ese @usuario está reservado. Prueba con otro';
    end if;
    if exists (select 1 from public.profiles where username = new.username and id <> new.id)
       or exists (select 1 from public.managed_profiles where username = new.username) then
      raise exception 'Ese @usuario ya está en uso. Prueba con otro';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_username() from public, anon, authenticated;

drop trigger if exists check_username on public.profiles;
create trigger check_username
  before insert or update of username, role, name on public.profiles
  for each row execute function public.check_username();

-- Existing creators get theirs now (the demo creator account keeps Valentina's).
do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.profiles where role = 'creator' and username is null order by created_at loop
    update public.profiles set username = null where id = v_id;
  end loop;
end;
$$;

-- Public: a creator's @usuario and social networks.
create or replace function public.creator_links(p_creator_profile_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('username', p.username, 'socials', coalesce(p.settings->'socials', '{}'::jsonb))
       from public.profiles p where p.creator_profile_id = p_creator_profile_id and p.role = 'creator' limit 1),
    (select jsonb_build_object('username', m.username, 'socials', '{}'::jsonb)
       from public.managed_profiles m where m.id = p_creator_profile_id and not m.hidden),
    '{}'::jsonb
  );
$$;
grant execute on function public.creator_links(text) to anon, authenticated;

-- Public: creator profile id → @usuario, for the cards in Explore.
create or replace function public.creator_usernames()
returns table (id text, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.creator_profile_id, p.username from public.profiles p
  where p.role = 'creator' and p.creator_profile_id is not null and p.username is not null
    and not public.is_suspended(p.id);
$$;
grant execute on function public.creator_usernames() to anon, authenticated;

-- fansreserve.com/@usuario → the creator profile id (null when nobody has it).
create or replace function public.creator_by_username(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.creator_profile_id from public.profiles p
      where p.username = lower(ltrim(trim(p_username), '@')) and p.role = 'creator' and not public.is_suspended(p.id)),
    (select m.id from public.managed_profiles m where m.username = lower(ltrim(trim(p_username), '@')) and not m.hidden)
  );
$$;
grant execute on function public.creator_by_username(text) to anon, authenticated;
