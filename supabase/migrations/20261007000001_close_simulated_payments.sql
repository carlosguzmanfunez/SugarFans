-- Día 1 del plan de lanzamiento (Carlos, 2026-10-07): P0 de dinero.
--
-- 1. Cobros simulados cerrados. Hasta hoy un fan podía añadirse una "tarjeta"
--    de demostración y llamar directo a buy_coins, send_tip, vip_pay_booking o
--    subscribe_and_pay: recibía Créditos, propinas o reservas pagadas sin pasar
--    por PayPal y el creador lo veía como saldo retirable. Ahora:
--      - buy_coins, send_tip y vip_pay_booking solo se ejecutan desde
--        paypal_fulfill (servidor, después de que PayPal confirma el cobro).
--      - subscribe_and_pay queda cerrado: suscribirse (o volver a suscribirse a
--        una cancelada que sigue pagada) se hace con PayPal Subscriptions.
--      - Las renovaciones simuladas dejan de cobrar: una suscripción antigua sin
--        PayPal termina en su próxima fecha de renovación.
-- 2. Perfiles demo sin dueño no aceptan dinero. Los demo 2-9 no tienen cuenta
--    detrás (solo el 1, Valentina, es de creator@). Un trigger en transactions
--    y en vip_bookings rechaza pagos, regalos y reservas a un perfil sin dueño,
--    y las cotizaciones de PayPal lo frenan antes de cobrar.
--
-- Aditivo: no borra datos; reemplaza funciones con las mismas firmas.

-- Un perfil acepta dinero si es de un creador con cuenta o un perfil gestionado visible.
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

create or replace function public.assert_creator_accepts_payments(p_creator_profile_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_creator_profile_id is not null and not public.creator_accepts_payments(p_creator_profile_id) then
    raise exception 'Este perfil es de demostración: todavía no acepta pagos ni reservas.';
  end if;
end;
$$;
revoke execute on function public.assert_creator_accepts_payments(text) from public, anon, authenticated;

-- Último candado: ningún pago, regalo o reserva nueva llega a un perfil sin dueño.
create or replace function public.guard_demo_creator_money()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_creator_accepts_payments(new.creator_profile_id);
  return new;
end;
$$;
revoke execute on function public.guard_demo_creator_money() from public, anon, authenticated;

drop trigger if exists guard_demo_creator_money on public.transactions;
create trigger guard_demo_creator_money
  before insert on public.transactions
  for each row execute function public.guard_demo_creator_money();

drop trigger if exists guard_demo_creator_money on public.vip_bookings;
create trigger guard_demo_creator_money
  before insert on public.vip_bookings
  for each row execute function public.guard_demo_creator_money();

-- Las cotizaciones de PayPal frenan antes de cobrar (si no, PayPal cobra y luego reembolsa).
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
    perform public.assert_creator_accepts_payments(v_creator);
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
  perform public.assert_creator_accepts_payments(p_creator_profile_id);
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


-- Renovaciones: PayPal cobra las suyas. Una suscripción antigua sin PayPal ya no
-- se cobra con métodos simulados: termina en su próxima fecha de renovación.
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
    -- El último mes ya cobrado termina en la primera fecha de renovación futura.
    n := 1;
    loop
      v_due := s.since + make_interval(months => n);
      exit when v_due > now() or n > 120;
      n := n + 1;
    end loop;
    update public.subscriptions set cancel_at = v_due
      where fan_id = s.fan_id and creator_id = s.creator_id and cancel_at is null;
  end loop;
end;
$$;
revoke execute on function public.bill_renewals_for(uuid) from public, anon, authenticated;

-- Los cobros directos ya no se pueden llamar desde la app: solo paypal_fulfill
-- (security definer, servidor) los ejecuta tras confirmar el pago en PayPal.
revoke execute on function public.buy_coins(text, uuid) from public, anon, authenticated;
revoke execute on function public.send_tip(text, text, numeric, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.vip_pay_booking(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.subscribe_and_pay(text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.buy_coins(text, uuid) to service_role;
grant execute on function public.send_tip(text, text, numeric, uuid, text, text) to service_role;
grant execute on function public.vip_pay_booking(uuid, uuid) to service_role;
