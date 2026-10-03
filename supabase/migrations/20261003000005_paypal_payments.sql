-- Real payments with PayPal Checkout (Carlos, 2026-10-03), first step:
-- Créditos packs, tips and Reserve bookings. Subscriptions (with automatic
-- monthly renewal through PayPal Subscriptions) come in a second step and keep
-- the simulated checkout until then.
--
-- Flow (api/paypal.ts, a Vercel function that holds the PayPal secret and the
-- Supabase service role key):
--   1. The fan opens the PayPal buttons. The server asks paypal_quote (as the
--      fan) what to charge, creates the PayPal order for that amount in USD and
--      records it with paypal_register.
--   2. The fan approves in PayPal. The server captures the order and, only if
--      PayPal says COMPLETED for the recorded amount, runs paypal_fulfill: the
--      same RPC the simulated checkout uses (buy_coins, send_tip,
--      vip_pay_booking) runs as the fan with a one-off "PayPal" method, so
--      prices, shares and rewards stay in one place.
--   3. If fulfilling fails after the capture, the server refunds the capture and
--      marks the order with paypal_mark.
--
-- paypal_register, paypal_fulfill and paypal_mark only run with the service role.

create table public.paypal_orders (
  id text primary key,                 -- PayPal order id
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('coins', 'tip', 'booking', 'subscription')),
  params jsonb not null default '{}'::jsonb,
  amount numeric(10, 2) not null check (amount > 0),
  status text not null default 'created' check (status in ('created', 'completed', 'refunded', 'failed')),
  capture_id text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index paypal_orders_user_idx on public.paypal_orders (user_id, created_at desc);

alter table public.paypal_orders enable row level security;
create policy "paypal_orders: own rows" on public.paypal_orders
  for select to authenticated using (user_id = auth.uid());

-- What a PayPal order should charge, checked as the signed-in fan with the same
-- rules as the RPC that will fulfill it. Returns {amount, description}.
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
    if v_me.creator_profile_id = v_creator then
      raise exception 'No puedes enviarte una propina a ti mismo';
    end if;
    if public.is_cut_off(v_me.id, v_creator) then
      raise exception 'No puedes enviar propinas a este perfil';
    end if;
    v_amount := round((p_params->>'amount')::numeric, 2);
    if v_amount is null or v_amount < 1 or v_amount > 500 then
      raise exception 'La propina debe estar entre $1 y $500';
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

-- Records the PayPal order the server just created for this fan.
create or replace function public.paypal_register(p_order_id text, p_user uuid, p_kind text, p_params jsonb, p_amount numeric)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.paypal_orders (id, user_id, kind, params, amount)
  values (p_order_id, p_user, p_kind, coalesce(p_params, '{}'::jsonb), round(p_amount, 2));
$$;

-- Runs once PayPal confirmed the capture: performs the purchase as the fan.
-- Raises (and changes nothing) if the order isn't pending, belongs to someone
-- else, the amount differs or the purchase itself is no longer valid.
create or replace function public.paypal_fulfill(p_order_id text, p_user uuid, p_capture_id text, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.paypal_orders;
  v_method uuid;
begin
  select * into o from public.paypal_orders where id = p_order_id for update;
  if o.id is null or o.user_id is distinct from p_user then
    raise exception 'Pedido de PayPal no encontrado';
  end if;
  if o.status = 'completed' then
    return; -- already fulfilled (a repeated capture call)
  end if;
  if o.status <> 'created' then
    raise exception 'Este pedido de PayPal ya no está pendiente';
  end if;
  if round(p_amount, 2) <> o.amount then
    raise exception 'El monto cobrado no coincide con el pedido';
  end if;

  -- The purchase RPCs read the fan from the request's JWT claims.
  perform set_config('request.jwt.claim.sub', o.user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', o.user_id, 'role', 'authenticated')::text, true);

  -- A one-off method so the transaction shows "PayPal"; removed right after.
  insert into public.payment_methods (user_id, kind, label, detail)
  values (o.user_id, 'paypal', 'PayPal', 'Pedido ' || o.id)
  returning id into v_method;

  if o.kind = 'coins' then
    perform public.buy_coins(o.params->>'packId', v_method);
  elsif o.kind = 'tip' then
    perform public.send_tip(o.params->>'creatorProfileId', public.creator_display_name(o.params->>'creatorProfileId'),
                            o.amount, v_method, nullif(o.params->>'postId', ''), o.params->>'message');
  elsif o.kind = 'booking' then
    perform public.vip_pay_booking((o.params->>'bookingId')::uuid, v_method);
  else
    raise exception 'Este pago todavía no se hace con PayPal';
  end if;

  delete from public.payment_methods where id = v_method;
  update public.paypal_orders
    set status = 'completed', capture_id = p_capture_id, completed_at = now(), error = null
    where id = o.id;
end;
$$;

-- Marks an order refunded or failed (the server refunds a capture it couldn't fulfill).
create or replace function public.paypal_mark(p_order_id text, p_status text, p_capture_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.paypal_orders
    set status = p_status, capture_id = coalesce(p_capture_id, capture_id), error = left(p_error, 500)
    where id = p_order_id and status <> 'completed' and p_status in ('refunded', 'failed');
$$;

revoke execute on function public.paypal_quote(text, jsonb) from public, anon;
grant execute on function public.paypal_quote(text, jsonb) to authenticated;
revoke execute on function public.paypal_register(text, uuid, text, jsonb, numeric) from public, anon, authenticated;
revoke execute on function public.paypal_fulfill(text, uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.paypal_mark(text, text, text, text) from public, anon, authenticated;
grant execute on function public.paypal_register(text, uuid, text, jsonb, numeric) to service_role;
grant execute on function public.paypal_fulfill(text, uuid, text, numeric) to service_role;
grant execute on function public.paypal_mark(text, text, text, text) to service_role;
grant select on public.paypal_orders to authenticated;
grant all on public.paypal_orders to service_role;
