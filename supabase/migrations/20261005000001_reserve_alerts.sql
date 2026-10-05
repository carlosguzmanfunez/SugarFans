-- Reserve alerts: the creator hears about every request at once, the fan knows
-- where their request stands, and no request waits forever.
--
--  * notifications: two new kinds. reserve_request goes to the creator (a new
--    request or reservation, a fan's cancellation, payment, an accepted
--    counter-offer); reserve_update goes to the fan (accepted, counter-offer,
--    rejected, expired). Written by triggers on vip_bookings, so every path that
--    creates or changes a booking (RPCs, PayPal, the expiry job) alerts the same way.
--  * vip_bookings.seen_at: when the creator first opened the request (the fan
--    sees "Vista"). Set by reserve_mark_seen() when the creator opens Reservas.
--  * vip_bookings.respond_by: deadline to answer. A pending request gives the
--    creator reserve_response_hours() (48 h); a counter-offer gives the fan the
--    same. Never later than the experience itself. Past it, the expiry job
--    (pg_cron, every 10 minutes) moves the booking to the new status 'expired'
--    and frees the slot. Nothing is charged before the creator accepts, so
--    nothing has to be refunded.
--  * Phone alerts (Web Push): push_subscriptions holds each device's
--    subscription; every new notification asks the Vercel function
--    /api/push (via pg_net) to deliver it. app_secrets keeps the push keys the
--    function generates on first use (service role only).
--
-- Idempotent: safe to run again.

-- ---------------------------------------------------------------------
-- 1. Booking columns and the 'expired' status
-- ---------------------------------------------------------------------
alter table public.vip_bookings drop constraint if exists vip_bookings_status_check;
alter table public.vip_bookings add constraint vip_bookings_status_check check (status in (
  'pending', 'accepted', 'confirmed', 'rejected', 'cancelled',
  'countered', 'reschedule_requested', 'completed', 'disputed', 'expired'
));
alter table public.vip_bookings add column if not exists seen_at timestamptz;
alter table public.vip_bookings add column if not exists respond_by timestamptz;
create index if not exists vip_bookings_respond_by_idx on public.vip_bookings (respond_by)
  where status in ('pending', 'countered');

-- Hours to answer a request (creator) or a counter-offer (fan). Change it here.
create or replace function public.reserve_response_hours()
returns integer
language sql
immutable
set search_path = ''
as $$ select 48 $$;
grant execute on function public.reserve_response_hours() to anon, authenticated;

-- Sets the deadline whenever a booking starts waiting for an answer, and refuses
-- answers that arrive after it (the job may not have run yet).
create or replace function public.reserve_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
begin
  if tg_op = 'UPDATE' and old.status in ('pending', 'countered') and old.respond_by is not null
     and old.respond_by < now() and new.status in ('accepted', 'countered', 'rejected') then
    raise exception 'Esta solicitud expiró: pasó el tiempo para responder';
  end if;
  if new.status in ('pending', 'countered') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    -- Dates are the creator's local time; read as UTC, close enough for a cap.
    v_start := (coalesce(new.date, current_date + 1) + coalesce(nullif(new.time, ''), '00:00')::time) at time zone 'utc';
    new.respond_by := least(now() + make_interval(hours => public.reserve_response_hours()), greatest(v_start, now() + interval '1 hour'));
  end if;
  return new;
end;
$$;
revoke execute on function public.reserve_deadline() from public, anon, authenticated;
drop trigger if exists reserve_deadline on public.vip_bookings;
create trigger reserve_deadline
  before insert or update of status on public.vip_bookings
  for each row execute function public.reserve_deadline();

-- Requests already waiting get the full time from now.
update public.vip_bookings set respond_by = now() + make_interval(hours => public.reserve_response_hours())
  where status in ('pending', 'countered') and respond_by is null;

create or replace function public.expire_reserve_requests()
returns integer
language sql
security definer
set search_path = ''
as $$
  with x as (
    update public.vip_bookings set status = 'expired', updated_at = now()
    where status in ('pending', 'countered') and respond_by < now()
    returning 1
  )
  select count(*)::int from x;
$$;
revoke execute on function public.expire_reserve_requests() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('expire-reserve-requests', '*/10 * * * *', 'select public.expire_reserve_requests()');

-- The creator opened Reservas: their waiting requests count as seen.
create or replace function public.reserve_mark_seen()
returns integer
language sql
security definer
set search_path = ''
as $$
  with x as (
    update public.vip_bookings set seen_at = now()
    where creator_profile_id = public.my_creator_profile_id() and seen_at is null
      and status in ('pending', 'reschedule_requested')
    returning 1
  )
  select count(*)::int from x;
$$;
revoke execute on function public.reserve_mark_seen() from public, anon;
grant execute on function public.reserve_mark_seen() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Notifications for both sides
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('live_started', 'reserve_request', 'reserve_update'));
alter table public.notifications add column if not exists pushed_at timestamptz;

create or replace function public.reserve_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_when text := to_char(new.date, 'DD/MM') || ' · ' || new.time;
  v_fan_first text := split_part(coalesce(nullif(trim(new.fan_name), ''), 'Un fan'), ' ', 1);
  v_creator_first text := split_part(coalesce(nullif(trim(new.creator_name), ''), 'El creador'), ' ', 1);
  v_to text; -- 'creator' or 'fan'
  v_title text;
  v_body text;
begin
  if tg_op = 'INSERT' then
    v_to := 'creator';
    v_title := case when new.status = 'pending' then 'Nueva solicitud de Reserve' else 'Nueva reserva' end;
    v_body := v_fan_first || ' · ' || new.title || ' · ' || v_when;
  elsif new.status is distinct from old.status then
    case
      when new.status = 'accepted' and old.status = 'pending' then
        v_to := 'fan'; v_title := v_creator_first || ' aceptó tu solicitud';
        v_body := new.title || ' · ' || v_when || '. Paga para confirmarla.';
      when new.status = 'accepted' and old.status = 'countered' then
        v_to := 'creator'; v_title := v_fan_first || ' aceptó tu contraoferta';
        v_body := new.title || ' · ' || v_when || '. Falta su pago.';
      when new.status = 'countered' then
        v_to := 'fan'; v_title := v_creator_first || ' te envió una contraoferta';
        v_body := new.title || '. Tienes ' || public.reserve_response_hours() || ' horas para responder.';
      when new.status = 'rejected' then
        v_to := 'fan'; v_title := v_creator_first || ' no puede aceptar tu solicitud';
        v_body := new.title || '. No se te cobró nada.';
      when new.status = 'expired' and old.status = 'pending' then
        v_to := 'fan'; v_title := 'Tu solicitud expiró sin respuesta';
        v_body := new.title || ' con ' || v_creator_first || '. No se te cobró nada.';
      when new.status = 'expired' and old.status = 'countered' then
        v_to := 'creator'; v_title := 'Tu contraoferta expiró';
        v_body := v_fan_first || ' no respondió a tiempo · ' || new.title;
      when new.status = 'cancelled' and old.status in ('pending', 'accepted', 'countered') then
        v_to := 'creator'; v_title := v_fan_first || ' canceló su solicitud';
        v_body := new.title || ' · ' || v_when;
      when new.status = 'confirmed' then
        v_to := 'creator'; v_title := 'Reserva confirmada y pagada';
        v_body := v_fan_first || ' · ' || new.title || ' · ' || v_when;
      else
        return null;
    end case;
  else
    return null;
  end if;

  if v_to = 'creator' then
    insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
    select p.id, 'reserve_request', new.creator_profile_id, left(v_title, 160), left(v_body, 200), '/creator/dashboard?tab=vip'
    from public.profiles p
    where p.creator_profile_id = new.creator_profile_id and p.role = 'creator';
  elsif new.fan_id is not null then
    insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
    values (new.fan_id, 'reserve_update', new.creator_profile_id, left(v_title, 160), left(v_body, 200), '/profile#mis-reservas');
  end if;
  return null;
end;
$$;
revoke execute on function public.reserve_alert() from public, anon, authenticated;
drop trigger if exists reserve_alert on public.vip_bookings;
create trigger reserve_alert
  after insert or update of status on public.vip_bookings
  for each row execute function public.reserve_alert();

-- ---------------------------------------------------------------------
-- 3. Phone alerts (Web Push)
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 10 and 1000),
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push: user reads own" on public.push_subscriptions;
create policy "push: user reads own" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

-- One device belongs to whoever signed in on it last.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if p_endpoint !~ '^https://' then
    raise exception 'Suscripción no válida';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end;
$$;
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Server-only secrets (the push keys /api/push creates on first use). No policies:
-- only the service role reads or writes it.
create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- Where the published site lives (the function that sends the alerts).
create or replace function public.app_base_url()
returns text
language sql
immutable
set search_path = ''
as $$ select 'https://fansreserve.com' $$;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net no está disponible: los avisos al celular no saldrán hasta activarlo';
end $$;

-- Each new notification is handed to /api/push, which reads it with the service
-- role and delivers it to the person's devices. Never blocks the notification.
create or replace function public.push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    begin
      perform net.http_post(
        url := public.app_base_url() || '/api/push',
        body := jsonb_build_object('id', new.id),
        headers := '{"content-type": "application/json"}'::jsonb
      );
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;
revoke execute on function public.push_notification() from public, anon, authenticated;
drop trigger if exists push_notification on public.notifications;
create trigger push_notification
  after insert on public.notifications
  for each row execute function public.push_notification();
