-- New product hierarchy (2026-10-04):
--
--   Subscribe → Subscriber Live   (group Live included in an active subscription)
--   Reserve   → Reserve Event     (group experience, one paid seat per fan)
--             → Reserve 1:1       (private call, only the booking's fan and creator)
--   Open Live → kept, disabled    (public free Live; capability retained, off by default)
--
-- Additive and non-destructive: no table, column, row or existing migration is
-- removed. Existing Lives keep working as rows of mode 'open'. Safe to run twice.
--
--  1. live_broadcasts.mode ('open' | 'subscriber'), default 'open'.
--  2. open_live_enabled(): the database side of ENABLE_OPEN_LIVE (false).
--     start_live (Open Live) refuses while it is false; nothing else changes in it.
--  3. start_subscriber_live(title): starts a Subscriber Live and alerts active
--     subscribers (unless they turned that creator's bell off).
--  4. Reserve Event seats: a booking with details.kind = 'event' is one seat in an
--     experience whose details.format = 'event' (fixed eventDate/eventTime,
--     maxParticipants = seats). Several fans can hold seats for the same time, so
--     the one-booking-per-slot index now skips seats, and a fan holds one seat per event.
--  5. reserve_book_event_seat(experience, message) and reserve_event_seats(ids).
--  6. Guards: seats only through reserve_book_event_seat, and a seat's day/time never moves.

-- ---------------------------------------------------------------------
-- 1. Live modes
-- ---------------------------------------------------------------------
alter table public.live_broadcasts add column if not exists mode text not null default 'open';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_broadcasts_mode_check') then
    alter table public.live_broadcasts add constraint live_broadcasts_mode_check check (mode in ('open', 'subscriber'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Open Live flag (turn back on with: create or replace ... select true)
-- ---------------------------------------------------------------------
create or replace function public.open_live_enabled()
returns boolean
language sql
immutable
set search_path = ''
as $$
  select false;
$$;
grant execute on function public.open_live_enabled() to anon, authenticated;

-- Same as 20261003000001_live_alerts.sql, plus the flag check at the top.
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
  if not public.open_live_enabled() then
    raise exception 'El Live abierto está desactivado. Usa el Live para suscriptores.';
  end if;
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

  v_recent := exists (
    select 1 from public.live_broadcasts
    where creator_profile_id = v_profile and started_at > now() - interval '30 minutes'
  );

  insert into public.live_broadcasts (creator_profile_id, creator_id, title, mode)
    values (v_profile, auth.uid(), v_title, 'open')
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

-- ---------------------------------------------------------------------
-- 3. Subscriber Live
-- ---------------------------------------------------------------------
-- end_live, live_heartbeat and close_stale_lives already work for any mode.
create or replace function public.start_subscriber_live(p_title text)
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

  v_recent := exists (
    select 1 from public.live_broadcasts
    where creator_profile_id = v_profile and started_at > now() - interval '30 minutes'
  );

  insert into public.live_broadcasts (creator_profile_id, creator_id, title, mode)
    values (v_profile, auth.uid(), v_title, 'subscriber')
    returning id into v_id;

  -- Only active subscribers hear about it; a follower who turned the bell off stays quiet.
  if not v_recent then
    select coalesce(nullif(btrim(name), ''), 'Tu creator') into v_name from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
      select s.fan_id, 'live_started', v_profile, left(v_name || ' empezó un Live para suscriptores', 160), v_title, '/en-vivo/' || v_profile
      from public.subscriptions s
      where s.creator_id = v_profile and (s.cancel_at is null or s.cancel_at > now()) and s.fan_id <> auth.uid()
        and not exists (
          select 1 from public.follows f
          where f.user_id = s.fan_id and f.creator_profile_id = v_profile and not f.live_alerts
        );
    get diagnostics v_count = row_count;
  end if;

  return json_build_object('id', v_id, 'notified', v_count);
end;
$$;
revoke execute on function public.start_subscriber_live(text) from public, anon;
grant execute on function public.start_subscriber_live(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Reserve Event seats can share a time slot
-- ---------------------------------------------------------------------
-- Rebuilt with the same name: 1:1 bookings keep one active booking per creator slot.
drop index if exists public.vip_bookings_active_slot;
create unique index vip_bookings_active_slot
  on public.vip_bookings (creator_profile_id, date, time)
  where status in ('pending', 'accepted', 'confirmed') and coalesce(details->>'kind', '') <> 'event';
-- One active seat per fan per event.
create unique index if not exists vip_bookings_event_seat
  on public.vip_bookings (experience_id, fan_id)
  where status in ('pending', 'accepted', 'confirmed') and details->>'kind' = 'event';

-- An event's own fields: day, time, at least 2 seats and a duration.
create or replace function public.check_reserve_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.details->>'format', '') <> 'event' then
    return new;
  end if;
  if coalesce(new.details->>'eventDate', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(new.details->>'eventTime', '') !~ '^\d{2}:\d{2}$' then
    raise exception 'Indica la fecha y la hora del evento';
  end if;
  if coalesce((new.details->>'maxParticipants')::int, 0) not between 2 and 50 then
    raise exception 'Un Reserve Event tiene entre 2 y 50 plazas';
  end if;
  if new.duration_minutes is null then
    raise exception 'Indica la duración del evento';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_reserve_event() from public, anon, authenticated;
drop trigger if exists check_reserve_event on public.vip_experiences;
create trigger check_reserve_event
  before insert or update on public.vip_experiences
  for each row execute function public.check_reserve_event();

-- ---------------------------------------------------------------------
-- 5. Book a seat / seats taken
-- ---------------------------------------------------------------------
create or replace function public.reserve_book_event_seat(p_experience_id text, p_message text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fan public.profiles;
  v_exp public.vip_experiences;
  d jsonb;
  v_date date;
  v_time text;
  v_seats integer;
  v_taken integer;
  v_sub boolean;
  v_discount integer;
  v_price numeric;
  v_status text := 'pending';
  v_id uuid;
begin
  select * into v_fan from public.profiles where id = auth.uid();
  if v_fan.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  -- Locks the event so two fans can't take the last seat at once.
  select * into v_exp from public.vip_experiences where id = p_experience_id and active for update;
  if v_exp.id is null then
    raise exception 'Evento no encontrado';
  end if;
  d := v_exp.details;
  if coalesce(d->>'format', '') <> 'event' then
    raise exception 'Esta experiencia no es un Reserve Event';
  end if;
  if v_fan.creator_profile_id = v_exp.creator_profile_id then
    raise exception 'No puedes reservar tu propio evento';
  end if;
  if public.is_cut_off(v_fan.id, v_exp.creator_profile_id) then
    raise exception 'No puedes reservar con este perfil';
  end if;
  if public.reserve_text_blocked(p_message, true) then
    raise exception 'Fans Reserve no permite esta solicitud. Reserve es para experiencias concretas, en venues o lugares públicos y dentro de la plataforma.';
  end if;
  if coalesce((d->'requirements'->>'verifiedFans')::boolean, false) and not v_fan.is_verified then
    raise exception 'Este evento es solo para fans con identidad verificada';
  end if;
  v_sub := public.has_subscription(v_fan.id, v_exp.creator_profile_id);
  if coalesce((d->'requirements'->>'subscribersOnly')::boolean, false) and not v_sub then
    raise exception 'Este evento es solo para suscriptores';
  end if;
  v_date := (d->>'eventDate')::date;
  v_time := d->>'eventTime';
  -- The event's time is the creator's local time and the server runs in UTC.
  if (v_date + v_time::time) < (now() at time zone 'utc') - interval '14 hours' then
    raise exception 'Este evento ya pasó';
  end if;
  v_seats := coalesce((d->>'maxParticipants')::int, 0);
  select count(*) into v_taken from public.vip_bookings
    where experience_id = v_exp.id and details->>'kind' = 'event' and status in ('pending', 'accepted', 'confirmed');
  if v_taken >= v_seats then
    raise exception 'No quedan plazas para este evento';
  end if;
  v_discount := case when v_sub then coalesce((d->>'subscriberDiscount')::int, 0) else 0 end;
  v_price := round(v_exp.price * (100 - v_discount) / 100, 2);
  if d->>'approval' = 'automatic' then
    v_status := 'accepted';
  end if;
  insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email,
                                   date, time, message, duration_minutes, status, details)
  values (v_exp.id, v_exp.creator_profile_id, v_exp.title, v_exp.creator_name, v_price, v_fan.id, v_fan.name, v_fan.email,
          v_date, v_time, left(coalesce(trim(p_message), ''), 500), v_exp.duration_minutes, v_status,
          jsonb_strip_nulls(jsonb_build_object(
            'kind', 'event', 'typeId', v_exp.type, 'modality', coalesce(d->>'modality', 'virtual'), 'participants', 1,
            'locationType', case when coalesce(d->>'modality', 'virtual') <> 'virtual' then d->'locationTypes'->>0 end,
            'city', case when coalesce(d->>'modality', 'virtual') <> 'virtual' then d->>'city' end,
            'venue', case when coalesce(d->>'modality', 'virtual') <> 'virtual' then d->>'venue' end,
            'listPrice', case when v_discount > 0 then v_exp.price end,
            'discountPercent', case when v_discount > 0 then v_discount end)))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya tienes una plaza en este evento';
end;
$$;
revoke execute on function public.reserve_book_event_seat(text, text) from public, anon;
grant execute on function public.reserve_book_event_seat(text, text) to authenticated;

-- Seats taken per event (counts only, never who holds them).
create or replace function public.reserve_event_seats(p_experience_ids text[])
returns table (experience_id text, taken integer)
language sql
stable
security definer
set search_path = ''
as $$
  select b.experience_id, count(*)::integer
  from public.vip_bookings b
  where b.experience_id = any (p_experience_ids) and b.details->>'kind' = 'event'
    and b.status in ('pending', 'accepted', 'confirmed')
  group by b.experience_id;
$$;
grant execute on function public.reserve_event_seats(text[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Guards
-- ---------------------------------------------------------------------
create or replace function public.guard_event_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_format text;
begin
  if tg_op = 'INSERT' then
    select coalesce(details->>'format', '') into v_format from public.vip_experiences where id = new.experience_id;
    if coalesce(v_format, '') = 'event' and coalesce(new.details->>'kind', '') <> 'event' then
      raise exception 'Reserva tu plaza desde el evento';
    end if;
    if coalesce(new.details->>'kind', '') = 'event' and coalesce(v_format, '') <> 'event' then
      raise exception 'Esta experiencia no es un Reserve Event';
    end if;
  elsif old.details->>'kind' = 'event' and (new.date is distinct from old.date or new.time is distinct from old.time
                                            or new.details->>'kind' is distinct from 'event') then
    raise exception 'La fecha de un Reserve Event no se cambia por participante';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_event_booking() from public, anon, authenticated;
drop trigger if exists guard_event_booking on public.vip_bookings;
create trigger guard_event_booking
  before insert or update on public.vip_bookings
  for each row execute function public.guard_event_booking();

-- ---------------------------------------------------------------------
-- 7. Demo (test mode): one Reserve Event for the demo creator '1', the same as
--    the app's demo catalogue (src/data/mockData.ts 'ev-1'), on the next Friday
--    at 20:00. Only inserted if it doesn't exist; delete it like any experience.
-- ---------------------------------------------------------------------
insert into public.vip_experiences (id, creator_profile_id, creator_name, title, description, type, price, duration_minutes, image, details)
select 'ev-1', '1', 'Valentina Rose', 'Beauty Q&A con Valentina',
       'Q&A grupal en vivo sobre maquillaje, cuidado de la piel y rutinas. Envías tus preguntas por el chat y Valentina responde en directo.',
       'qa-session', 15, 60, '',
       jsonb_build_object(
         'modality', 'virtual', 'locationTypes', jsonb_build_array('online'),
         'format', 'event', 'eventDate', to_char(x.d, 'YYYY-MM-DD'), 'eventTime', '20:00',
         'includes', jsonb_build_array('Sala del evento en Fans Reserve', 'Preguntas por chat', 'Lista de productos mencionados'),
         'excludes', jsonb_build_array('Grabación de la sesión', 'Tiempo privado con la creator', 'Contacto o pagos fuera de Fans Reserve'),
         'requirements', jsonb_build_object('verifiedFans', false, 'subscribersOnly', false),
         'minNoticeHours', 24, 'maxParticipants', 20, 'approval', 'automatic', 'cancellationPolicy', 'moderate')
from (select (current_date + 2 + ((5 - extract(dow from current_date + 2)::int + 7) % 7))::date as d) x
where exists (select 1 from public.vip_experiences where creator_profile_id = '1')
on conflict (id) do nothing;
