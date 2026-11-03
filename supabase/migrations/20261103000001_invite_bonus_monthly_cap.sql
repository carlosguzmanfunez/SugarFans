-- Invite bonus: the $100 cap is now per month, not in total (Carlos, 2026-11-03).
-- The inviter earns 5% of what the invited creator sells for 6 months, at most
-- $100 in each calendar month (Honduras time) per invited creator. Only
-- add_invite_bonus() changes; bonuses already paid stay as they are.

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
  -- At most $100 a month per invited creator (calendar month, Honduras time).
  select coalesce(sum(b.amount), 0) into v_paid from public.transactions b
    join public.transactions s on b.key = 'bonus:' || s.id
    where b.creator_profile_id = v_referrer and b.kind = 'referral' and b.status = 'paid'
      and s.creator_profile_id = new.creator_profile_id
      and date_trunc('month', s.created_at at time zone 'America/Tegucigalpa')
        = date_trunc('month', new.created_at at time zone 'America/Tegucigalpa');
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

revoke execute on function public.add_invite_bonus() from public, anon, authenticated;
