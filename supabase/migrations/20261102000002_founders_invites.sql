-- Creadores Fundadores and the new creator-invite bonus (decided by Carlos on 2026-11-02).
-- Mirrors FOUNDER_* and CREATOR_INVITE_* in src/lib/rewardRules.ts: keep both in sync.
--
-- 1. Invite bonus: whoever invites a creator earns 5% of the net of everything that
--    creator sells (subscriptions, renewals, tips and now Reserve too) for 6 months,
--    up to $100 per invited creator. It starts on its own when that creator is
--    verified and has sold $100: no need to have 2 invited creators any more. Paid
--    by Fans Reserve; creator + inviter never above 90% of the net.
-- 2. Creador Fundador: only by invitation of the team (the Captar creadores link
--    /c/<code>), 100 per country. Earns 82% of the net and the "Fundador" badge
--    while they keep it: 2 months to reach Oro, then they must stay Oro or higher
--    (30 days to get it back after dropping). Losing it never touches money earned.

-- =====================================================================
-- 1. Creadores Fundadores
-- =====================================================================
create table if not exists public.creator_founders (
  creator_profile_id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  country text not null,
  prospect_id uuid,
  granted_at timestamptz not null default now(),
  below_oro_since timestamptz, -- first day of the current stretch below Oro (after the grace)
  lost_at timestamptz,         -- when they lost the title; their seat is free again
  lost_reason text
);
create index if not exists creator_founders_country_idx on public.creator_founders (country) where lost_at is null;
alter table public.creator_founders enable row level security;
-- Nobody reads or writes it directly: only the functions below.
revoke all on public.creator_founders from anon, authenticated;

-- Rules (mirrored in src/lib/rewardRules.ts): 100 seats per country, 2 months to
-- reach Oro, then 30 days to get it back each time they drop below it.
create or replace function public.founder_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('seats', 100, 'grace_days', 60, 'recover_days', 30, 'share', 0.82);
$$;

-- A creator the team invited (their account claimed a /c/<code> invite) becomes
-- Fundador if their country still has a free seat. Only once: a lost title doesn't
-- come back by itself.
create or replace function public.founder_grant(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_prospect public.creator_prospects;
  v_country text;
begin
  select * into v_me from public.profiles where id = p_user;
  if v_me.id is null or v_me.role <> 'creator' or v_me.creator_profile_id is null then
    return false;
  end if;
  if exists (select 1 from public.creator_founders where creator_profile_id = v_me.creator_profile_id) then
    return false;
  end if;
  select * into v_prospect from public.creator_prospects where matched_profile_id = p_user order by updated_at desc limit 1;
  if v_prospect.id is null then
    return false;
  end if;
  v_country := coalesce(v_me.country, v_prospect.country, 'ZZ');
  -- One at a time per country, so two sign-ups can't take the last seat together.
  perform pg_advisory_xact_lock(hashtext('founder-seat:' || v_country));
  if (select count(*) from public.creator_founders where country = v_country and lost_at is null)
     >= (public.founder_rules() ->> 'seats')::int then
    return false;
  end if;
  insert into public.creator_founders (creator_profile_id, user_id, country, prospect_id)
  values (v_me.creator_profile_id, p_user, v_country, v_prospect.id)
  on conflict do nothing;
  insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
  values (p_user, 'creator_goal', v_me.creator_profile_id, 'Eres Creador Fundador',
          'Ganas 82% mientras te mantengas en Oro. Tienes 2 meses para llegar.', '/creator/dashboard');
  return true;
end;
$$;

-- Linking the invite now also grants Fundador.
create or replace function public.prospect_claim(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then return false; end if;
  if exists (select 1 from public.profiles where id = v_uid and role = 'admin') then return false; end if;
  update public.creator_prospects
  set matched_profile_id = v_uid,
      status = case when public.prospect_rank(status) < 4 then 'registrado' else status end
  where invite_code = lower(trim(coalesce(p_code, '')))
    and (matched_profile_id is null or matched_profile_id = v_uid)
  returning id into v_id;
  if v_id is not null then
    perform public.founder_grant(v_uid);
  end if;
  return v_id is not null;
end;
$$;

-- An invited fan who later becomes a creator gets it then.
create or replace function public.founder_on_become_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'creator' and old.role is distinct from 'creator' then
    perform public.founder_grant(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists founder_on_become_creator on public.profiles;
create trigger founder_on_become_creator
  after update of role on public.profiles
  for each row execute function public.founder_on_become_creator();

create or replace function public.founder_active(p_creator text, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.creator_founders f
                 where f.creator_profile_id = p_creator and f.granted_at <= p_at and (f.lost_at is null or f.lost_at > p_at));
$$;

-- 82% while they are Fundador; 0 otherwise.
create or replace function public.reward_founder_share(p_creator text, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.founder_active(p_creator, p_at) then (public.founder_rules() ->> 'share')::numeric else 0 end;
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

-- What the creator panel shows about Fundador (null if never invited as one).
create or replace function public.founder_state(p_creator text, p_at timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'granted_at', f.granted_at,
    'grace_until', f.granted_at + make_interval(days => (public.founder_rules() ->> 'grace_days')::int),
    'below_oro_since', f.below_oro_since,
    'lose_at', f.below_oro_since + make_interval(days => (public.founder_rules() ->> 'recover_days')::int),
    'lost_at', f.lost_at,
    'country', f.country,
    'active', f.granted_at <= p_at and (f.lost_at is null or f.lost_at > p_at))
  from public.creator_founders f where f.creator_profile_id = p_creator;
$$;

-- Every day: after the grace, a Fundador below Oro gets 30 days to get it back
-- (with a notice); if they don't, they lose the title and the seat frees up.
create or replace function public.founder_daily_check(p_at timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.creator_founders;
  v_level text;
  v_recover int := (public.founder_rules() ->> 'recover_days')::int;
  v_changed int := 0;
begin
  for f in select * from public.creator_founders
           where lost_at is null
             and granted_at + make_interval(days => (public.founder_rules() ->> 'grace_days')::int) <= p_at
           for update loop
    v_level := public.reward_level_for(f.creator_profile_id, p_at);
    if v_level in ('oro', 'diamante') then
      if f.below_oro_since is not null then
        update public.creator_founders set below_oro_since = null where creator_profile_id = f.creator_profile_id;
        v_changed := v_changed + 1;
      end if;
    elsif f.below_oro_since is null then
      update public.creator_founders set below_oro_since = p_at where creator_profile_id = f.creator_profile_id;
      insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
      values (f.user_id, 'creator_goal', f.creator_profile_id, 'Recupera Oro para seguir siendo Fundador',
              'Tienes ' || v_recover || ' días para volver a Oro. Si no, pierdes el título de Fundador y el 82%.', '/creator/dashboard');
      v_changed := v_changed + 1;
    elsif f.below_oro_since + make_interval(days => v_recover) <= p_at then
      update public.creator_founders set lost_at = p_at, lost_reason = 'sin-oro' where creator_profile_id = f.creator_profile_id;
      insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
      values (f.user_id, 'creator_goal', f.creator_profile_id, 'Ya no eres Creador Fundador',
              'No volviste a Oro a tiempo. Lo que ya ganaste no cambia; desde hoy ganas lo de tu nivel.', '/creator/dashboard');
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end;
$$;

-- Same name again just updates the job, so this can run twice.
select cron.schedule('founders-daily-check', '15 12 * * *', 'select public.founder_daily_check()');

-- Admin: seats taken per country (Captar creadores → Metas).
create or replace function public.founders_summary()
returns table (country text, active int, at_risk int, lost int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el equipo puede ver esto';
  end if;
  return query
    select f.country,
           (count(*) filter (where f.lost_at is null))::int,
           (count(*) filter (where f.lost_at is null and f.below_oro_since is not null))::int,
           (count(*) filter (where f.lost_at is not null))::int
    from public.creator_founders f group by f.country order by 2 desc, 1;
end;
$$;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('live_started', 'reserve_request', 'reserve_update', 'creator_goal'));

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
               '''embajador'', v_invites >= 1,' || chr(10) || '    ''fundador'', public.founder_active(p_creator, p_at),');
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

revoke execute on function public.founder_grant(uuid) from public, anon, authenticated;
revoke execute on function public.founder_on_become_creator() from public, anon, authenticated;
revoke execute on function public.founder_active(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.founder_daily_check(timestamptz) from public, anon, authenticated;
revoke execute on function public.founders_summary() from public, anon;
grant execute on function public.founders_summary() to authenticated;
revoke execute on function public.prospect_claim(text) from public, anon;
grant execute on function public.prospect_claim(text) to authenticated;
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
