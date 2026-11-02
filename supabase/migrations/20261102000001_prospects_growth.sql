-- Creator recruitment, part 3 ("Captar creadores"):
--
-- 1. Message versions A and B. creator_prospects.message_variant records which
--    version of the first message each creator got (the console sets it when it
--    marks the contact), so prospects_insights() can show the reply rate of each.
-- 2. prospects_insights() for the admin console: the reply rate per channel and
--    version, and the creators that other creators invited (creator_invites).
-- 3. prospects_digest(): what moved in the last 24 hours and what is pending today,
--    for the morning email that api/prospects.ts sends (Vercel Cron, with the
--    service role). Nobody else can call it.
-- 4. social_connections: the TikTok account a user connected with TikTok Login Kit
--    (api/tiktok.ts). Only the public numbers TikTok gives (username, name,
--    followers, likes, videos); no tokens are stored. The owner and admins read
--    it, the owner can disconnect it, and only the server writes it, through
--    social_connection_save(), which also fills settings.socials.tiktok so the
--    daily prospect check finds the account.
--
-- Additive and safe to re-run. Needs 20261101000002_prospect_invites.sql.

/* ---------- 1. Message versions ---------- */

alter table public.creator_prospects
  add column if not exists message_variant text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'creator_prospects_message_variant_check') then
    alter table public.creator_prospects
      add constraint creator_prospects_message_variant_check check (message_variant is null or message_variant in ('A', 'B'));
  end if;
end;
$$;

/* ---------- 2. Insights for the console ---------- */

create or replace function public.prospects_insights()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver esto';
  end if;
  return jsonb_build_object(
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object('channel', channel, 'variant', variant, 'contacted', contacted, 'replied', replied) order by channel, variant)
      from (
        select coalesce(channel, 'dm') as channel, message_variant as variant, count(*) as contacted,
          count(*) filter (where interested_at is not null or replied_at is not null or public.prospect_rank(status) >= 3) as replied
        from public.creator_prospects
        where message_variant is not null and contacted_at is not null
        group by 1, 2
      ) v
    ), '[]'::jsonb),
    'creator_invites', (
      select jsonb_build_object(
        'total', count(*),
        'verified', count(*) filter (where p.is_verified),
        'selling', count(*) filter (where exists (
          select 1 from public.transactions t where t.creator_profile_id = i.creator_profile_id and t.status = 'paid')),
        'last_30_days', count(*) filter (where i.joined_at >= now() - interval '30 days')
      )
      from public.creator_invites i
      left join public.profiles p on p.id = i.creator_id
    ),
    'top_inviters', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc, name)
      from (
        select coalesce(r.name, 'Creador') as name, count(*) as n
        from public.creator_invites i
        left join public.profiles r on r.creator_profile_id = i.referrer_profile_id and r.role = 'creator'
        group by 1
        order by 2 desc, 1
        limit 5
      ) t
    ), '[]'::jsonb),
    'measured_at', now()
  );
end;
$$;

/* ---------- 3. The morning email ---------- */

create or replace function public.prospects_digest()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'last_24h', coalesce((
      select jsonb_object_agg(kind, n) from (
        select kind, count(*) as n from public.prospect_events where at >= now() - interval '24 hours' group by kind
      ) e), '{}'::jsonb),
    'people', coalesce((
      select jsonb_object_agg(kind, list) from (
        select kind, jsonb_agg(jsonb_build_object('handle', handle, 'network', network, 'name', display_name) order by at desc) as list
        from (
          select distinct on (e.kind, p.id) e.kind, e.at, p.handle, p.network, p.display_name,
            row_number() over (partition by e.kind order by e.at desc) as n
          from public.prospect_events e
          join public.creator_prospects p on p.id = e.prospect_id
          where e.at >= now() - interval '24 hours' and e.kind in ('interesado', 'registrado', 'verificado', 'activo')
          order by e.kind, p.id, e.at desc
        ) x
        where n <= 8
        group by kind
      ) k), '{}'::jsonb),
    'interested', (select count(*) from public.creator_prospects where status = 'respondio'),
    'follow_ups_due', (
      select count(*) from public.creator_prospects
      where status = 'contactado' and follow_ups = 0 and contacted_at < now() - interval '5 days'),
    'to_contact', (select count(*) from public.creator_prospects where status = 'nuevo'),
    'creators_invited_24h', (select count(*) from public.creator_invites where joined_at >= now() - interval '24 hours'),
    'measured_at', now()
  )
$$;

/* ---------- 4. Connected TikTok accounts ---------- */

create table if not exists public.social_connections (
  user_id uuid not null references public.profiles (id) on delete cascade,
  network text not null check (network in ('tiktok')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  username text check (username is null or username ~ '^[a-z0-9._-]{1,50}$'),
  display_name text check (display_name is null or char_length(display_name) <= 120),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2000),
  followers integer check (followers is null or followers >= 0),
  likes bigint check (likes is null or likes >= 0),
  videos integer check (videos is null or videos >= 0),
  network_verified boolean not null default false,
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  primary key (user_id, network),
  unique (network, external_id)
);

alter table public.social_connections enable row level security;
drop policy if exists "social_connections: owner or admin reads" on public.social_connections;
create policy "social_connections: owner or admin reads" on public.social_connections
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "social_connections: owner disconnects" on public.social_connections;
create policy "social_connections: owner disconnects" on public.social_connections
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.social_connections from anon;
revoke insert, update on public.social_connections from authenticated;

-- Called by api/tiktok.ts after TikTok confirmed the account. Another Fans Reserve
-- account that had the same TikTok loses it (one TikTok, one account).
create or replace function public.social_connection_save(
  p_user uuid, p_network text, p_external_id text, p_username text, p_display_name text,
  p_avatar_url text, p_followers integer, p_likes bigint, p_videos integer, p_verified boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := nullif(lower(regexp_replace(coalesce(p_username, ''), '^@', '')), '');
begin
  if p_network <> 'tiktok' or coalesce(p_external_id, '') = '' then
    raise exception 'Cuenta no válida';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    return false;
  end if;
  if v_username is not null and v_username !~ '^[a-z0-9._-]{1,50}$' then
    v_username := null;
  end if;
  delete from public.social_connections where network = p_network and external_id = p_external_id and user_id <> p_user;
  insert into public.social_connections as s (user_id, network, external_id, username, display_name, avatar_url, followers, likes, videos, network_verified)
  values (p_user, p_network, p_external_id, v_username, left(p_display_name, 120), left(p_avatar_url, 2000),
    greatest(p_followers, 0), greatest(p_likes, 0), greatest(p_videos, 0), coalesce(p_verified, false))
  on conflict (user_id, network) do update set
    external_id = excluded.external_id, username = excluded.username, display_name = excluded.display_name,
    avatar_url = excluded.avatar_url, followers = excluded.followers, likes = excluded.likes, videos = excluded.videos,
    network_verified = excluded.network_verified, refreshed_at = now(),
    connected_at = case when s.external_id = excluded.external_id then s.connected_at else now() end;
  if v_username is not null then
    update public.profiles
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{socials}',
      coalesce(settings->'socials', '{}'::jsonb) || jsonb_build_object('tiktok', v_username))
    where id = p_user;
  end if;
  return true;
end;
$$;

revoke all on function public.prospects_insights() from public, anon;
revoke all on function public.prospects_digest() from public, anon, authenticated;
revoke all on function public.social_connection_save(uuid, text, text, text, text, text, integer, bigint, integer, boolean) from public, anon, authenticated;
grant execute on function public.prospects_insights() to authenticated;
grant execute on function public.prospects_digest() to service_role;
grant execute on function public.social_connection_save(uuid, text, text, text, text, text, integer, bigint, integer, boolean) to service_role;
