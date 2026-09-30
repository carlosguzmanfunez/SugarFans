-- Creator invites creator: whoever signs up as a creator through another
-- creator's link earns that creator 5% of everything they sell for 12 months.
-- The bonus is paid from SugarFans' part: the invited creator's cut is untouched.
-- Each paid sale gets a companion 'referral' row (share 100%) in the inviting
-- creator's books, which follows the sale if it is refunded.
-- Mirrors CREATOR_INVITE_* in src/lib/rewardRules.ts.

alter table public.transactions drop constraint transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('subscription', 'renewal', 'tip', 'gift', 'referral'));

create table public.creator_invites (
  creator_id uuid primary key references public.profiles (id) on delete cascade,
  creator_profile_id text not null unique,
  referrer_profile_id text not null,
  joined_at timestamptz not null default now()
);

create index creator_invites_referrer_idx on public.creator_invites (referrer_profile_id);

alter table public.creator_invites enable row level security;

create policy "creator_invites: invited, inviter or admin reads" on public.creator_invites
  for select to authenticated
  using (creator_id = (select auth.uid()) or referrer_profile_id = (select public.my_creator_profile_id()) or (select public.is_admin()));

-- Sign-up through a creator's link: a fan is a referral, a creator is an invite.
create or replace function public.record_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text := nullif(trim(new.raw_user_meta_data ->> 'ref'), '');
  v_role text := coalesce(new.raw_user_meta_data ->> 'role', 'fan');
begin
  if v_ref is null
     or not exists (select 1 from public.profiles where creator_profile_id = v_ref and role in ('creator', 'admin') and id <> new.id) then
    return new;
  end if;
  if v_role = 'creator' then
    insert into public.creator_invites (creator_id, creator_profile_id, referrer_profile_id)
    select p.id, p.creator_profile_id, v_ref from public.profiles p
    where p.id = new.id and p.creator_profile_id is not null and p.creator_profile_id <> v_ref
    on conflict do nothing;
  else
    insert into public.referrals (fan_id, creator_profile_id) values (new.id, v_ref) on conflict do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.add_invite_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.creator_invites;
  v_amount numeric := round(new.amount * 0.05, 2);
begin
  if new.kind = 'referral' or new.status <> 'paid' or v_amount < 0.01 then
    return new;
  end if;
  select * into v_inv from public.creator_invites
  where creator_profile_id = new.creator_profile_id
    and new.created_at >= joined_at and new.created_at < joined_at + interval '12 months';
  if v_inv.creator_id is null then
    return new;
  end if;
  insert into public.transactions
    (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, note, creator_share, created_at)
  values ('bonus:' || new.id, null, 'SugarFans', v_inv.referrer_profile_id,
          coalesce((select name from public.profiles where creator_profile_id = v_inv.referrer_profile_id limit 1), 'Creador'),
          'referral', v_amount, 'Bono de invitación', 'paid', 'Por ' || new.creator_name, 1, new.created_at)
  on conflict do nothing;
  return new;
end;
$$;

create trigger add_invite_bonus
  after insert on public.transactions
  for each row execute function public.add_invite_bonus();

create or replace function public.sync_invite_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.transactions set status = new.status
  where key = 'bonus:' || new.id and kind = 'referral' and status <> new.status;
  return new;
end;
$$;

create trigger sync_invite_bonus
  after update of status on public.transactions
  for each row when (old.status is distinct from new.status and new.kind <> 'referral')
  execute function public.sync_invite_bonus();

-- Dashboard: same as before plus the creators this creator invited.
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
        'until', i.joined_at + interval '12 months',
        'bonus', coalesce((select sum(b.amount) from public.transactions b
                           join public.transactions s on b.key = 'bonus:' || s.id
                           where b.creator_profile_id = v_id and b.kind = 'referral' and b.status = 'paid'
                             and s.creator_profile_id = i.creator_profile_id), 0)
      ) order by i.joined_at desc)
      from public.creator_invites i join public.profiles p on p.id = i.creator_id
      where i.referrer_profile_id = v_id), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.add_invite_bonus() from public, anon, authenticated;
revoke execute on function public.sync_invite_bonus() from public, anon, authenticated;
revoke execute on function public.record_referral() from public, anon, authenticated;
revoke execute on function public.my_creator_rewards() from public, anon;
grant execute on function public.my_creator_rewards() to authenticated;
