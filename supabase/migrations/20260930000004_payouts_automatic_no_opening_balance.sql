-- Creator balance is only 80% of what fans paid (no demo opening balance), and
-- payouts need no admin step: a request is confirmed at once and becomes paid
-- automatically on its scheduled date (the 1st of next month).

drop function public.process_payout(uuid, boolean);
drop table public.creator_opening_balances;

delete from public.payouts where status = 'rejected';
alter table public.payouts drop constraint payouts_status_check;
alter table public.payouts add constraint payouts_status_check check (status in ('scheduled', 'paid'));
alter table public.payouts rename column processed_at to paid_at;
alter table public.payouts add column available_before numeric(12, 2) not null default 0;

-- Balance = 80% of paid charges - payouts.
create or replace function public.creator_available_balance(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    round(coalesce((select sum(t.amount) from public.transactions t
                    where t.creator_profile_id = p.creator_profile_id and t.status = 'paid'), 0) * 0.8, 2)
    - coalesce((select sum(x.amount) from public.payouts x where x.user_id = p.id), 0)
  from public.profiles p where p.id = p_user;
$$;

-- Confirmed on request and paid on the 1st of next month.
-- INTEGRATION: Stripe Connect / PayPal Payouts would send the money on that date.
create or replace function public.request_payout(p_amount numeric)
returns void
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
  if p_amount is null or p_amount < 50 then
    raise exception 'El mínimo de retiro es $50.00 USD';
  end if;
  v_available := public.creator_available_balance(v_me.id);
  if p_amount > v_available then
    raise exception 'Tu saldo disponible es $%', to_char(v_available, 'FM999,999,990.00');
  end if;
  insert into public.payouts (user_id, creator_name, amount, account_label, scheduled_for, available_before)
  values (v_me.id, v_me.name, round(p_amount, 2), v_account.bank || ' •••• ' || v_account.account_last4,
          (date_trunc('month', current_date) + interval '1 month')::date, v_available);
end;
$$;

-- Marks every payout whose date has arrived as paid (idempotent; the app calls it
-- before listing payouts). INTEGRATION: the payout provider's webhook would do this.
create or replace function public.settle_due_payouts()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payouts set status = 'paid', paid_at = scheduled_for
  where status = 'scheduled' and scheduled_for <= current_date;
$$;

revoke execute on function public.settle_due_payouts() from public, anon;
grant execute on function public.settle_due_payouts() to authenticated;
