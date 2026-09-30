-- Audit fixes, part 2 (2026-09-30):
--  * VIP experiences live in the database; creators who sign up create their own.
--  * Paying a VIP booking charges a payment method and credits the creator (80%).
--  * Cancelling keeps access until the end of the paid month.
--  * Renewals are billed by the server every hour (pg_cron), not only when the fan
--    opens the site; a renewal that cannot be charged ends the subscription.
--  * Creators who sign up are listed publicly.

-- Display name of a creator for receipts and bookings (the demo catalogue
-- profiles stay active while the site is in test mode).
create or replace function public.creator_display_name(p_creator_profile_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.name from public.profiles p where p.creator_profile_id = p_creator_profile_id and p.role = 'creator'),
    (select m.name from public.managed_profiles m where m.id = p_creator_profile_id),
    (select d.name from (values ('1', 'Valentina Rose'), ('2', 'Diego Torres'), ('3', 'Sofía Luna'),
      ('4', 'Mariana Silva'), ('5', 'Andrés Vega'), ('6', 'Camila Reyes')) as d(id, name) where d.id = p_creator_profile_id),
    'Creador'
  );
$$;
revoke execute on function public.creator_display_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- VIP experiences
-- ---------------------------------------------------------------------
create table public.vip_experiences (
  id text primary key default gen_random_uuid()::text,
  creator_profile_id text not null,
  creator_name text not null,
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '' check (char_length(description) <= 600),
  type text not null default 'meet-greet'
    check (type in ('meet-greet', 'qa-session', 'custom-content', 'early-access', 'collaboration')),
  price numeric(10, 2) not null check (price between 5 and 5000),
  -- Minutes of the live video session; null for experiences without one.
  duration_minutes integer check (duration_minutes between 10 and 180),
  image text not null default '',
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vip_experiences_creator_idx on public.vip_experiences (creator_profile_id);
create index vip_experiences_created_by_idx on public.vip_experiences (created_by);

-- The demo catalogue (same ids as src/data/mockData.ts `vipExperiences`).
insert into public.vip_experiences (id, creator_profile_id, creator_name, title, description, type, price, duration_minutes, image) values
  ('1', '1', 'Valentina Rose', 'Video Llamada VIP Personalizada',
   'Sesión privada de 30 minutos donde podemos conversar, conocer tus intereses y crear contenido personalizado para ti.',
   'meet-greet', 99.99, 30, 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&h=400&fit=crop'),
  ('2', '2', 'Diego Torres', 'Plan de Entrenamiento 1:1',
   'Sesión de coaching personalizado donde diseño un plan de entrenamiento específico para tus objetivos.',
   'qa-session', 149.99, 60, 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600&h=400&fit=crop'),
  ('3', '3', 'Sofía Luna', 'Tutorial de Arte Personalizado',
   'Clase privada donde te enseño técnicas específicas de arte digital según tu nivel y preferencias.',
   'custom-content', 79.99, 45, 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=600&h=400&fit=crop'),
  ('4', '4', 'Mariana Silva', 'Behind the Scenes Exclusivo',
   'Acceso anticipado a mi próximo proyecto de baile + video exclusivo del proceso creativo.',
   'early-access', 49.99, null, 'https://images.unsplash.com/photo-1508700929628-666bc8bd84ea?w=600&h=400&fit=crop'),
  ('5', '6', 'Camila Reyes', 'Clase de Cocina Privada',
   'Sesión en vivo donde cocinamos juntos una receta exclusiva. Incluye lista de ingredientes y tips profesionales.',
   'collaboration', 119.99, 90, 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=600&h=400&fit=crop')
on conflict (id) do nothing;

alter table public.vip_experiences enable row level security;

create policy "vip_experiences: anyone reads active, owner reads all" on public.vip_experiences
  for select to anon, authenticated
  using (active or creator_profile_id = (select public.my_creator_profile_id()));
create policy "vip_experiences: creator adds own" on public.vip_experiences
  for insert to authenticated
  with check (creator_profile_id = (select public.my_creator_profile_id()));
create policy "vip_experiences: creator edits own" on public.vip_experiences
  for update to authenticated
  using (creator_profile_id = (select public.my_creator_profile_id()))
  with check (creator_profile_id = (select public.my_creator_profile_id()));
create policy "vip_experiences: creator deletes own" on public.vip_experiences
  for delete to authenticated
  using (creator_profile_id = (select public.my_creator_profile_id()));

-- The creator's profile id and name come from the account, never the browser.
create or replace function public.fill_vip_experience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
begin
  if auth.uid() is null then
    return new;
  end if;
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.role <> 'creator' or v_me.creator_profile_id is null then
    raise exception 'Solo los creadores publican experiencias VIP';
  end if;
  if tg_op = 'INSERT' then
    new.id := gen_random_uuid()::text;
    new.created_by := v_me.id;
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.creator_profile_id := v_me.creator_profile_id;
  new.creator_name := v_me.name;
  new.title := trim(new.title);
  new.description := trim(new.description);
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.fill_vip_experience() from public, anon, authenticated;
create trigger fill_vip_experience
  before insert or update on public.vip_experiences
  for each row execute function public.fill_vip_experience();

-- Live session length travels with the booking.
alter table public.vip_bookings add column if not exists duration_minutes integer;
update public.vip_bookings b set duration_minutes = e.duration_minutes
  from public.vip_experiences e where e.id = b.experience_id and b.duration_minutes is null;
update public.vip_bookings set duration_minutes = 20 where experience_id = 'gift-call' and duration_minutes is null;

create or replace function public.vip_create_booking(
  p_experience_id text, p_creator_profile_id text, p_title text, p_creator_name text,
  p_price numeric, p_date date, p_time text, p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fan public.profiles;
  v_av public.vip_availability;
  v_exp public.vip_experiences;
  v_id uuid;
begin
  select * into v_fan from public.profiles where id = auth.uid();
  if v_fan.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into v_exp from public.vip_experiences where id = p_experience_id and active;
  if v_exp.id is null then
    raise exception 'Experiencia no encontrada';
  end if;
  if public.creator_price(v_exp.creator_profile_id) is null then
    raise exception 'Este perfil no existe';
  end if;
  if v_fan.creator_profile_id = v_exp.creator_profile_id then
    raise exception 'No puedes reservar tu propia experiencia';
  end if;
  if public.is_cut_off(v_fan.id, v_exp.creator_profile_id) then
    raise exception 'No puedes reservar con este perfil';
  end if;
  if p_date < current_date + 1 or p_date > (current_date + interval '3 months')::date then
    raise exception 'La fecha debe estar dentro de los próximos 3 meses';
  end if;
  select * into v_av from public.vip_availability where creator_profile_id = v_exp.creator_profile_id;
  if v_av.creator_profile_id is null then
    v_av.days := '{1,2,3,4,5}';
    v_av.hours := '{10:00,12:00,16:00,18:00}';
  end if;
  if not (extract(dow from p_date)::smallint = any (v_av.days)) or not (p_time = any (v_av.hours)) then
    raise exception 'Ese horario no está disponible';
  end if;
  insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email,
                                   date, time, message, duration_minutes)
  values (v_exp.id, v_exp.creator_profile_id, v_exp.title, v_exp.creator_name, v_exp.price, v_fan.id, v_fan.name, v_fan.email,
          p_date, p_time, left(coalesce(trim(p_message), ''), 500), v_exp.duration_minutes)
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
end;
$$;

-- Accept / reject (creator) and cancel (fan). Paying goes through vip_pay_booking.
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
  else
    raise exception 'Esta acción no está permitida';
  end if;
end;
$$;

alter table public.transactions drop constraint transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('subscription', 'renewal', 'tip', 'gift', 'referral', 'vip'));

-- The fan pays an accepted booking: charge, confirm, email, credit the creator 80%.
-- INTEGRATION: a real gateway would call this after capturing the payment.
create or replace function public.vip_pay_booking(p_booking_id uuid, p_method_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.vip_bookings;
  v_method public.payment_methods;
begin
  select * into b from public.vip_bookings where id = p_booking_id for update;
  if b.id is null or b.fan_id is distinct from auth.uid() then
    raise exception 'Reserva no encontrada';
  end if;
  if b.status <> 'accepted' then
    raise exception 'Solo puedes pagar una reserva aceptada por el creador';
  end if;
  select * into v_method from public.payment_methods where id = p_method_id and user_id = b.fan_id;
  if v_method.id is null then
    raise exception 'Elige un método de pago';
  end if;
  insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, note)
  values ('vip:' || b.id, b.fan_id, b.fan_name, b.creator_profile_id, b.creator_name, 'vip', b.price, v_method.label, 'paid', b.title);
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
end;
$$;
revoke execute on function public.vip_pay_booking(uuid, uuid) from public, anon;
grant execute on function public.vip_pay_booking(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Subscriptions: cancel at the end of the paid month
-- ---------------------------------------------------------------------
alter table public.subscriptions add column if not exists cancel_at timestamptz;

-- Next monthly billing date strictly after now.
create or replace function public.next_renewal(p_since timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select p_since + make_interval(months => (
    select min(n) from generate_series(1, 1200) n where p_since + make_interval(months => n) > now()
  ));
$$;

create or replace function public.has_subscription(p_fan uuid, p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.fan_id = p_fan and s.creator_id = p_creator_profile_id and (s.cancel_at is null or s.cancel_at > now())
  );
$$;
revoke execute on function public.has_subscription(uuid, text) from public, anon, authenticated;

create or replace function public.cancel_subscription(p_creator_profile_id text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subscriptions;
begin
  select * into s from public.subscriptions
    where fan_id = auth.uid() and creator_id = p_creator_profile_id for update;
  if s.fan_id is null or (s.cancel_at is not null and s.cancel_at <= now()) then
    raise exception 'No tienes una suscripción activa a este perfil';
  end if;
  if s.cancel_at is null then
    s.cancel_at := public.next_renewal(s.since);
    update public.subscriptions set cancel_at = s.cancel_at where fan_id = s.fan_id and creator_id = s.creator_id;
  end if;
  return s.cancel_at;
end;
$$;
revoke execute on function public.cancel_subscription(text) from public, anon;
grant execute on function public.cancel_subscription(text) to authenticated;

-- Resubscribing while a cancellation is pending just keeps the subscription (no new charge).
create or replace function public.subscribe_and_pay(p_creator_profile_id text, p_creator_name text, p_price numeric, p_method_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_method public.payment_methods;
  v_price numeric := public.creator_price(p_creator_profile_id);
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if v_price is null then
    raise exception 'Este perfil no existe';
  end if;
  if v_me.creator_profile_id = p_creator_profile_id then
    raise exception 'No puedes suscribirte a tu propio perfil';
  end if;
  if public.is_cut_off(v_me.id, p_creator_profile_id) then
    raise exception 'No puedes suscribirte a este perfil';
  end if;
  if public.has_subscription(v_me.id, p_creator_profile_id) then
    update public.subscriptions set cancel_at = null where fan_id = v_me.id and creator_id = p_creator_profile_id;
    return;
  end if;
  select * into v_method from public.payment_methods where id = p_method_id and user_id = v_me.id;
  if v_method.id is null then
    raise exception 'Elige un método de pago';
  end if;
  insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status)
  values ('sub:' || v_me.id || ':' || p_creator_profile_id || ':' || now(), v_me.id, v_me.name, p_creator_profile_id,
          public.creator_display_name(p_creator_profile_id), 'subscription', round(v_price, 2), v_method.label, 'paid');
  insert into public.subscriptions (fan_id, creator_id, price, since, cancel_at)
  values (v_me.id, p_creator_profile_id, round(v_price, 2), now(), null)
  on conflict (fan_id, creator_id) do update set price = excluded.price, since = excluded.since, cancel_at = null;
end;
$$;

create or replace function public.can_view_post(p_post_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.creator_posts;
begin
  if exists (select 1 from public.removed_posts where post_id = p_post_id) then
    return false;
  end if;
  if p_post_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return true;
  end if;
  select * into p from public.creator_posts where id = p_post_id::uuid;
  if p.id is null then
    return false;
  end if;
  if p.creator_id = auth.uid() or public.is_admin() then
    return true;
  end if;
  if auth.uid() is not null and public.is_cut_off(auth.uid(), p.creator_profile_id) then
    return false;
  end if;
  if not p.is_locked then
    return true;
  end if;
  return public.has_subscription(auth.uid(), p.creator_profile_id);
end;
$$;

create or replace function public.my_subscribers()
returns table (id uuid, name text, avatar text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.avatar, s.since
  from public.subscriptions s
  join public.profiles p on p.id = s.fan_id
  where s.creator_id = public.my_creator_profile_id() and (s.cancel_at is null or s.cancel_at > now())
  order by s.since desc;
$$;

-- ---------------------------------------------------------------------
-- Renewals, billed by the server
-- ---------------------------------------------------------------------
-- Bills every cycle of one fan that came due (idempotent: one row per cycle).
-- A cycle that cannot be charged ends the subscription at that date.
create or replace function public.bill_renewals_for(p_fan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_method public.payment_methods;
  s record;
  n integer;
  v_due timestamptz;
begin
  select * into v_me from public.profiles where id = p_fan;
  if v_me.id is null then
    return;
  end if;
  select * into v_method from public.payment_methods
    where user_id = v_me.id order by is_default desc, created_at asc limit 1;
  for s in select * from public.subscriptions where fan_id = v_me.id loop
    continue when public.is_cut_off(v_me.id, s.creator_id);
    n := 1;
    loop
      v_due := s.since + make_interval(months => n);
      exit when v_due > now() or n > 120 or (s.cancel_at is not null and v_due >= s.cancel_at);
      insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, created_at)
      values ('renew:' || v_me.id || ':' || s.creator_id || ':' || s.since || ':' || n, v_me.id, v_me.name, s.creator_id,
              public.creator_display_name(s.creator_id), 'renewal', s.price,
              coalesce(v_method.label, 'Sin método de pago'), case when v_method.id is null then 'failed' else 'paid' end, v_due)
      on conflict (key) do nothing;
      if v_method.id is null then
        update public.subscriptions set cancel_at = v_due
          where fan_id = s.fan_id and creator_id = s.creator_id and (cancel_at is null or cancel_at > v_due);
        exit;
      end if;
      n := n + 1;
    end loop;
  end loop;
end;
$$;
revoke execute on function public.bill_renewals_for(uuid) from public, anon, authenticated;

-- Kept for the web app, which still calls it after sign-in (harmless and idempotent).
create or replace function public.bill_due_renewals(p_creator_names jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    perform public.bill_renewals_for(auth.uid());
  end if;
end;
$$;

create or replace function public.bill_all_renewals()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f uuid;
begin
  for f in select distinct fan_id from public.subscriptions loop
    perform public.bill_renewals_for(f);
  end loop;
end;
$$;
revoke execute on function public.bill_all_renewals() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('bill-renewals', '15 * * * *', 'select public.bill_all_renewals()');

-- ---------------------------------------------------------------------
-- Creators who signed up, for Explore (demo catalogue ids are shown from the app).
-- ---------------------------------------------------------------------
create or replace function public.public_creators()
returns table (id text, name text, avatar text, bio text, is_verified boolean, subscription_price numeric, posts integer, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.creator_profile_id, p.name, p.avatar, p.bio, p.is_verified, p.subscription_price, p.posts, p.created_at
  from public.profiles p
  where p.role = 'creator' and p.creator_profile_id is not null
    and p.creator_profile_id not in ('1', '2', '3', '4', '5', '6')
  order by p.created_at desc;
$$;
grant execute on function public.public_creators() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Indexes the database advisor asked for (foreign keys)
-- ---------------------------------------------------------------------
create index if not exists circle_messages_user_idx on public.circle_messages (user_id);
create index if not exists coin_purchases_pack_idx on public.coin_purchases (pack_id);
create index if not exists email_outbox_booking_idx on public.email_outbox (booking_id);
create index if not exists email_outbox_user_idx on public.email_outbox (user_id);
create index if not exists managed_profiles_created_by_idx on public.managed_profiles (created_by);
create index if not exists payouts_user_idx on public.payouts (user_id);
create index if not exists perk_requests_booking_idx on public.perk_requests (booking_id);
create index if not exists perk_requests_transaction_idx on public.perk_requests (transaction_id);
create index if not exists post_comments_user_idx on public.post_comments (user_id);
create index if not exists post_likes_user_idx on public.post_likes (user_id);
create index if not exists reports_reporter_idx on public.reports (reporter_id);
create index if not exists transactions_gift_idx on public.transactions (gift_id);
create index if not exists vault_items_creator_idx on public.vault_items (creator_id);
