-- Closes a free Live on its own when the creator vanishes without leaving the
-- page (phone switched off, browser crashed, connection lost). While the
-- creator has the Live page open it checks in every 30 seconds
-- (live_heartbeat); a Live with no check-in for 2 minutes is closed by
-- close_stale_lives, which pg_cron runs every minute and each check-in also runs.

-- Empty until the first check-in, so a Live opened from a page without
-- check-ins (an older version of the site) is never closed by this.
alter table public.live_broadcasts add column if not exists last_seen_at timestamptz;

create or replace function public.close_stale_lives()
returns integer
language sql
security definer
set search_path = ''
as $$
  with closed as (
    update public.live_broadcasts set ended_at = last_seen_at
    where ended_at is null and last_seen_at < now() - interval '2 minutes'
    returning 1
  )
  select count(*)::integer from closed;
$$;

-- True while the signed-in creator's Live is still open; false once it was closed.
create or replace function public.live_heartbeat()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open boolean;
begin
  update public.live_broadcasts set last_seen_at = now()
    where creator_profile_id = public.my_creator_profile_id() and ended_at is null;
  v_open := found;
  perform public.close_stale_lives();
  return v_open;
end;
$$;

revoke execute on function public.close_stale_lives() from public, anon, authenticated;
revoke execute on function public.live_heartbeat() from public, anon;
grant execute on function public.live_heartbeat() to authenticated;

-- Every minute, even when no creator is checking in.
create extension if not exists pg_cron;
select cron.schedule('close-stale-lives', '* * * * *', 'select public.close_stale_lives()');
