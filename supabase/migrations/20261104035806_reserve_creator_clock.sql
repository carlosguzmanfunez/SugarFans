-- Explicit creator clocks, exact notice/deadlines, immutable booking clocks.
-- Existing financial records and legacy rows are not rewritten.
begin;

create or replace function public.reserve_booking_time_zone()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_exp public.vip_experiences;
  v_start timestamptz;
  v_notice integer;
begin
  if tg_op = 'UPDATE' then
    if new.time_zone is distinct from old.time_zone then
      raise exception 'La zona horaria de una reserva existente no se cambia';
    end if;
  else
    select * into v_exp from public.vip_experiences where id = new.experience_id;
    if new.time_zone is null then
      if coalesce(new.details->>'kind','') = 'event' then new.time_zone := v_exp.time_zone; end if;
      if new.time_zone is null then
        select time_zone into new.time_zone from public.vip_availability where creator_profile_id = new.creator_profile_id;
      end if;
      if new.time_zone is null then new.time_zone := v_exp.time_zone; end if;
    end if;
  end if;
  if not public.valid_time_zone(new.time_zone) then
    raise exception 'vip_bookings_time_zone_check: zona horaria inválida' using errcode = '23514';
  end if;
  if new.time_zone is not null and
     (tg_op = 'INSERT' or new.date is distinct from old.date or new.time is distinct from old.time) then
    v_start := (new.date + new.time::time) at time zone new.time_zone;
    if v_start at time zone new.time_zone <> new.date + new.time::time then
      raise exception 'Esa hora no existe por el cambio de horario. Elige otra.';
    end if;
    if tg_op = 'INSERT' and coalesce(new.details->>'kind','') = 'experience' then
      v_notice := coalesce((v_exp.details->>'minNoticeHours')::integer,24);
      if v_start < now() + make_interval(hours => v_notice) then
        raise exception 'Reserva con al menos % horas de anticipación', v_notice;
      end if;
    elsif tg_op = 'INSERT' and coalesce(new.details->>'kind','') = 'event' and v_start <= now() then
      raise exception 'Este evento ya comenzó';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.reserve_booking_time_zone() from public,anon,authenticated;
drop trigger if exists reserve_booking_time_zone on public.vip_bookings;
create trigger reserve_booking_time_zone before insert or update on public.vip_bookings
for each row execute function public.reserve_booking_time_zone();

-- Keep the existing RPC implementations, permissions and financial protections.
-- Replace only their calendar-day reference; abort on unexpected source drift.
do $$
declare
  target regprocedure;
  definition text;
  creator_expression text;
  zone_expression text;
begin
  foreach target in array array[
    'public.reserve_create_booking(text,date,text,text,integer)'::regprocedure,
    'public.reserve_request_custom(text,date,text,integer,numeric,integer,text,text,jsonb)'::regprocedure,
    'public.reserve_counter_offer(uuid,numeric,date,text,integer,text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    creator_expression := case
      when target::text like '%reserve_create_booking%' then 'v_exp.creator_profile_id'
      when target::text like '%reserve_request_custom%' then 'p_creator_profile_id'
      else 'b.creator_profile_id' end;
    zone_expression := case when target::text like '%reserve_counter_offer%'
      then 'coalesce(b.time_zone, ''UTC'')'
      else 'coalesce((select a.time_zone from public.vip_availability a where a.creator_profile_id = ' || creator_expression || '),'
        || case when target::text like '%reserve_create_booking%' then ' v_exp.time_zone,' else '' end || ' ''UTC'')' end;
    if position('p_date < current_date + 1' in definition) = 0 then
      raise exception 'Unexpected calendar validation in %',target;
    end if;
    definition := replace(definition,'current_date','((now() at time zone ' || zone_expression || ')::date)');
    execute definition;
  end loop;
end;
$$;

-- Time-zone snapshot runs before the existing deadline trigger (alphabetic order).
do $$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('public.reserve_deadline()'::regprocedure);
  anchor := 'at time zone ''utc''';
  if position(anchor in definition) = 0 then raise exception 'Unexpected deadline source'; end if;
  execute replace(definition,anchor,'at time zone coalesce(new.time_zone, ''UTC'')');

  definition := pg_get_functiondef('public.reserve_alert()'::regprocedure);
  anchor := '|| new.time;';
  if position(anchor in definition) = 0 then raise exception 'Unexpected alert source'; end if;
  execute replace(definition,anchor,'|| new.time || case when new.time_zone is not null then '' (hora de '' || replace(new.time_zone, ''_'', '' '') || '')'' else '''' end;');
end;
$$;

-- All outgoing confirmations, including PayPal and Credits, go through the outbox.
create or replace function public.reserve_email_clock()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare b public.vip_bookings;
begin
  if new.booking_id is not null then
    select * into b from public.vip_bookings where id = new.booking_id;
    if b.time_zone is not null and position('Zona horaria de la reserva:' in new.body) = 0 then
      new.body := new.body || E'\nZona horaria de la reserva: ' || b.time_zone ||
        '. Fecha y hora: ' || b.date || ' ' || b.time ||
        '. Consulta Mis reservas para ver la hora que corresponde a tu ubicación.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.reserve_email_clock() from public,anon,authenticated;
create trigger reserve_email_clock before insert on public.email_outbox
for each row execute function public.reserve_email_clock();

create or replace function public.reserve_event_clock_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.details->>'format' = 'event' and new.time_zone is distinct from old.time_zone and exists(
    select 1 from public.vip_bookings where experience_id = old.id and status in ('pending','accepted','confirmed')
  ) then
    raise exception 'Este evento ya tiene reservas. Conserva su zona horaria.';
  end if;
  return new;
end;
$$;
revoke execute on function public.reserve_event_clock_guard() from public,anon,authenticated;
create trigger reserve_event_clock_guard before update of time_zone on public.vip_experiences
for each row execute function public.reserve_event_clock_guard();
-- Equal wall times in different zones may be different appointments. Preserve
-- the old same-clock uniqueness; the locked guard below handles real overlaps.
drop index if exists public.vip_bookings_active_slot;
create unique index vip_bookings_active_slot
 on public.vip_bookings(creator_profile_id,date,time,(coalesce(time_zone,'')))
 where status in ('pending','accepted','confirmed') and coalesce(details->>'kind','') <> 'event';
create index vip_bookings_clock_intervals on public.vip_bookings(creator_profile_id,date)
 where status in ('pending','accepted','confirmed','reschedule_requested');

-- Public busy intervals only: no fan identity or payment information.
create or replace function public.reserve_taken_slots(p_creator_profile_id text)
returns table(date date, "time" text, time_zone text, duration_minutes integer)
language sql stable security definer set search_path = ''
as $$
 select b.date,b.time,b.time_zone,b.duration_minutes from public.vip_bookings b
 where b.creator_profile_id = p_creator_profile_id
   and b.status in ('pending','accepted','confirmed','reschedule_requested')
   and b.date >= current_date - 1
$$;
revoke execute on function public.reserve_taken_slots(text) from public,anon,authenticated;
grant execute on function public.reserve_taken_slots(text) to anon,authenticated;

create or replace function public.reserve_clock_conflict()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_start timestamptz; v_end timestamptz;
begin
 if new.status not in ('pending','accepted','confirmed','reschedule_requested') then return new; end if;
 if tg_op = 'UPDATE' and new.date = old.date and new.time = old.time and new.time_zone is not distinct from old.time_zone
   and new.status = old.status and new.duration_minutes is not distinct from old.duration_minutes then return new; end if;
 -- Legacy clocks stay untouched. Their old unique-slot constraint still applies.
 if new.time_zone is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('reserve-clock:' || new.creator_profile_id,0));
 v_start := (new.date + new.time::time) at time zone new.time_zone;
 v_end := v_start + make_interval(mins => coalesce(new.duration_minutes,60));
 if exists(select 1 from public.vip_bookings b
   where b.creator_profile_id = new.creator_profile_id and b.id <> new.id
     and b.status in ('pending','accepted','confirmed','reschedule_requested')
     and not (coalesce(new.details->>'kind','') = 'event' and b.experience_id = new.experience_id and b.details->>'kind' = 'event')
     and ((b.time_zone is null and b.date = new.date and b.time = new.time) or
       (b.time_zone is not null and ((b.date + b.time::time) at time zone b.time_zone) < v_end
        and ((b.date + b.time::time) at time zone b.time_zone) + make_interval(mins => coalesce(b.duration_minutes,60)) > v_start))
 ) then raise exception 'Ese horario ya no está disponible. Elige otro.'; end if;
 return new;
end;
$$;
revoke execute on function public.reserve_clock_conflict() from public,anon,authenticated;
-- Runs after reserve_booking_time_zone, before the deadline.
create trigger reserve_clock_conflict before insert or update on public.vip_bookings
for each row execute function public.reserve_clock_conflict();
-- New callers send the clock they displayed. Lock it while creating the booking,
-- so an edit made in another tab cannot silently move the time the fan chose.
create or replace function public.reserve_create_booking_in_zone(
 p_experience_id text,p_date date,p_time text,p_message text,p_participants integer,p_time_zone text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare e public.vip_experiences; v_zone text;
begin
 if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
 select * into e from public.vip_experiences where id=p_experience_id for share;
 select time_zone into v_zone from public.vip_availability where creator_profile_id=e.creator_profile_id for share;
 if coalesce(v_zone,e.time_zone) is distinct from p_time_zone then
  raise exception 'La zona horaria cambió. Vuelve a abrir la experiencia y revisa su horario.';
 end if;
 return public.reserve_create_booking(p_experience_id,p_date,p_time,p_message,p_participants);
end;
$$;
revoke execute on function public.reserve_create_booking_in_zone(text,date,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.reserve_create_booking_in_zone(text,date,text,text,integer,text) to authenticated;

create or replace function public.reserve_book_event_in_zone(p_experience_id text,p_message text,p_time_zone text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare e public.vip_experiences;
begin
 if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
 select * into e from public.vip_experiences where id=p_experience_id for update;
 if e.time_zone is distinct from p_time_zone then
  raise exception 'La zona horaria cambió. Vuelve a abrir el evento y revisa su horario.';
 end if;
 return public.reserve_book_event_seat(p_experience_id,p_message);
end;
$$;
revoke execute on function public.reserve_book_event_in_zone(text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_book_event_in_zone(text,text,text) to authenticated;

create or replace function public.reserve_request_custom_in_zone(
 p_creator_profile_id text,p_date date,p_time text,p_duration integer,p_budget numeric,p_participants integer,
 p_message text,p_title text,p_details jsonb,p_time_zone text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_zone text;
begin
 if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
 select time_zone into v_zone from public.vip_availability where creator_profile_id=p_creator_profile_id for share;
 if v_zone is distinct from p_time_zone then
  raise exception 'La zona horaria cambió. Vuelve a abrir la propuesta y revisa su horario.';
 end if;
 return public.reserve_request_custom(p_creator_profile_id,p_date,p_time,p_duration,p_budget,p_participants,p_message,p_title,p_details);
end;
$$;
revoke execute on function public.reserve_request_custom_in_zone(text,date,text,integer,numeric,integer,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_request_custom_in_zone(text,date,text,integer,numeric,integer,text,text,jsonb,text) to authenticated;
commit;
