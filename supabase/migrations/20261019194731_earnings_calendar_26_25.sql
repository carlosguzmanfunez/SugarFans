-- Deploy before the client. No payments, cron jobs, historical transaction
-- updates or payout-state rewrites. Preserve the old credited boundary once.
create table if not exists public.payout_calendar_settings (
  id boolean primary key default true check (id),
  legacy_cutoff timestamptz not null,
  activated_at timestamptz not null default now()
);
insert into public.payout_calendar_settings(id, legacy_cutoff)
values (true, date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
on conflict (id) do nothing;
alter table public.payout_calendar_settings enable row level security;
revoke all on table public.payout_calendar_settings from public, anon, authenticated;
grant select on table public.payout_calendar_settings to authenticated, service_role;
drop policy if exists payout_calendar_read on public.payout_calendar_settings;
-- Global calendar metadata, the same for every signed-in user. No personal data.
create policy payout_calendar_read on public.payout_calendar_settings
for select to authenticated using (true);

create or replace function public.payout_calendar_policy()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('legacy_cutoff', legacy_cutoff)
  from public.payout_calendar_settings where id;
$$;
revoke execute on function public.payout_calendar_policy() from public, anon;
grant execute on function public.payout_calendar_policy() to authenticated, service_role;

create or replace function public.earnings_cycle_start(p_at timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_at at time zone 'America/Tegucigalpa')
    + case when extract(day from p_at at time zone 'America/Tegucigalpa') >= 26
      then interval '25 days' else interval '-1 month 25 days' end)
    at time zone 'America/Tegucigalpa';
$$;
create or replace function public.payout_window_open(p_at timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select extract(day from p_at at time zone 'America/Tegucigalpa') >= 26
      or extract(day from p_at at time zone 'America/Tegucigalpa') = 1;
$$;
create or replace function public.payout_credit_cutoff(p_at timestamptz)
returns timestamptz language sql stable set search_path = '' as $$
  select greatest(public.earnings_cycle_start(p_at), legacy_cutoff)
  from public.payout_calendar_settings where id;
$$;
revoke execute on function public.earnings_cycle_start(timestamptz),
  public.payout_window_open(timestamptz), public.payout_credit_cutoff(timestamptz)
from public, anon, authenticated;

-- Keep refunds covered by the platform and all previous sending/paid deductions.
create or replace function public.creator_available_balance(p_user uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select
    round(coalesce((select sum(t.amount * t.creator_share) from public.transactions t
                    where t.creator_profile_id = p.creator_profile_id
                      and (t.status = 'paid' or (t.platform_covers and t.status in ('refunded', 'disputed')))
                      and t.created_at < public.payout_credit_cutoff(now())), 0), 2)
    - coalesce((select sum(x.amount) from public.payouts x where x.user_id = p.id and x.status <> 'failed'), 0)
  from public.profiles p where p.id = p_user;
$$;
revoke execute on function public.creator_available_balance(uuid) from public, anon, authenticated;

-- Both entry points use this guard. Window closure never prevents confirmation
-- or reconciliation of an existing payout; only starting a new one is restricted.
create or replace function public.payout_checks(p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
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
  if public.is_suspended(v_me.id)
     or exists (select 1 from public.account_restrictions r where r.user_id = v_me.id and r.payouts_frozen) then
    raise exception 'Tus retiros están en revisión. Escríbenos a support@fansreserve.com';
  end if;
  select paypal_email into v_email from public.payout_accounts where user_id = v_me.id;
  if v_email is null then
    raise exception 'Añade el email de tu cuenta PayPal para retiros';
  end if;
  if exists (select 1 from public.payouts where user_id = v_me.id and status = 'sending') then
    raise exception 'Tienes un retiro en camino; espera a que PayPal lo confirme';
  end if;
  if not public.payout_window_open(now()) then
    raise exception 'Los pagos se procesan del 26 al 1, hora de Honduras (UTC−6).';
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
revoke execute on function public.payout_checks(uuid) from public, anon, authenticated;

create or replace function public.paypal_payout_start(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.payout_checks(p_user);
  v_available numeric := public.creator_available_balance(p_user);
  v_fee numeric := public.payout_fee_for(p_user, v_available);
  v_id uuid;
begin
  insert into public.payouts (user_id, creator_name, amount, fee, net, account_label, available_before, status, paid_at, scheduled_for)
  values (p_user, (select name from public.profiles where id = p_user), v_available, v_fee, v_available - v_fee,
          public.payout_label(v_email), v_available, 'sending', null, (now() at time zone 'America/Tegucigalpa')::date)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'amount', v_available, 'fee', v_fee, 'net', v_available - v_fee, 'email', v_email);
end;
$$;
revoke execute on function public.paypal_payout_start(uuid) from public, anon, authenticated;
grant execute on function public.paypal_payout_start(uuid) to service_role;

-- Existing fallback retained; it is not an automatic or batch executor.
create or replace function public.request_payout()
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.payout_checks(auth.uid());
  v_available numeric := public.creator_available_balance(auth.uid());
  v_fee numeric := public.payout_fee_for(auth.uid(), v_available);
begin
  insert into public.payouts (user_id, creator_name, amount, fee, net, account_label, available_before, status, paid_at, scheduled_for)
  values (auth.uid(), (select name from public.profiles where id = auth.uid()), v_available, v_fee, v_available - v_fee,
          public.payout_label(v_email), v_available, 'paid', now(), (now() at time zone 'America/Tegucigalpa')::date);
  return v_available;
end;
$$;
revoke execute on function public.request_payout() from public, anon;
grant execute on function public.request_payout() to authenticated;
