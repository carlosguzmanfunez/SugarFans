-- Creator invites, revised: the 5% bonus starts once the inviter has at least
-- 2 invited creators and lasts one month (from that moment, or from when the
-- invited creator joins if later). It covers subscriptions, renewals and tips;
-- gifts have their own rules. SugarFans always keeps at least 10% of a sale, so
-- the bonus shrinks when the seller already gets 90%.
-- Mirrors CREATOR_INVITE_* and inviteWindow in src/lib/rewardRules.ts.

create or replace function public.invite_window(p_creator_profile_id text, out from_at timestamptz, out until_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.creator_invites;
  v_qualified timestamptz;
begin
  select * into v_inv from public.creator_invites where creator_profile_id = p_creator_profile_id;
  if v_inv.creator_id is null then
    return;
  end if;
  select joined_at into v_qualified from public.creator_invites
  where referrer_profile_id = v_inv.referrer_profile_id
  order by joined_at offset 1 limit 1;
  if v_qualified is null then
    return;
  end if;
  from_at := greatest(v_inv.joined_at, v_qualified);
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
  v_amount numeric := greatest(0, round(new.amount * least(0.05, 0.90 - new.creator_share), 2));
begin
  if new.kind not in ('subscription', 'renewal', 'tip') or new.status <> 'paid' or v_amount < 0.01 then
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
  insert into public.transactions
    (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, note, creator_share, created_at)
  values ('bonus:' || new.id, null, 'SugarFans', v_referrer,
          coalesce((select name from public.profiles where creator_profile_id = v_referrer limit 1), 'Creador'),
          'referral', v_amount, 'Bono de invitación', 'paid', 'Por ' || new.creator_name, 1, new.created_at)
  on conflict do nothing;
  return new;
end;
$$;

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
      where r.creator_profile_id = v_id), '[]'::jsonb),
    'invited_creators', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.name,
        'joined_at', i.joined_at,
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

revoke execute on function public.invite_window(text) from public, anon, authenticated;
revoke execute on function public.add_invite_bonus() from public, anon, authenticated;
revoke execute on function public.my_creator_rewards() from public, anon;
grant execute on function public.my_creator_rewards() to authenticated;
