-- New sends pause on payer funding failures; accepted sends remain reconcilable.
-- No historical payout/attempt or automatic money gate changes on deployment.
create table finance_private.payer_funding_stops(
 id uuid primary key default gen_random_uuid(),environment text not null check(environment in('sandbox','live')),
 payout_id uuid not null references public.payouts(id),proof text not null unique,created_at timestamptz not null default now()
);
create index payer_funding_stops_environment on finance_private.payer_funding_stops(environment,created_at desc,id);
create table finance_private.payer_funding_releases(
 stop_id uuid primary key references finance_private.payer_funding_stops(id),
 decision_id uuid not null unique references public.finance_case_actions(id) deferrable initially deferred,
 funding_id uuid not null references public.finance_funding_checks(id),created_at timestamptz not null default now()
);
do $$declare t text;begin
 foreach t in array array['payer_funding_stops','payer_funding_releases'] loop
  execute format('alter table finance_private.%I enable row level security',t);
  execute format('revoke all on finance_private.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger funding_record_immutable before update or delete on finance_private.%I for each row execute function finance_private.immutable()',t);
 end loop;
end$$;
create function finance_private.active_funding_stop(p_environment text) returns uuid language sql stable set search_path='' as $$
 select s.id from finance_private.payer_funding_stops s where s.environment=p_environment
 and not exists(select 1 from finance_private.payer_funding_releases r where r.stop_id=s.id)
 order by s.created_at desc,s.id limit 1
$$;
create function finance_private.stop_payer_funding(p_payout uuid,p_proof text) returns void language plpgsql set search_path='' as $$
declare v_environment text;
begin
 perform finance_private.lock_book();
 select environment into v_environment from public.paypal_payout_submissions where payout_id=p_payout;
 if v_environment is null then raise exception 'Falta el emisor original del retiro';end if;
 if finance_private.active_funding_stop(v_environment) is null then
  insert into finance_private.payer_funding_stops(environment,payout_id,proof) values(v_environment,p_payout,p_proof) on conflict(proof) do nothing;
 end if;
 if finance_private.active_funding_stop(v_environment) is not null then
  perform finance_private.incident(null,'PAYER_FUNDS_INSUFFICIENT',v_environment,'Faltan fondos en la cuenta pagadora',
   'PayPal rechazó un envío por saldo insuficiente del pagador. Se pausan nuevos envíos; los ya aceptados siguen conciliándose. Registra fondos nuevos y documenta la reanudación. No es un error atribuido al creador.');
 end if;
end$$;
create function finance_private.funding_stop_basis(p_environment text) returns jsonb language plpgsql stable set search_path='' as $$
declare s finance_private.payer_funding_stops;f public.finance_funding_checks;v_required numeric;v_fee numeric;v_issue text;
begin
 select * into s from finance_private.payer_funding_stops where id=finance_private.active_funding_stop(p_environment);
 select * into f from public.finance_funding_checks where environment=p_environment order by observed_at desc,created_at desc,id limit 1;
 select fee_limit into v_fee from finance_private.automation_settings where id;
 -- Cover outstanding commitments, paid since observation and current-cycle unsent reserved items.
 select coalesce(sum(p.net+greatest(p.fee,coalesce(v_fee,p.fee))),0) into v_required
 from public.payouts p join public.paypal_payout_submissions x on x.payout_id=p.id where x.environment=p_environment
 and (p.status='sending' or (p.status='paid' and coalesce(p.paid_at,p.requested_at)>=f.observed_at));
 select v_required+coalesce(sum(i.net+greatest(i.fee,coalesce(v_fee,i.fee))),0) into v_required
 from public.finance_batch_items i join public.finance_batches b on b.id=i.batch_id
 where b.state='frozen' and b.cutoff=public.payout_credit_cutoff(now()) and i.state='reserved'
 and not exists(select 1 from public.payouts p where p.finance_batch_item_id=i.id);
 if s.id is null then v_issue:='FUNDING_STOP_INACTIVE';
 elsif f.id is null or f.created_at<=s.created_at or f.observed_at<=s.created_at or f.observed_at<now()-interval '24 hours' or f.observed_at>now() then v_issue:='FRESH_FUNDING_REQUIRED';
 elsif f.available<=0 or f.available<v_required then v_issue:='FUNDING_COVERAGE_REQUIRED';end if;
 return jsonb_build_object('stop',s.id,'environment',p_environment,'payout',s.payout_id,'stopped_at',s.created_at,
  'funding',f.id,'available',f.available,'observed_at',f.observed_at,'funding_reference',f.reference,'required',v_required,
  'blockers',case when v_issue is null then '[]'::jsonb else jsonb_build_array(v_issue) end);
end$$;
create function finance_private.rejected_basis(p_payout uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('payout',p.id,'creator',p.creator_name,'user_id',p.user_id,'status',p.status,
 'amount',p.amount,'net',p.net,'revision',p.finance_revision,'reason',coalesce(p.error,s.last_error,'PROVIDER_REASON_UNKNOWN'),
 'environment',s.environment,'attempts',s.attempt_count,'submission_state',s.state,'proof',q.id,'proof_outcome',q.outcome,
 'definitive',p.status='failed' and ((s.state='rejected' and s.attempt_count=1 and p.paypal_batch_id is null)
  or (q.outcome='applied' and q.status_after='failed' and q.response->>'http'='200')),
 'source_hash',md5(jsonb_build_array(p.id,p.finance_revision,p.status,p.error,s.last_error)::text))
 from public.payouts p left join public.paypal_payout_submissions s on s.payout_id=p.id
 left join lateral(select z.* from public.paypal_payout_reconciliations z where z.payout_id=p.id order by sequence desc limit 1)q on true where p.id=p_payout
$$;
create function finance_private.observe_rejected(p_run uuid,p_payout uuid) returns void language plpgsql set search_path='' as $$
declare v jsonb;
begin
 v:=finance_private.rejected_basis(p_payout);
 if v->>'status'<>'failed' or v is null then return;end if;
 if exists(select 1 from public.finance_case_actions a join public.finance_incidents i on i.id=a.incident_id
  where i.code='PAYOUT_REJECTED' and i.reference=p_payout::text and a.action='close_review'
  and a.before_snapshot#>>'{source,source_hash}'=v->>'source_hash') then return;end if;
 perform finance_private.incident(p_run,'PAYOUT_REJECTED',p_payout::text,'Revisar pago rechazado · '||coalesce(v->>'creator','Creador'),
  case when v->>'reason'='INSUFFICIENT_FUNDS' then 'PayPal informó saldo insuficiente del pagador. No se atribuye este rechazo al creador.'
  else 'PayPal no confirmó la entrega. Código conservado: '||(v->>'reason')||'. Si no hay causa específica, permanece por determinar.' end
  ||' Revisa la referencia original; cerrar el expediente no reintenta el pago ni cambia su saldo.');
end$$;
-- Preserve existing guards, leases, immutable snapshots and accounting under narrow wrappers.
alter function finance_private.execution_block(text) rename to execution_block_before_funding;
create function finance_private.execution_block(p_environment text) returns text language plpgsql stable set search_path='' as $$
begin
 if p_environment is not distinct from (select environment from finance_private.automation_settings where id)
  and finance_private.active_funding_stop(p_environment) is not null then return 'PAYER_FUNDS_INSUFFICIENT';end if;
 return finance_private.execution_block_before_funding(p_environment);
end$$;
alter function public.paypal_payout_begin(uuid,text,text) set schema finance_private;
alter function finance_private.paypal_payout_begin(uuid,text,text) rename to payout_begin_before_funding;
create function public.paypal_payout_begin(p_user uuid,p_environment text,p_sender text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.lock_book();
 if finance_private.active_funding_stop(p_environment) is not null then raise exception 'Faltan fondos del pagador; documenta la reanudación antes de iniciar otro retiro';end if;
 return finance_private.payout_begin_before_funding(p_user,p_environment,p_sender);
end$$;
alter function public.paypal_payout_claim(uuid,uuid,text,text) set schema finance_private;
alter function finance_private.paypal_payout_claim(uuid,uuid,text,text) rename to payout_claim_before_funding;
create function public.paypal_payout_claim(p_user uuid,p_id uuid,p_environment text,p_sender text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.lock_book();
 if finance_private.active_funding_stop(p_environment) is not null and exists(select 1 from public.payouts p
  join public.paypal_payout_submissions s on s.payout_id=p.id where p.id=p_id and p.user_id=p_user and p.status='sending'
  and s.environment=p_environment and s.sender_client_id=p_sender and coalesce(s.batch_id,p.paypal_batch_id) is null) then
  return jsonb_build_object('operation','wait','reason','PAYER_FUNDS_INSUFFICIENT');end if;
 return finance_private.payout_claim_before_funding(p_user,p_id,p_environment,p_sender);
end$$;
alter function public.paypal_payout_submission_result(uuid,uuid,uuid,text,text,text) set schema finance_private;
alter function finance_private.paypal_payout_submission_result(uuid,uuid,uuid,text,text,text) rename to submission_result_before_funding;
create function public.paypal_payout_submission_result(p_user uuid,p_id uuid,p_token uuid,p_outcome text,p_batch text,p_error text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 perform finance_private.lock_book();
 v:=finance_private.submission_result_before_funding(p_user,p_id,p_token,p_outcome,p_batch,p_error);
 if (v->>'applied')::boolean then
  if p_outcome='rejected' and p_error='INSUFFICIENT_FUNDS' then perform finance_private.stop_payer_funding(p_id,'submission/'||p_id||'/'||p_token);end if;
  perform finance_private.observe_rejected(null,p_id);
 end if;
 return v;
end$$;
alter function public.paypal_payout_reconcile_finish(uuid,jsonb) set schema finance_private;
alter function finance_private.paypal_payout_reconcile_finish(uuid,jsonb) rename to reconcile_finish_before_funding;
create function public.paypal_payout_reconcile_finish(p_query uuid,p_response jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;q public.paypal_payout_reconciliations;
begin
 perform finance_private.lock_book();v:=finance_private.reconcile_finish_before_funding(p_query,p_response);
 select * into q from public.paypal_payout_reconciliations where id=p_query;
 -- Replays cannot substitute another response for the persisted identity-checked proof.
 if q.outcome='applied' and q.status_after='failed' and exists(select 1 from jsonb_array_elements(q.response#>'{data,items}') x
  where x#>>'{payout_item,sender_item_id}'=q.payout_id::text and x#>>'{errors,name}'='INSUFFICIENT_FUNDS') then
  perform finance_private.stop_payer_funding(q.payout_id,'query/'||q.id);end if;
 perform finance_private.observe_rejected(null,q.payout_id);return v;
end$$;
-- Guarded extensions retain all existing attribution/idempotency checks.
do $migration$
declare v text;anchor text;
begin
 v:=pg_get_functiondef('finance_private.case_basis(uuid)'::regprocedure);
 anchor:=E' elsif i.code=''CASE_OVERDUE'' then';
 if position(anchor in v)=0 then raise exception 'Revisar case_basis antes de ampliar expedientes';end if;
 execute replace(v,anchor,$insert$
 elsif i.code='PAYOUT_REJECTED' then
  s:=finance_private.rejected_basis(i.reference::uuid);
  if i.state='open' and coalesce((s->>'definitive')::boolean,false) then v_actions:=v_actions||'"close_review"'::jsonb;end if;
 elsif i.code='PAYER_FUNDS_INSUFFICIENT' then
  s:=finance_private.funding_stop_basis(i.reference);
  if i.state='open' and jsonb_array_length(s->'blockers')=0 then v_actions:=v_actions||'"close_review"'::jsonb;end if;
 elsif i.code='CASE_OVERDUE' then$insert$);
 v:=pg_get_functiondef('public.finance_case_act(uuid,uuid,text,text,text,text,text,text,text,timestamptz)'::regprocedure);
 anchor:=E' elsif p_action=''ack_alert'' then';
 if position(anchor in v)=0 then raise exception 'Revisar case_act antes de ampliar expedientes';end if;
 execute replace(v,anchor,$insert$
 elsif p_action='close_review' and i.code='PAYER_FUNDS_INSUFFICIENT' then
  if p_party<>'platform' or p_category<>'platform_processing' then raise exception 'La reposición y revisión de fondos del pagador corresponden a Fans Reserve';end if;
  insert into finance_private.payer_funding_releases(stop_id,decision_id,funding_id)
   values((v#>>'{source,stop}')::uuid,v_id,(v#>>'{source,funding}')::uuid);
  v_result:=jsonb_build_object('funding_stop_released',true,'stop',v#>>'{source,stop}','funding',v#>>'{source,funding}','other_gates_preserved',true,'sent',false);
 elsif p_action='close_review' and i.code='PAYOUT_REJECTED' then
  v_result:=jsonb_build_object('review_closed',true,'retried',false,'balance_changed',false,'provider_status_preserved',true);
 elsif p_action='ack_alert' then$insert$);
 v:=pg_get_functiondef('public.finance_job_review(uuid)'::regprocedure);
 -- The funding case is the common alert; do not enqueue a second generic stop for it.
 v:=replace(v,'if j.execute_requested and finance_private.execution_block(j.environment) is not null then',
  'if j.execute_requested and finance_private.execution_block(j.environment) is not null and finance_private.execution_block(j.environment)<>''PAYER_FUNDS_INSUFFICIENT'' then');
 anchor:=E' update public.finance_incidents set state=''resolved'',resolved_at=now() where state=''open'' and last_seen_run is distinct from p_run and code not in (''JOB_FAILURE'',''PREPARATION_FAILED'');';
 if position(anchor in v)=0 then raise exception 'Revisar job_review antes de observar rechazos';end if;
 execute replace(v,anchor,$insert$
 for t in select p.id from public.payouts p join public.paypal_payout_submissions x on x.payout_id=p.id where p.status='failed' and x.environment=j.environment loop
  perform finance_private.observe_rejected(p_run,t.id);
 end loop;
 if finance_private.active_funding_stop(j.environment) is not null then
  perform finance_private.incident(p_run,'PAYER_FUNDS_INSUFFICIENT',j.environment,'Faltan fondos en la cuenta pagadora',
   'Se mantienen pausados los nuevos envíos. Los ya aceptados siguen conciliándose. Registra evidencia nueva de fondos y documenta la reanudación desde este expediente.');
 end if;
 update public.finance_incidents set state='resolved',resolved_at=now() where state='open' and last_seen_run is distinct from p_run and code not in ('JOB_FAILURE','PREPARATION_FAILED','PAYOUT_REJECTED','PAYER_FUNDS_INSUFFICIENT');$insert$);
 v:=pg_get_functiondef('finance_private.reason_label(text)'::regprocedure);
 anchor:='select case p_reason';
 if position(anchor in v)=0 then raise exception 'Revisar reason_label';end if;
 execute replace(v,anchor,'select case p_reason when ''PAYER_FUNDS_INSUFFICIENT'' then ''Faltan fondos del pagador; nuevos envíos pausados hasta revisión documentada''');
 v:=pg_get_functiondef('finance_private.group_rows(uuid)'::regprocedure);
 anchor:='when payout_status=''failed''then ''El envío no terminó con una entrega confirmada''';
 if position(anchor in v)=0 then raise exception 'Revisar group_rows antes de ampliar motivos';end if;
 execute replace(v,anchor,$insert$when payout_status='failed'then case when (select z.error from public.payouts z where z.id=payout)='INSUFFICIENT_FUNDS'
  then 'Saldo insuficiente del pagador; revisar fondos de Fans Reserve'
  else 'PayPal no confirmó la entrega; revisar el motivo conservado en el expediente' end$insert$);
 v:=pg_get_functiondef('public.finance_case_list(integer,integer,text)'::regprocedure);
 anchor:='i.reference=p_reference or exists';
 if position(anchor in v)=0 then raise exception 'Revisar case_list antes de añadir la cuenta del rechazo';end if;
 execute replace(v,anchor,'i.reference=p_reference or exists(select 1 from public.payouts z where i.code=''PAYOUT_REJECTED'' and z.id::text=i.reference and z.user_id::text=p_reference) or exists');
end$migration$;
-- Adopt historical failures as cases only; no historical global funding pause.
do $$declare p record;begin
 perform finance_private.lock_book();
 for p in select id from public.payouts where status='failed' loop perform finance_private.observe_rejected(null,p.id);end loop;
end$$;
revoke all on all functions in schema finance_private from public,anon,authenticated,service_role;
revoke all on function public.paypal_payout_begin(uuid,text,text),public.paypal_payout_claim(uuid,uuid,text,text),public.paypal_payout_submission_result(uuid,uuid,uuid,text,text,text),public.paypal_payout_reconcile_finish(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.paypal_payout_begin(uuid,text,text),public.paypal_payout_claim(uuid,uuid,text,text),public.paypal_payout_submission_result(uuid,uuid,uuid,text,text,text),public.paypal_payout_reconcile_finish(uuid,jsonb) to service_role;
select pg_notify('pgrst','reload schema');
