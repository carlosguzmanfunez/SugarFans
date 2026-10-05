-- Special accounts: links the admin creates to give a creator a special plan.
--   Reserve al neto: the creator keeps each Reserve payment minus what the payment
--     gateway charged for it (PayPal's real fee when it reports one, else an
--     estimate) and the plan's tax rate. This is an exception, only for these
--     accounts, to the rule that the platform keeps at least 10% of every sale.
--   Visibilidad extra: listed first among the featured creators (Explorar).
-- Subscriptions, renewals, tips and gifts keep their usual rules, and the PayPal
-- withdrawal fee is still charged to the creator when they withdraw.
-- The admin creates and revokes links and plans; a signed-in creator claims a link
-- with claim_special_invite. Mirrors src/lib/specialRules.ts: keep both in sync.

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.special_invites (
  code text primary key default left(replace(gen_random_uuid()::text, '-', ''), 16),
  label text not null check (char_length(trim(label)) between 1 and 80),
  reserve_net boolean not null default true,
  tax_rate numeric(5, 4) not null default 0 check (tax_rate between 0 and 0.5),
  featured boolean not null default false,
  max_uses int not null default 1 check (max_uses between 1 and 1000),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- One plan per creator. The terms are copied from the link when it is claimed,
-- so the admin can change one account without touching the link or the others.
create table public.special_accounts (
  creator_profile_id text primary key,
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  invite_code text references public.special_invites (code) on delete set null,
  label text not null default '',
  reserve_net boolean not null default true,
  tax_rate numeric(5, 4) not null default 0 check (tax_rate between 0 and 0.5),
  featured boolean not null default false,
  since timestamptz not null default now(),
  revoked_at timestamptz
);
create index special_accounts_invite_idx on public.special_accounts (invite_code);

alter table public.special_invites enable row level security;
alter table public.special_accounts enable row level security;

create policy "special_invites: admin reads" on public.special_invites
  for select to authenticated using ((select public.is_admin()));
create policy "special_invites: admin creates" on public.special_invites
  for insert to authenticated with check ((select public.is_admin()));
create policy "special_invites: admin edits" on public.special_invites
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "special_accounts: owner or admin reads" on public.special_accounts
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "special_accounts: admin edits" on public.special_accounts
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update on public.special_invites to authenticated;
grant select, update on public.special_accounts to authenticated;

-- ---------------------------------------------------------------------
-- Claiming a link (the creator, signed in)
-- ---------------------------------------------------------------------
create or replace function public.claim_special_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  inv public.special_invites;
  cur public.special_accounts;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Inicia sesión para activar tu cuenta especial';
  end if;
  if v_me.role <> 'creator' or v_me.creator_profile_id is null then
    raise exception 'Este link es para cuentas de creador';
  end if;
  select * into inv from public.special_invites where code = trim(p_code) for update;
  if inv.code is null or inv.revoked_at is not null then
    raise exception 'Este link ya no es válido';
  end if;
  if inv.expires_at is not null and inv.expires_at <= now() then
    raise exception 'Este link ya venció';
  end if;
  select * into cur from public.special_accounts where user_id = v_me.id;
  if cur.user_id is not null and cur.revoked_at is null then
    if cur.invite_code = inv.code then
      return jsonb_build_object('label', cur.label, 'already', true);
    end if;
    raise exception 'Tu cuenta ya tiene un plan especial';
  end if;
  if (select count(*) from public.special_accounts where invite_code = inv.code) >= inv.max_uses then
    raise exception 'Este link ya se usó todas las veces permitidas';
  end if;
  insert into public.special_accounts (creator_profile_id, user_id, invite_code, label, reserve_net, tax_rate, featured, since, revoked_at)
  values (v_me.creator_profile_id, v_me.id, inv.code, inv.label, inv.reserve_net, inv.tax_rate, inv.featured, now(), null)
  on conflict (creator_profile_id) do update
    set user_id = excluded.user_id, invite_code = excluded.invite_code, label = excluded.label,
        reserve_net = excluded.reserve_net, tax_rate = excluded.tax_rate, featured = excluded.featured,
        since = excluded.since, revoked_at = null;
  return jsonb_build_object('label', inv.label, 'already', false);
end;
$$;
revoke execute on function public.claim_special_invite(text) from public, anon;
grant execute on function public.claim_special_invite(text) to authenticated;

-- ---------------------------------------------------------------------
-- Reserve al neto
-- ---------------------------------------------------------------------
-- The fee PayPal charged for the capture, saved by api/paypal.ts before fulfilling.
alter table public.paypal_orders add column if not exists fee numeric(10, 2);

-- What the plan deducted from a Reserve payment (null on every other sale).
alter table public.transactions add column if not exists gateway_fee numeric(10, 2);
alter table public.transactions add column if not exists tax_amount numeric(10, 2);
-- Net shares need more than two decimals (e.g. 0.9431).
alter table public.transactions alter column creator_share type numeric(6, 4);

-- Used only when the gateway didn't report its fee (e.g. simulated test payments):
-- PayPal's usual rate for international commercial payments, 5.4% + $0.30.
create or replace function public.special_fee_estimate(p_amount numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(p_amount * 0.054 + 0.30, 2);
$$;

-- Runs before insert on transactions; fills in the cut of a special account's Reserve payment.
create or replace function public.set_special_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.special_accounts;
  v_fee numeric;
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
  -- Reserve payments are keyed 'vip:<booking id>'; PayPal's order is still 'created' while it fulfills.
  select o.fee into v_fee from public.paypal_orders o
    where o.kind = 'booking' and o.params ->> 'bookingId' = substr(new.key, 5) and o.status = 'created' and o.fee is not null
    order by o.created_at desc limit 1;
  v_fee := least(new.amount, coalesce(v_fee, public.special_fee_estimate(new.amount)));
  v_tax := least(new.amount - v_fee, round(new.amount * s.tax_rate, 2));
  new.gateway_fee := v_fee;
  new.tax_amount := v_tax;
  new.creator_share := greatest(0, least(1, round((new.amount - v_fee - v_tax) / new.amount, 4)));
  return new;
end;
$$;

create trigger set_special_share
  before insert on public.transactions
  for each row execute function public.set_special_share();

revoke execute on function public.set_special_share() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Visibilidad extra: special accounts first among the featured creators
-- ---------------------------------------------------------------------
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
  ), scored as (
    select c.id,
           public.reward_active_fans(c.id, now()) as fans,
           greatest(public.reward_attracted(c.id, public.reward_month_start(now()), public.reward_month_start(now(), 1)),
                    public.reward_attracted(c.id, public.reward_month_start(now(), -1), public.reward_month_start(now()))) as attracted
    from candidates c
    where c.id not in (select id from special)
  ), earned as (
    select id, fans, row_number() over (order by fans desc) as pos
    from scored
    where fans >= 50 or attracted >= 10
    order by fans desc
    limit 8
  )
  select id, level, reason from (
    select s.id, public.reward_level(public.reward_active_fans(s.id, now())) as level, 'special' as reason, 0 as grp, s.pos from special s
    union all
    select e.id, public.reward_level(e.fans), case when e.fans >= 50 then 'level' else 'goal' end, 1, e.pos from earned e
  ) x
  order by grp, pos;
$$;
grant execute on function public.featured_creators() to anon, authenticated;
