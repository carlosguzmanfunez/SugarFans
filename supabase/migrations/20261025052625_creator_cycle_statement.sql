-- Read-only operational statement. No balance, source or payment is rewritten.
-- One JSON document avoids PostgREST's row limit and uses a single DB snapshot.
create function public.finance_creator_statement(p_cycle date,p_creator uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare who uuid:=coalesce(p_creator,auth.uid());p public.profiles;from_at timestamptz;until_at timestamptz;document jsonb;
begin
 if auth.uid() is null then raise exception 'Inicia sesión para consultar el estado de cuenta';end if;
 if who is distinct from auth.uid() then perform finance_private.assert_admin();end if;
 select * into p from public.profiles where id=who and creator_profile_id is not null;
 if p.id is null then raise exception 'No encontramos una cuenta de creador';end if;
 if p_cycle is null or extract(day from p_cycle)<>26 or p_cycle<date '2000-01-26' then
  raise exception 'Elige un ciclo que comience el día 26';end if;
 from_at:=p_cycle::timestamp at time zone 'America/Tegucigalpa';
 until_at:=(p_cycle+interval '1 month')::timestamp at time zone 'America/Tegucigalpa';
 if from_at>public.earnings_cycle_start(now()) then raise exception 'Ese ciclo todavía no ha comenzado';end if;
 if exists(select 1 from public.transactions t where t.creator_profile_id=p.creator_profile_id and t.created_at>=from_at and t.created_at<until_at
  and not exists(select 1 from public.finance_sources s where s.creator_profile_id=p.creator_profile_id and s.kind='transaction'and s.reference=t.id::text))then
  raise exception 'Falta registrar un movimiento en los libros; solicita una revisión antes de descargar el ciclo';end if;
 with source_dates as (
  select s.*,case when isfinite(s.eligible_at) then s.eligible_at else coalesce(original.created_at,a.created_at)end as statement_at
  from public.finance_sources s left join public.finance_adjustments a on s.kind='adjustment'and a.id::text=s.reference
  left join public.finance_adjustments original on original.id=a.reverses
  where s.creator_profile_id=p.creator_profile_id
 ), period_sources as(select * from source_dates where statement_at>=from_at and statement_at<until_at),
 sale_basis as (
  select s.id as source_id,s.reference,s.amount as earnings,s.statement_at,t.kind,t.status,t.amount,t.gateway_fee,
   t.service_fee,t.tax_amount,t.collection_fee_status,t.refunded_amount,t.refunded_gateway_fee,t.platform_covers,
   round(case when t.status<>'failed' then t.amount*t.creator_share else 0 end,2) as original_gain,
   round(case when t.status in('refunded','disputed') then t.amount*t.creator_share when t.status='paid' then t.creator_refund_loss else 0 end,2)as affected_gain
  from period_sources s left join public.transactions t on s.kind='transaction'and t.id::text=s.reference where s.kind='transaction'
 ), sale_lines as (
  select source_id,statement_at,jsonb_build_object('id',source_id,'reference',reference,'at',statement_at,'kind',coalesce(kind,'removed'),
   'status',coalesce(status,'removed'),'value',coalesce(amount,0),'collection_fee',case when kind not in('gift','referral')then gateway_fee end,
   'collection_status',case when kind in('gift','referral')then 'not_applicable'else collection_fee_status end,
   'service',coalesce(service_fee,0),'tax',coalesce(tax_amount,0),
   'platform_part',case when kind<>'referral'and gateway_fee is not null then round(amount-gateway_fee-coalesce(service_fee,0)-coalesce(tax_amount,0)-coalesce(original_gain,0),2)end,
   'original_earnings',coalesce(original_gain,0),'returned_to_fan',coalesce(refunded_amount,0),'returned_collection_fee',coalesce(refunded_gateway_fee,0),
   'creator_loss',case when platform_covers then 0 else coalesce(affected_gain,0)end,
   'covered_by_platform',case when platform_covers then coalesce(affected_gain,0)else 0 end,
   'rounding',earnings-(coalesce(original_gain,0)-case when platform_covers then 0 else coalesce(affected_gain,0)end),
   'adjustment',0,'earnings',earnings,'note',null)as line from sale_basis
 ), adjustment_lines as (
  select s.id as source_id,s.statement_at,jsonb_build_object('id',s.id,'reference',s.reference,'at',s.statement_at,'kind','adjustment','status','recorded',
   'value',0,'collection_fee',null,'collection_status','not_applicable','service',0,'tax',0,'platform_part',null,
   'original_earnings',0,'returned_to_fan',0,'returned_collection_fee',0,'creator_loss',0,'covered_by_platform',0,'rounding',0,
   'adjustment',s.amount,'earnings',s.amount,'note',a.reason)as line
  from period_sources s join public.finance_adjustments a on a.id::text=s.reference where s.kind='adjustment'
 ), lines as(select * from sale_lines union all select * from adjustment_lines),
 allocation_rows as (
  select a.id,a.amount,coalesce(x.id::text,'batch:'||i.id::text)as reference,x.id as payout_id,i.id as item_id,
   coalesce(x.status,i.state)as state,i.reason,x.amount as payout_gross,x.net as delivered,x.fee as estimated_fee,x.requested_at as payout_at,x.paid_at,
   exists(select 1 from finance_private.active_allocations active where active.id=a.id)as active
  from public.finance_allocations a join period_sources s on s.id=a.source_id
  left join public.finance_batch_items i on i.id=a.batch_item_id
  left join public.payouts x on x.id=a.payout_id or x.finance_batch_item_id=i.id
 ), payments as (
  select reference,payout_id,item_id,state,reason,sum(amount)as from_cycle,max(payout_gross)as payout_gross,max(delivered)as delivered,
   max(estimated_fee)as estimated_fee,max(payout_at)as created_at,max(paid_at)as paid_at,bool_or(active)as active,
   (select r.actual_fee from public.finance_fee_resolutions r where r.payout_id=allocation_rows.payout_id
    and not exists(select 1 from public.finance_fee_reversals z where z.resolution_id=r.id)order by r.sequence desc limit 1)as actual_fee
  from allocation_rows group by reference,payout_id,item_id,state,reason
 ), totals as (
  select coalesce(sum((line->>'original_earnings')::numeric),0)as original_earnings,
   coalesce(sum((line->>'creator_loss')::numeric),0)as creator_loss,
   coalesce(sum((line->>'covered_by_platform')::numeric),0)as covered_by_platform,
   coalesce(sum((line->>'rounding')::numeric),0)as rounding,coalesce(sum((line->>'adjustment')::numeric),0)as adjustments,
   coalesce(sum((line->>'earnings')::numeric),0)as earnings,
   coalesce(sum((line->>'value')::numeric)filter(where line->>'kind'not in('gift','referral','adjustment')and line->>'status'<>'failed'),0)as fan_payments,
   coalesce(sum((line->>'collection_fee')::numeric)filter(where line->>'status'<>'failed'),0)as known_collection_fees,
   count(*)filter(where line->>'kind'not in('gift','referral','adjustment')and line->>'status'<>'failed'and line->>'collection_fee'is null)as unknown_collection_fees,
   count(*)filter(where line->>'collection_status'='estimated'and line->>'status'<>'failed')as estimated_collection_fees,
   coalesce(sum((line->>'platform_part')::numeric)filter(where line->>'kind'not in('gift','referral','adjustment')and line->>'status'<>'failed'),0)as platform_part,
   coalesce(sum((line->>'service')::numeric)filter(where line->>'status'<>'failed'),0)as service,
   coalesce(sum((line->>'tax')::numeric)filter(where line->>'status'<>'failed'),0)as tax,
   coalesce(sum((line->>'returned_to_fan')::numeric)filter(where line->>'kind'not in('gift','referral','adjustment')),0)as returned_cash,
   coalesce(sum((line->>'returned_collection_fee')::numeric)filter(where line->>'kind'not in('gift','referral','adjustment')),0)as returned_collection_fees,
   count(*)as movement_count from lines
 ), use_totals as (
  select coalesce(sum(from_cycle)filter(where active and state='paid'),0)as paid,
   coalesce(sum(from_cycle)filter(where active and state='sending'),0)as sending,
   coalesce(sum(from_cycle)filter(where active and payout_id is null),0)as reserved from payments
 )
 select jsonb_build_object('version',1,'currency','USD','as_of',now(),'creator',p.name,
  'cycle',jsonb_build_object('start',from_at,'end',until_at,'closed',until_at<=public.payout_credit_cutoff(now()),
   'payment_start',until_at,'payment_end',(date_trunc('month',p_cycle+interval '1 month')+interval '1 month 1 day')at time zone 'America/Tegucigalpa'),
  'totals',to_jsonb(totals)||to_jsonb(use_totals)||jsonb_build_object('unallocated',totals.earnings-use_totals.paid-use_totals.sending-use_totals.reserved),
  'movements',coalesce((select jsonb_agg(line order by statement_at,source_id)from lines),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(to_jsonb(payments)order by created_at nulls last,reference)from payments),'[]'::jsonb),
  'holds',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'kind',h.kind,'created_at',h.created_at))from public.finance_payout_holds h
   where h.user_id=who and not exists(select 1 from public.finance_hold_releases r where r.hold_id=h.id)),'[]'::jsonb),
  'unassigned_historical_payouts',(select count(*)from public.payouts x where x.user_id=who and not exists(select 1 from public.finance_allocations a
    left join public.finance_batch_items i on i.id=a.batch_item_id where a.payout_id=x.id or x.finance_batch_item_id=i.id)))into document from totals cross join use_totals;
 return document;
end$$;
revoke all on function public.finance_creator_statement(date,uuid)from public,anon,authenticated,service_role;
grant execute on function public.finance_creator_statement(date,uuid)to authenticated;
comment on function public.finance_creator_statement(date,uuid)is 'Current creator cycle statement. No fee is charged or recalculated. Includes every persisted movement and explicitly identified allocation.';
select pg_notify('pgrst','reload schema');
