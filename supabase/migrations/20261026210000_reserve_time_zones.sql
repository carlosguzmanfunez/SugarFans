-- Reserve: time zones.
--
-- Until now a booked "18:00" had no zone: the app read it in the viewer's clock,
-- so a fan in another country saw the wrong hour and the room opened at the
-- wrong moment. The creator's zone (IANA name, e.g. America/Tegucigalpa) is now
-- saved with their schedule and their experiences, and copied onto each booking.
-- Rows without a zone keep the old behaviour.
-- Safe to run more than once.

create or replace function public.valid_time_zone(p_zone text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_zone is null then return true; end if;
  if char_length(p_zone) not between 3 and 64 then return false; end if;
  perform now() at time zone p_zone;
  return true;
exception when others then
  return false;
end;
$$;

alter table public.vip_availability add column if not exists time_zone text;
alter table public.vip_experiences add column if not exists time_zone text;
alter table public.vip_bookings add column if not exists time_zone text;

alter table public.vip_availability drop constraint if exists vip_availability_time_zone_check;
alter table public.vip_availability add constraint vip_availability_time_zone_check check (public.valid_time_zone(time_zone));
alter table public.vip_experiences drop constraint if exists vip_experiences_time_zone_check;
alter table public.vip_experiences add constraint vip_experiences_time_zone_check check (public.valid_time_zone(time_zone));
alter table public.vip_bookings drop constraint if exists vip_bookings_time_zone_check;
alter table public.vip_bookings add constraint vip_bookings_time_zone_check check (public.valid_time_zone(time_zone));

-- A booking takes the zone its hour was offered in: the event's zone for a seat
-- in a Reserve Event, otherwise the creator's schedule (then the experience's).
create or replace function public.reserve_booking_time_zone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.time_zone is null then
    if coalesce(new.details ->> 'kind', '') = 'event' then
      select e.time_zone into new.time_zone from public.vip_experiences e where e.id = new.experience_id;
    end if;
    if new.time_zone is null then
      select a.time_zone into new.time_zone from public.vip_availability a where a.creator_profile_id = new.creator_profile_id;
    end if;
    if new.time_zone is null then
      select e.time_zone into new.time_zone from public.vip_experiences e where e.id = new.experience_id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.reserve_booking_time_zone() from public, anon, authenticated;

drop trigger if exists reserve_booking_time_zone on public.vip_bookings;
create trigger reserve_booking_time_zone
  before insert on public.vip_bookings
  for each row execute function public.reserve_booking_time_zone();

