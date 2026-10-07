-- Close the simulated checkout and payments to unowned demo profiles (launch audit, 2026-10-07).
--
-- 1. Purchases only go through the server. buy_coins, send_tip, vip_pay_booking and
--    subscribe_and_pay charge a saved "payment method" that is only a label (no money
--    moves). They were still callable from the browser, so anyone signed in could get
--    Créditos, tips, Reserve payments or subscriptions credited to a creator without
--    paying, and that balance could be withdrawn with PayPal Payouts. They now run only
--    inside paypal_fulfill (after PayPal confirmed the capture), never from the browser.
-- 2. Simulated subscriptions stop renewing. Subscriptions not paid through PayPal
--    Subscriptions are no longer charged to a saved method: they keep access until the
--    end of the month already paid, then end. PayPal subscriptions are unchanged.
-- 3. Demo profiles without an owner take no money. A creator profile receives payments
--    only when it belongs to a creator account or is a profile run by the admin. The
--    demo catalogue profiles that nobody owns (today all but Valentina Rose) refuse
--    PayPal orders, subscriptions, gifts and tips, and no paid sale can be recorded for
--    them, so nothing is charged for a profile nobody can serve or withdraw.
--
-- Apply once. Nothing here deletes data.

-- ---------------------------------------------------------------------
-- 3a. Who can receive payments
-- ---------------------------------------------------------------------
create or replace function public.creator_accepts_payments(p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                 where p.creator_profile_id = p_creator_profile_id and p.role = 'creator')
      or exists (select 1 from public.managed_profiles m
                 where m.id = p_creator_profile_id and not m.hidden);
$$;
revoke execute on function public.creator_accepts_payments(text) from public;
grant execute on function public.creator_accepts_payments(text) to anon, authenticated;

-- Last line of defence: no paid sale for a profile that cannot receive it. Every
-- subscription, renewal, tip, gift and Reserve payment is a row here.
create or replace function public.transactions_payable_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and not public.creator_accepts_payments(new.creator_profile_id) then
    raise exception 'Este perfil es de demostración y todavía no recibe pagos';
  end if;
  return new;
end;
$$;
revoke execute on function public.transactions_payable_creator() from public, anon, authenticated;
drop trigger if exists transactions_payable_creator on public.transactions;
create trigger transactions_payable_creator
  before insert on public.transactions
  for each row execute function public.transactions_payable_creator();

-- PayPal quotes refuse those profiles before the fan is charged.
create or replace function public.paypal_quote(p_kind text, p_params jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_creator text := p_params->>'creatorProfileId';
  v_amount numeric;
  v_desc text;
  v_pack public.coin_packs;
  v_today numeric;
  b public.vip_bookings;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;

  if p_kind = 'coins' then
    select * into v_pack from public.coin_packs where id = p_params->>'packId';
    if v_pack.id is null then
      raise exception 'Paquete no encontrado';
    end if;
    if not v_me.is_verified then
      select coalesce(sum(price), 0) into v_today from public.coin_purchases
        where user_id = v_me.id and created_at > now() - interval '1 day';
      if v_today + v_pack.price > 300 then
        raise exception 'Sin verificar tu identidad puedes comprar hasta $300 al día. Verifícate en Configuración para comprar más.';
      end if;
    end if;
    v_amount := v_pack.price;
    v_desc := 'Créditos: ' || v_pack.name;

  elsif p_kind = 'tip' then
    if public.creator_price(v_creator) is null then
      raise exception 'Creador no encontrado';
    end if;
    if not public.creator_accepts_payments(v_creator) then
      raise exception 'Este perfil es de demostración y todavía no recibe pagos';
    end if;
    if v_me.creator_profile_id = v_creator then
      raise exception 'No puedes enviarte una propina a ti mismo';
    end if;
    if public.is_cut_off(v_me.id, v_creator) then
      raise exception 'No puedes enviar propinas a este perfil';
    end if;
    v_amount := round((p_params->>'amount')::numeric, 2);
    if v_amount is null or v_amount < 3 or v_amount > 500 then
      raise exception 'La propina debe estar entre $3 y $500';
    end if;
    v_desc := 'Propina para ' || public.creator_display_name(v_creator);

  elsif p_kind = 'booking' then
    select * into b from public.vip_bookings where id = (p_params->>'bookingId')::uuid;
    if b.id is null or b.fan_id is distinct from v_me.id then
      raise exception 'Reserva no encontrada';
    end if;
    if b.status <> 'accepted' then
      raise exception 'Solo puedes pagar una reserva aceptada por el creador';
    end if;
    if not public.creator_accepts_payments(b.creator_profile_id) then
      raise exception 'Este perfil es de demostración y todavía no recibe pagos';
    end if;
    v_amount := b.price;
    v_desc := 'Reserve: ' || b.title;

  else
    raise exception 'Este pago todavía no se hace con PayPal';
  end if;

  return jsonb_build_object('amount', round(v_amount, 2), 'description', left(v_desc, 120));
end;
$$;


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
  if not public.creator_accepts_payments(p_creator_profile_id) then
    raise exception 'Este perfil es de demostración y todavía no recibe pagos';
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


-- ---------------------------------------------------------------------
-- 1. Purchases only from the server (paypal_fulfill runs them as the fan)
-- ---------------------------------------------------------------------
revoke execute on function public.buy_coins(text, uuid) from public, anon, authenticated;
revoke execute on function public.send_tip(text, text, numeric, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.vip_pay_booking(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.subscribe_and_pay(text, text, numeric, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Subscriptions outside PayPal end with the month already paid
-- ---------------------------------------------------------------------
create or replace function public.bill_renewals_for(p_fan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  n integer;
  v_due timestamptz;
begin
  for s in select * from public.subscriptions
    where fan_id = p_fan and paypal_subscription_id is null and cancel_at is null loop
    -- The next monthly date: access lasts until then and nothing more is charged.
    n := 1;
    loop
      v_due := s.since + make_interval(months => n);
      exit when v_due > now() or n > 240;
      n := n + 1;
    end loop;
    update public.subscriptions set cancel_at = v_due
      where fan_id = s.fan_id and creator_id = s.creator_id and cancel_at is null;
  end loop;
end;
$$;
revoke execute on function public.bill_renewals_for(uuid) from public, anon, authenticated;
