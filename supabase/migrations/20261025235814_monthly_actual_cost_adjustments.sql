-- Approved replacement policy: signed differences preserve the original split.
-- Both directions wait for the following calendar month's scheduled payout.
-- Existing decisions retain their policy, amounts, eligibility and evidence.
alter table finance_private.collection_cost_resolutions add column policy_version text not null default 'legacy-absorb-v1';
alter table finance_private.collection_cost_resolutions alter column policy_version set default 'actual-cost-next-month-v2';
alter table finance_private.collection_cost_resolutions drop constraint collection_cost_resolutions_creator_credit_check;
alter table finance_private.collection_cost_resolutions add constraint collection_cost_signed_bounds check(abs(creator_credit)<=100000 and creator_credit::text<>'NaN');
alter table finance_private.collection_credit_updates drop constraint collection_credit_updates_remaining_credit_check;
alter table finance_private.collection_credit_updates add constraint collection_cost_remaining_bounds check(abs(remaining_credit)<=100000 and remaining_credit::text<>'NaN');
alter table public.finance_fee_resolutions add column schedule_policy text not null default 'legacy-date-v1';
alter table public.finance_fee_resolutions alter column schedule_policy set default 'next-calendar-month-v2';

create function finance_private.cost_adjustment_open(p_at timestamptz)returns timestamptz language sql immutable set search_path=''as $$
 select(date_trunc('month',p_at at time zone 'America/Tegucigalpa')+interval '1 month 25 days')at time zone 'America/Tegucigalpa';
$$;
create function finance_private.cost_adjustment_eligible(p_at timestamptz)returns timestamptz language sql immutable set search_path=''as $$
 select finance_private.cost_adjustment_open(p_at)-interval '1 microsecond';
$$;

-- The reserved references below identify cost decisions, not ordinary manual
-- corrections or refunds. Apply the same future date to positive and negative
-- cost differences. An explicit reversal keeps its original eligibility.
do $$declare definition text;anchor text;begin
 definition:=replace(pg_get_functiondef('finance_private.creator_adjust_core(uuid,numeric,text,uuid,text,uuid)'::regprocedure),chr(13),'');
 anchor:='v_eligible:=case when p_amount<0 then ''-infinity''::timestamptz else now() end;';
 if position(anchor in definition)=0 then raise exception 'Revisar la fecha de incorporación de correcciones';end if;
 execute replace(definition,anchor,$new$v_eligible:=case when trim(p_reference)~'^(COBRO/|payout-fee/)[0-9a-fA-F-]{36}$'
  then finance_private.cost_adjustment_eligible(now())when p_amount<0 then '-infinity'::timestamptz else now()end;$new$);
end$$;

create or replace function finance_private.collection_cost_plan(p_kind text,p_id uuid)returns jsonb language plpgsql stable set search_path=''as $$
declare s finance_private.collection_cost_sources;r finance_private.collection_receipts;d finance_private.collection_cost_resolutions;
 t public.transactions;baseline numeric;ratio numeric;change numeric:=0;old_gain numeric;correct_gain numeric;who uuid;issue text;v jsonb;last_issue text;eligible timestamptz;opens timestamptz;platform_change numeric:=0;
begin
 select *into s from finance_private.collection_cost_sources where kind=p_kind and id=p_id;
 if s.id is null then return jsonb_build_object('issue','No encontramos ese cobro.');end if;
 r:=finance_private.collection_cost_receipt(p_kind,p_id);select *into d from finance_private.collection_cost_resolutions where kind=p_kind and source_id=p_id;
 select result->>'issue'into last_issue from finance_private.collection_cost_queries where kind=p_kind and source_id=p_id order by sequence desc limit 1;
 baseline:=case when p_kind='coins'then coalesce(s.recorded_fee,public.gateway_fee_estimate(s.gross))else s.recorded_fee end;
 eligible:=finance_private.cost_adjustment_eligible(now());opens:=finance_private.cost_adjustment_open(now());
 if r.id is null then issue:='Falta consultar y comprobar el costo original de PayPal.';
 elsif d.id is null and s.collection_fee_status<>'verified'and p_kind='sale'then
  select *into t from public.transactions where id=p_id;
  if t.status<>'paid'or t.refunded_amount<>0 or t.creator_refund_loss<>0 or exists(select 1 from finance_private.income_disputes where payment_ref=s.reference)then
   issue:='La venta tiene devolución, disputa o historial especial; revisa su expediente antes de ajustar el costo.';
  elsif r.fee is distinct from baseline and exists(select 1 from public.transactions where kind='referral'and key='bonus:'||t.id::text)then
   issue:='La venta tiene una bonificación por invitación. Hay que revisar su límite e historial; no se recalculará automáticamente.';
  elsif baseline is null or baseline::text='NaN'or baseline<0 or t.amount-baseline-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0)<=0 then
   issue:='Falta la base de costo original; no se puede inventar lo que se descontó al creador.';
  else
   ratio:=t.amount*t.creator_share/(t.amount-baseline-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0));
   if ratio is null or ratio<0 or ratio>1 or ratio::text='NaN'or t.amount-r.fee-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0)<0 then issue:='El reparto original requiere revisar su contrato.';
   else old_gain:=round(t.amount*t.creator_share,2);correct_gain:=round((t.amount-r.fee-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0))*ratio,2);change:=correct_gain-old_gain;end if;
   if change<>0 then
    select id into who from public.profiles where creator_profile_id=s.creator_profile_id and role='creator';
    if(select count(*)from public.profiles where creator_profile_id=s.creator_profile_id and role='creator')<>1 then issue:='Revisa quién es el propietario del saldo antes de corregirlo.';end if;
   end if;
  end if;
 end if;
 if last_issue is not null then issue:='Falta aclarar el último comprobante consultado: '||last_issue;end if;
 if s.reference is not null and(select count(*)from finance_private.collection_cost_sources where reference=s.reference)<>1 then issue:='La referencia corresponde a más de un cobro; revisa el historial antes de corregirlo.';end if;
 if d.id is null and exists(select 1 from public.finance_adjustments where reference='COBRO/'||p_id::text)then issue:='Ya existe una corrección con esta referencia; revisa el historial antes de corregir otra vez.';end if;
 if abs(change)>100000 then issue:='El ajuste supera el límite de una corrección supervisada; requiere revisión contable.';end if;
 if d.id is not null then
  change:=d.creator_credit;baseline:=d.comparison_fee;ratio:=(d.before_snapshot#>>'{preview,original_ratio}')::numeric;
  old_gain:=case when p_kind='sale'then round((d.before_snapshot->>'amount')::numeric*(d.before_snapshot->>'creator_share')::numeric,2)end;
  correct_gain:=old_gain+change;
  select a.eligible_at,a.user_id into eligible,who from public.finance_adjustments a where a.id=d.adjustment_id;
  opens:=case when eligible is not null and isfinite(eligible)then public.earnings_cycle_start(eligible)+interval '1 month'end;
  if exists(select 1 from finance_private.collection_manual_changes(d.id))then issue:='Este ajuste tiene una reversión manual. Revisa sus correcciones y el bloqueo antes de continuar.';end if;
 end if;
 platform_change:=baseline-r.fee-change;
 v:=jsonb_build_object('issue',issue,'kind',p_kind,'id',p_id,'reference',s.reference,'creator',s.creator,'gross',s.gross,'recorded_fee',s.recorded_fee,
  'comparison_fee',baseline,'comparison_is_estimate',p_kind='coins'and s.recorded_fee is null,'actual_fee',r.fee,'receipt',r.id,
  'fee_difference',r.fee-baseline,'creator_credit',greatest(0,change),'creator_debit',greatest(0,-change),'creator_delta',change,'creator_user',who,'original_ratio',ratio,
  'original_earning',old_gain,'corrected_earning',correct_gain,'platform_delta',platform_change,'platform_extra_cost',case when d.policy_version='legacy-absorb-v1'then d.platform_extra_cost else 0 end,
  'policy_version',coalesce(d.policy_version,'actual-cost-next-month-v2'),'eligible_at',eligible,'scheduled_from',opens,
  'scheduled_until',case when opens is not null then( date_trunc('month',opens at time zone 'America/Tegucigalpa')+interval '1 month 1 day')at time zone 'America/Tegucigalpa'end,
  'needs_resolution',d.id is null and s.collection_fee_status<>'verified','resolution',d.id,'adjustment',d.adjustment_id,'resolved_credit',d.creator_credit,'resolved_at',d.created_at,
  'active_credit',case when d.id is null then null else coalesce((select remaining_credit from finance_private.collection_credit_updates where resolution_id=d.id order by revision desc limit 1),d.creator_credit)+coalesce((select sum(amount)from finance_private.collection_manual_changes(d.id)),0)end);
 return v||jsonb_build_object('hash',md5((s.original||v)::text));
end$$;

-- Preserve the prior replay, stale-preview, evidence and event recheck controls.
do $$declare definition text;anchor text;begin
 definition:=replace(pg_get_functiondef('public.finance_collection_resolve(text,uuid,uuid,text,text,text)'::regprocedure),chr(13),'');
 definition:=replace(definition,'''creator_credit''','''creator_delta''');
 anchor:='if(v->>''creator_delta'')::numeric>0 then';
 if position(anchor in definition)=0 then raise exception 'Revisar la creación de diferencias de cobro';end if;
 definition:=replace(definition,anchor,'if(v->>''creator_delta'')::numeric<>0 then');
 definition:=replace(definition,'''Costo de cobro comprobado; devolución de estimación excesiva. ''||trim(p_reason)',
  $new$'Ajuste del costo de recibir el pago. Estimado USD '||(v->>'comparison_fee')||'; comprobado USD '||(v->>'actual_fee')||'; variación del creador USD '||(v->>'creator_delta')||'. Se incorpora al pago mensual desde '||to_char((v->>'scheduled_from')::timestamptz at time zone 'America/Tegucigalpa','DD/MM/YYYY')||'. '||trim(p_reason)$new$);
 execute definition;
end$$;

create or replace function finance_private.sync_collection_credit()returns trigger language plpgsql security definer set search_path=''as $$
declare d finance_private.collection_cost_resolutions;t public.transactions;last_credit finance_private.collection_credit_updates;
 original_adjustment public.finance_adjustments;a public.finance_adjustments;new_source uuid;eligible timestamptz;
 wanted numeric;original_gain numeric;new_gain numeric;old_current numeric;refund_core numeric;ratio numeric;service_back numeric;tax_back numeric;delta numeric;
begin
 select *into d from finance_private.collection_cost_resolutions where kind='sale'and source_id=coalesce(new.id,old.id);
 if d.id is null then return null;end if;perform finance_private.lock_book();select *into t from public.transactions where id=d.source_id;
 if t.id is null or jsonb_build_array(t.amount,t.creator_share,t.gateway_fee,t.key,t.paypal_ref,t.creator_profile_id,t.created_at,t.service_fee,t.tax_amount)is distinct from
  jsonb_build_array((d.before_snapshot->>'amount')::numeric,(d.before_snapshot->>'creator_share')::numeric,(d.before_snapshot->>'gateway_fee')::numeric,d.before_snapshot->>'key',d.before_snapshot->>'paypal_ref',d.before_snapshot->>'creator_profile_id',(d.before_snapshot->>'created_at')::timestamptz,(d.before_snapshot->>'service_fee')::numeric,(d.before_snapshot->>'tax_amount')::numeric)then raise exception 'Conservar la base original de la venta conciliada';end if;
 if d.creator_credit=0 then return null;end if;
 select *into original_adjustment from public.finance_adjustments where id=d.adjustment_id;
 select *into last_credit from finance_private.collection_credit_updates where resolution_id=d.id order by revision desc limit 1;
 if exists(select 1 from finance_private.collection_manual_changes(d.id))then
  perform finance_private.place_hold(original_adjustment.user_id,'safety','collection-cost/'||d.id,'Hay una reversión manual del ajuste de costo. Revisar antes de volver a modificarlo.');return null;end if;
 ratio:=(d.before_snapshot#>>'{preview,original_ratio}')::numeric;
 if t.platform_covers and t.status in('paid','refunded','disputed')then wanted:=d.creator_credit;
 elsif t.status in('failed','refunded','disputed')then wanted:=0;
 elsif t.status='paid'and t.refunded_amount=0 then wanted:=d.creator_credit;
 else
  service_back:=0;tax_back:=0;
  if coalesce(t.service_fee,0)<>0 or coalesce(t.tax_amount,0)<>0 then
   select(result->>'service_refund')::numeric,(result->>'tax_refund')::numeric into service_back,tax_back from public.finance_case_actions
    where action='refund_resolution'and result->>'payment_ref'=coalesce(t.paypal_ref,case when t.key like'paypal-sub:%'then split_part(t.key,':',3)end)
    and(result->>'refunded_amount')::numeric=t.refunded_amount order by sequence desc limit 1;
   if service_back is null or tax_back is null then
    perform finance_private.place_hold(original_adjustment.user_id,'safety','collection-cost/'||d.id,'Falta el desglose de la devolución para revisar el ajuste del costo.');return null;end if;
  end if;
  original_gain:=round(t.amount*t.creator_share,2);old_current:=greatest(0,round(original_gain-t.creator_refund_loss,2));
  refund_core:=t.refunded_amount-t.refunded_gateway_fee-service_back-tax_back;
  new_gain:=greatest(0,round((t.amount-d.actual_fee-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0)-refund_core)*ratio,2));
  wanted:=greatest(least(0,d.creator_credit),least(greatest(0,d.creator_credit),new_gain-old_current));
 end if;
 delta:=wanted-last_credit.remaining_credit;if delta=0 then return null;end if;
 eligible:=case when d.policy_version='legacy-absorb-v1'then original_adjustment.eligible_at else greatest(original_adjustment.eligible_at,finance_private.cost_adjustment_eligible(now()))end;
 insert into public.finance_adjustments(request_key,user_id,creator_profile_id,amount,eligible_at,reason,reference,created_by)
 values(gen_random_uuid(),original_adjustment.user_id,original_adjustment.creator_profile_id,delta,eligible,
  'El ajuste del costo sigue el resultado de su venta; resolución '||d.id||'. Variación USD '||delta||'. Incorporación al ciclo que cierra el '||to_char((eligible+interval '1 microsecond')at time zone 'America/Tegucigalpa','DD/MM/YYYY')||'.',
  'COBRO/'||d.source_id||'/'||(last_credit.revision+1),d.actor)returning *into a;
 insert into public.finance_sources(creator_profile_id,kind,reference,amount,eligible_at,revision,snapshot)
 values(a.creator_profile_id,'adjustment',a.id::text,a.amount,a.eligible_at,1,to_jsonb(a))returning id into new_source;
 insert into public.finance_source_revisions(source_id,revision,before_amount,after_amount,before_eligible_at,after_eligible_at,snapshot)
 values(new_source,1,0,a.amount,a.eligible_at,a.eligible_at,to_jsonb(a));
 perform finance_private.post('adjustment/'||a.id,a.creator_profile_id,case when delta>0 then'operating_clearing'else'creator_payable'end,
  case when delta>0 then'creator_payable'else'operating_clearing'end,abs(delta),'collection_cost_credit',a.id::text,to_jsonb(a));
 insert into finance_private.collection_credit_updates(resolution_id,revision,delta,remaining_credit,adjustment_id,snapshot)
 values(d.id,last_credit.revision+1,delta,wanted,a.id,to_jsonb(t));perform finance_private.review_changed(a.creator_profile_id);return null;
end$$;

-- Payout charges belong wholly to the creator. Only their timing changes; the
-- actual-cost policy switch, proof validation, amount and clearing stay intact.
do $$declare definition text;anchor text;begin
 definition:=replace(pg_get_functiondef('finance_private.fee_basis(uuid)'::regprocedure),chr(13),'');
 anchor:='v:=jsonb_build_object(''line'',l.id,';
 if position(anchor in definition)=0 then raise exception 'Revisar la vista previa de costos de envío';end if;
 execute replace(definition,anchor,$new$v:=jsonb_build_object('scheduled_from',finance_private.cost_adjustment_open(now()),'scheduled_until',(date_trunc('month',finance_private.cost_adjustment_open(now())at time zone 'America/Tegucigalpa')+interval '1 month 1 day')at time zone 'America/Tegucigalpa','line',l.id,$new$);
 definition:=replace(pg_get_functiondef('public.finance_fee_resolve(uuid,uuid,text,text,text)'::regprocedure),chr(13),'');
 anchor:='v_adjust:=(finance_private.creator_adjust_core((v->>''user_id'')::uuid,v_delta,trim(p_reason),v_id,';
 if position(anchor in definition)=0 then raise exception 'Revisar la explicación de correcciones de envío';end if;
 execute replace(definition,anchor,$new$v_adjust:=(finance_private.creator_adjust_core((v->>'user_id')::uuid,v_delta,'Ajuste del costo de enviar el pago. Apartado USD '||(v->>'estimated_fee')||'; comprobado USD '||(v->>'actual_fee')||'; variación del creador USD '||v_delta||'. Se incorpora al pago mensual desde '||to_char((v->>'scheduled_from')::timestamptz at time zone 'America/Tegucigalpa','DD/MM/YYYY')||'. '||trim(p_reason),v_id,$new$);
end$$;
revoke all on function finance_private.cost_adjustment_open(timestamptz),finance_private.cost_adjustment_eligible(timestamptz)from public,anon,authenticated,service_role;

-- The creator sees their own marginal explanation and scheduling, without
-- administrative proof payloads or a financial write to obtain the statement.
create view finance_private.scheduled_cost_adjustments as
 select a.id,a.user_id,a.amount,a.eligible_at,a.created_at,a.reason,r.comparison_fee as estimated_fee,r.actual_fee,
  'collection'::text as cost_kind,r.source_id::text as source_reference,r.policy_version,exists(select 1 from public.finance_adjustments rev where rev.reverses=a.id)as reversed
 from finance_private.collection_cost_resolutions r cross join lateral(
  select u.adjustment_id as id from finance_private.collection_credit_updates u where u.resolution_id=r.id
  union select m.id from finance_private.collection_manual_changes(r.id)m
 )linked join public.finance_adjustments a on a.id=linked.id
 union all
 select a.id,a.user_id,a.amount,a.eligible_at,a.created_at,a.reason,r.estimated_fee,r.actual_fee,
  'payout',r.payout_id::text,r.policy_version||'/'||r.schedule_policy,exists(select 1 from public.finance_fee_reversals z where z.resolution_id=r.id)
 from public.finance_adjustments a join public.finance_fee_resolutions r on r.adjustment_id=a.id;
revoke all on finance_private.scheduled_cost_adjustments from public,anon,authenticated,service_role;
alter function public.finance_creator_balance()rename to balance_before_monthly_costs;
alter function public.balance_before_monthly_costs()set schema finance_private;
revoke all on function finance_private.balance_before_monthly_costs()from public,anon,authenticated,service_role;
create function public.finance_creator_balance()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare v jsonb;begin
 v:=finance_private.balance_before_monthly_costs();
 return v||jsonb_build_object('cost_adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'amount',a.amount,'estimated_fee',a.estimated_fee,'actual_fee',a.actual_fee,
  'kind',a.cost_kind,'source_reference',a.source_reference,'reason',a.reason,'created_at',a.created_at,'eligible_at',a.eligible_at,'reversed',a.reversed,
  'scheduled_from',case when isfinite(a.eligible_at)then public.earnings_cycle_start(a.eligible_at)+interval '1 month'end,
  'pending',a.eligible_at>=public.payout_credit_cutoff(now()))order by a.created_at desc,a.id)
 from finance_private.scheduled_cost_adjustments a where a.user_id=auth.uid()),'[]'));
end$$;
revoke all on function public.finance_creator_balance()from public,anon,service_role;
grant execute on function public.finance_creator_balance()to authenticated;
select pg_notify('pgrst','reload schema');
