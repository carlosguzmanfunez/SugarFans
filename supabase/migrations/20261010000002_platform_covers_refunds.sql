-- Creator Agreement 6.2.3: a refund or chargeback is taken from the creator only
-- when the fault was theirs. PayPal doesn't say whose fault it was, so
-- paypal_money_back always takes it out; an admin then marks the ones that
-- weren't the creator's ("Lo cubre Fans Reserve") and the creator keeps their
-- part (the platform absorbs the loss). Works the same for a frozen dispute.
-- Additive and safe to re-run.

alter table public.transactions add column if not exists platform_covers boolean not null default false;

-- Same as 20261003000007, plus the sales Fans Reserve covers.
create or replace function public.creator_available_balance(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    round(coalesce((select sum(t.amount * t.creator_share) from public.transactions t
                    where t.creator_profile_id = p.creator_profile_id
                      and (t.status = 'paid' or (t.platform_covers and t.status in ('refunded', 'disputed')))
                      and t.created_at < date_trunc('month', now() at time zone 'utc') at time zone 'utc'), 0), 2)
    - coalesce((select sum(x.amount) from public.payouts x where x.user_id = p.id and x.status <> 'failed'), 0)
  from public.profiles p where p.id = p_user;
$$;
revoke execute on function public.creator_available_balance(uuid) from public, anon, authenticated;

-- Admin: the creator keeps (p_cover) or loses their part of a refunded or disputed sale.
-- A referral bonus paid on that sale follows it.
create or replace function public.admin_cover_refund(p_transaction uuid, p_cover boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  if not public.is_admin() then
    raise exception 'Esta acción no está permitida';
  end if;
  select * into t from public.transactions where id = p_transaction for update;
  if t.id is null or t.status not in ('refunded', 'disputed') or t.kind = 'referral' then
    raise exception 'Solo se cubre una venta reembolsada o en disputa';
  end if;
  update public.transactions set platform_covers = coalesce(p_cover, false)
    where id = t.id or (key = 'bonus:' || t.id::text and kind = 'referral');
end;
$$;
revoke execute on function public.admin_cover_refund(uuid, boolean) from public, anon;
grant execute on function public.admin_cover_refund(uuid, boolean) to authenticated;
