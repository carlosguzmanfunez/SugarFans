-- Creator rewards: referral link, levels by active fans, monthly goals for fans
-- attracted with the link, and featured spots. They set the creator's cut
-- (transactions.creator_share) of every subscription, renewal and tip; gifts keep
-- their fixed 60%. Mirrors src/lib/rewardRules.ts: keep both in sync.
--   Levels (active fans = distinct payers in the last 30 days):
--     Bronce 0 -> 80%, Plata 10 -> 82%, Oro 50 -> 84%, Diamante 200 -> 85%.
--   Referral: a fan who signed up with the creator's link pays the creator 90% for 90 days.
--   Goals: referred fans who joined in a month and have paid the creator;
--     10 -> +2 points, 25 -> +5, 50 -> +10 for the whole next month.
--   The cut never goes above 90%.

-- ---------------------------------------------------------------------
-- Referrals (written at sign-up only)
-- ---------------------------------------------------------------------
create table public.referrals (
  fan_id uuid primary key references public.profiles (id) on delete cascade,
  creator_profile_id text not null,
  joined_at timestamptz not null default now()
);

create index referrals_creator_idx on public.referrals (creator_profile_id, joined_at);

alter table public.referrals enable row level security;

create policy "referrals: fan, creator or admin reads" on public.referrals
  for select to authenticated
  using (fan_id = (select auth.uid()) or creator_profile_id = (select public.my_creator_profile_id()) or (select public.is_admin()));

-- Runs after on_auth_user_created (triggers fire in name order), so the profile exists.
create or replace function public.record_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text := nullif(trim(new.raw_user_meta_data ->> 'ref'), '');
begin
  if v_ref is null or coalesce(new.raw_user_meta_data ->> 'role', 'fan') <> 'fan' then
    return new;
  end if;
  if exists (select 1 from public.profiles where creator_profile_id = v_ref and role in ('creator', 'admin') and id <> new.id) then
    insert into public.referrals (fan_id, creator_profile_id) values (new.id, v_ref) on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_referral
  after insert on auth.users
  for each row execute function public.record_referral();

-- ---------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------
create or replace function public.reward_month_start(p_at timestamptz, p_offset int default 0)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('month', p_at at time zone 'utc') + make_interval(months => p_offset)) at time zone 'utc';
$$;

create or replace function public.reward_active_fans(p_creator text, p_at timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct t.payer_id)::int from public.transactions t
  where t.creator_profile_id = p_creator and t.status = 'paid' and t.payer_id is not null
    and t.created_at > p_at - interval '30 days' and t.created_at <= p_at;
$$;

create or replace function public.reward_level(p_active_fans int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_active_fans >= 200 then 'diamante' when p_active_fans >= 50 then 'oro'
              when p_active_fans >= 10 then 'plata' else 'bronce' end;
$$;

create or replace function public.reward_level_share(p_level text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_level when 'diamante' then 0.85 when 'oro' then 0.84 when 'plata' then 0.82 else 0.80 end;
$$;

create or replace function public.reward_attracted(p_creator text, p_from timestamptz, p_to timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.referrals r
  where r.creator_profile_id = p_creator and r.joined_at >= p_from and r.joined_at < p_to
    and exists (select 1 from public.transactions t
                where t.payer_id = r.fan_id and t.creator_profile_id = p_creator and t.status = 'paid');
$$;

create or replace function public.reward_goal_bonus(p_attracted int)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_attracted >= 50 then 0.10 when p_attracted >= 25 then 0.05 when p_attracted >= 10 then 0.02 else 0 end;
$$;

-- Cut for fans not covered by a referral: level + last month's goal bonus, at most 90%.
create or replace function public.reward_base_share(p_creator text, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select least(0.90,
    public.reward_level_share(public.reward_level(public.reward_active_fans(p_creator, p_at)))
    + public.reward_goal_bonus(public.reward_attracted(p_creator, public.reward_month_start(p_at, -1), public.reward_month_start(p_at))));
$$;

create or replace function public.reward_share(p_creator text, p_fan uuid, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.referrals r
                 where r.fan_id = p_fan and r.creator_profile_id = p_creator and p_at - r.joined_at < interval '90 days')
      then 0.90
    else public.reward_base_share(p_creator, p_at)
  end;
$$;

-- Every subscription, renewal and tip records the cut in force when it was paid.
create or replace function public.set_reward_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('subscription', 'renewal', 'tip') and new.payer_id is not null then
    new.creator_share := public.reward_share(new.creator_profile_id, new.payer_id, new.created_at);
  end if;
  return new;
end;
$$;

create trigger set_reward_share
  before insert on public.transactions
  for each row execute function public.set_reward_share();

-- ---------------------------------------------------------------------
-- Read functions
-- ---------------------------------------------------------------------
-- The signed-in creator's rewards dashboard.
create or replace function public.my_creator_rewards()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id text := public.my_creator_profile_id();
  v_fans int;
  v_last int;
begin
  if v_id is null then
    raise exception 'Solo los creadores tienen recompensas';
  end if;
  v_fans := public.reward_active_fans(v_id, now());
  v_last := public.reward_attracted(v_id, public.reward_month_start(now(), -1), public.reward_month_start(now()));
  return jsonb_build_object(
    'level', public.reward_level(v_fans),
    'active_fans', v_fans,
    'share', public.reward_base_share(v_id, now()),
    'bonus', public.reward_goal_bonus(v_last),
    'attracted_this_month', public.reward_attracted(v_id, public.reward_month_start(now()), public.reward_month_start(now(), 1)),
    'attracted_last_month', v_last,
    'referrals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.name,
        'joined_at', r.joined_at,
        'paid', exists (select 1 from public.transactions t
                        where t.payer_id = r.fan_id and t.creator_profile_id = v_id and t.status = 'paid'),
        'referral_until', r.joined_at + interval '90 days'
      ) order by r.joined_at desc)
      from public.referrals r join public.profiles p on p.id = r.fan_id
      where r.creator_profile_id = v_id), '[]'::jsonb)
  );
end;
$$;

-- Public: the level badge of each creator profile.
create or replace function public.creator_levels(p_ids text[])
returns table (creator_profile_id text, level text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, public.reward_level(public.reward_active_fans(id, now())) from unnest(p_ids[1:100]) as id;
$$;

-- Public: creators featured this month (Oro and Diamante, or a goal reached this month or last).
create or replace function public.featured_creators()
returns table (creator_profile_id text, level text, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
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
  )
  select id, public.reward_level(fans), case when fans >= 50 then 'level' else 'goal' end
  from scored
  where fans >= 50 or attracted >= 10
  order by fans desc
  limit 8;
$$;

revoke execute on function public.record_referral() from public, anon, authenticated;
revoke execute on function public.reward_active_fans(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reward_attracted(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.reward_base_share(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reward_share(text, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.set_reward_share() from public, anon, authenticated;
revoke execute on function public.my_creator_rewards() from public, anon;
grant execute on function public.my_creator_rewards() to authenticated;
grant execute on function public.creator_levels(text[]) to anon, authenticated;
grant execute on function public.featured_creators() to anon, authenticated;
