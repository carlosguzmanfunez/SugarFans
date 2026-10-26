-- Reserve: time zones and reviews.
--
-- 1. Time zones. Until now a booked "18:00" had no zone: the app read it in the
--    viewer's clock, so a fan in another country saw the wrong hour and the room
--    opened at the wrong moment. The creator's zone (IANA name, e.g.
--    America/Tegucigalpa) is now saved with their schedule and their experiences,
--    and copied onto each booking. Rows without a zone keep the old behaviour.
-- 2. Reviews. After a confirmed experience has ended, the fan can rate it (1-5)
--    and leave a short comment. One review per booking; the fan can edit it.
--    Everyone can read them; admins can hide one.
-- Safe to run more than once.

-- ---------------------------------------------------------------------
-- 1. Time zones
-- ---------------------------------------------------------------------
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

-- When the experience ends, as an instant. Without a zone it assumes the latest
-- clock on Earth (UTC-12), so a review never opens before the session is over.
create or replace function public.reserve_booking_ends_at(p_date date, p_time text, p_minutes integer, p_zone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((p_date + coalesce(nullif(p_time, ''), '00:00')::time) at time zone coalesce(p_zone, 'Etc/GMT+12'))
         + make_interval(mins => coalesce(p_minutes, 60));
$$;

-- ---------------------------------------------------------------------
-- 2. Reviews
-- ---------------------------------------------------------------------
create table if not exists public.reserve_reviews (
  booking_id uuid primary key references public.vip_bookings (id) on delete cascade,
  creator_profile_id text not null,
  experience_id text not null,
  experience_title text not null,
  fan_id uuid not null references public.profiles (id) on delete cascade,
  -- First name only: reviews are public.
  fan_name text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 500),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reserve_reviews_creator_idx on public.reserve_reviews (creator_profile_id, created_at desc);
create index if not exists reserve_reviews_fan_idx on public.reserve_reviews (fan_id);

alter table public.reserve_reviews enable row level security;

-- Visible reviews are public; the author and admins also see hidden ones.
drop policy if exists "reserve_reviews: anyone reads visible" on public.reserve_reviews;
create policy "reserve_reviews: anyone reads visible" on public.reserve_reviews
  for select to anon
  using (not hidden);
drop policy if exists "reserve_reviews: signed-in read" on public.reserve_reviews;
create policy "reserve_reviews: signed-in read" on public.reserve_reviews
  for select to authenticated
  using (not hidden or fan_id = (select auth.uid()) or (select public.is_admin()));

-- Writes only through the functions below.
revoke insert, update, delete on public.reserve_reviews from anon, authenticated;

-- The fan rates their own booking once it has ended; calling it again edits the review.
create or replace function public.reserve_submit_review(p_booking_id uuid, p_rating integer, p_comment text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.vip_bookings%rowtype;
  v_comment text := btrim(coalesce(p_comment, ''));
  v_name text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para dejar una reseña'; end if;
  select * into b from public.vip_bookings where id = p_booking_id;
  if not found or b.fan_id <> auth.uid() then raise exception 'No encontramos esta reserva en tu cuenta'; end if;
  if b.status not in ('confirmed', 'completed') then raise exception 'Solo puedes reseñar una experiencia confirmada'; end if;
  if public.reserve_booking_ends_at(b.date, b.time, b.duration_minutes, b.time_zone) > now() then
    raise exception 'Podrás dejar tu reseña cuando termine la experiencia';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Elige de 1 a 5 estrellas'; end if;
  if char_length(v_comment) > 500 then raise exception 'La reseña puede tener hasta 500 caracteres'; end if;
  if public.reserve_text_blocked(v_comment) then
    raise exception 'Tu reseña incluye contenido que no está permitido en Fans Reserve';
  end if;
  select coalesce(nullif(split_part(btrim(p.name), ' ', 1), ''), 'Fan') into v_name from public.profiles p where p.id = auth.uid();

  insert into public.reserve_reviews (booking_id, creator_profile_id, experience_id, experience_title, fan_id, fan_name, rating, comment)
  values (b.id, b.creator_profile_id, b.experience_id, b.title, b.fan_id, coalesce(v_name, 'Fan'), p_rating, v_comment)
  on conflict (booking_id) do update
    set rating = excluded.rating, comment = excluded.comment, fan_name = excluded.fan_name, updated_at = now();
end;
$$;
revoke execute on function public.reserve_submit_review(uuid, integer, text) from public, anon;
grant execute on function public.reserve_submit_review(uuid, integer, text) to authenticated;

-- Admins hide or show a review (it stays visible to its author).
create or replace function public.admin_set_review_hidden(p_booking_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede hacer esto'; end if;
  update public.reserve_reviews set hidden = coalesce(p_hidden, true), updated_at = now() where booking_id = p_booking_id;
end;
$$;
revoke execute on function public.admin_set_review_hidden(uuid, boolean) from public, anon;
grant execute on function public.admin_set_review_hidden(uuid, boolean) to authenticated;

-- Average and count of a creator's visible reviews.
create or replace function public.reserve_creator_rating(p_creator_profile_id text)
returns table (average numeric, total integer)
language sql
stable
security definer
set search_path = ''
as $$
  select round(avg(r.rating)::numeric, 1), count(*)::integer
  from public.reserve_reviews r
  where r.creator_profile_id = p_creator_profile_id and not r.hidden;
$$;
grant execute on function public.reserve_creator_rating(text) to anon, authenticated;
