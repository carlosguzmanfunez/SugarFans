-- Subscriptions paid with PayPal Subscriptions, renewed automatically every
-- month (Carlos, 2026-10-03). Second step after 20261003000005_paypal_payments.
--
-- Flow (api/paypal.ts holds the PayPal secret and the service role key):
--   1. The fan opens the PayPal buttons. The server asks
--      paypal_subscription_quote (as the fan) for the monthly price, finds or
--      creates the PayPal plan for that price (paypal_catalog), creates the
--      PayPal subscription and records it with paypal_subscription_register.
--   2. The fan approves in PayPal. The server checks the subscription is ACTIVE
--      and runs paypal_subscription_activate: the fan gets access right away.
--   3. Every payment PayPal collects (the first one and each renewal) is
--      recorded once with paypal_subscription_payment, from the server right
--      after approval and from the PayPal webhook. The creator's share comes
--      from the same transactions trigger as any other payment.
--   4. Cancelling cancels at PayPal first, then paypal_subscription_ended keeps
--      access until the end of the paid month. A failed payment (PayPal
--      suspends the subscription) ends access at once.
--
-- The hourly simulated renewals (bill_renewals_for) skip PayPal subscriptions.

alter table public.subscriptions add column if not exists paypal_subscription_id text unique;

-- PayPal product and plan ids, per environment: 'sandbox:product', 'sandbox:plan:9.99'.
create table public.paypal_catalog (
  key text primary key,
  paypal_id text not null,
  created_at timestamptz not null default now()
);
alter table public.paypal_catalog enable row level security;

create table public.paypal_subscriptions (
  id text primary key,                 -- PayPal subscription id
  user_id uuid references public.profiles (id) on delete set null,
  creator_id text not null,
  amount numeric(10, 2) not null check (amount > 0),
  starts_at timestamptz,               -- first charge later (resubscribing during a paid month)
  status text not null default 'created' check (status in ('created', 'active', 'ended')),
  created_at timestamptz not null default now(),
  activated_at timestamptz
);
create index paypal_subscriptions_user_idx on public.paypal_subscriptions (user_id, created_at desc);
alter table public.paypal_subscriptions enable row level security;
create policy "paypal_subscriptions: own rows" on public.paypal_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- What the fan's PayPal subscription to a creator should charge each month,
-- with the same rules as subscribe_and_pay. While a cancelled subscription is
-- still paid, the first PayPal charge waits until it ends (start_time).
create or replace function public.paypal_subscription_quote(p_creator_profile_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_price numeric := public.creator_price(p_creator_profile_id);
  s public.subscriptions;
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
  select * into s from public.subscriptions where fan_id = v_me.id and creator_id = p_creator_profile_id;
  if s.fan_id is not null and s.cancel_at is null then
    raise exception 'Ya estás suscrito a este perfil';
  end if;
  return jsonb_build_object(
    'amount', round(v_price, 2),
    'description', left('Suscripción mensual a ' || public.creator_display_name(p_creator_profile_id), 120),
    'startTime', case when s.cancel_at > now() + interval '10 minutes' then s.cancel_at end
  );
end;
$$;

-- Records the PayPal subscription the server just created for this fan.
create or replace function public.paypal_subscription_register(p_id text, p_user uuid, p_creator_profile_id text, p_amount numeric, p_starts_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.paypal_subscriptions (id, user_id, creator_id, amount, starts_at)
  values (p_id, p_user, p_creator_profile_id, round(p_amount, 2), p_starts_at)
  on conflict (id) do nothing;
$$;

-- PayPal says the subscription is ACTIVE: the fan gets access. Idempotent (the
-- browser and the webhook may both call it).
create or replace function public.paypal_subscription_activate(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.paypal_subscriptions;
  s public.subscriptions;
begin
  select * into o from public.paypal_subscriptions where id = p_id for update;
  if o.id is null or o.user_id is null then
    raise exception 'Suscripción de PayPal no encontrada';
  end if;
  if o.status <> 'created' then
    return;
  end if;
  select * into s from public.subscriptions where fan_id = o.user_id and creator_id = o.creator_id for update;
  if s.fan_id is not null and (s.cancel_at is null or s.cancel_at > now()) then
    -- Still inside a paid month: keep its dates; PayPal charges from then on.
    update public.subscriptions set paypal_subscription_id = o.id, cancel_at = null, price = o.amount
      where fan_id = s.fan_id and creator_id = s.creator_id;
  else
    insert into public.subscriptions (fan_id, creator_id, price, since, cancel_at, paypal_subscription_id)
    values (o.user_id, o.creator_id, o.amount, now(), null, o.id)
    on conflict (fan_id, creator_id) do update
      set price = excluded.price, since = excluded.since, cancel_at = null, paypal_subscription_id = excluded.paypal_subscription_id;
  end if;
  update public.paypal_subscriptions set status = 'active', activated_at = now() where id = o.id;
end;
$$;

-- One payment PayPal collected for a subscription (the sale id makes it
-- idempotent). Returns 'recorded'; 'unknown' when the subscription isn't ours;
-- 'orphan' when it was ours but no longer gives access here (the fan deleted it
-- or their account, or it was replaced): the server then cancels and refunds it.
create or replace function public.paypal_subscription_payment(p_id text, p_sale_id text, p_amount numeric)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.paypal_subscriptions;
  v_me public.profiles;
  v_prefix text := 'paypal-sub:' || p_id || ':';
begin
  select * into o from public.paypal_subscriptions where id = p_id;
  if o.id is null then
    return 'unknown';
  end if;
  if exists (select 1 from public.transactions where key = v_prefix || p_sale_id) then
    return 'recorded';
  end if;
  if o.user_id is null or not exists (select 1 from public.subscriptions where paypal_subscription_id = p_id) then
    return 'orphan';
  end if;
  select * into v_me from public.profiles where id = o.user_id;
  insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status)
  values (v_prefix || p_sale_id, v_me.id, v_me.name, o.creator_id, public.creator_display_name(o.creator_id),
          case when exists (select 1 from public.transactions where key like v_prefix || '%') then 'renewal' else 'subscription' end,
          round(p_amount, 2), 'PayPal', 'paid')
  on conflict (key) do nothing;
  return 'recorded';
end;
$$;

-- The PayPal subscription ended: cancelled (access until the end of the paid
-- month) or, with p_now, suspended after a failed payment (access ends now).
-- Returns the date access ends.
create or replace function public.paypal_subscription_ended(p_id text, p_now boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  update public.paypal_subscriptions set status = 'ended' where id = p_id;
  update public.subscriptions
    set cancel_at = case when p_now then least(coalesce(cancel_at, 'infinity'::timestamptz), now())
                         else coalesce(cancel_at, public.next_renewal(since)) end
    where paypal_subscription_id = p_id
    returning cancel_at into v_until;
  return v_until;
end;
$$;

-- A PayPal subscription is cancelled through the server (it must stop at PayPal too).
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
  if s.paypal_subscription_id is not null and s.cancel_at is null then
    raise exception 'Esta suscripción se paga con PayPal';
  end if;
  if s.cancel_at is null then
    s.cancel_at := public.next_renewal(s.since);
    update public.subscriptions set cancel_at = s.cancel_at where fan_id = s.fan_id and creator_id = s.creator_id;
  end if;
  return s.cancel_at;
end;
$$;

-- Simulated checkout: a cancelled PayPal subscription can't be revived without
-- a new PayPal subscription (PayPal stopped charging it).
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
    if exists (select 1 from public.subscriptions where fan_id = v_me.id and creator_id = p_creator_profile_id and paypal_subscription_id is not null) then
      raise exception 'Debes volver a suscribirte con PayPal';
    end if;
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
  insert into public.subscriptions (fan_id, creator_id, price, since, cancel_at, paypal_subscription_id)
  values (v_me.id, p_creator_profile_id, round(v_price, 2), now(), null, null)
  on conflict (fan_id, creator_id) do update set price = excluded.price, since = excluded.since, cancel_at = null, paypal_subscription_id = null;
end;
$$;

-- Same as before, but PayPal subscriptions are billed by PayPal, not here.
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
    continue when s.paypal_subscription_id is not null;
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

revoke execute on function public.paypal_subscription_quote(text) from public, anon;
grant execute on function public.paypal_subscription_quote(text) to authenticated;
revoke execute on function public.paypal_subscription_register(text, uuid, text, numeric, timestamptz) from public, anon, authenticated;
revoke execute on function public.paypal_subscription_activate(text) from public, anon, authenticated;
revoke execute on function public.paypal_subscription_payment(text, text, numeric) from public, anon, authenticated;
revoke execute on function public.paypal_subscription_ended(text, boolean) from public, anon, authenticated;
grant execute on function public.paypal_subscription_register(text, uuid, text, numeric, timestamptz) to service_role;
grant execute on function public.paypal_subscription_activate(text) to service_role;
grant execute on function public.paypal_subscription_payment(text, text, numeric) to service_role;
grant execute on function public.paypal_subscription_ended(text, boolean) to service_role;
revoke execute on function public.cancel_subscription(text) from public, anon;
grant execute on function public.cancel_subscription(text) to authenticated;
revoke execute on function public.subscribe_and_pay(text, text, numeric, uuid) from public, anon;
grant execute on function public.subscribe_and_pay(text, text, numeric, uuid) to authenticated;
grant select on public.paypal_subscriptions to authenticated;
grant all on public.paypal_subscriptions, public.paypal_catalog to service_role;
