-- Creator recruitment, part 2: personal invite links, a daily automatic check and
-- emails sent from the admin console (api/prospects.ts, through Zoho).
--
-- 1. Every prospect gets a private invite code: fansreserve.com/c/<code>. The page
--    is public (also while the pre-launch gate is up) and calls:
--    - prospect_invite(code): shows who it is for and records the first open
--      (opened_at) and every later one (open_count). Admins previewing it don't count.
--    - prospect_interest(code, email): "Quiero participar" → status respondio
--      (if it was nuevo or contactado) and, optionally, an email to tell them when
--      we open in their country.
--    - prospect_unsubscribe(code): "No quiero recibir más mensajes" → no_contactar
--      (the existing trigger erases email, bio and notes).
--    - prospect_claim(code): once they have an account, links it (matched_profile_id)
--      and moves them to registrado. Never for admin accounts.
-- 2. prospect_events: one row per step (contactado, seguimiento, correo, abrio,
--    interesado, registrado, verificado, activo, baja), for the "last 24 hours"
--    box and the daily email cap. Only admins read it; only these functions write it.
-- 3. prospects_sync_run(automatic): the old prospects_sync() body, now also following
--    claimed accounts. pg_cron runs it every day at 12:00 UTC (6:00 a. m. in
--    Honduras); the admin button still calls prospects_sync(). Each run is logged in
--    prospect_sync_runs.
-- 4. prospects_email_quota() / prospects_email_sent(ids, follow_up): the API checks
--    how many emails went out today (Honduras time) and records the ones it sent.
-- 5. prospects_summary() adds last_24h, emails_today and last_auto_sync.
--
-- Additive and safe to re-run. Needs 20261101000001_creator_prospects.sql.

alter table public.creator_prospects
  add column if not exists invite_code text,
  add column if not exists opened_at timestamptz,
  add column if not exists last_opened_at timestamptz,
  add column if not exists open_count integer not null default 0,
  add column if not exists interested_at timestamptz;

update public.creator_prospects
set invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
where invite_code is null;

alter table public.creator_prospects
  alter column invite_code set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  alter column invite_code set not null;

create unique index if not exists creator_prospects_invite_code_idx on public.creator_prospects (invite_code);

-- Position in the funnel: 0 for descartado / no_contactar.
create or replace function public.prospect_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_position(array['nuevo', 'contactado', 'respondio', 'registrado', 'verificado', 'activo'], p_status), 0)
$$;

/* ---------- Events ---------- */

create table if not exists public.prospect_events (
  id bigint generated always as identity primary key,
  prospect_id uuid not null references public.creator_prospects (id) on delete cascade,
  kind text not null check (kind in ('contactado', 'seguimiento', 'correo', 'abrio', 'interesado', 'registrado', 'verificado', 'activo', 'baja')),
  at timestamptz not null default now()
);

create index if not exists prospect_events_at_idx on public.prospect_events (at desc);
create index if not exists prospect_events_prospect_idx on public.prospect_events (prospect_id);

alter table public.prospect_events enable row level security;
drop policy if exists "prospect_events: admins read" on public.prospect_events;
create policy "prospect_events: admins read" on public.prospect_events
  for select to authenticated using ((select public.is_admin()));
revoke all on public.prospect_events from anon;
revoke insert, update, delete on public.prospect_events from authenticated;

-- Status changes and follow-ups write their own event (DMs marked by hand included).
create or replace function public.creator_prospects_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('contactado', 'registrado', 'verificado', 'activo') then
    insert into public.prospect_events (prospect_id, kind) values (new.id, new.status);
  end if;
  if new.follow_ups > old.follow_ups then
    insert into public.prospect_events (prospect_id, kind) values (new.id, 'seguimiento');
  end if;
  return null;
end;
$$;

drop trigger if exists creator_prospects_log on public.creator_prospects;
create trigger creator_prospects_log after update on public.creator_prospects
  for each row execute function public.creator_prospects_log();

/* ---------- The public invite page ---------- */

create or replace function public.prospect_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.creator_prospects;
begin
  select * into p from public.creator_prospects where invite_code = lower(trim(coalesce(p_code, '')));
  if not found then return null; end if;
  if p.status = 'no_contactar' then
    return jsonb_build_object('handle', p.handle, 'network', p.network, 'unsubscribed', true);
  end if;
  -- The team checking the page doesn't count as the creator opening it.
  if not public.is_admin() then
    update public.creator_prospects
    set opened_at = coalesce(opened_at, now()), last_opened_at = now(), open_count = least(open_count + 1, 100000)
    where id = p.id;
    if p.opened_at is null then
      insert into public.prospect_events (prospect_id, kind) values (p.id, 'abrio');
    end if;
  end if;
  return jsonb_build_object(
    'handle', p.handle,
    'network', p.network,
    'name', p.display_name,
    'country', p.country,
    'interested', p.interested_at is not null,
    'registered', public.prospect_rank(p.status) >= 4,
    'unsubscribed', false
  );
end;
$$;

create or replace function public.prospect_interest(p_code text, p_email text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.creator_prospects;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Ese correo no parece válido';
  end if;
  select * into p from public.creator_prospects where invite_code = lower(trim(coalesce(p_code, '')));
  if not found or p.status = 'no_contactar' then return false; end if;
  if public.is_admin() then return true; end if;

  update public.creator_prospects
  set interested_at = coalesce(interested_at, now()),
      email = coalesce(email, v_email),
      status = case when status in ('nuevo', 'contactado') then 'respondio' else status end
  where id = p.id;
  if p.interested_at is null then
    insert into public.prospect_events (prospect_id, kind) values (p.id, 'interesado');
  end if;
  return true;
end;
$$;

create or replace function public.prospect_unsubscribe(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.creator_prospects
  set status = 'no_contactar'
  where invite_code = lower(trim(coalesce(p_code, ''))) and status <> 'no_contactar'
  returning id into v_id;
  if v_id is not null then
    insert into public.prospect_events (prospect_id, kind) values (v_id, 'baja');
  end if;
  return exists (select 1 from public.creator_prospects where invite_code = lower(trim(coalesce(p_code, ''))));
end;
$$;

create or replace function public.prospect_claim(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then return false; end if;
  if exists (select 1 from public.profiles where id = v_uid and role = 'admin') then return false; end if;
  update public.creator_prospects
  set matched_profile_id = v_uid,
      status = case when public.prospect_rank(status) < 4 then 'registrado' else status end
  where invite_code = lower(trim(coalesce(p_code, '')))
    and (matched_profile_id is null or matched_profile_id = v_uid)
  returning id into v_id;
  return v_id is not null;
end;
$$;

/* ---------- Daily automatic check ---------- */

create table if not exists public.prospect_sync_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  moved integer not null default 0,
  automatic boolean not null default false
);
alter table public.prospect_sync_runs enable row level security;
drop policy if exists "prospect_sync_runs: admins read" on public.prospect_sync_runs;
create policy "prospect_sync_runs: admins read" on public.prospect_sync_runs
  for select to authenticated using ((select public.is_admin()));
revoke all on public.prospect_sync_runs from anon;
revoke insert, update, delete on public.prospect_sync_runs from authenticated;

-- Links prospects to their account (the one they claimed with the invite link, or
-- the one that lists the same handle) and only moves them forward.
create or replace function public.prospects_sync_run(p_automatic boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved integer;
begin
  with found as (
    select distinct on (cp.id) cp.id, p.id as profile_id,
      case
        when p.role = 'creator' and p.is_verified and exists (
          select 1 from public.transactions s
          where s.creator_profile_id = p.creator_profile_id and s.status = 'paid' and s.created_at >= now() - interval '90 days'
        ) then 'activo'
        when p.role = 'creator' and p.is_verified then 'verificado'
        else 'registrado'
      end as target
    from public.creator_prospects cp
    join public.profiles p on p.role <> 'admin'
      and (p.id = cp.matched_profile_id or lower(p.settings->'socials'->>cp.network) = cp.handle)
    order by cp.id, (p.id = cp.matched_profile_id) desc, p.is_verified desc, p.created_at
  )
  update public.creator_prospects cp
  set matched_profile_id = f.profile_id,
      status = case when public.prospect_rank(f.target) > public.prospect_rank(cp.status) then f.target else cp.status end
  from found f
  where cp.id = f.id
    and (cp.matched_profile_id is distinct from f.profile_id or public.prospect_rank(f.target) > public.prospect_rank(cp.status));
  get diagnostics v_moved = row_count;
  insert into public.prospect_sync_runs (moved, automatic) values (v_moved, coalesce(p_automatic, false));
  delete from public.prospect_sync_runs where ran_at < now() - interval '90 days';
  return v_moved;
end;
$$;

create or replace function public.prospects_sync()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede hacer esto';
  end if;
  return public.prospects_sync_run(false);
end;
$$;

/* ---------- Emails from the console ---------- */

create or replace function public.prospects_email_quota()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede hacer esto';
  end if;
  return (
    select count(*) from public.prospect_events
    where kind = 'correo'
      and at >= (date_trunc('day', now() at time zone 'America/Tegucigalpa')) at time zone 'America/Tegucigalpa'
  );
end;
$$;

-- What api/prospects.ts calls after Zoho accepted each email.
create or replace function public.prospects_email_sent(p_ids uuid[], p_follow_up boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede hacer esto';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 100 then
    raise exception 'Demasiados correos en una sola llamada';
  end if;
  if p_follow_up then
    update public.creator_prospects set follow_ups = least(follow_ups + 1, 5) where id = any (p_ids) and status <> 'no_contactar';
  else
    update public.creator_prospects
    set status = case when status = 'nuevo' then 'contactado' else status end,
        channel = case when status = 'nuevo' then 'email' else channel end
    where id = any (p_ids) and status <> 'no_contactar';
  end if;
  insert into public.prospect_events (prospect_id, kind)
  select id, 'correo' from public.creator_prospects where id = any (p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/* ---------- Summary ---------- */

create or replace function public.prospects_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today timestamptz := (date_trunc('day', now() at time zone 'America/Tegucigalpa')) at time zone 'America/Tegucigalpa';
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver esto';
  end if;
  return jsonb_build_object(
    'by_country', coalesce((
      select jsonb_agg(jsonb_build_object('country', country, 'status', status, 'count', n))
      from (select coalesce(country, '') as country, status, count(*) as n from public.creator_prospects group by 1, 2) s
    ), '[]'::jsonb),
    'contacted_today', (select count(*) from public.creator_prospects where contacted_at >= v_today),
    'follow_ups_due', (
      select count(*) from public.creator_prospects
      where status = 'contactado' and follow_ups = 0 and contacted_at < now() - interval '5 days'),
    'to_enrich', (
      select count(*) from public.creator_prospects
      where network = 'instagram' and enriched_at is null and status not in ('descartado', 'no_contactar')),
    'last_24h', coalesce((
      select jsonb_object_agg(kind, n) from (
        select kind, count(*) as n from public.prospect_events where at >= now() - interval '24 hours' group by kind
      ) e), '{}'::jsonb),
    'emails_today', (select count(*) from public.prospect_events where kind = 'correo' and at >= v_today),
    'last_auto_sync', (select max(ran_at) from public.prospect_sync_runs where automatic),
    'measured_at', now()
  );
end;
$$;

revoke all on function public.prospect_rank(text) from public, anon;
revoke all on function public.creator_prospects_log() from public, anon, authenticated;
revoke all on function public.prospects_sync_run(boolean) from public, anon, authenticated;
revoke all on function public.prospects_sync() from public, anon;
revoke all on function public.prospects_summary() from public, anon;
revoke all on function public.prospects_email_quota() from public, anon;
revoke all on function public.prospects_email_sent(uuid[], boolean) from public, anon;
revoke all on function public.prospect_claim(text) from public, anon;
grant execute on function public.prospect_rank(text) to authenticated;
grant execute on function public.prospects_sync() to authenticated;
grant execute on function public.prospects_summary() to authenticated;
grant execute on function public.prospects_email_quota() to authenticated;
grant execute on function public.prospects_email_sent(uuid[], boolean) to authenticated;
grant execute on function public.prospect_claim(text) to authenticated;
-- The invite page works for visitors without an account.
grant execute on function public.prospect_invite(text) to anon, authenticated;
grant execute on function public.prospect_interest(text, text) to anon, authenticated;
grant execute on function public.prospect_unsubscribe(text) to anon, authenticated;

-- 12:00 UTC = 6:00 a. m. in Honduras (no daylight saving time).
create extension if not exists pg_cron;
select cron.schedule('prospects-daily-sync', '0 12 * * *', 'select public.prospects_sync_run(true)');
