-- Explain an existing refund calculation. No financial row is recalculated.
-- Expose only the stored numeric components, never administrator proof or notes.
do $migration$
declare d text;anchor text;
begin
 d:=replace(pg_get_functiondef('public.finance_creator_statement(date,uuid)'::regprocedure),chr(13),'');
 anchor:='t.service_fee,t.tax_amount,t.collection_fee_status,t.refunded_amount,t.refunded_gateway_fee,t.platform_covers,';
 if position(anchor in d)=0 then raise exception 'Revisar base del estado de cuenta antes de añadir sus explicaciones';end if;
 d:=replace(d,anchor,anchor||E'\n   t.refunded_coins,t.creator_share,refund_record.basis as refund_basis,');
 anchor:=$old$from period_sources s left join public.transactions t on s.kind='transaction'and t.id::text=s.reference where s.kind='transaction'$old$;
 if position(anchor in d)=0 then raise exception 'Revisar consulta de movimientos antes de añadir sus explicaciones';end if;
 d:=replace(d,anchor,$new$from period_sources s left join public.transactions t on s.kind='transaction'and t.id::text=s.reference
  left join lateral(select a.before_snapshot||a.result as basis from public.finance_case_actions a
   where a.action='refund_resolution'and a.before_snapshot->>'kind'='contract'
    and a.result->>'payment_ref'=coalesce(t.paypal_ref,case when t.key like 'paypal-sub:%'then split_part(t.key,':',3)end)
    and (a.result->>'refunded_amount')::numeric=t.refunded_amount
   order by a.sequence desc limit 1)refund_record on true where s.kind='transaction'$new$);
 anchor:=$old$'adjustment',0,'earnings',earnings,'note',null)as line from sale_basis$old$;
 if position(anchor in d)=0 then raise exception 'Revisar salida del estado de cuenta antes de añadir sus explicaciones';end if;
 d:=replace(d,anchor,$new$'adjustment',0,'earnings',earnings,'note',null,
   'returned_gift_credits',coalesce(refunded_coins,0),
   'refund_original_cost',coalesce(gateway_fee,(refund_basis->>'collection_fee')::numeric),
   'refund_original_base',case when kind not in('gift','referral')then amount-coalesce(gateway_fee,(refund_basis->>'collection_fee')::numeric)-coalesce(service_fee,0)-coalesce(tax_amount,0)end,
   'refund_share',case when kind='gift'then creator_share when amount-coalesce(gateway_fee,(refund_basis->>'collection_fee')::numeric)-coalesce(service_fee,0)-coalesce(tax_amount,0)>0
    then amount*creator_share/(amount-coalesce(gateway_fee,(refund_basis->>'collection_fee')::numeric)-coalesce(service_fee,0)-coalesce(tax_amount,0))end,
   'refunded_service',case when refunded_amount=amount and refunded_amount>0 then coalesce(service_fee,0)when coalesce(service_fee,0)=0 then 0 else (refund_basis->>'service_refund')::numeric end,
   'refunded_tax',case when refunded_amount=amount and refunded_amount>0 then coalesce(tax_amount,0)when coalesce(tax_amount,0)=0 then 0 else (refund_basis->>'tax_refund')::numeric end,
   'refund_breakdown_known',kind='gift'or(refunded_amount>0 and(refunded_amount=amount or refund_basis is not null or(coalesce(service_fee,0)=0 and coalesce(tax_amount,0)=0 and gateway_fee is not null))))as line from sale_basis$new$);
 execute d;
end$migration$;
select pg_notify('pgrst','reload schema');
