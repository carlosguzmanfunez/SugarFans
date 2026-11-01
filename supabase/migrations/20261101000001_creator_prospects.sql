-- Creator recruitment ("Captar creadores" in the admin dashboard).
--
-- creator_prospects holds the public creators the team plans to invite: one row per
-- network and handle, imported from a list (Heepsy, Modash, TikTok One, Meta Creator
-- Marketplace or made by hand) and optionally completed with the public numbers the
-- official Instagram API gives for a professional account (api/prospects.ts).
-- Only admins read or change it.
--
-- 1. prospects_import(rows, source): adds new prospects and refreshes the numbers of
--    the ones already listed. It never touches status, notes or contact dates, so a
--    list imported twice does not reset anyone, and "no contactar" stays.
-- 2. A trigger keeps the score (0-100: followers in the 10k-150k range, engagement,
--    a recent post, a public business email), the contact dates and, when someone
--    asks not to be contacted, removes their email, bio and notes.
-- 3. prospects_sync(): links prospects to the Fans Reserve account that lists the
--    same handle in its social networks and moves them forward: registrado (has an
--    account), verificado (verified creator), activo (verified creator with a paid
--    sale in the last 90 days). It only moves forward, never back.
-- 4. prospects_summary(): counts per country and status, today's contacts and the
--    follow-ups due (contacted 5+ days ago, no answer, no follow-up yet).
--
-- Additive and safe to re-run.

create table if not exists public.creator_prospects (
  id uuid primary key default gen_random_uuid(),
  network text not null check (network in ('instagram', 'tiktok', 'facebook', 'youtube')),
  handle text not null check (handle ~ '^[a-z0-9._-]{1,50}$'),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  city text check (city is null or char_length(city) <= 80),
  display_name text check (display_name is null or char_length(display_name) <= 120),
  category text check (category is null or char_length(category) <= 60),
  followers integer check (followers is null or followers >= 0),
  posts integer check (posts is null or posts >= 0),
  engagement numeric(6, 2) check (engagement is null or engagement between 0 and 1000),
  last_post_at timestamptz,
  email text check (email is null or (char_length(email) <= 160 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  bio text check (bio is null or char_length(bio) <= 600),
  website text check (website is null or char_length(website) <= 300),
  source text not null default 'manual' check (source in ('heepsy', 'modash', 'tiktok_one', 'meta_marketplace', 'manual', 'referido', 'otro')),
  status text not null default 'nuevo' check (status in ('nuevo', 'contactado', 'respondio', 'registrado', 'verificado', 'activo', 'descartado', 'no_contactar')),
  channel text check (channel is null or channel in ('dm', 'email')),
  contacted_at timestamptz,
  replied_at timestamptz,
  follow_ups smallint not null default 0 check (follow_ups between 0 and 5),
  last_follow_up_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 1000),
  score smallint not null default 0,
  enriched_at timestamptz,
  enrich_note text check (enrich_note is null or char_length(enrich_note) <= 200),
  matched_profile_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (network, handle)
);

create index if not exists creator_prospects_country_status_idx on public.creator_prospects (country, status);
create index if not exists creator_prospects_score_idx on public.creator_prospects (score desc, created_at desc);
create index if not exists creator_prospects_contacted_idx on public.creator_prospects (contacted_at) where contacted_at is not null;

alter table public.creator_prospects enable row level security;

drop policy if exists "creator_prospects: admins read" on public.creator_prospects;
create policy "creator_prospects: admins read" on public.creator_prospects
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "creator_prospects: admins update" on public.creator_prospects;
create policy "creator_prospects: admins update" on public.creator_prospects
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "creator_prospects: admins delete" on public.creator_prospects;
create policy "creator_prospects: admins delete" on public.creator_prospects
  for delete to authenticated using ((select public.is_admin()));

-- Rows are only added through prospects_import(), which validates each one.
revoke insert on public.creator_prospects from anon, authenticated;
revoke all on public.creator_prospects from anon;

-- Same weights as prospectScore() in src/lib/prospects.ts.
create or replace function public.prospect_score(p_followers integer, p_engagement numeric, p_last_post timestamptz, p_email text, p_at timestamptz)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select (
    case
      when p_followers is null then 15
      when p_followers between 10000 and 150000 then 40
      when p_followers between 3000 and 9999 then 25
      when p_followers between 150001 and 500000 then 20
      else 5
    end
    + case
      when p_engagement is null then 10
      when p_engagement >= 6 then 30
      when p_engagement >= 3 then 22
      when p_engagement >= 1.5 then 14
      else 5
    end
    + case
      when p_last_post is null then 8
      when p_last_post >= p_at - interval '14 days' then 20
      when p_last_post >= p_at - interval '45 days' then 12
      else 0
    end
    + case when coalesce(p_email, '') <> '' then 10 else 0 end
  )::smallint
$$;

create or replace function public.creator_prospects_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'no_contactar' then
    new.email := null;
    new.bio := null;
    new.notes := null;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'contactado' and new.contacted_at is null then new.contacted_at := now(); end if;
    if new.status = 'respondio' and new.replied_at is null then new.replied_at := now(); end if;
  end if;
  if tg_op = 'UPDATE' and new.follow_ups > old.follow_ups then
    new.last_follow_up_at := now();
  end if;
  new.score := public.prospect_score(new.followers, new.engagement, new.last_post_at, new.email, coalesce(new.enriched_at, now()));
  return new;
end;
$$;

drop trigger if exists creator_prospects_touch on public.creator_prospects;
create trigger creator_prospects_touch before insert or update on public.creator_prospects
  for each row execute function public.creator_prospects_touch();

-- "@Ana.Fit", "ana.fit" or the profile's address → "ana.fit"; null when it isn't a handle.
create or replace function public.prospect_handle(p_input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when h ~ '^[a-z0-9._-]{1,50}$' then h end
  from (
    select lower(regexp_replace(
      regexp_replace(
        regexp_replace(trim(coalesce(p_input, '')), '^(https?://)?(www\.|m\.)?(instagram\.com|tiktok\.com|facebook\.com|youtube\.com)/', '', 'i'),
        '[/?#].*$', ''),
      '^@', '')) as h
  ) s
$$;

create or replace function public.prospects_import(p_rows jsonb, p_source text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_handle text;
  v_network text;
  v_country text;
  v_email text;
  v_inserted int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_existed boolean;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede importar creadores';
  end if;
  if p_source not in ('heepsy', 'modash', 'tiktok_one', 'meta_marketplace', 'manual', 'referido', 'otro') then
    raise exception 'Origen no válido';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'La lista no es válida';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Importa como máximo 2,000 creadores por vez';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_network := lower(coalesce(r->>'network', ''));
    v_handle := public.prospect_handle(r->>'handle');
    v_country := nullif(upper(trim(coalesce(r->>'country', ''))), '');
    v_email := nullif(lower(trim(coalesce(r->>'email', ''))), '');
    if v_network not in ('instagram', 'tiktok', 'facebook', 'youtube') or v_handle is null
       or (v_country is not null and v_country !~ '^[A-Z]{2}$')
       or (v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select true into v_existed from public.creator_prospects where network = v_network and handle = v_handle;
    insert into public.creator_prospects as t (
      network, handle, country, city, display_name, category, followers, posts, engagement, last_post_at,
      email, bio, website, source, enriched_at, enrich_note)
    values (
      v_network, v_handle, v_country,
      left(nullif(trim(r->>'city'), ''), 80),
      left(nullif(trim(r->>'display_name'), ''), 120),
      left(nullif(trim(r->>'category'), ''), 60),
      case when (r->>'followers') ~ '^\d{1,10}$' then least((r->>'followers')::bigint, 2147483647)::int end,
      case when (r->>'posts') ~ '^\d{1,9}$' then (r->>'posts')::int end,
      case when (r->>'engagement') ~ '^\d{1,4}(\.\d+)?$' then least(round((r->>'engagement')::numeric, 2), 1000) end,
      case when (r->>'last_post_at') ~ '^\d{4}-\d{2}-\d{2}' then (r->>'last_post_at')::timestamptz end,
      v_email,
      left(nullif(trim(r->>'bio'), ''), 600),
      left(nullif(trim(r->>'website'), ''), 300),
      p_source,
      case when r->>'enriched' = 'true' then now() end,
      left(nullif(trim(r->>'enrich_note'), ''), 200))
    on conflict (network, handle) do update set
      country = coalesce(excluded.country, t.country),
      city = coalesce(excluded.city, t.city),
      display_name = coalesce(excluded.display_name, t.display_name),
      category = coalesce(excluded.category, t.category),
      followers = coalesce(excluded.followers, t.followers),
      posts = coalesce(excluded.posts, t.posts),
      engagement = coalesce(excluded.engagement, t.engagement),
      last_post_at = coalesce(excluded.last_post_at, t.last_post_at),
      -- Someone who asked not to be contacted never gets an email back.
      email = case when t.status = 'no_contactar' then null else coalesce(excluded.email, t.email) end,
      bio = case when t.status = 'no_contactar' then null else coalesce(excluded.bio, t.bio) end,
      website = coalesce(excluded.website, t.website),
      enriched_at = coalesce(excluded.enriched_at, t.enriched_at),
      enrich_note = case when excluded.enriched_at is not null then excluded.enrich_note else t.enrich_note end;
    if coalesce(v_existed, false) then v_updated := v_updated + 1; else v_inserted := v_inserted + 1; end if;
    v_existed := null;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;

create or replace function public.prospects_sync()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede hacer esto';
  end if;

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
      and lower(p.settings->'socials'->>cp.network) = cp.handle
    order by cp.id, p.is_verified desc, p.created_at
  ), ranked as (
    select f.*, cp.status,
      array_position(array['nuevo', 'contactado', 'respondio', 'registrado', 'verificado', 'activo'], f.target) as to_rank,
      coalesce(array_position(array['nuevo', 'contactado', 'respondio', 'registrado', 'verificado', 'activo'], cp.status), 0) as from_rank
    from found f join public.creator_prospects cp on cp.id = f.id
  )
  update public.creator_prospects cp
  set matched_profile_id = r.profile_id,
      status = case when r.to_rank > r.from_rank then r.target else cp.status end
  from ranked r
  where cp.id = r.id
    and (cp.matched_profile_id is distinct from r.profile_id or r.to_rank > r.from_rank);
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

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
    'measured_at', now()
  );
end;
$$;

revoke all on function public.prospects_import(jsonb, text) from public, anon;
revoke all on function public.prospects_sync() from public, anon;
revoke all on function public.prospects_summary() from public, anon;
grant execute on function public.prospects_import(jsonb, text) to authenticated;
grant execute on function public.prospects_sync() to authenticated;
grant execute on function public.prospects_summary() to authenticated;
