-- Creator withdrawals sent for real with PayPal Payouts (Carlos, 2026-10-03).
--
-- The creator saves the email of their PayPal account and withdraws, as before,
-- the whole credited balance (from $50). PayPal's fee for sending it is paid by
-- the creator: it is taken from the amount (2%, at most $20), so the creator
-- receives `net` = `amount` - `fee` in their PayPal account.
--
-- Flow (api/paypal.ts, action 'payout'):
--   1. paypal_payout_start records the withdrawal as 'sending' (the balance drops
--      at once, so it can't be withdrawn twice).
--   2. The server sends `net` with PayPal Payouts (the payout id is PayPal's
--      sender_batch_id, so a retry can't pay twice).
--   3. paypal_payout_mark sets 'paid' when PayPal confirms it, or 'failed' when
--      PayPal can't deliver it (the money goes back to the creator's balance).
--      The webhook reports the final result of each payout.
--
-- Without PayPal set up (local mode, tests) request_payout still records the
-- withdrawal as paid at once.

alter table public.payout_accounts add column if not exists paypal_email text
  check (paypal_email is null or paypal_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$');
alter table public.payout_accounts alter column holder drop not null;
alter table public.payout_accounts alter column bank drop not null;
alter table public.payout_accounts alter column account_last4 drop not null;

alter table public.payouts drop constraint payouts_status_check;
alter table public.payouts add constraint payouts_status_check check (status in ('sending', 'paid', 'failed'));
alter table public.payouts alter column paid_at drop not null;
alter table public.payouts add column if not exists fee numeric(12, 2) not null default 0;
alter table public.payouts add column if not exists net numeric(12, 2);
alter table public.payouts add column if not exists paypal_batch_id text;
alter table public.payouts add column if not exists paypal_item_id text;
alter table public.payouts add column if not exists error text;
update public.payouts set net = amount where net is null;

-- PayPal's fee for sending a withdrawal: 2%, at most $20 (confirm it in PayPal's fee page).
create or replace function public.payout_fee(p_amount numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select least(round(p_amount * 0.02, 2), 20.00);
$$;

-- Credited balance = creator's share of payments made before this month's 1st
-- (UTC) - withdrawals, except those PayPal couldn't deliver.
create or replace function public.creator_available_balance(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    round(coalesce((select sum(t.amount * t.creator_share) from public.transactions t
                    where t.creator_profile_id = p.creator_profile_id and t.status = 'paid'
                      and t.created_at < date_trunc('month', now() at time zone 'utc') at time zone 'utc'), 0), 2)
    - coalesce((select sum(x.amount) from public.payouts x where x.user_id = p.id and x.status <> 'failed'), 0)
  from public.profiles p where p.id = p_user;
$$;

-- Checks shared by both ways of withdrawing; returns the creator's PayPal email.
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
  if v_available < 50 then
    raise exception 'Necesitas al menos $50.00 USD acreditados para retirar; tu saldo disponible es $%',
      to_char(v_available, 'FM999,999,990.00');
  end if;
  return v_email;
end;
$$;

create or replace function public.payout_label(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'PayPal · ' || left(split_part(p_email, '@', 1), 2) || '•••@' || split_part(p_email, '@', 2);
$$;

-- Server (PayPal set up): records the withdrawal as 'sending' and says what to send.
create or replace function public.paypal_payout_start(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.payout_checks(p_user);
  v_available numeric := public.creator_available_balance(p_user);
  v_fee numeric := public.payout_fee(v_available);
  v_id uuid;
begin
  insert into public.payouts (user_id, creator_name, amount, fee, net, account_label, available_before, status, paid_at, scheduled_for)
  values (p_user, (select name from public.profiles where id = p_user), v_available, v_fee, v_available - v_fee,
          public.payout_label(v_email), v_available, 'sending', null, current_date)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'amount', v_available, 'fee', v_fee, 'net', v_available - v_fee, 'email', v_email);
end;
$$;

-- Server: PayPal's answer for a withdrawal. 'paid' only from 'sending'; 'failed'
-- also after 'paid' (PayPal returned it, e.g. unclaimed for 30 days).
create or replace function public.paypal_payout_mark(p_id uuid, p_status text, p_batch_id text, p_item_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payouts
    set status = p_status,
        paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
        paypal_batch_id = coalesce(p_batch_id, paypal_batch_id),
        paypal_item_id = coalesce(p_item_id, paypal_item_id),
        error = case when p_status = 'failed' then left(p_error, 500) else null end
    where id = p_id
      and ((p_status = 'paid' and status = 'sending')
        or (p_status = 'failed' and status in ('sending', 'paid'))
        or (p_status = 'sending' and status = 'sending'));
$$;

-- Without PayPal (local mode, tests): the withdrawal is recorded as paid at once.
create or replace function public.request_payout()
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.payout_checks(auth.uid());
  v_available numeric := public.creator_available_balance(auth.uid());
  v_fee numeric := public.payout_fee(v_available);
begin
  insert into public.payouts (user_id, creator_name, amount, fee, net, account_label, available_before, status, paid_at, scheduled_for)
  values (auth.uid(), (select name from public.profiles where id = auth.uid()), v_available, v_fee, v_available - v_fee,
          public.payout_label(v_email), v_available, 'paid', now(), current_date);
  return v_available;
end;
$$;

revoke execute on function public.payout_checks(uuid) from public, anon, authenticated;
revoke execute on function public.paypal_payout_start(uuid) from public, anon, authenticated;
revoke execute on function public.paypal_payout_mark(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.paypal_payout_start(uuid) to service_role;
grant execute on function public.paypal_payout_mark(uuid, text, text, text, text) to service_role;
revoke execute on function public.creator_available_balance(uuid) from public, anon, authenticated;
revoke execute on function public.request_payout() from public, anon;
grant execute on function public.request_payout() to authenticated;
