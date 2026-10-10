-- Real money protection (Carlos, 2026-10-10), two parts:
--
-- 1. Refunds and disputes. When a fan gets money back through PayPal (a refund,
--    a chargeback) the sale stops counting for the creator; while a dispute is
--    open it is frozen ('disputed') and goes back to 'paid' if PayPal sides
--    with the seller. A creator's balance only counts 'paid' sales, so money
--    already withdrawn is taken from what they earn next. Créditos bought and
--    then refunded leave the fan's wallet; if they were already spent, the
--    gifts paid with them are reversed too (newest first).
--    api/paypal.ts calls paypal_money_back from PayPal's webhook:
--    PAYMENT.CAPTURE.REFUNDED / REVERSED, PAYMENT.SALE.REFUNDED / REVERSED and
--    CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED.
--
-- 2. Paying yourself. A fan account can't pay a creator account of the same
--    person: same PayPal email as the creator's withdrawals or login, the fan
--    signing in with the creator's PayPal email, the same phone, or the same
--    verified identity (name and birth date). Checked before PayPal charges
--    (api/paypal.ts) and by a trigger on every sale and gift.
--
-- Additive and safe to re-run.

-- ---------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------
alter table public.transactions drop constraint if exists transactions_status_check;
alter table public.transactions add constraint transactions_status_check
  check (status in ('paid', 'failed', 'refunded', 'disputed'));
-- The PayPal capture behind a sale (subscription payments carry their sale id in the key).
alter table public.transactions add column if not exists paypal_ref text;
-- The refund or dispute that reversed a gift paid with Créditos that were given back.
alter table public.transactions add column if not exists reversed_by text;
create index if not exists transactions_paypal_ref_idx on public.transactions (paypal_ref) where paypal_ref is not null;
create index if not exists transactions_reversed_by_idx on public.transactions (reversed_by) where reversed_by is not null;

alter table public.coin_purchases add column if not exists status text not null default 'paid';
alter table public.coin_purchases drop constraint if exists coin_purchases_status_check;
alter table public.coin_purchases add constraint coin_purchases_status_check check (status in ('paid', 'disputed', 'refunded'));
alter table public.coin_purchases add column if not exists paypal_ref text;
create index if not exists coin_purchases_paypal_ref_idx on public.coin_purchases (paypal_ref) where paypal_ref is not null;

-- Créditos given back to PayPal no longer count.
create or replace function public.coin_balance(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(c.coins) from public.coin_purchases c where c.user_id = p_user and c.status = 'paid'), 0)
       - coalesce((select sum(round(t.amount * 100)) from public.transactions t
                   where t.payer_id = p_user and t.kind = 'gift' and t.status = 'paid'), 0)::bigint;
$$;

-- ---------------------------------------------------------------------
-- Every row a PayPal payment creates remembers its capture
-- ---------------------------------------------------------------------
create or replace function public.stamp_paypal_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.paypal_ref := coalesce(new.paypal_ref, nullif(current_setting('fansreserve.paypal_ref', true), ''));
  return new;
end;
$$;
revoke execute on function public.stamp_paypal_ref() from public, anon, authenticated;

drop trigger if exists stamp_paypal_ref on public.transactions;
create trigger stamp_paypal_ref before insert on public.transactions
  for each row execute function public.stamp_paypal_ref();
drop trigger if exists stamp_paypal_ref on public.coin_purchases;
create trigger stamp_paypal_ref before insert on public.coin_purchases
  for each row execute function public.stamp_paypal_ref();

-- Same as 20261003000005, plus the capture id for the rows the purchase creates.
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
  -- stamp_paypal_ref writes it on the sale or the Créditos purchase.
  perform set_config('fansreserve.paypal_ref', p_capture_id, true);

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
  perform set_config('fansreserve.paypal_ref', '', true);
  update public.paypal_orders
    set status = 'completed', capture_id = p_capture_id, completed_at = now(), error = null
    where id = o.id;
end;
$$;
revoke execute on function public.paypal_fulfill(text, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.paypal_fulfill(text, uuid, text, numeric) to service_role;

-- Payments made before this migration: link them to their capture.
update public.transactions t set paypal_ref = o.capture_id
  from public.paypal_orders o
  where o.status = 'completed' and o.kind = 'booking' and o.capture_id is not null
    and t.paypal_ref is null and t.key = 'vip:' || (o.params->>'bookingId');
update public.transactions t set paypal_ref = o.capture_id
  from public.paypal_orders o
  where o.status = 'completed' and o.kind = 'tip' and o.capture_id is not null
    and t.paypal_ref is null and t.kind = 'tip' and t.payer_id = o.user_id
    and t.creator_profile_id = o.params->>'creatorProfileId' and t.amount = o.amount
    and t.created_at between o.created_at and coalesce(o.completed_at, o.created_at) + interval '5 minutes';
update public.coin_purchases c set paypal_ref = o.capture_id
  from public.paypal_orders o
  where o.status = 'completed' and o.kind = 'coins' and o.capture_id is not null
    and c.paypal_ref is null and c.user_id = o.user_id and c.pack_id = o.params->>'packId' and c.price = o.amount
    and c.created_at between o.created_at and coalesce(o.completed_at, o.created_at) + interval '5 minutes';

-- ---------------------------------------------------------------------
-- 1. Refunds and disputes
-- ---------------------------------------------------------------------
-- p_ref: a PayPal capture id (Créditos, tips, Reserve) or a subscription sale id.
-- p_action: 'refund' (money went back to the fan), 'dispute' (frozen while PayPal
-- decides) or 'release' (the dispute ended in the seller's favour). Idempotent.
-- Returns {matched, subscription}: the PayPal subscription of a refunded payment,
-- which the server then cancels at PayPal.
create or replace function public.paypal_money_back(p_ref text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to text;
  v_from text[];
  v_n int;
  v_hits int := 0;
  v_fan uuid;
  v_sub text;
  g record;
begin
  if coalesce(p_ref, '') = '' or p_action not in ('refund', 'dispute', 'release') then
    raise exception 'Aviso de PayPal no válido';
  end if;
  v_to := case p_action when 'refund' then 'refunded' when 'dispute' then 'disputed' else 'paid' end;
  v_from := case p_action when 'refund' then array['paid', 'disputed'] when 'dispute' then array['paid'] else array['disputed'] end;

  select split_part(t.key, ':', 2) into v_sub from public.transactions t
    where t.key like 'paypal-sub:%' and split_part(t.key, ':', 3) = p_ref limit 1;

  -- Tips, Reserve and subscription payments (the referral bonus follows through sync_invite_bonus).
  update public.transactions t set status = v_to
    where (t.paypal_ref = p_ref or (t.key like 'paypal-sub:%' and split_part(t.key, ':', 3) = p_ref))
      and t.kind <> 'referral' and t.status = any (v_from);
  get diagnostics v_n = row_count;
  v_hits := v_hits + v_n;

  if p_action = 'refund' then
    -- A refunded Reserve is off; a refunded subscription payment ends access now.
    update public.vip_bookings b set status = 'cancelled', updated_at = now()
      where b.status in ('accepted', 'confirmed')
        and exists (select 1 from public.transactions t
                    where t.paypal_ref = p_ref and t.key = 'vip:' || b.id::text);
    if v_sub is not null then
      update public.paypal_subscriptions set status = 'ended' where id = v_sub;
      update public.subscriptions set cancel_at = least(coalesce(cancel_at, 'infinity'::timestamptz), now())
        where paypal_subscription_id = v_sub;
    end if;
    update public.paypal_orders set status = 'refunded' where capture_id = p_ref and status = 'completed';
  end if;

  -- Créditos: the purchase stops counting, and so do the gifts already paid with it.
  update public.coin_purchases c set status = v_to
    where c.paypal_ref = p_ref and c.status = any (v_from)
    returning c.user_id into v_fan;
  get diagnostics v_n = row_count;
  v_hits := v_hits + v_n;

  if p_action = 'release' then
    update public.transactions set status = 'paid', reversed_by = null
      where reversed_by = p_ref and kind = 'gift' and status = 'disputed';
  elsif p_action = 'refund' then
    update public.transactions set status = 'refunded'
      where reversed_by = p_ref and kind = 'gift' and status = 'disputed';
  end if;
  if v_fan is not null and p_action <> 'release' then
    for g in select t.id from public.transactions t
             where t.payer_id = v_fan and t.kind = 'gift' and t.status = 'paid'
             order by t.created_at desc, t.id desc loop
      exit when public.coin_balance(v_fan) >= 0;
      update public.transactions set status = v_to, reversed_by = p_ref where id = g.id;
    end loop;
  end if;

  return jsonb_build_object('matched', v_hits, 'subscription', case when p_action = 'refund' then v_sub end);
end;
$$;
revoke execute on function public.paypal_money_back(text, text) from public, anon, authenticated;
grant execute on function public.paypal_money_back(text, text) to service_role;

-- ---------------------------------------------------------------------
-- 2. Paying yourself
-- ---------------------------------------------------------------------
create or replace function public.same_person_pays(p_fan uuid, p_creator_profile_id text, p_payer_email text default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.profiles;
  c public.profiles;
  v_payout text;
  v_payer text := nullif(lower(trim(coalesce(p_payer_email, ''))), '');
  vf public.identity_verifications;
  vc public.identity_verifications;
begin
  select * into c from public.profiles where creator_profile_id = p_creator_profile_id and role = 'creator' limit 1;
  if c.id is null or p_fan is null then
    return false; -- profiles run by the platform
  end if;
  if c.id = p_fan then
    return true;
  end if;
  select * into f from public.profiles where id = p_fan;
  select nullif(lower(trim(coalesce(a.paypal_email, ''))), '') into v_payout from public.payout_accounts a where a.user_id = c.id;
  -- Paying with the PayPal account the creator signs in with or withdraws to.
  if v_payer is not null and (v_payer = lower(c.email) or v_payer = v_payout) then
    return true;
  end if;
  if v_payout is not null and lower(f.email) = v_payout then
    return true;
  end if;
  if nullif(trim(coalesce(f.phone, '')), '') is not null and f.phone = c.phone then
    return true;
  end if;
  select * into vf from public.identity_verifications where user_id = f.id and status = 'approved';
  select * into vc from public.identity_verifications where user_id = c.id and status = 'approved';
  if vf.id is not null and vc.id is not null and vf.birth_date = vc.birth_date
     and lower(regexp_replace(trim(vf.legal_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(vc.legal_name), '\s+', ' ', 'g'))
     and trim(vf.legal_name) <> '' then
    return true;
  end if;
  return false;
end;
$$;
revoke execute on function public.same_person_pays(uuid, text, text) from public, anon, authenticated;
grant execute on function public.same_person_pays(uuid, text, text) to service_role;

-- What the server checks before PayPal charges, and again with the payer's PayPal email.
create or replace function public.paypal_self_pay(p_user uuid, p_kind text, p_params jsonb, p_payer_email text default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_creator text;
begin
  if p_kind = 'booking' then
    select creator_profile_id into v_creator from public.vip_bookings where id = (p_params->>'bookingId')::uuid;
  elsif p_kind in ('tip', 'subscription') then
    v_creator := p_params->>'creatorProfileId';
  end if;
  return v_creator is not null and public.same_person_pays(p_user, v_creator, p_payer_email);
end;
$$;
revoke execute on function public.paypal_self_pay(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.paypal_self_pay(uuid, text, jsonb, text) to service_role;

-- The last word: no sale or gift between two accounts of the same person.
create or replace function public.guard_self_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payer_id is not null and new.kind in ('subscription', 'renewal', 'tip', 'vip', 'gift')
     and public.same_person_pays(new.payer_id, new.creator_profile_id) then
    raise exception 'No puedes pagarte a ti mismo: esta cuenta y la del creador son de la misma persona.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_self_payment() from public, anon, authenticated;

drop trigger if exists guard_self_payment on public.transactions;
create trigger guard_self_payment before insert on public.transactions
  for each row execute function public.guard_self_payment();
