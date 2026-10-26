-- Review a partial refund after a full collection-fee variance was approved.
-- This decision records arithmetic and explanation only: no new debit, credit,
-- payout, refund, release, or rewrite of the original agreement.
create table finance_private.collection_refund_reviews(
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique,
 resolution_id uuid not null references finance_private.collection_cost_resolutions(id),
 user_id uuid not null references public.profiles(id), expected_hash text not null,
 snapshot jsonb not null, evidence text not null, reason text not null, actor uuid not null,
 created_at timestamptz not null default now(), unique(resolution_id,expected_hash)
);
create index collection_refund_reviews_owner on finance_private.collection_refund_reviews(user_id,created_at desc,id);
alter table finance_private.collection_refund_reviews enable row level security;
revoke all on finance_private.collection_refund_reviews from public,anon,authenticated,service_role;
create trigger collection_refund_review_immutable before update or delete on finance_private.collection_refund_reviews
 for each row execute function finance_private.immutable();

create function finance_private.collection_refund_plan(p_source uuid)returns jsonb language plpgsql stable set search_path=''as $$
declare d finance_private.collection_cost_resolutions;t public.transactions;c finance_private.collection_receipts;
 a public.finance_adjustments;review finance_private.collection_refund_reviews;
 receipts jsonb;updates jsonb;basis jsonb;v jsonb;issue text;last_issue text;active numeric;
 total numeric;fees numeric;service_back numeric:=0;tax_back numeric:=0;core numeric;loss numeric;earning numeric;
 original_commission numeric;creator_remaining numeric;platform_remaining numeric;source_count integer;
begin
 select *into d from finance_private.collection_cost_resolutions where kind='sale'and source_id=p_source;
 select *into t from public.transactions where id=p_source;
 if d.id is null or d.policy_version<>'creator-full-variance-next-month-v3'or t.status<>'paid'or t.refunded_amount<=0 or t.refunded_amount>=t.amount then
  return jsonb_build_object('applicable',false,'issue','Esta revisión corresponde a una devolución parcial con un ajuste completo de costo ya aprobado.');end if;
 select *into c from finance_private.collection_receipts where id=d.receipt_id;
 select *into a from public.finance_adjustments where id=d.adjustment_id;
 select count(*)into source_count from finance_private.collection_cost_sources where reference=c.reference;
 select result->>'issue'into last_issue from finance_private.collection_cost_queries where kind='sale'and source_id=p_source order by sequence desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(r)order by r.refund_id),'[]'),coalesce(sum(r.amount),0),coalesce(sum(r.fee_returned),0)
 into receipts,total,fees from finance_private.refund_receipts r where r.payment_ref=c.reference and r.environment=c.environment and r.sender=c.sender;
 select coalesce(jsonb_agg(to_jsonb(u)order by u.revision),'[]')into updates from finance_private.collection_credit_updates u where resolution_id=d.id;
 active:=coalesce((select remaining_credit from finance_private.collection_credit_updates where resolution_id=d.id order by revision desc limit 1),d.creator_credit);
 if source_count<>1 or c.id is null or c.fee is distinct from d.actual_fee then issue:='Falta un comprobante único del costo aprobado.';
 elsif last_issue is not null then issue:='Primero aclara el comprobante de costo contradictorio: '||last_issue;
 elsif exists(select 1 from finance_private.collection_manual_changes(d.id))then issue:='Hay una reversión manual del ajuste; revisa su historial antes de continuar.';
 elsif active is distinct from d.creator_credit then issue:='El ajuste activo no coincide con la diferencia aprobada; revisa su historial.';
 elsif total is distinct from t.refunded_amount or fees is distinct from t.refunded_gateway_fee then issue:='Los comprobantes de devolución no coinciden con lo registrado; concilia los avisos primero.';
 elsif fees>d.actual_fee then issue:='La comisión devuelta supera el costo comprobado del cobro; revisa ambos comprobantes.';
 elsif exists(select 1 from finance_private.refund_receipts r join finance_private.refund_events e on e.id=r.event_id where r.payment_ref=c.reference and (r.environment<>c.environment or r.sender<>c.sender or e.state<>'applied'))
  or exists(select 1 from finance_private.refund_events e where e.result->>'payment_ref'=c.reference and e.state<>'applied')then issue:='Hay avisos de devolución pendientes o de otra cuenta; concílialos primero.';
 elsif exists(select 1 from finance_private.income_disputes where payment_ref=c.reference)
  or exists(select 1 from finance_private.income_events e where e.state<>'applied'and (e.body#>>'{resource,id}'=c.reference or e.result->>'payment_ref'=c.reference))then issue:='La venta tiene una disputa o aviso de cobro por resolver.';
 end if;
 if coalesce(t.service_fee,0)<>0 or coalesce(t.tax_amount,0)<>0 then
  select(result->>'service_refund')::numeric,(result->>'tax_refund')::numeric into service_back,tax_back from public.finance_case_actions
  where action='refund_resolution'and result->>'payment_ref'=c.reference and(result->>'refunded_amount')::numeric=t.refunded_amount order by sequence desc limit 1;
  if service_back is null or tax_back is null then issue:=coalesce(issue,'Falta el desglose documentado de servicios e impuestos de esta devolución.');end if;
 end if;
 core:=t.refunded_amount-t.refunded_gateway_fee-service_back-tax_back;
 earning:=round(t.amount*t.creator_share,2);
 if core<0 or core is null or t.amount-d.comparison_fee-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0)<=0 then
  issue:=coalesce(issue,'La devolución no tiene una base de reparto válida.');
 else
  loss:=round(least(t.amount*t.creator_share,greatest(0,core*t.amount*t.creator_share/(t.amount-d.comparison_fee-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0)))),8);
  if loss is distinct from t.creator_refund_loss then issue:=coalesce(issue,'El descuento de la devolución no coincide con el reparto original; revisa su expediente.');end if;
 end if;
 original_commission:=round(t.amount-d.comparison_fee-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0)-earning,2);
 creator_remaining:=round(greatest(0,t.amount*t.creator_share-case when t.platform_covers then 0 else t.creator_refund_loss end)+active,2);
 platform_remaining:=round(t.amount-d.actual_fee-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0)-core-creator_remaining,2);
 if not t.platform_covers and(creator_remaining<0 or platform_remaining<0)then issue:=coalesce(issue,'La devolución supera el reparto disponible. Decide la responsabilidad en su expediente; esta revisión no inventa un descuento ni una cobertura.');end if;
 if a.user_id is null and d.creator_credit<>0 then issue:=coalesce(issue,'Falta la corrección original del creador.');end if;
 basis:=jsonb_build_object('transaction',to_jsonb(t),'resolution',to_jsonb(d),'receipt',to_jsonb(c),'refunds',receipts,'updates',updates,
  'manual_changes',(select coalesce(jsonb_agg(to_jsonb(m)order by m.id),'[]')from finance_private.collection_manual_changes(d.id)m),
  'last_issue',last_issue,'service_back',service_back,'tax_back',tax_back,'issue',issue);
 v:=jsonb_build_object('applicable',true,'source',p_source,'resolution',d.id,'reference',c.reference,'creator_user',coalesce(a.user_id,(select id from public.profiles where creator_profile_id=t.creator_profile_id and role='creator')),
  'gross',t.amount,'refund',t.refunded_amount,'fee_returned',t.refunded_gateway_fee,'estimated_fee',d.comparison_fee,'actual_fee',d.actual_fee,
  'original_earning',earning,'refund_loss',case when t.platform_covers then 0 else round(t.creator_refund_loss,2)end,'recorded_refund_loss',round(t.creator_refund_loss,2),
  'cost_adjustment',active,'creator_remaining',creator_remaining,'platform_commission_initial',original_commission,'platform_remaining',platform_remaining,
  'service_remaining',coalesce(t.service_fee,0)-service_back,'tax_remaining',coalesce(t.tax_amount,0)-tax_back,'covered',t.platform_covers,
  'scheduled_from',case when a.id is not null then public.earnings_cycle_start(a.eligible_at)+interval '1 month'end,'issue',issue,'hash',md5(basis::text));
 select *into review from finance_private.collection_refund_reviews where resolution_id=d.id and expected_hash=v->>'hash';
 return v||jsonb_build_object('reviewed',review.id is not null,'review',review.id,'reviewed_at',review.created_at,'explanation',review.reason);
end$$;
revoke all on function finance_private.collection_refund_plan(uuid)from public,anon,authenticated,service_role;

create function public.finance_collection_refund_preview(p_source uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
begin perform finance_private.assert_admin();return finance_private.collection_refund_plan(p_source);end$$;
create function public.finance_collection_refund_review(p_source uuid,p_key uuid,p_expected text,p_evidence text,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare v jsonb;r finance_private.collection_refund_reviews;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or length(trim(coalesce(p_evidence,'')))not between 10 and 1000 or length(trim(coalesce(p_reason,'')))not between 20 and 2000 then raise exception 'Documenta los comprobantes y la explicación de la revisión';end if;
 select *into r from finance_private.collection_refund_reviews where request_key=p_key;
 if r.id is not null then
  if(r.snapshot->>'source',r.expected_hash,r.evidence,r.reason)is distinct from(p_source::text,p_expected,trim(p_evidence),trim(p_reason))then raise exception 'Referencia de revisión reutilizada';end if;
  return jsonb_build_object('id',r.id);end if;
 v:=finance_private.collection_refund_plan(p_source);
 if v->>'issue'is not null then raise exception '%',v->>'issue';end if;
 if not coalesce((v->>'applicable')::boolean,false)or v->>'hash'is distinct from p_expected or p_expected is null then raise exception 'La devolución o sus comprobantes cambiaron; actualiza la revisión';end if;
 if(v->>'reviewed')::boolean then raise exception 'Esta devolución ya fue revisada con estos importes';end if;
 insert into finance_private.collection_refund_reviews(request_key,resolution_id,user_id,expected_hash,snapshot,evidence,reason,actor)
 values(p_key,(v->>'resolution')::uuid,(v->>'creator_user')::uuid,p_expected,v,trim(p_evidence),trim(p_reason),auth.uid())returning *into r;
 return jsonb_build_object('id',r.id);
end$$;
revoke all on function public.finance_collection_refund_preview(uuid),public.finance_collection_refund_review(uuid,uuid,text,text,text)from public,anon,service_role;
grant execute on function public.finance_collection_refund_preview(uuid),public.finance_collection_refund_review(uuid,uuid,text,text,text)to authenticated;

-- Preserve the original signed adjustment. Repeated notices on an already
-- reviewed basis do not refreeze it; a different refund opens its own episode.
do $$declare definition text;anchor text;begin
 definition:=replace(pg_get_functiondef('finance_private.sync_collection_credit()'::regprocedure),chr(13),'');
 anchor:=$old$perform finance_private.place_hold(original_adjustment.user_id,'safety','collection-cost/'||d.id,
   'Devolución parcial con diferencia completa del costo. Revisar su costo y reparto sin recalcular la comisión inicial automáticamente.');return null;$old$;
 if position(anchor in definition)=0 then raise exception 'Revisar el seguimiento de diferencias completas';end if;
 execute replace(definition,anchor,$new$declare review_plan jsonb;begin
  review_plan:=finance_private.collection_refund_plan(d.source_id);
  if not coalesce((review_plan->>'reviewed')::boolean,false)or review_plan->>'issue'is not null then
   perform finance_private.place_hold(original_adjustment.user_id,'safety','collection-refund/'||d.id||'/'||(review_plan->>'hash'),
    'Revisar la devolución parcial y el costo ya corregido. No descontar otra vez la devolución ni cambiar la comisión inicial automáticamente.');end if;
 end;return null;$new$);
end$$;

-- Covers changes to responsibility and zero variances as well as ordinary
-- partial refunds. An already released reference is never reused for new facts.
create function finance_private.watch_collection_refund()returns trigger language plpgsql security definer set search_path=''as $$
declare b jsonb;begin
 perform finance_private.lock_book();b:=finance_private.collection_refund_plan(new.id);
 if coalesce((b->>'applicable')::boolean,false)and(b->>'issue'is not null or not coalesce((b->>'reviewed')::boolean,false))then
  perform finance_private.place_hold((b->>'creator_user')::uuid,'safety','collection-refund/'||(b->>'resolution')||'/'||(b->>'hash'),
   'Revisar la devolución parcial y el costo ya corregido. La revisión anterior no cubre importes o responsabilidades diferentes.');end if;
 return null;
end$$;
revoke all on function finance_private.watch_collection_refund()from public,anon,authenticated,service_role;
create constraint trigger collection_refund_watch after update on public.transactions deferrable initially deferred
 for each row execute function finance_private.watch_collection_refund();

-- Even a legacy hold cannot be released via casework while this separate
-- cost/refund review is missing. All earlier release requirements stay intact.
alter function finance_private.hold_blockers(uuid,uuid)rename to blockers_before_collection_refunds;
revoke all on function finance_private.blockers_before_collection_refunds(uuid,uuid)from public,anon,authenticated,service_role;
create function finance_private.hold_blockers(p_user uuid,p_payout uuid)returns jsonb language plpgsql stable set search_path=''as $$
declare v jsonb;r record;b jsonb;begin
 v:=finance_private.blockers_before_collection_refunds(p_user,p_payout);
 for r in select d.source_id from finance_private.collection_cost_resolutions d join public.transactions t on t.id=d.source_id join public.profiles p on p.creator_profile_id=t.creator_profile_id
  where p.id=p_user and d.kind='sale'and d.policy_version='creator-full-variance-next-month-v3'and t.status='paid'and t.refunded_amount>0 and t.refunded_amount<t.amount loop
  b:=finance_private.collection_refund_plan(r.source_id);
  if b->>'issue'is not null or not coalesce((b->>'reviewed')::boolean,false)then return v||'"COLLECTION_REFUND_REVIEW_REQUIRED"'::jsonb;end if;
 end loop;return v;
end$$;
revoke all on function finance_private.hold_blockers(uuid,uuid)from public,anon,authenticated,service_role;

-- Add the review to the existing administrative route; never suppress another
-- issue, proof conflict or manual reversal in that route.
do $$declare definition text;anchor text;begin
 definition:=replace(pg_get_functiondef('finance_private.collection_cost_plan(text,uuid)'::regprocedure),chr(13),'');
 anchor:=$old$v:=v||jsonb_build_object('issue','Este ajuste tiene una devolución parcial. Revisa el costo y el reparto de esa devolución antes de liberar su bloqueo.');$old$;
 if position(anchor in definition)=0 then raise exception 'Revisar la pantalla de devoluciones parciales';end if;
 execute replace(definition,anchor,$new$declare refund_plan jsonb;begin
  refund_plan:=finance_private.collection_refund_plan(p_id);
  v:=v||jsonb_build_object('partial_refund',refund_plan,'issue',case when refund_plan->>'issue'is not null then 'Este ajuste tiene una devolución parcial. '||(refund_plan->>'issue')
   when coalesce((refund_plan->>'reviewed')::boolean,false)then null else 'Esta devolución parcial requiere revisar su costo y reparto antes de liberar el bloqueo.'end);
 end;$new$);
end$$;

-- Creator-facing notes contain the explanation and amounts, never internal
-- evidence, another creator's data or an implicit permission to pay.
alter function public.finance_creator_balance()rename to balance_before_refund_cost_notes;
alter function public.balance_before_refund_cost_notes()set schema finance_private;
revoke all on function finance_private.balance_before_refund_cost_notes()from public,anon,authenticated,service_role;
create function public.finance_creator_balance()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare v jsonb;begin
 v:=finance_private.balance_before_refund_cost_notes();
 return v||jsonb_build_object('cost_refund_reviews',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'source',r.snapshot->>'source','reference',r.snapshot->>'reference',
  'refund',r.snapshot->'refund','refund_loss',r.snapshot->'refund_loss','cost_adjustment',r.snapshot->'cost_adjustment','creator_remaining',r.snapshot->'creator_remaining',
  'scheduled_from',r.snapshot->'scheduled_from','reason',r.reason,'created_at',r.created_at,
  'current',coalesce(r.expected_hash=(finance_private.collection_refund_plan((r.snapshot->>'source')::uuid)->>'hash'),false))order by r.created_at desc,r.id)
  from(select *from(select distinct on(resolution_id)*from finance_private.collection_refund_reviews where user_id=auth.uid()order by resolution_id,created_at desc,id)latest order by created_at desc,id limit 100)r),'[]'));
end$$;
revoke all on function public.finance_creator_balance()from public,anon,service_role;
grant execute on function public.finance_creator_balance()to authenticated;
select pg_notify('pgrst','reload schema');
