-- Terrones and gifts. Fans buy coin packs at a net price (1 terrón = $0.01 of
-- gift value; the platform absorbs the card fee) and spend them on gifts. The
-- creator gets 60% of each gift. Gifts unlock the creator's Círculo privado
-- (group chat) and Bóveda (exclusive files), plus a personalised video ($500)
-- and a private video call ($1,000) when the creator offers them. A perk not
-- delivered in time refunds the whole gift.
-- The catalogue mirrors src/lib/giftRules.ts: keep both in sync.

-- ---------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------
create table public.coin_packs (
  id text primary key,
  name text not null,
  price numeric(10, 2) not null,
  coins integer not null
);

create table public.gift_catalog (
  id text primary key,
  name text not null,
  category text not null,
  coins integer not null,
  icon text not null
);

insert into public.coin_packs (id, name, price, coins) values
  ('bolsita', 'Bolsita', 4.99, 500),
  ('frasco', 'Frasco', 9.99, 1000),
  ('caja', 'Caja', 19.99, 2000),
  ('saco', 'Saco', 49.99, 5000),
  ('barril', 'Barril', 99.99, 10000),
  ('cofre', 'Cofre', 249.99, 25000),
  ('boveda', 'Bóveda', 499.99, 50000),
  ('tesoro', 'Tesoro', 999.00, 100000);

insert into public.gift_catalog (id, name, category, coins, icon) values
  ('caramelo', 'Caramelo', 'Dulces', 20, '🍬'),
  ('chicle', 'Chicle rosa', 'Dulces', 20, '🫧'),
  ('piruleta', 'Piruleta', 'Dulces', 20, '🍭'),
  ('gomita', 'Gomita osito', 'Dulces', 50, '🧸'),
  ('algodon', 'Algodón de azúcar', 'Dulces', 50, '☁️'),
  ('bombon', 'Bombón', 'Dulces', 50, '🍫'),
  ('cupcake', 'Cupcake', 'Repostería', 100, '🧁'),
  ('donut', 'Donut glaseado', 'Repostería', 100, '🍩'),
  ('macaron', 'Macaron', 'Repostería', 100, '🍪'),
  ('helado', 'Helado de fresa', 'Repostería', 200, '🍦'),
  ('churros', 'Churros con chocolate', 'Repostería', 200, '🥨'),
  ('manzana', 'Manzana de caramelo', 'Repostería', 200, '🍎'),
  ('tarta', 'Tarta de fresas', 'Romance', 500, '🍰'),
  ('bombones', 'Caja de bombones', 'Romance', 500, '🎁'),
  ('rosas', 'Ramo de rosas', 'Romance', 1000, '💐'),
  ('champan', 'Copa de champán', 'Romance', 1000, '🥂'),
  ('perfume', 'Perfume', 'Lujo', 2000, '🌸'),
  ('corazon', 'Corazón de cristal', 'Lujo', 2000, '💖'),
  ('perlas', 'Collar de perlas', 'Lujo', 5000, '📿'),
  ('tacones', 'Tacones de diamante', 'Lujo', 5000, '👠'),
  ('corona', 'Corona de azúcar', 'Fantasía', 10000, '👑'),
  ('limusina', 'Limusina rosa', 'Fantasía', 20000, '🚘'),
  ('yate', 'Yate de caramelo', 'Fantasía', 50000, '🛥️'),
  ('jet', 'Jet privado', 'Fantasía', 50000, '✈️'),
  ('castillo', 'Castillo de azúcar', 'Fantasía', 100000, '🏰');

alter table public.coin_packs enable row level security;
alter table public.gift_catalog enable row level security;
create policy "coin_packs: anyone reads" on public.coin_packs for select to anon, authenticated using (true);
create policy "gift_catalog: anyone reads" on public.gift_catalog for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- Gifts are payments in the creator's books, with a 60% share
-- ---------------------------------------------------------------------
alter table public.transactions drop constraint transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check check (kind in ('subscription', 'renewal', 'tip', 'gift'));
alter table public.transactions drop constraint transactions_status_check;
alter table public.transactions add constraint transactions_status_check check (status in ('paid', 'failed', 'refunded'));
alter table public.transactions add column creator_share numeric(3, 2) not null default 0.80 check (creator_share between 0 and 1);
alter table public.transactions add column gift_id text references public.gift_catalog (id);

-- Credited balance = the creator's share of payments made before this month's 1st (UTC) - withdrawals.
create or replace function public.creator_available_balance(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    round(coalesce((select sum(t.amount * t.creator_share) from public.transactions t
                    where t.creator_profile_id = p.creator_profile_id and t.status = 'paid'
                      and t.created_at < date_trunc('month', now() at time zone 'utc') at time zone 'utc'), 0), 2)
    - coalesce((select sum(x.amount) from public.payouts x where x.user_id = p.id), 0)
  from public.profiles p where p.id = p_user;
$$;

-- ---------------------------------------------------------------------
-- Wallet
-- ---------------------------------------------------------------------
create table public.coin_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id text not null references public.coin_packs (id),
  coins integer not null,
  price numeric(10, 2) not null,
  method_label text not null,
  created_at timestamptz not null default now()
);
create index coin_purchases_user_idx on public.coin_purchases (user_id, created_at);

alter table public.coin_purchases enable row level security;
create policy "coin_purchases: owner or admin reads" on public.coin_purchases
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

create or replace function public.coin_balance(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(c.coins) from public.coin_purchases c where c.user_id = p_user), 0)
       - coalesce((select sum(round(t.amount * 100)) from public.transactions t
                   where t.payer_id = p_user and t.kind = 'gift' and t.status = 'paid'), 0)::bigint;
$$;

create or replace function public.my_coin_balance()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select public.coin_balance(auth.uid());
$$;

-- INTEGRATION: the payment processor charges the pack here.
create or replace function public.buy_coins(p_pack_id text, p_method_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_pack public.coin_packs;
  v_method public.payment_methods;
  v_today numeric;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into v_pack from public.coin_packs where id = p_pack_id;
  if v_pack.id is null then
    raise exception 'Paquete no encontrado';
  end if;
  select * into v_method from public.payment_methods where id = p_method_id and user_id = v_me.id;
  if v_method.id is null then
    raise exception 'Elige un método de pago';
  end if;
  if not v_me.is_verified then
    select coalesce(sum(price), 0) into v_today from public.coin_purchases
      where user_id = v_me.id and created_at > now() - interval '1 day';
    if v_today + v_pack.price > 300 then
      raise exception 'Sin verificar tu identidad puedes comprar hasta $300 al día. Verifícate en Configuración para comprar más.';
    end if;
  end if;
  insert into public.coin_purchases (user_id, pack_id, coins, price, method_label)
  values (v_me.id, v_pack.id, v_pack.coins, v_pack.price, v_method.label);
end;
$$;

-- ---------------------------------------------------------------------
-- Creator settings and perks
-- ---------------------------------------------------------------------
create table public.creator_gift_settings (
  creator_profile_id text primary key,
  circle_min numeric(10, 2) not null default 100 check (circle_min between 50 and 1000),
  offers_video boolean not null default false,
  offers_call boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.creator_gift_settings enable row level security;
create policy "creator_gift_settings: anyone reads" on public.creator_gift_settings
  for select to anon, authenticated using (true);
create policy "creator_gift_settings: creator inserts own" on public.creator_gift_settings
  for insert to authenticated with check (creator_profile_id = (select public.my_creator_profile_id()));
create policy "creator_gift_settings: creator updates own" on public.creator_gift_settings
  for update to authenticated
  using (creator_profile_id = (select public.my_creator_profile_id()))
  with check (creator_profile_id = (select public.my_creator_profile_id()));

create table public.perk_requests (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  fan_id uuid not null references public.profiles (id) on delete cascade,
  fan_name text not null,
  creator_profile_id text not null,
  creator_name text not null,
  kind text not null check (kind in ('video', 'call')),
  request text not null default '',
  status text not null default 'pending' check (status in ('pending', 'scheduled', 'delivered', 'refunded')),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  media_path text,
  media_type text check (media_type is null or media_type = 'video'),
  booking_id uuid references public.vip_bookings (id) on delete set null
);
create index perk_requests_fan_idx on public.perk_requests (fan_id);
create index perk_requests_creator_idx on public.perk_requests (creator_profile_id, status);

alter table public.perk_requests enable row level security;
create policy "perk_requests: fan, creator or admin reads" on public.perk_requests
  for select to authenticated
  using (fan_id = (select auth.uid()) or creator_profile_id = (select public.my_creator_profile_id()) or (select public.is_admin()));

create or replace function public.send_gift(
  p_creator_profile_id text,
  p_creator_name text,
  p_gift_id text,
  p_post_id text,
  p_message text,
  p_request text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_gift public.gift_catalog;
  v_value numeric;
  v_tx uuid;
  v_message text := left(trim(coalesce(p_message, '')), 200);
  v_video boolean := false;
  v_call boolean := false;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into v_gift from public.gift_catalog where id = p_gift_id;
  if v_gift.id is null then
    raise exception 'Regalo no encontrado';
  end if;
  if v_me.creator_profile_id = p_creator_profile_id then
    raise exception 'No puedes enviarte un regalo a ti mismo';
  end if;
  if public.is_cut_off(v_me.id, p_creator_profile_id) then
    raise exception 'No puedes enviar regalos a este perfil';
  end if;
  -- One spend at a time per fan, so two gifts cannot use the same coins.
  perform pg_advisory_xact_lock(hashtext('coins:' || v_me.id::text));
  if public.coin_balance(v_me.id) < v_gift.coins then
    raise exception 'No tienes suficientes terrones';
  end if;
  v_value := v_gift.coins / 100.0;
  insert into public.transactions
    (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, note, creator_share, gift_id)
  values
    ('gift:' || v_me.id || ':' || gen_random_uuid(), v_me.id, v_me.name, p_creator_profile_id, p_creator_name, 'gift',
     v_value, 'Terrones', 'paid',
     case when v_message = '' then v_gift.name else v_gift.name || ' · “' || v_message || '”' end,
     0.60, v_gift.id)
  returning id into v_tx;

  select s.offers_video, s.offers_call into v_video, v_call
    from public.creator_gift_settings s where s.creator_profile_id = p_creator_profile_id;
  if v_value >= 500 and coalesce(v_video, false) then
    insert into public.perk_requests (transaction_id, fan_id, fan_name, creator_profile_id, creator_name, kind, request, due_at)
    values (v_tx, v_me.id, v_me.name, p_creator_profile_id, p_creator_name, 'video',
            left(trim(coalesce(p_request, '')), 500), now() + interval '7 days');
  end if;
  if v_value >= 1000 and coalesce(v_call, false) then
    insert into public.perk_requests (transaction_id, fan_id, fan_name, creator_profile_id, creator_name, kind, due_at)
    values (v_tx, v_me.id, v_me.name, p_creator_profile_id, p_creator_name, 'call', now() + interval '30 days');
  end if;
  return v_tx;
end;
$$;

-- Refunds every gift whose perk was not delivered in time (idempotent; the app
-- calls it before showing wallets and perks). INTEGRATION: a scheduled job.
create or replace function public.settle_overdue_perks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(distinct transaction_id) into v_ids from public.perk_requests
    where status = 'pending' and due_at < now();
  if v_ids is null then
    return;
  end if;
  update public.transactions set status = 'refunded' where id = any (v_ids) and status = 'paid';
  update public.perk_requests set status = 'refunded' where transaction_id = any (v_ids) and status = 'pending';
end;
$$;

create or replace function public.deliver_perk_video(p_id uuid, p_media_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.perk_requests;
begin
  perform public.settle_overdue_perks();
  select * into v from public.perk_requests where id = p_id for update;
  if v.id is null or v.kind <> 'video' or v.creator_profile_id is distinct from public.my_creator_profile_id() then
    raise exception 'Esta acción no está permitida';
  end if;
  if v.status <> 'pending' then
    raise exception 'Este pedido ya no está pendiente';
  end if;
  if split_part(coalesce(p_media_path, ''), '/', 1) <> auth.uid()::text then
    raise exception 'Archivo no válido';
  end if;
  update public.perk_requests
    set status = 'delivered', delivered_at = now(), media_path = p_media_path, media_type = 'video'
    where id = p_id;
end;
$$;

-- The gifted video call becomes a confirmed VIP booking, so it uses the live room.
create or replace function public.schedule_perk_call(p_id uuid, p_date date, p_time text, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.perk_requests;
  v_booking uuid;
begin
  perform public.settle_overdue_perks();
  select * into v from public.perk_requests where id = p_id for update;
  if v.id is null or v.kind <> 'call' or v.creator_profile_id is distinct from public.my_creator_profile_id() then
    raise exception 'Esta acción no está permitida';
  end if;
  if v.status <> 'pending' then
    raise exception 'Esta videollamada ya no está pendiente';
  end if;
  if p_at is null or p_at <= now() then
    raise exception 'Elige un momento futuro';
  end if;
  if p_at > v.due_at then
    raise exception 'La videollamada debe hacerse antes de que venza el plazo de 30 días';
  end if;
  begin
    insert into public.vip_bookings
      (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email, date, time, status, paid_at)
    select 'gift-call', v.creator_profile_id, 'Videollamada privada (regalo)', v.creator_name, 0, v.fan_id, v.fan_name, p.email,
           p_date, p_time, 'confirmed', now()
    from public.profiles p where p.id = v.fan_id
    returning id into v_booking;
  exception when unique_violation then
    raise exception 'Ya tienes otra sesión a esa hora. Elige otro horario.';
  end;
  update public.perk_requests set status = 'scheduled', booking_id = v_booking, delivered_at = now() where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Círculo privado and Bóveda
-- ---------------------------------------------------------------------
-- A gift of at least the creator's minimum, or gifts adding up to it within one
-- calendar month (UTC), give 30 days of Círculo; each new qualifying gift adds 30
-- more. A single gift of $200 or more also gives 30 days of Bóveda.
create or replace function public.circle_access(p_fan uuid, p_creator_profile_id text, out circle_until timestamptz, out vault_until timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_min numeric;
  v_month text := '';
  v_pile numeric := 0;
begin
  select coalesce((select s.circle_min from public.creator_gift_settings s where s.creator_profile_id = p_creator_profile_id), 100)
    into v_min;
  for r in
    select t.amount, t.created_at from public.transactions t
    where t.payer_id = p_fan and t.creator_profile_id = p_creator_profile_id and t.kind = 'gift' and t.status = 'paid'
    order by t.created_at
  loop
    if to_char(r.created_at at time zone 'utc', 'YYYY-MM') <> v_month then
      v_month := to_char(r.created_at at time zone 'utc', 'YYYY-MM');
      v_pile := 0;
    end if;
    v_pile := v_pile + r.amount;
    if r.amount >= v_min or r.amount >= 200 or v_pile >= v_min then
      circle_until := greatest(coalesce(circle_until, r.created_at), r.created_at) + interval '30 days';
      v_pile := 0;
    end if;
    if r.amount >= 200 then
      vault_until := greatest(coalesce(vault_until, r.created_at), r.created_at) + interval '30 days';
    end if;
  end loop;
end;
$$;

create or replace function public.owns_creator_profile(p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or coalesce(public.my_creator_profile_id() = p_creator_profile_id, false);
$$;

create or replace function public.in_circle(p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.owns_creator_profile(p_creator_profile_id)
      or coalesce((select a.circle_until > now() from public.circle_access(auth.uid(), p_creator_profile_id) a), false);
$$;

create or replace function public.in_vault(p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.owns_creator_profile(p_creator_profile_id)
      or coalesce((select a.vault_until > now() from public.circle_access(auth.uid(), p_creator_profile_id) a), false);
$$;

create or replace function public.my_circle_status(p_creator_profile_id text)
returns table (owner boolean, circle_until timestamptz, vault_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select public.owns_creator_profile(p_creator_profile_id), a.circle_until, a.vault_until
  from public.circle_access(auth.uid(), p_creator_profile_id) a;
$$;

-- Top gifters of the current month (UTC).
create or replace function public.top_fans(p_creator_profile_id text)
returns table (name text, value numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select max(t.payer_name), sum(t.amount)
  from public.transactions t
  where t.creator_profile_id = p_creator_profile_id and t.kind = 'gift' and t.status = 'paid'
    and t.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
  group by coalesce(t.payer_id::text, t.payer_name)
  order by 2 desc
  limit 5;
$$;

create table public.circle_messages (
  id uuid primary key default gen_random_uuid(),
  creator_profile_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  user_name text not null default '',
  user_avatar text not null default '',
  body text not null check (char_length(trim(body)) between 1 and 1000),
  from_creator boolean not null default false,
  created_at timestamptz not null default now()
);
create index circle_messages_creator_idx on public.circle_messages (creator_profile_id, created_at);

create or replace function public.fill_circle_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid();
  new.user_id := v_me.id;
  new.user_name := v_me.name;
  new.user_avatar := v_me.avatar;
  new.from_creator := coalesce(v_me.creator_profile_id = new.creator_profile_id, false);
  new.body := trim(new.body);
  new.created_at := now();
  return new;
end;
$$;

create trigger fill_circle_message
  before insert on public.circle_messages
  for each row execute function public.fill_circle_message();

alter table public.circle_messages enable row level security;
create policy "circle_messages: members read" on public.circle_messages
  for select to authenticated using (public.in_circle(creator_profile_id));
create policy "circle_messages: members write" on public.circle_messages
  for insert to authenticated with check (public.in_circle(creator_profile_id));
create policy "circle_messages: author, creator or admin deletes" on public.circle_messages
  for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.owns_creator_profile(creator_profile_id)));

create table public.vault_items (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  creator_profile_id text not null default '',
  title text not null check (char_length(trim(title)) between 1 and 120),
  media_path text not null,
  media_type text not null check (media_type in ('image', 'video')),
  created_at timestamptz not null default now()
);
create index vault_items_creator_idx on public.vault_items (creator_profile_id, created_at);

create or replace function public.fill_vault_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.creator_id := auth.uid();
  select creator_profile_id into new.creator_profile_id from public.profiles where id = auth.uid() and role = 'creator';
  if new.creator_profile_id is null then
    raise exception 'Solo los creadores publican en su Bóveda';
  end if;
  if split_part(new.media_path, '/', 1) <> auth.uid()::text then
    raise exception 'Archivo no válido';
  end if;
  new.title := trim(new.title);
  new.created_at := now();
  return new;
end;
$$;

create trigger fill_vault_item
  before insert on public.vault_items
  for each row execute function public.fill_vault_item();

alter table public.vault_items enable row level security;
create policy "vault_items: members read" on public.vault_items
  for select to authenticated using (public.in_vault(creator_profile_id));
create policy "vault_items: creators add" on public.vault_items
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'creator'));
create policy "vault_items: creator or admin deletes" on public.vault_items
  for delete to authenticated using ((select public.owns_creator_profile(creator_profile_id)));

-- Storage: Bóveda files for members, and a gifted video for its fan.
create or replace function public.can_view_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.creator_posts p where p.media_path = p_name and public.can_view_post(p.id::text))
      or exists (select 1 from public.vault_items v where v.media_path = p_name and public.in_vault(v.creator_profile_id))
      or exists (select 1 from public.perk_requests r where r.media_path = p_name
                 and (r.fan_id = auth.uid() or public.owns_creator_profile(r.creator_profile_id)));
$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.coin_balance(uuid) from public, anon, authenticated;
revoke execute on function public.circle_access(uuid, text) from public, anon, authenticated;
revoke execute on function public.fill_circle_message() from public, anon, authenticated;
revoke execute on function public.fill_vault_item() from public, anon, authenticated;
revoke execute on function public.my_coin_balance() from public, anon;
revoke execute on function public.buy_coins(text, uuid) from public, anon;
revoke execute on function public.send_gift(text, text, text, text, text, text) from public, anon;
revoke execute on function public.settle_overdue_perks() from public, anon;
revoke execute on function public.deliver_perk_video(uuid, text) from public, anon;
revoke execute on function public.schedule_perk_call(uuid, date, text, timestamptz) from public, anon;
revoke execute on function public.my_circle_status(text) from public, anon;
grant execute on function public.my_coin_balance() to authenticated;
grant execute on function public.buy_coins(text, uuid) to authenticated;
grant execute on function public.send_gift(text, text, text, text, text, text) to authenticated;
grant execute on function public.settle_overdue_perks() to authenticated;
grant execute on function public.deliver_perk_video(uuid, text) to authenticated;
grant execute on function public.schedule_perk_call(uuid, date, text, timestamptz) to authenticated;
grant execute on function public.my_circle_status(text) to authenticated;
grant execute on function public.owns_creator_profile(text) to anon, authenticated;
grant execute on function public.in_circle(text) to authenticated;
grant execute on function public.in_vault(text) to anon, authenticated;
grant execute on function public.top_fans(text) to anon, authenticated;
