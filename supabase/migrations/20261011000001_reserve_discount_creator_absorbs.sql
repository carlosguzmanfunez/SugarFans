-- Reserve subscriber discount is absorbed by the creator (Carlos, 2026-10-11).
-- A creator may turn on a discount for their subscribers on an experience
-- (details.subscriberDiscount, unchanged). That discount comes out of the
-- creator's part: Fans Reserve's cut of a Reserve payment (and the 5% service
-- fee of special accounts) is computed on the full price, using the booking's
-- listPrice. Function bodies are the live ones (checked 2026-10-11) with only
-- this change.

-- Full price of a Reserve payment before the subscriber discount (the amount itself
-- when there was none or the payment isn't a Reserve booking).
create or replace function public.reserve_list_price(p_kind text, p_key text, p_amount numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_list numeric;
begin
  if p_kind = 'vip' and p_key ~ '^vip:[0-9a-f-]{36}$' then
    select (b.details->>'listPrice')::numeric into v_list from public.vip_bookings b where b.id = substr(p_key, 5)::uuid;
  end if;
  return coalesce(v_list, p_amount);
end;
$$;
revoke execute on function public.reserve_list_price(text, text, numeric) from public, anon, authenticated;


create or replace function public.set_reward_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee numeric;
  v_rate numeric;
  v_list numeric;
begin
  if new.kind in ('subscription', 'renewal', 'tip', 'vip') and new.amount > 0 then
    v_fee := public.sale_gateway_fee(new.kind, new.key, new.amount);
    v_rate := least(0.90, public.reward_share(new.creator_profile_id, new.payer_id, new.created_at));
    new.gateway_fee := v_fee;
    -- A Reserve subscriber discount comes out of the creator's part: Fans Reserve keeps
    -- what it would have kept at the full price.
    v_list := greatest(new.amount, public.reserve_list_price(new.kind, new.key, new.amount));
    new.creator_share := greatest(0, round((v_rate * (new.amount - v_fee) - (1 - v_rate) * (v_list - new.amount)) / new.amount, 4));
  end if;
  return new;
end;
$$;


create or replace function public.set_special_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.special_accounts;
  v_fee numeric;
  v_service numeric;
  v_tax numeric;
  v_list numeric;
begin
  if new.kind <> 'vip' or new.amount <= 0 then
    return new;
  end if;
  select * into s from public.special_accounts
    where creator_profile_id = new.creator_profile_id and revoked_at is null and reserve_net;
  if s.creator_profile_id is null then
    return new;
  end if;
  v_fee := public.sale_gateway_fee(new.kind, new.key, new.amount);
  -- The 5% service fee is taken on the full price: a subscriber discount comes out of the creator's part.
  v_list := greatest(new.amount, public.reserve_list_price(new.kind, new.key, new.amount));
  v_service := least(new.amount - v_fee, round(v_list * 0.05, 2));
  v_tax := least(new.amount - v_fee - v_service, round(new.amount * s.tax_rate, 2));
  new.gateway_fee := v_fee;
  new.service_fee := v_service;
  new.tax_amount := v_tax;
  new.creator_share := greatest(0, least(1, round((new.amount - v_fee - v_service - v_tax) / new.amount, 4)));
  return new;
end;
$$;

