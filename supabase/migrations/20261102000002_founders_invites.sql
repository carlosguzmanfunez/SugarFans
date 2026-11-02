-- Creadores Fundadores and the new creator-invite bonus (decided by Carlos on 2026-11-02).
-- Mirrors FOUNDER_* and CREATOR_INVITE_* in src/lib/rewardRules.ts: keep both in sync.
--
-- 1. Invite bonus: whoever invites a creator earns 5% of the net of everything that
--    creator sells (subscriptions, renewals, tips and now Reserve too) for 6 months,
--    up to $100 per invited creator. It starts on its own when that creator is
--    verified and has sold $100: no need to have 2 invited creators any more. Paid
--    by Fans Reserve; creator + inviter never above 90% of the net.
-- 2. Fundador: a creator who is verified and sells $100 within their first 30 days as
--    a creator keeps the "Fundador" badge for good, and earns 82% of the net (instead
--    of 80%) every 30 days in which they sell at least $100. Creators already on the
--    platform get their 30 days from today.

-- =====================================================================
-- 1. When each account started as a creator
-- =====================================================================
create table if not exists public.creator_starts (
  creator_profile_id text primary key,
  started_at timestamptz not null default now()
);
alter table public.creator_starts enable row level security;
-- Nobody reads or writes it directly: only the functions below.
revoke all on public.creator_starts from anon, authenticated;

insert into public.creator_starts (creator_profile_id, started_at)
select p.creator_profile_id, now() from public.profiles p
where p.role = 'creator' and p.creator_profile_id is not null
on conflict do nothing;

create or replace function public.record_creator_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'creator' and new.creator_profile_id is not null then
    insert into public.creator_starts (creator_profile_id) values (new.creator_profile_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists record_creator_start on public.profiles;
create trigger record_creator_start
  after insert or update of role, creator_profile_id on public.profiles
  for each row execute function public.record_creator_start();

-- =====================================================================
-- 2. Fundador
-- =====================================================================
-- When the creator became Fundador: verified, and the sale that took their first
-- 30 days to $100. Null if not (yet).
create or replace function public.founder_at(p_creator text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from public.profiles p where p.creator_profile_id = p_creator and p.is_verified)
    then (select min(x.created_at) from (
            select t.created_at, sum(t.amount) over (order by t.created_at, t.id) as total
            from public.transactions t, public.creator_starts s
            where s.creator_profile_id = p_creator and t.creator_profile_id = p_creator
              and t.status = 'paid' and t.kind <> 'referral'
              and t.created_at < s.started_at + interval '30 days') x
          where x.total >= 100)
  end;
$$;

-- 82% while a Fundador sells $100 in 30 days; 0 otherwise.
create or replace function public.reward_founder_share(p_creator text, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.founder_at(p_creator) <= p_at and public.reward_sales(p_creator, p_at) >= 100 then 0.82 else 0 end;
$$;

-- The creator's rate for fans who didn't come through their link: their level's,
-- or the Fundador rate when it is higher.
create or replace function public.reward_base_share(p_creator text, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(public.reward_level_share(public.reward_level_for(p_creator, p_at)), public.reward_founder_share(p_creator, p_at));
$$;

-- What the creator panel shows about Fundador.
create or replace function public.founder_state(p_creator text, p_at timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'started_at', s.started_at,
    'until', s.started_at + interval '30 days',
    'sales', coalesce((select sum(t.amount) from public.transactions t
                       where t.creator_profile_id = p_creator and t.status = 'paid' and t.kind <> 'referral'
                         and t.created_at < s.started_at + interval '30 days' and t.created_at <= p_at), 0),
    'verified', exists (select 1 from public.profiles p where p.creator_profile_id = p_creator and p.is_verified),
    'reached_at', public.founder_at(p_creator),
    'active', public.reward_founder_share(p_creator, p_at) > 0)
  from public.creator_starts s where s.creator_profile_id = p_creator;
$$;

-- =====================================================================
-- 3. Invite bonus: 6 months from the invited creator's own $100
-- =====================================================================
create or replace function public.invite_window(p_creator_profile_id text, out from_at timestamptz, out until_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.creator_invites where creator_profile_id = p_creator_profile_id) then
    return;
  end if;
  from_at := public.invite_qualified_at(p_creator_profile_id);
  if from_at is not null then
    until_at := from_at + interval '6 months';
  end if;
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
  if new.kind not in ('subscription', 'renewal', 'tip', 'vip') or new.status <> 'paid' or new.amount <= 0 then
    return new;
  end if;
  select referrer_profile_id into v_referrer from public.creator_invites where creator_profile_id = new.creator_profile_id;
  if v_referrer is null then
    return new;
  end if;
  select * into v_window from public.invite_window(new.creator_profile_id);
  -- The sale that completes the $100 earns nothing.
  if v_window.from_at is null or new.created_at <= v_window.from_at or new.created_at >= v_window.until_at then
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

-- Embajador now comes with the first invited creator who reaches $100, and the
-- medals carry Fundador.
do $$
declare
  d text := pg_get_functiondef('public.creator_medal_state(text, timestamptz)'::regprocedure);
begin
  if position('''embajador'', v_invites >= 2,' in d) = 0 then
    raise exception 'Revisar creator_medal_state antes de cambiar Embajador';
  end if;
  d := replace(d, '''embajador'', v_invites >= 2,',
               '''embajador'', v_invites >= 1,' || chr(10) || '    ''fundador'', public.founder_at(p_creator) <= p_at,');
  execute d;
end;
$$;

-- Public: level and the badges fans see on a profile, now with Fundador.
drop function if exists public.creator_badges(text[]);
create function public.creator_badges(p_ids text[])
returns table (creator_profile_id text, level text, puntual boolean, constante boolean, fundador boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select id, public.reward_level_for(id, now()),
         (m ->> 'puntual')::boolean, (m ->> 'constante')::boolean, coalesce((m ->> 'fundador')::boolean, false)
  from unnest(p_ids[1:60]) as id
  cross join lateral public.creator_medal_state(id, now()) as m;
$$;

-- =====================================================================
-- 4. The creator's own panel
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
    'share', public.reward_base_share(v_id, now()),
    'bonus', 0,
    'attracted_this_month', public.reward_attracted(v_id, public.reward_month_start(now()), public.reward_month_start(now(), 1)),
    'attracted_last_month', public.reward_attracted(v_id, public.reward_month_start(now(), -1), public.reward_month_start(now())),
    'medals', public.creator_medal_state(v_id, now()),
    'founder', public.founder_state(v_id, now()),
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
        'avatar', p.avatar,
        'joined_at', i.joined_at,
        'verified', p.is_verified,
        'sales', coalesce((select sum(t.amount) from public.transactions t
                           where t.creator_profile_id = i.creator_profile_id and t.status = 'paid' and t.kind <> 'referral'), 0),
        'qualified_at', w.from_at,
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

revoke execute on function public.record_creator_start() from public, anon, authenticated;
revoke execute on function public.founder_at(text) from public, anon, authenticated;
revoke execute on function public.reward_founder_share(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reward_base_share(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.founder_state(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.invite_window(text) from public, anon, authenticated;
revoke execute on function public.add_invite_bonus() from public, anon, authenticated;
revoke execute on function public.creator_medal_state(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.creator_badges(text[]) from public;
grant execute on function public.creator_badges(text[]) to anon, authenticated;
revoke execute on function public.my_creator_rewards() from public, anon;
grant execute on function public.my_creator_rewards() to authenticated;
