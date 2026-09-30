-- Creator earnings are credited on the 1st of each month (everything fans paid
-- before that day) and add up until withdrawn. A withdrawal always takes the
-- whole credited balance, needs at least $50, and is paid at once.

drop function public.settle_due_payouts();
drop function public.request_payout(numeric);

update public.payouts set status = 'paid', paid_at = coalesce(paid_at, requested_at);
alter table public.payouts drop constraint payouts_status_check;
alter table public.payouts add constraint payouts_status_check check (status = 'paid');
alter table public.payouts alter column status set default 'paid';
alter table public.payouts alter column paid_at set default now();
alter table public.payouts alter column paid_at set not null;
alter table public.payouts alter column scheduled_for set default current_date;

-- Credited balance = 80% of payments made before this month's 1st (UTC) - withdrawals.
create or replace function public.creator_available_balance(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    round(coalesce((select sum(t.amount) from public.transactions t
                    where t.creator_profile_id = p.creator_profile_id and t.status = 'paid'
                      and t.created_at < date_trunc('month', now() at time zone 'utc') at time zone 'utc'), 0) * 0.8, 2)
    - coalesce((select sum(x.amount) from public.payouts x where x.user_id = p.id), 0)
  from public.profiles p where p.id = p_user;
$$;

-- Withdraws the whole credited balance and returns the amount paid.
-- INTEGRATION: Stripe Connect / PayPal Payouts would send the money here.
create or replace function public.request_payout()
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_account public.payout_accounts;
  v_available numeric;
begin
  select * into v_me from public.profiles where id = auth.uid() for update;
  if v_me.id is null or v_me.role <> 'creator' then
    raise exception 'Solo los creadores pueden retirar';
  end if;
  if not v_me.is_verified then
    raise exception 'Verifica tu identidad antes de solicitar un retiro';
  end if;
  select * into v_account from public.payout_accounts where user_id = v_me.id;
  if v_account.user_id is null then
    raise exception 'Añade una cuenta bancaria para retiros';
  end if;
  v_available := public.creator_available_balance(v_me.id);
  if v_available < 50 then
    raise exception 'Necesitas al menos $50.00 USD acreditados para retirar; tu saldo disponible es $%',
      to_char(v_available, 'FM999,999,990.00');
  end if;
  insert into public.payouts (user_id, creator_name, amount, account_label, available_before, status, paid_at, scheduled_for)
  values (v_me.id, v_me.name, v_available, v_account.bank || ' •••• ' || v_account.account_last4, v_available,
          'paid', now(), current_date);
  return v_available;
end;
$$;

revoke execute on function public.request_payout() from public, anon;
grant execute on function public.request_payout() to authenticated;
