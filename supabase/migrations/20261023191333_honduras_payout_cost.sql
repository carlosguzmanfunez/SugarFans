-- Owner-approved Honduras USD payout pricing: 2% of the transfer, at most $1.
-- Existing withdrawals and immutable provider payloads are never repriced.
-- No payment execution gate, cron, funding budget or real-cost policy is enabled.
create or replace function public.payout_fee(p_amount numeric)
returns numeric language plpgsql immutable set search_path='' as $$
declare gross bigint;lo bigint:=0;hi bigint;sent bigint;cost bigint;
begin
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount>999999999999.99 then
  raise exception 'Saldo de retiro no válido';end if;
 if p_amount<=0 then return 0;end if;
 gross:=round(p_amount*100)::bigint;hi:=gross;
 if gross>=5100 then return 1.00;end if;
 while lo<hi loop
  sent:=lo+(hi-lo+1)/2;
  cost:=least((sent+25)/50,100);
  if sent+cost<=gross then lo:=sent;else hi:=sent-1;end if;
 end loop;
 -- An unspendable rounding cent is a reservation, not platform income.
 -- The existing actual-cost settlement credits any verified difference.
 return (gross-lo)::numeric/100;
end$$;

-- Every creator pays this cost. Preserve the existing minimums and ACLs.
create or replace function public.payout_fee_for(p_user uuid,p_amount numeric)
returns numeric language sql stable security definer set search_path='' as $$
 select public.payout_fee(p_amount);
$$;

-- Old batch quotes without a prepared withdrawal must be reviewed and rebuilt.
-- Keep their original amounts, allocations and reservations until cancellation.
do $$declare d text;begin
 perform finance_private.lock_book();
 update public.finance_batch_items i set state='review',reason=case when i.state='reserved' then 'PAYOUT_FEE_POLICY_CHANGED' else coalesce(i.reason,'PAYOUT_FEE_POLICY_CHANGED') end
 where i.state in ('reserved','review') and i.fee<>public.payout_fee_for(i.user_id,i.gross)
  and not exists(select 1 from public.payouts p where p.finance_batch_item_id=i.id);
 if to_regprocedure('finance_private.reason_label(text)') is not null then
  d:=pg_get_functiondef('finance_private.reason_label(text)'::regprocedure);
  if position('case p_reason when' in d)=0 then raise exception 'Revisar los motivos de pagos antes de instalar el nuevo costo';end if;
  if position('PAYOUT_FEE_POLICY_CHANGED' in d)=0 then execute replace(d,'case p_reason when',
   'case p_reason when ''PAYOUT_FEE_POLICY_CHANGED'' then ''Cambió el costo de envío. Cancela el apartado anterior y prepara otro con el nuevo cálculo.'' when');
  end if;
 end if;
end$$;
