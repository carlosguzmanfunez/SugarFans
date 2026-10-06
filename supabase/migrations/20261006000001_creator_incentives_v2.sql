-- Creator incentives v2 (analysis /mnt/project-files/incentivos/analisis-incentivos.md,
-- approved by Carlos on 2026-10-05). Mirrors src/lib/rewardRules.ts and
-- src/lib/experienceGoalRules.ts: keep both in sync.
--
--  * The creator's cut is taken from the NET of a payment: first the payment
--    processor's fee (PayPal's real fee when we know it, else 5.4% + $0.30), then
--    the creator's rate. Applies to subscriptions, renewals, tips and Reserve.
--    transactions.creator_share keeps being the fraction of the gross amount, so
--    every balance and payout keeps working unchanged.
--  * Rates: Bronce, Plata and Oro 80%; Diamante 83%. Fans who signed up with the
--    creator's link: 85% for 60 days. Nothing goes above 90% of the net.
--  * Levels by active fans (link fans count twice) OR sales in the last 30 days:
--    Plata 10 / $250, Oro 50 / $1,000, Diamante 200 / $5,000. Plata and up need no
--    report against them confirmed in 90 days; Oro and Diamante also answer at
--    least 95% of their Reserve requests (counted from 5 requests in 90 days).
--  * Monthly cash goals are gone (reward_goal_bonus is 0). They became medals
--    that give visibility: Primer Reserve, Imán de fans, Puntual, Constante, Embajador.
--  * Level benefits: Plata "En ascenso" in Explorar and Reserve Events up to 20
--    seats (Bronce 10); Oro featured, withdrawals from $25, events up to 50 seats;
--    Diamante also has its withdrawal fee paid by Fans Reserve.
--  * Creator invites: 5% of the invited creator's net sales for one month, once
--    the inviter has 2 invited creators who are verified and sold $100; at most
--    $100 per invited creator.
--  * Special accounts keep Reserve al neto, minus a 5% service fee.
--  * Minimums: subscriptions from $4.99, tips from $3.
--  * Meta de experiencia: each fan fills the creator's goal with gifts and tips;
--    a full goal gives a ticket for one of the creator's experiences (the fan
--    picks it) plus a free extra from an all-win wheel; the fan books it choosing
--    only date and time. Tickets last 60 days.
--
-- Idempotent: safe to run again.

-- =====================================================================
-- 1. Processor fee and the net cut
-- =====================================================================
alter table public.transactions add column if not exists gateway_fee numeric(10, 2);
alter table public.transactions add column if not exists service_fee numeric(10, 2);

-- PayPal's usual rate for international commercial payments.
create or replace function public.gateway_fee_estimate(p_amount numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(p_amount * 0.054 + 0.30, 2);
$$;

-- What the processor kept from one sale: PayPal's real fee for a Reserve payment
-- when it reported it, otherwise the estimate. Never more than the sale.
create or replace function public.sale_gateway_fee(p_kind text, p_key text, p_amount numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fee numeric;
begin
  if p_amount is null or p_amount <= 0 then
    return 0;
  end if;
  if p_kind = 'vip' and p_key like 'vip:%' then
    select o.fee into v_fee from public.paypal_orders o
      where o.kind = 'booking' and o.params ->> 'bookingId' = substr(p_key, 5) and o.fee is not null
      order by o.created_at desc limit 1;
  end if;
  return least(p_amount, coalesce(v_fee, public.gateway_fee_estimate(p_amount)));
end;
$$;

-- =====================================================================
-- 2. Levels
-- =====================================================================
-- Active fans in the last 30 days; fans who signed up with the creator's link count twice.
create or replace function public.reward_active_fans(p_creator text, p_at timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with payers as (
    select distinct t.payer_id from public.transactions t
    where t.creator_profile_id = p_creator and t.status = 'paid' and t.payer_id is not null
      and t.kind <> 'referral' and t.created_at > p_at - interval '30 days' and t.created_at <= p_at
  )
  select (count(*) + count(*) filter (where exists (
    select 1 from public.referrals r where r.fan_id = payers.payer_id and r.creator_profile_id = p_creator)))::int
  from payers;
$$;

-- What fans paid the creator in the last 30 days (gross).
create or replace function public.reward_sales(p_creator text, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(t.amount), 0) from public.transactions t
  where t.creator_profile_id = p_creator and t.status = 'paid' and t.kind <> 'referral'
    and t.created_at > p_at - interval '30 days' and t.created_at <= p_at;
$$;

-- No report against the creator confirmed by the team in the last 90 days.
create or replace function public.reward_clean(p_creator text, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.reports r
    where r.kind = 'creator' and r.target_id = p_creator and r.status = 'resolved'
      and coalesce(r.resolved_at, r.created_at) > p_at - interval '90 days');
$$;

-- Answers at least 95% of the Reserve requests of the last 90 days (from 5 requests on).
create or replace function public.reward_reliable(p_creator text, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < 5 or count(*) filter (where b.status in ('expired', 'disputed')) <= count(*) * 0.05
  from public.vip_bookings b
  where b.creator_profile_id = p_creator and b.created_at > p_at - interval '90 days' and b.created_at <= p_at
    and b.status in ('accepted', 'confirmed', 'completed', 'rejected', 'expired', 'disputed');
$$;

create or replace function public.reward_level_for(p_creator text, p_at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fans int := public.reward_active_fans(p_creator, p_at);
  v_sales numeric := public.reward_sales(p_creator, p_at);
  v_clean boolean;
  v_reliable boolean;
begin
  if v_fans < 10 and v_sales < 250 then
    return 'bronce';
  end if;
  v_clean := public.reward_clean(p_creator, p_at);
  if not v_clean then
    return 'bronce';
  end if;
  v_reliable := public.reward_reliable(p_creator, p_at);
  if v_reliable and (v_fans >= 200 or v_sales >= 5000) then
    return 'diamante';
  elsif v_reliable and (v_fans >= 50 or v_sales >= 1000) then
    return 'oro';
  end if;
  return 'plata';
end;
$$;

create or replace function public.reward_level_share(p_level text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_level when 'diamante' then 0.83 else 0.80 end;
$$;

-- Monthly cash goals were replaced by medals.
create or replace function public.reward_goal_bonus(p_attracted int)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 0::numeric;
$$;

-- The creator's rate for fans who didn't come through their link.
create or replace function public.reward_base_share(p_creator text, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select public.reward_level_share(public.reward_level_for(p_creator, p_at));
$$;

-- The creator's rate (share of the net) for one fan's payment.
create or replace function public.reward_share(p_creator text, p_fan uuid, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_fan is not null and exists (
      select 1 from public.referrals r
      where r.fan_id = p_fan and r.creator_profile_id = p_creator and p_at - r.joined_at < interval '60 days')
      then greatest(0.85, public.reward_base_share(p_creator, p_at))
    else public.reward_base_share(p_creator, p_at)
  end;
$$;

-- Every subscription, renewal, tip and Reserve payment records the processor's fee
-- and the creator's cut of what is left. Special accounts (set_special_share,
-- which runs after this trigger) replace the cut of their Reserve payments.
create or replace function public.set_reward_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee numeric;
  v_rate numeric;
begin
  if new.kind in ('subscription', 'renewal', 'tip', 'vip') and new.amount > 0 then
    v_fee := public.sale_gateway_fee(new.kind, new.key, new.amount);
    v_rate := least(0.90, public.reward_share(new.creator_profile_id, new.payer_id, new.created_at));
    new.gateway_fee := v_fee;
    new.creator_share := greatest(0, round(v_rate * (new.amount - v_fee) / new.amount, 4));
  end if;
  return new;
end;
$$;

drop trigger if exists set_reward_share on public.transactions;
create trigger set_reward_share
  before insert on public.transactions
  for each row execute function public.set_reward_share();

-- =====================================================================
-- 3. Special accounts: Reserve al neto minus a 5% service fee
-- =====================================================================
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
  v_service := least(new.amount - v_fee, round(new.amount * 0.05, 2));
  v_tax := least(new.amount - v_fee - v_service, round(new.amount * s.tax_rate, 2));
  new.gateway_fee := v_fee;
  new.service_fee := v_service;
  new.tax_amount := v_tax;
  new.creator_share := greatest(0, least(1, round((new.amount - v_fee - v_service - v_tax) / new.amount, 4)));
  return new;
end;
$$;

-- =====================================================================
-- 4. Creator invites
-- =====================================================================
-- When an invited creator qualified: verified and $100 sold (the sale that reached it).
create or replace function public.invite_qualified_at(p_creator_profile_id text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from public.profiles p where p.creator_profile_id = p_creator_profile_id and p.is_verified)
    then (select min(x.created_at) from (
            select t.created_at, sum(t.amount) over (order by t.created_at, t.id) as total
            from public.transactions t
            where t.creator_profile_id = p_creator_profile_id and t.status = 'paid' and t.kind <> 'referral') x
          where x.total >= 100)
  end;
$$;

-- The bonus month of one invited creator: it starts once the inviter has 2 qualified
-- invited creators (or when this one qualifies, if later) and lasts one month.
create or replace function public.invite_window(p_creator_profile_id text, out from_at timestamptz, out until_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.creator_invites;
  v_mine timestamptz;
  v_second timestamptz;
begin
  select * into v_inv from public.creator_invites where creator_profile_id = p_creator_profile_id;
  if v_inv.creator_id is null then
    return;
  end if;
  v_mine := public.invite_qualified_at(p_creator_profile_id);
  if v_mine is null then
    return;
  end if;
  select q into v_second from (
    select public.invite_qualified_at(i.creator_profile_id) as q
    from public.creator_invites i where i.referrer_profile_id = v_inv.referrer_profile_id) x
  where q is not null order by q offset 1 limit 1;
  if v_second is null then
    return;
  end if;
  from_at := greatest(v_mine, v_second);
  until_at := from_at + interval '1 month';
end;
$$;

create or replace function public.add_invite_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referrer text;
  v_window record;
  v_net numeric;
  v_rate numeric;
  v_paid numeric;
  v_amount numeric;
begin
  if new.kind not in ('subscription', 'renewal', 'tip') or new.status <> 'paid' or new.amount <= 0 then
    return new;
  end if;
  select referrer_profile_id into v_referrer from public.creator_invites where creator_profile_id = new.creator_profile_id;
  if v_referrer is null then
    return new;
  end if;
  select * into v_window from public.invite_window(new.creator_profile_id);
  if v_window.from_at is null or new.created_at < v_window.from_at or new.created_at >= v_window.until_at then
    return new;
  end if;
  v_net := new.amount - coalesce(new.gateway_fee, public.gateway_fee_estimate(new.amount));
  if v_net <= 0 then
    return new;
  end if;
  -- Creator and inviter together never take more than 90% of the net.
  v_rate := new.amount * new.creator_share / v_net;
  select coalesce(sum(b.amount), 0) into v_paid from public.transactions b
    join public.transactions s on b.key = 'bonus:' || s.id
    where b.creator_profile_id = v_referrer and b.kind = 'referral' and b.status = 'paid'
      and s.creator_profile_id = new.creator_profile_id;
  v_amount := least(greatest(0, 100 - v_paid), round(v_net * greatest(0, least(0.05, 0.90 - v_rate)), 2));
  if v_amount < 0.01 then
    return new;
  end if;
  insert into public.transactions
    (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, note, creator_share, created_at)
  values ('bonus:' || new.id, null, 'Fans Reserve', v_referrer,
          coalesce((select name from public.profiles where creator_profile_id = v_referrer limit 1), 'Creador'),
          'referral', v_amount, 'Bono de invitación', 'paid', 'Por ' || new.creator_name, 1, new.created_at)
  on conflict do nothing;
  return new;
end;
$$;

-- =====================================================================
-- 5. Medals (worked out from activity, nothing stored)
-- =====================================================================
create or replace function public.creator_medal_state(p_creator text, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first timestamptz;
  v_answered text[];
  v_weeks int := 0;
  v_k int;
  v_tier int := 0;
  v_until timestamptz;
  v_reached timestamptz;
  v_month int;
  v_n int;
  v_days int;
  v_invites int;
  v_boost timestamptz;
  v_reason text;
begin
  -- Primer Reserve: the first experience that took place.
  select min((b.date + b.time::time) at time zone 'utc') into v_first from public.vip_bookings b
    where b.creator_profile_id = p_creator and b.status in ('confirmed', 'completed')
      and (b.date + b.time::time) at time zone 'utc' < p_at;

  -- Puntual: the last 20 requests that needed an answer, none left to expire.
  select array_agg(status) into v_answered from (
    select b.status from public.vip_bookings b
    where b.creator_profile_id = p_creator and b.created_at <= p_at
      and b.status in ('accepted', 'confirmed', 'completed', 'rejected', 'expired', 'disputed')
    order by b.created_at desc limit 20) x;

  -- Constante: a subscriber Live in each of the last 4 weeks.
  for v_k in 0..3 loop
    exit when not exists (
      select 1 from public.live_broadcasts l
      where l.creator_profile_id = p_creator and l.mode = 'subscriber'
        and l.started_at > p_at - make_interval(days => 7 * (v_k + 1)) and l.started_at <= p_at - make_interval(days => 7 * v_k));
    v_weeks := v_weeks + 1;
  end loop;

  -- Imán de fans: 10 / 25 / 50 link fans who paid, joined in one month (this or last).
  for v_month in -1..0 loop
    foreach v_n in array array[10, 25, 50] loop
      select first_paid into v_reached from (
        select (select min(t.created_at) from public.transactions t
                where t.payer_id = r.fan_id and t.creator_profile_id = p_creator and t.status = 'paid') as first_paid
        from public.referrals r
        where r.creator_profile_id = p_creator
          and r.joined_at >= public.reward_month_start(p_at, v_month) and r.joined_at < public.reward_month_start(p_at, v_month + 1)) x
      where first_paid is not null and first_paid <= p_at
      order by first_paid offset v_n - 1 limit 1;
      exit when v_reached is null;
      v_days := case v_n when 10 then 2 when 25 then 5 else 7 end;
      if v_until is null or v_reached + make_interval(days => v_days) > v_until then
        v_until := v_reached + make_interval(days => v_days);
      end if;
      v_tier := greatest(v_tier, case v_n when 10 then 1 when 25 then 2 else 3 end);
    end loop;
  end loop;

  -- Embajador: invited creators who are verified and sold $100.
  select count(*) into v_invites from public.creator_invites i
    where i.referrer_profile_id = p_creator and public.invite_qualified_at(i.creator_profile_id) <= p_at;

  -- Featured while a medal's boost lasts.
  if v_first is not null and p_at < v_first + interval '2 days' then
    v_boost := v_first + interval '2 days'; v_reason := 'primer-reserve';
  end if;
  if v_until is not null and p_at < v_until and (v_boost is null or v_until > v_boost) then
    v_boost := v_until; v_reason := 'iman';
  end if;
  if v_weeks >= 4 and v_boost is null then
    v_boost := p_at + interval '1 day'; v_reason := 'constante';
  end if;

  return jsonb_build_object(
    'first_reserve_at', v_first,
    'puntual_count', coalesce(array_length(v_answered, 1), 0),
    'puntual', coalesce(array_length(v_answered, 1), 0) >= 20
               and not (v_answered && array['expired', 'disputed']),
    'live_weeks', v_weeks,
    'constante', v_weeks >= 4,
    'iman_tier', v_tier,
    'iman_until', v_until,
    'qualified_invites', v_invites,
    'embajador', v_invites >= 2,
    'boost_until', v_boost,
    'boost_reason', v_reason
  );
end;
$$;

-- Public: level and the medals fans see on a profile.
create or replace function public.creator_badges(p_ids text[])
returns table (creator_profile_id text, level text, puntual boolean, constante boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select id, public.reward_level_for(id, now()),
         (m ->> 'puntual')::boolean, (m ->> 'constante')::boolean
  from unnest(p_ids[1:60]) as id
  cross join lateral public.creator_medal_state(id, now()) as m;
$$;

create or replace function public.creator_levels(p_ids text[])
returns table (creator_profile_id text, level text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, public.reward_level_for(id, now()) from unnest(p_ids[1:100]) as id;
$$;

-- Public: new paying fans of each creator this month (for the category ranking).
create or replace function public.monthly_new_fans()
returns table (creator_profile_id text, new_fans int)
language sql
stable
security definer
set search_path = ''
as $$
  select f.creator_profile_id, count(*)::int from (
    select t.creator_profile_id, t.payer_id, min(t.created_at) as first_at
    from public.transactions t
    where t.status = 'paid' and t.payer_id is not null and t.kind <> 'referral'
    group by t.creator_profile_id, t.payer_id) f
  where f.first_at >= public.reward_month_start(now())
  group by f.creator_profile_id
  order by count(*) desc
  limit 300;
$$;

-- Public: special accounts first, then Oro and Diamante, then creators with a
-- medal boost, then Plata ("En ascenso").
drop function if exists public.featured_creators();
create function public.featured_creators()
returns table (creator_profile_id text, level text, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with special as (
    select s.creator_profile_id as id, row_number() over (order by s.since) as pos
    from public.special_accounts s
    where s.featured and s.revoked_at is null
    order by s.since
    limit 8
  ), candidates as (
    select distinct t.creator_profile_id as id from public.transactions t
    where t.status = 'paid' and t.created_at > now() - interval '30 days'
    union
    select distinct r.creator_profile_id from public.referrals r
    where r.joined_at >= public.reward_month_start(now(), -1)
    union
    select distinct b.creator_profile_id from public.vip_bookings b
    where b.status in ('confirmed', 'completed') and b.date >= current_date - 3
    union
    select distinct l.creator_profile_id from public.live_broadcasts l
    where l.mode = 'subscriber' and l.started_at > now() - interval '28 days'
  ), scored as (
    select c.id, public.reward_active_fans(c.id, now()) as fans, public.reward_level_for(c.id, now()) as level,
           (public.creator_medal_state(c.id, now()) ->> 'boost_until')::timestamptz as boost
    from candidates c
    where c.id not in (select id from special)
  ), grouped as (
    select id, level, fans,
           case when level in ('oro', 'diamante') then 'level'
                when boost > now() then 'medal'
                when level = 'plata' then 'rising' end as reason
    from scored
  ), ranked as (
    select *, row_number() over (partition by reason order by fans desc, id) as pos
    from grouped where reason is not null
  )
  select id, level, reason from (
    select s.id, public.reward_level_for(s.id, now()) as level, 'special' as reason, 0 as grp, s.pos from special s
    union all
    select r.id, r.level, r.reason, case r.reason when 'level' then 1 when 'medal' then 2 else 3 end, r.pos
    from ranked r where r.pos <= 8
  ) x
  order by grp, pos;
$$;

-- =====================================================================
-- 6. The creator's dashboard
-- =====================================================================
create or replace function public.my_creator_rewards()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id text := public.my_creator_profile_id();
  v_level text;
begin
  if v_id is null then
    raise exception 'Solo los creadores tienen recompensas';
  end if;
  v_level := public.reward_level_for(v_id, now());
  return jsonb_build_object(
    'level', v_level,
    'active_fans', public.reward_active_fans(v_id, now()),
    'sales', public.reward_sales(v_id, now()),
    'clean', public.reward_clean(v_id, now()),
    'reliable', public.reward_reliable(v_id, now()),
    'share', public.reward_level_share(v_level),
    'bonus', 0,
    'attracted_this_month', public.reward_attracted(v_id, public.reward_month_start(now()), public.reward_month_start(now(), 1)),
    'attracted_last_month', public.reward_attracted(v_id, public.reward_month_start(now(), -1), public.reward_month_start(now())),
    'medals', public.creator_medal_state(v_id, now()),
    'referrals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.name,
        'joined_at', r.joined_at,
        'paid', exists (select 1 from public.transactions t
                        where t.payer_id = r.fan_id and t.creator_profile_id = v_id and t.status = 'paid'),
        'referral_until', r.joined_at + interval '60 days'
      ) order by r.joined_at desc)
      from public.referrals r join public.profiles p on p.id = r.fan_id
      where r.creator_profile_id = v_id), '[]'::jsonb),
    'invited_creators', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.name,
        'joined_at', i.joined_at,
        'qualified_at', public.invite_qualified_at(i.creator_profile_id),
        'from', w.from_at,
        'until', w.until_at,
        'bonus', coalesce((select sum(b.amount) from public.transactions b
                           join public.transactions s on b.key = 'bonus:' || s.id
                           where b.creator_profile_id = v_id and b.kind = 'referral' and b.status = 'paid'
                             and s.creator_profile_id = i.creator_profile_id), 0)
      ) order by i.joined_at desc)
      from public.creator_invites i
      join public.profiles p on p.id = i.creator_id
      cross join lateral public.invite_window(i.creator_profile_id) w
      where i.referrer_profile_id = v_id), '[]'::jsonb)
  );
end;
$$;

-- =====================================================================
-- 7. Withdrawals: from $25 for Oro and Diamante; Diamante's fee is on us
-- =====================================================================
create or replace function public.payout_min(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.reward_level_for(p.creator_profile_id, now()) in ('oro', 'diamante') then 25 else 50 end::numeric
  from public.profiles p where p.id = p_user;
$$;

create or replace function public.payout_fee_for(p_user uuid, p_amount numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.reward_level_for(p.creator_profile_id, now()) = 'diamante' then 0 else public.payout_fee(p_amount) end
  from public.profiles p where p.id = p_user;
$$;

create or replace function public.payout_checks(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_email text;
  v_available numeric;
  v_min numeric;
begin
  select * into v_me from public.profiles where id = p_user for update;
  if v_me.id is null or v_me.role <> 'creator' then
    raise exception 'Solo los creadores pueden retirar';
  end if;
  if not v_me.is_verified then
    raise exception 'Verifica tu identidad antes de solicitar un retiro';
  end if;
  select paypal_email into v_email from public.payout_accounts where user_id = v_me.id;
  if v_email is null then
    raise exception 'Añade el email de tu cuenta PayPal para retiros';
  end if;
  if exists (select 1 from public.payouts where user_id = v_me.id and status = 'sending') then
    raise exception 'Tienes un retiro en camino; espera a que PayPal lo confirme';
  end if;
  v_available := public.creator_available_balance(v_me.id);
  v_min := public.payout_min(v_me.id);
  if v_available < v_min then
    raise exception 'Necesitas al menos $% USD acreditados para retirar; tu saldo disponible es $%',
      to_char(v_min, 'FM999,990.00'), to_char(v_available, 'FM999,999,990.00');
  end if;
  return v_email;
end;
$$;

create or replace function public.paypal_payout_start(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.payout_checks(p_user);
  v_available numeric := public.creator_available_balance(p_user);
  v_fee numeric := public.payout_fee_for(p_user, v_available);
  v_id uuid;
begin
  insert into public.payouts (user_id, creator_name, amount, fee, net, account_label, available_before, status, paid_at, scheduled_for)
  values (p_user, (select name from public.profiles where id = p_user), v_available, v_fee, v_available - v_fee,
          public.payout_label(v_email), v_available, 'sending', null, current_date)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'amount', v_available, 'fee', v_fee, 'net', v_available - v_fee, 'email', v_email);
end;
$$;

create or replace function public.request_payout()
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.payout_checks(auth.uid());
  v_available numeric := public.creator_available_balance(auth.uid());
  v_fee numeric := public.payout_fee_for(auth.uid(), v_available);
begin
  insert into public.payouts (user_id, creator_name, amount, fee, net, account_label, available_before, status, paid_at, scheduled_for)
  values (auth.uid(), (select name from public.profiles where id = auth.uid()), v_available, v_fee, v_available - v_fee,
          public.payout_label(v_email), v_available, 'paid', now(), current_date);
  return v_available;
end;
$$;

-- Public, for the creator's own panel.
create or replace function public.my_payout_terms()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('min', public.payout_min(auth.uid()),
                            'fee_waived', public.reward_level_for(p.creator_profile_id, now()) = 'diamante')
  from public.profiles p where p.id = auth.uid() and p.creator_profile_id is not null;
$$;

-- =====================================================================
-- 8. Reserve Event seats by level: Bronce 10, Plata 20, Oro and Diamante 50
-- =====================================================================
create or replace function public.event_seat_cap(p_creator text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case public.reward_level_for(p_creator, now()) when 'bronce' then 10 when 'plata' then 20 else 50 end;
$$;

create or replace function public.check_reserve_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats int;
  v_cap int;
begin
  if coalesce(new.details->>'format', '') <> 'event' then
    return new;
  end if;
  if coalesce(new.details->>'eventDate', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(new.details->>'eventTime', '') !~ '^\d{2}:\d{2}$' then
    raise exception 'Indica la fecha y la hora del evento';
  end if;
  v_seats := coalesce((new.details->>'maxParticipants')::int, 0);
  if v_seats not between 2 and 50 then
    raise exception 'Un Reserve Event tiene entre 2 y 50 plazas';
  end if;
  -- Only when the seats are set or changed: an event saved earlier keeps its seats.
  if tg_op = 'INSERT' or (old.details->>'maxParticipants') is distinct from (new.details->>'maxParticipants') then
    v_cap := public.event_seat_cap(new.creator_profile_id);
    if v_seats > v_cap then
      raise exception 'Con tu nivel actual un Reserve Event tiene hasta % plazas', v_cap;
    end if;
  end if;
  if new.duration_minutes is null then
    raise exception 'Indica la duración del evento';
  end if;
  return new;
end;
$$;

-- =====================================================================
-- 9. Minimum prices: subscriptions from $4.99, tips from $3
-- =====================================================================
update public.profiles set subscription_price = 4.99 where subscription_price < 4.99;
update public.managed_profiles set subscription_price = 4.99 where subscription_price < 4.99;
alter table public.profiles drop constraint if exists profiles_subscription_price_check;
alter table public.profiles add constraint profiles_subscription_price_check
  check (subscription_price is null or (subscription_price >= 4.99 and subscription_price <= 999));
alter table public.managed_profiles drop constraint if exists managed_profiles_subscription_price_check;
alter table public.managed_profiles add constraint managed_profiles_subscription_price_check
  check (subscription_price between 4.99 and 999);

create or replace function public.send_tip(p_creator_profile_id text, p_creator_name text, p_amount numeric, p_method_id uuid, p_post_id text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_method public.payment_methods;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if public.creator_price(p_creator_profile_id) is null then
    raise exception 'Creador no encontrado';
  end if;
  if v_me.creator_profile_id = p_creator_profile_id then
    raise exception 'No puedes enviarte una propina a ti mismo';
  end if;
  select * into v_method from public.payment_methods where id = p_method_id and user_id = v_me.id;
  if v_method.id is null then
    raise exception 'Elige un método de pago';
  end if;
  if p_amount is null or p_amount < 3 or p_amount > 500 then
    raise exception 'La propina debe estar entre $3 y $500';
  end if;
  if public.is_cut_off(v_me.id, p_creator_profile_id) then
    raise exception 'No puedes enviar propinas a este perfil';
  end if;
  insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, note)
  values ('tip:' || v_me.id || ':' || gen_random_uuid(), v_me.id, v_me.name, p_creator_profile_id, p_creator_name, 'tip',
          round(p_amount, 2), v_method.label, 'paid',
          nullif(left(trim(coalesce(p_message, '')), 200), '') );
end;
$$;

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

-- =====================================================================
-- 10. Meta de experiencia
-- =====================================================================
create table if not exists public.experience_goals (
  creator_profile_id text primary key,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  enabled boolean not null default true,
  target numeric(10, 2) not null check (target between 20 and 2000),
  experience_ids text[] not null default '{}',
  since timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.experience_goals enable row level security;
drop policy if exists "experience_goals: anyone reads" on public.experience_goals;
create policy "experience_goals: anyone reads" on public.experience_goals
  for select to anon, authenticated using (true);
revoke insert, update, delete on public.experience_goals from anon, authenticated;

create table if not exists public.experience_tickets (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references public.profiles (id) on delete cascade,
  creator_profile_id text not null,
  experience_id text not null,
  experience_title text not null,
  amount numeric(10, 2) not null,
  bonus text not null check (bonus in ('extra-time', 'live-shoutout', 'thank-you', 'photo')),
  status text not null default 'active' check (status in ('active', 'reserved', 'used')),
  booking_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days'
);

create index if not exists experience_tickets_fan_idx on public.experience_tickets (fan_id, creator_profile_id);
create index if not exists experience_tickets_creator_idx on public.experience_tickets (creator_profile_id);

alter table public.experience_tickets enable row level security;
drop policy if exists "experience_tickets: fan or creator reads" on public.experience_tickets;
create policy "experience_tickets: fan or creator reads" on public.experience_tickets
  for select to authenticated
  using (fan_id = (select auth.uid()) or creator_profile_id = (select public.my_creator_profile_id()));
revoke insert, update, delete on public.experience_tickets from anon, authenticated;

-- The creator turns the goal on or off, sets its size and the experiences it offers.
create or replace function public.save_experience_goal(p_enabled boolean, p_target numeric, p_experience_ids text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := public.my_creator_profile_id();
  v_ids text[] := coalesce(p_experience_ids, '{}');
begin
  if v_id is null then
    raise exception 'Solo los creadores pueden crear una Meta de experiencia';
  end if;
  if p_target is null or p_target < 20 or p_target > 2000 then
    raise exception 'La meta debe estar entre $20 y $2,000';
  end if;
  if p_enabled and cardinality(v_ids) = 0 then
    raise exception 'Elige al menos una experiencia para tu meta';
  end if;
  if exists (select 1 from unnest(v_ids) as x(id)
             where not exists (select 1 from public.vip_experiences e
                               where e.id = x.id and e.creator_profile_id = v_id and e.active
                                 and coalesce(e.details->>'format', '') <> 'event')) then
    raise exception 'Elige experiencias activas de tu Reserve (no eventos)';
  end if;
  insert into public.experience_goals (creator_profile_id, creator_id, enabled, target, experience_ids)
  values (v_id, auth.uid(), p_enabled, round(p_target, 2), v_ids)
  on conflict (creator_profile_id) do update
    set enabled = excluded.enabled, target = excluded.target, experience_ids = excluded.experience_ids, updated_at = now();
end;
$$;

-- What a fan has put into a creator's goal and not yet turned into tickets.
create or replace function public.experience_goal_progress(p_fan uuid, p_creator text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0,
    coalesce((select sum(t.amount) from public.transactions t
              where t.payer_id = p_fan and t.creator_profile_id = p_creator and t.status = 'paid'
                and t.kind in ('gift', 'tip') and t.created_at >= g.since), 0)
    - coalesce((select sum(k.amount) from public.experience_tickets k
                where k.fan_id = p_fan and k.creator_profile_id = p_creator), 0))
  from public.experience_goals g where g.creator_profile_id = p_creator;
$$;

-- The signed-in fan's view of a creator's goal (null when the creator has none on).
create or replace function public.my_experience_goal(p_creator text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'target', g.target,
    'progress', case when auth.uid() is null then 0 else coalesce(public.experience_goal_progress(auth.uid(), p_creator), 0) end,
    'experiences', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'duration_minutes', e.duration_minutes) order by e.title)
      from public.vip_experiences e where e.id = any (g.experience_ids) and e.active), '[]'::jsonb))
  from public.experience_goals g where g.creator_profile_id = p_creator and g.enabled;
$$;

-- A full goal becomes a ticket for the experience the fan picks, plus a free extra
-- from the wheel (every slot wins).
create or replace function public.claim_experience_ticket(p_creator text, p_experience_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  g public.experience_goals;
  v_exp public.vip_experiences;
  v_bonus text;
  t public.experience_tickets;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into g from public.experience_goals where creator_profile_id = p_creator and enabled for update;
  if g.creator_profile_id is null then
    raise exception 'Este creador no tiene una Meta de experiencia activa';
  end if;
  if v_me.creator_profile_id = p_creator then
    raise exception 'No puedes llenar tu propia meta';
  end if;
  if public.is_cut_off(v_me.id, p_creator) then
    raise exception 'No puedes reservar con este perfil';
  end if;
  if not (p_experience_id = any (g.experience_ids)) then
    raise exception 'Elige una de las experiencias de la meta';
  end if;
  select * into v_exp from public.vip_experiences where id = p_experience_id and creator_profile_id = p_creator and active;
  if v_exp.id is null then
    raise exception 'Esa experiencia ya no está disponible';
  end if;
  if coalesce(public.experience_goal_progress(v_me.id, p_creator), 0) < g.target then
    raise exception 'Todavía no llenas la meta';
  end if;
  v_bonus := (array['extra-time', 'live-shoutout', 'thank-you', 'photo'])[1 + floor(random() * 4)::int];
  insert into public.experience_tickets (fan_id, creator_profile_id, experience_id, experience_title, amount, bonus)
  values (v_me.id, p_creator, v_exp.id, v_exp.title, g.target, v_bonus)
  returning * into t;
  return jsonb_build_object('id', t.id, 'bonus', t.bonus, 'expires_at', t.expires_at, 'experience_title', t.experience_title);
end;
$$;

-- The fan books the ticket's experience choosing only the date and time. The
-- request follows the usual Reserve rules; nothing is charged.
create or replace function public.book_with_ticket(p_ticket_id uuid, p_date date, p_time text, p_message text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.experience_tickets;
  v_id uuid;
  v_status text;
begin
  select * into t from public.experience_tickets where id = p_ticket_id and fan_id = auth.uid() for update;
  if t.id is null then
    raise exception 'Ticket no encontrado';
  end if;
  if t.status <> 'active' then
    raise exception 'Este ticket ya tiene una reserva';
  end if;
  if t.expires_at < now() then
    raise exception 'Este ticket venció';
  end if;
  v_id := public.reserve_create_booking(t.experience_id, p_date, p_time, p_message, 1);
  select status into v_status from public.vip_bookings where id = v_id;
  update public.vip_bookings
    set price = 0,
        details = coalesce(details, '{}'::jsonb) || jsonb_build_object('ticketId', t.id, 'ticketBonus', t.bonus),
        status = case when v_status = 'accepted' then 'confirmed' else status end,
        paid_at = case when v_status = 'accepted' then now() else paid_at end,
        updated_at = now()
    where id = v_id;
  update public.experience_tickets
    set status = case when v_status = 'accepted' then 'used' else 'reserved' end, booking_id = v_id
    where id = t.id;
  return v_id;
end;
$$;

-- A ticket booking needs no payment: accepting it confirms it. A counter-offer
-- isn't possible (the price is the ticket).
create or replace function public.ticket_booking_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (coalesce(new.details, '{}'::jsonb) ? 'ticketId') or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'accepted' then
    new.status := 'confirmed';
    new.paid_at := now();
  elsif new.status = 'countered' then
    raise exception 'Esta reserva usa un ticket de Meta de experiencia: acéptala o recházala';
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_booking_status on public.vip_bookings;
create trigger ticket_booking_status
  before update of status on public.vip_bookings
  for each row execute function public.ticket_booking_status();

-- Confirmed: the ticket is used. Rejected, cancelled or expired: the ticket is free again.
create or replace function public.ticket_booking_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket uuid;
begin
  if not (coalesce(new.details, '{}'::jsonb) ? 'ticketId') or new.status is not distinct from old.status then
    return null;
  end if;
  v_ticket := (new.details->>'ticketId')::uuid;
  if new.status = 'confirmed' then
    update public.experience_tickets set status = 'used' where id = v_ticket;
  elsif new.status in ('rejected', 'cancelled', 'expired') then
    update public.experience_tickets set status = 'active', booking_id = null where id = v_ticket and booking_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists ticket_booking_sync on public.vip_bookings;
create trigger ticket_booking_sync
  after update of status on public.vip_bookings
  for each row execute function public.ticket_booking_sync();

-- The fan's tickets.
create or replace function public.my_experience_tickets()
returns table (id uuid, creator_profile_id text, creator_name text, experience_id text, experience_title text,
               bonus text, status text, booking_id uuid, created_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.creator_profile_id, public.creator_display_name(k.creator_profile_id), k.experience_id, k.experience_title,
         k.bonus, k.status, k.booking_id, k.created_at, k.expires_at
  from public.experience_tickets k
  where k.fan_id = auth.uid()
  order by k.created_at desc;
$$;

-- Reserve alerts: a ticket booking the creator accepts tells the fan it is confirmed.
create or replace function public.reserve_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_when text := to_char(new.date, 'DD/MM') || ' · ' || new.time;
  v_fan_first text := split_part(coalesce(nullif(trim(new.fan_name), ''), 'Un fan'), ' ', 1);
  v_creator_first text := split_part(coalesce(nullif(trim(new.creator_name), ''), 'El creador'), ' ', 1);
  v_ticket boolean := coalesce(new.details, '{}'::jsonb) ? 'ticketId';
  v_to text; -- 'creator' or 'fan'
  v_title text;
  v_body text;
begin
  if tg_op = 'INSERT' then
    v_to := 'creator';
    v_title := case when new.status = 'pending' then 'Nueva solicitud de Reserve' else 'Nueva reserva' end;
    v_body := v_fan_first || ' · ' || new.title || ' · ' || v_when;
  elsif new.status is distinct from old.status then
    case
      when v_ticket and new.status = 'confirmed' and old.status = 'pending' then
        v_to := 'fan'; v_title := v_creator_first || ' confirmó tu experiencia';
        v_body := new.title || ' · ' || v_when || '. Usaste tu ticket de la Meta de experiencia.';
      when v_ticket and new.status = 'confirmed' then
        return null;
      when new.status = 'accepted' and old.status = 'pending' then
        v_to := 'fan'; v_title := v_creator_first || ' aceptó tu solicitud';
        v_body := new.title || ' · ' || v_when || '. Paga para confirmarla.';
      when new.status = 'accepted' and old.status = 'countered' then
        v_to := 'creator'; v_title := v_fan_first || ' aceptó tu contraoferta';
        v_body := new.title || ' · ' || v_when || '. Falta su pago.';
      when new.status = 'countered' then
        v_to := 'fan'; v_title := v_creator_first || ' te envió una contraoferta';
        v_body := new.title || '. Tienes ' || public.reserve_response_hours() || ' horas para responder.';
      when new.status = 'rejected' then
        v_to := 'fan'; v_title := v_creator_first || ' no puede aceptar tu solicitud';
        v_body := new.title || case when v_ticket then '. Tu ticket sigue activo: elige otra fecha.' else '. No se te cobró nada.' end;
      when new.status = 'expired' and old.status = 'pending' then
        v_to := 'fan'; v_title := 'Tu solicitud expiró sin respuesta';
        v_body := new.title || ' con ' || v_creator_first ||
                  case when v_ticket then '. Tu ticket sigue activo.' else '. No se te cobró nada.' end;
      when new.status = 'expired' and old.status = 'countered' then
        v_to := 'creator'; v_title := 'Tu contraoferta expiró';
        v_body := v_fan_first || ' no respondió a tiempo · ' || new.title;
      when new.status = 'cancelled' and old.status in ('pending', 'accepted', 'countered') then
        v_to := 'creator'; v_title := v_fan_first || ' canceló su solicitud';
        v_body := new.title || ' · ' || v_when;
      when new.status = 'confirmed' then
        v_to := 'creator'; v_title := 'Reserva confirmada y pagada';
        v_body := v_fan_first || ' · ' || new.title || ' · ' || v_when;
      else
        return null;
    end case;
  else
    return null;
  end if;

  if v_to = 'creator' then
    insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
    select p.id, 'reserve_request', new.creator_profile_id, left(v_title, 160), left(v_body, 200), '/creator/dashboard?tab=vip'
    from public.profiles p
    where p.creator_profile_id = new.creator_profile_id and p.role = 'creator';
  elsif new.fan_id is not null then
    insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
    values (new.fan_id, 'reserve_update', new.creator_profile_id, left(v_title, 160), left(v_body, 200), '/profile#mis-reservas');
  end if;
  return null;
end;
$$;

-- =====================================================================
-- Grants
-- =====================================================================
revoke execute on function public.sale_gateway_fee(text, text, numeric) from public, anon, authenticated;
revoke execute on function public.reward_sales(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reward_clean(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reward_reliable(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reward_level_for(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reward_active_fans(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reward_base_share(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reward_share(text, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.set_reward_share() from public, anon, authenticated;
revoke execute on function public.set_special_share() from public, anon, authenticated;
revoke execute on function public.invite_qualified_at(text) from public, anon, authenticated;
revoke execute on function public.invite_window(text) from public, anon, authenticated;
revoke execute on function public.add_invite_bonus() from public, anon, authenticated;
revoke execute on function public.creator_medal_state(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.payout_min(uuid) from public, anon, authenticated;
revoke execute on function public.payout_fee_for(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.event_seat_cap(text) from public, anon, authenticated;
revoke execute on function public.check_reserve_event() from public, anon, authenticated;
revoke execute on function public.experience_goal_progress(uuid, text) from public, anon, authenticated;
revoke execute on function public.ticket_booking_status() from public, anon, authenticated;
revoke execute on function public.ticket_booking_sync() from public, anon, authenticated;
revoke execute on function public.reserve_alert() from public, anon, authenticated;
grant execute on function public.creator_badges(text[]) to anon, authenticated;
grant execute on function public.creator_levels(text[]) to anon, authenticated;
grant execute on function public.monthly_new_fans() to anon, authenticated;
grant execute on function public.featured_creators() to anon, authenticated;
revoke execute on function public.my_creator_rewards() from public, anon;
grant execute on function public.my_creator_rewards() to authenticated;
revoke execute on function public.my_payout_terms() from public, anon;
grant execute on function public.my_payout_terms() to authenticated;
revoke execute on function public.save_experience_goal(boolean, numeric, text[]) from public, anon;
grant execute on function public.save_experience_goal(boolean, numeric, text[]) to authenticated;
grant execute on function public.my_experience_goal(text) to anon, authenticated;
revoke execute on function public.claim_experience_ticket(text, text) from public, anon;
grant execute on function public.claim_experience_ticket(text, text) to authenticated;
revoke execute on function public.book_with_ticket(uuid, date, text, text) from public, anon;
grant execute on function public.book_with_ticket(uuid, date, text, text) to authenticated;
revoke execute on function public.my_experience_tickets() from public, anon;
grant execute on function public.my_experience_tickets() to authenticated;
