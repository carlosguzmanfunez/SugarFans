-- Live alerts ("campanita"): a creator marks that they are live and every
-- follower who kept alerts on gets an in-app notification.
--
--  * follows.live_alerts: the fan's bell for that creator (on by default when following).
--  * live_broadcasts: who is live right now (public, read-only for clients).
--  * notifications: each person's inbox; written only by security definer RPCs.
--  * start_live / end_live / mark_notifications_read RPCs.
--
-- The video of the free Live (one creator to many fans) is not here: it needs a
-- streaming service. This only records the state and sends the alerts.

-- ---------------------------------------------------------------------
-- Bell per followed creator
-- ---------------------------------------------------------------------
alter table public.follows add column if not exists live_alerts boolean not null default true;

drop policy if exists "follows: user updates own" on public.follows;
create policy "follows: user updates own" on public.follows
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Live broadcasts
-- ---------------------------------------------------------------------
create table if not exists public.live_broadcasts (
  id uuid primary key default gen_random_uuid(),
  creator_profile_id text not null check (char_length(creator_profile_id) between 1 and 64),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
-- One open Live per creator.
create unique index if not exists live_broadcasts_one_open on public.live_broadcasts (creator_profile_id) where ended_at is null;
create index if not exists live_broadcasts_creator_idx on public.live_broadcasts (creator_profile_id, started_at desc);

alter table public.live_broadcasts enable row level security;

drop policy if exists "live broadcasts: everyone reads" on public.live_broadcasts;
create policy "live broadcasts: everyone reads" on public.live_broadcasts
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('live_started')),
  creator_profile_id text,
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 200),
  link text not null default '' check (char_length(link) <= 200),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications: user reads own" on public.notifications;
create policy "notifications: user reads own" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "notifications: user deletes own" on public.notifications;
create policy "notifications: user deletes own" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

-- New notifications reach the open bell at once (Realtime applies the select policy).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
-- A Live left open (closed tab, lost connection) stops counting after 4 hours.
create or replace function public.start_live(p_title text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile text := public.my_creator_profile_id();
  v_title text := btrim(coalesce(p_title, ''));
  v_name text;
  v_id uuid;
  v_recent boolean;
  v_count integer := 0;
begin
  if v_profile is null then
    raise exception 'Solo los creators pueden iniciar un Live';
  end if;
  if char_length(v_title) < 3 or char_length(v_title) > 80 then
    raise exception 'El título del Live debe tener entre 3 y 80 caracteres';
  end if;
  if public.reserve_text_blocked(v_title) then
    raise exception 'Ese título no está permitido en Fans Reserve';
  end if;

  update public.live_broadcasts set ended_at = now()
    where creator_profile_id = v_profile and ended_at is null and started_at < now() - interval '4 hours';

  select id into v_id from public.live_broadcasts where creator_profile_id = v_profile and ended_at is null;
  if v_id is not null then
    return json_build_object('id', v_id, 'notified', 0);
  end if;

  -- Restarting within 30 minutes doesn't alert followers again.
  v_recent := exists (
    select 1 from public.live_broadcasts
    where creator_profile_id = v_profile and started_at > now() - interval '30 minutes'
  );

  insert into public.live_broadcasts (creator_profile_id, creator_id, title)
    values (v_profile, auth.uid(), v_title)
    returning id into v_id;

  if not v_recent then
    select coalesce(nullif(btrim(name), ''), 'Tu creator') into v_name from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
      select f.user_id, 'live_started', v_profile, left(v_name || ' está en Live', 160), v_title, '/en-vivo/' || v_profile
      from public.follows f
      where f.creator_profile_id = v_profile and f.live_alerts and f.user_id <> auth.uid();
    get diagnostics v_count = row_count;
  end if;

  return json_build_object('id', v_id, 'notified', v_count);
end;
$$;

create or replace function public.end_live()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.live_broadcasts set ended_at = now()
  where creator_profile_id = public.my_creator_profile_id() and ended_at is null;
$$;

create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null;
$$;

revoke execute on function public.start_live(text) from public, anon;
revoke execute on function public.end_live() from public, anon;
revoke execute on function public.mark_notifications_read() from public, anon;
grant execute on function public.start_live(text) to authenticated;
grant execute on function public.end_live() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
