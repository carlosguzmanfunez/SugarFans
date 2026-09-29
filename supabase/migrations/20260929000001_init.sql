-- SugarFans initial schema: profiles, subscriptions, creator posts,
-- VIP availability/bookings and a simulated email outbox.
-- Every table has Row Level Security; state changes that need rules
-- (booking lifecycle, account deletion) go through SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  email text not null,
  role text not null default 'fan' check (role in ('fan', 'creator', 'admin')),
  avatar text not null default '',
  bio text,
  is_verified boolean not null default false,
  subscription_price numeric(10, 2) check (subscription_price is null or (subscription_price >= 0.99 and subscription_price <= 999)),
  followers integer not null default 0,
  following integer not null default 0,
  posts integer not null default 0,
  age_verified boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  creator_profile_id text,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_creator_profile_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select creator_profile_id from public.profiles where id = auth.uid() and role in ('creator', 'admin');
$$;

-- New auth user -> profile. Only fan/creator can be chosen at sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(new.raw_user_meta_data ->> 'role', 'fan');
  v_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1));
begin
  if v_role not in ('fan', 'creator') then
    v_role := 'fan';
  end if;
  insert into public.profiles (id, name, email, role, avatar, age_verified, subscription_price, creator_profile_id, bio)
  values (
    new.id,
    v_name,
    lower(new.email),
    v_role,
    'https://api.dicebear.com/7.0/adventurer/svg?seed=' || replace(v_name, ' ', '%20'),
    coalesce((new.raw_user_meta_data ->> 'age_verified')::boolean, false),
    case when v_role = 'creator' then 9.99 end,
    case when v_role = 'creator' then new.id::text end,
    case when v_role = 'creator' then '' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in sync when the login email changes.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Users may edit their profile but not privileged columns.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.id := old.id;
    new.role := old.role;
    new.email := old.email;
    new.is_verified := old.is_verified;
    new.followers := old.followers;
    new.following := old.following;
    new.creator_profile_id := old.creator_profile_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

alter table public.profiles enable row level security;

create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Subscriptions (fan -> public creator profile id)
-- ---------------------------------------------------------------------
create table public.subscriptions (
  fan_id uuid not null references public.profiles (id) on delete cascade,
  creator_id text not null,
  price numeric(10, 2) not null,
  since timestamptz not null default now(),
  primary key (fan_id, creator_id)
);

alter table public.subscriptions enable row level security;

create policy "subscriptions: own rows" on public.subscriptions
  for all to authenticated using (fan_id = (select auth.uid())) with check (fan_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Creator posts
-- ---------------------------------------------------------------------
create table public.creator_posts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(trim(content)) > 0),
  is_locked boolean not null default false,
  created_at timestamptz not null default now()
);

create index creator_posts_creator_idx on public.creator_posts (creator_id, created_at desc);

alter table public.creator_posts enable row level security;

create policy "creator_posts: owner manages" on public.creator_posts
  for all to authenticated
  using (creator_id = (select auth.uid()))
  with check (creator_id = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('creator', 'admin')
  ));

-- Keep profiles.posts in step with the posts table.
create or replace function public.sync_post_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid := coalesce(new.creator_id, old.creator_id);
begin
  update public.profiles
    set posts = (select count(*) from public.creator_posts where creator_id = v_creator)
    where id = v_creator;
  return null;
end;
$$;

create trigger sync_post_count
  after insert or delete on public.creator_posts
  for each row execute function public.sync_post_count();

-- ---------------------------------------------------------------------
-- VIP availability (public read, creator writes their own)
-- ---------------------------------------------------------------------
create table public.vip_availability (
  creator_profile_id text primary key,
  days smallint[] not null default '{1,2,3,4,5}',
  hours text[] not null default '{10:00,12:00,16:00,18:00}',
  updated_at timestamptz not null default now(),
  check (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
);

alter table public.vip_availability enable row level security;

create policy "vip_availability: anyone reads" on public.vip_availability
  for select to anon, authenticated using (true);
create policy "vip_availability: creator inserts own" on public.vip_availability
  for insert to authenticated with check (creator_profile_id = (select public.my_creator_profile_id()));
create policy "vip_availability: creator updates own" on public.vip_availability
  for update to authenticated
  using (creator_profile_id = (select public.my_creator_profile_id()))
  with check (creator_profile_id = (select public.my_creator_profile_id()));

-- ---------------------------------------------------------------------
-- VIP bookings
-- ---------------------------------------------------------------------
create table public.vip_bookings (
  id uuid primary key default gen_random_uuid(),
  experience_id text not null,
  creator_profile_id text not null,
  title text not null,
  creator_name text not null,
  price numeric(10, 2) not null,
  fan_id uuid not null references public.profiles (id) on delete cascade,
  fan_name text not null,
  fan_email text not null,
  date date not null,
  time text not null,
  message text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'confirmed', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  email_sent_at timestamptz
);

-- One active booking per creator slot.
create unique index vip_bookings_active_slot
  on public.vip_bookings (creator_profile_id, date, time)
  where status in ('pending', 'accepted', 'confirmed');
create index vip_bookings_fan_idx on public.vip_bookings (fan_id);

alter table public.vip_bookings enable row level security;

create policy "vip_bookings: fan or creator reads" on public.vip_bookings
  for select to authenticated
  using (fan_id = (select auth.uid()) or creator_profile_id = (select public.my_creator_profile_id()));

-- Taken slots of a creator, without exposing who booked them.
create or replace function public.vip_taken_slots(p_creator_profile_id text)
returns table (date date, "time" text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.date, b.time from public.vip_bookings b
  where b.creator_profile_id = p_creator_profile_id
    and b.status in ('pending', 'accepted', 'confirmed')
    and b.date >= current_date;
$$;

create or replace function public.vip_create_booking(
  p_experience_id text,
  p_creator_profile_id text,
  p_title text,
  p_creator_name text,
  p_price numeric,
  p_date date,
  p_time text,
  p_message text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fan public.profiles;
  v_av public.vip_availability;
  v_id uuid;
begin
  select * into v_fan from public.profiles where id = auth.uid();
  if v_fan.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if v_fan.creator_profile_id = p_creator_profile_id then
    raise exception 'No puedes reservar tu propia experiencia';
  end if;
  if p_date < current_date + 1 or p_date > (current_date + interval '3 months')::date then
    raise exception 'La fecha debe estar dentro de los próximos 3 meses';
  end if;
  select * into v_av from public.vip_availability where creator_profile_id = p_creator_profile_id;
  if v_av.creator_profile_id is null then
    v_av.days := '{1,2,3,4,5}';
    v_av.hours := '{10:00,12:00,16:00,18:00}';
  end if;
  if not (extract(dow from p_date)::smallint = any (v_av.days)) or not (p_time = any (v_av.hours)) then
    raise exception 'Ese horario no está disponible';
  end if;
  insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email, date, time, message)
  values (p_experience_id, p_creator_profile_id, p_title, p_creator_name, p_price, v_fan.id, v_fan.name, v_fan.email, p_date, p_time, coalesce(trim(p_message), ''))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
end;
$$;

-- ---------------------------------------------------------------------
-- Simulated email outbox (until a mail provider is connected)
-- ---------------------------------------------------------------------
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  booking_id uuid references public.vip_bookings (id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  sent_at timestamptz not null default now()
);

alter table public.email_outbox enable row level security;

create policy "email_outbox: recipient reads" on public.email_outbox
  for select to authenticated using (user_id = (select auth.uid()));

-- Booking lifecycle: pending -(creator)-> accepted|rejected
--                    pending|accepted -(fan)-> cancelled
--                    accepted -(fan pays)-> confirmed (+ confirmation email)
create or replace function public.vip_update_booking(p_booking_id uuid, p_next text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.vip_bookings;
  v_is_fan boolean;
  v_is_creator boolean;
begin
  select * into b from public.vip_bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'Reserva no encontrada';
  end if;
  v_is_fan := b.fan_id = auth.uid();
  v_is_creator := b.creator_profile_id = public.my_creator_profile_id();

  if v_is_creator and b.status = 'pending' and p_next in ('accepted', 'rejected') then
    update public.vip_bookings set status = p_next, updated_at = now() where id = b.id;
  elsif v_is_fan and b.status in ('pending', 'accepted') and p_next = 'cancelled' then
    update public.vip_bookings set status = 'cancelled', updated_at = now() where id = b.id;
  elsif v_is_fan and b.status = 'accepted' and p_next = 'confirmed' then
    -- Payment is simulated here; a real gateway would call this after capture.
    update public.vip_bookings
      set status = 'confirmed', paid_at = now(), email_sent_at = now(), updated_at = now()
      where id = b.id;
    insert into public.email_outbox (user_id, booking_id, to_email, subject, body)
    values (
      b.fan_id, b.id, b.fan_email,
      'Confirmación: ' || b.title,
      'Hola ' || b.fan_name || ', tu experiencia "' || b.title || '" con ' || b.creator_name ||
      ' está confirmada para el ' || to_char(b.date, 'DD/MM/YYYY') || ' a las ' || b.time ||
      '. Pago recibido: $' || b.price || ' USD.'
    );
  else
    raise exception 'Esta acción no está permitida';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Account deletion (the client re-checks the password first)
-- ---------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- Lock down function execution to signed-in users (taken slots are public).
revoke execute on function public.vip_create_booking(text, text, text, text, numeric, date, text, text) from public, anon;
revoke execute on function public.vip_update_booking(uuid, text) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
revoke execute on function public.protect_profile_columns() from public, anon, authenticated;
revoke execute on function public.sync_post_count() from public, anon, authenticated;
grant execute on function public.vip_create_booking(text, text, text, text, numeric, date, text, text) to authenticated;
grant execute on function public.vip_update_booking(uuid, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.vip_taken_slots(text) to anon, authenticated;
