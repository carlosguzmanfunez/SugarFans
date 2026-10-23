-- Evidence for supervised recovery; deployment does not enable any money gate.
create table finance_private.provider_run_coverage (
 run_id uuid primary key references public.finance_job_runs(id),
 protocol integer not null default 1 check(protocol=1),entered_at timestamptz not null default now()
);
create table finance_private.run_work_attempts (
 run_id uuid not null references finance_private.provider_run_coverage(run_id),
 operation text not null check(operation in('event','payout','prepare')),
 reference uuid not null,attempted_at timestamptz not null default now(),
 primary key(run_id,operation,reference)
);
alter table finance_private.provider_run_coverage enable row level security;
alter table finance_private.run_work_attempts enable row level security;
revoke all on finance_private.provider_run_coverage,finance_private.run_work_attempts from public,anon,authenticated,service_role;
create trigger provider_run_coverage_immutable before update or delete on finance_private.provider_run_coverage for each row execute function finance_private.immutable();
create trigger run_work_attempts_immutable before update or delete on finance_private.run_work_attempts for each row execute function finance_private.immutable();

do $migration$
declare v text;anchor text;
begin
 v:=pg_get_functiondef('public.finance_provider_enter(uuid)'::regprocedure);
 anchor:='insert into finance_private.provider_limits(environment,blocked_until,failures,active_run)';
 if position(anchor in v)=0 then raise exception 'Revisar provider_enter antes de instalar auditoría';end if;
 execute replace(v,anchor,'insert into finance_private.provider_run_coverage(run_id)values(p_run)on conflict do nothing; '||anchor);
 v:=pg_get_functiondef('public.finance_job_attempt(uuid,text,uuid)'::regprocedure);
 anchor:='insert into finance_private.work_attempts(environment,operation,reference,last_attempt_at)';
 if position(anchor in v)=0 then raise exception 'Revisar job_attempt antes de instalar auditoría';end if;
 execute replace(v,anchor,'insert into finance_private.run_work_attempts(run_id,operation,reference)values(p_run,p_operation,p_reference)on conflict do nothing; '||anchor);
end$migration$;

create function finance_private.recovery_basis(p_environment text) returns jsonb language plpgsql stable set search_path='' as $$
declare l finance_private.provider_limits;j public.finance_job_runs;a record;p public.payouts;s public.paypal_payout_submissions;q public.paypal_payout_reconciliations;
 blockers jsonb:='[]';items jsonb:='[]';reason text;covered boolean;
begin
 select * into l from finance_private.provider_limits where environment=p_environment;
 select * into j from public.finance_job_runs where id=l.active_run;
 covered:=exists(select 1 from finance_private.provider_run_coverage where run_id=j.id);
 if l.active_run is null then blockers:=blockers||'"NO_INTERRUPTED_RUN"'::jsonb;
 elsif j.state='running' and j.lease_until>now() then blockers:=blockers||'"RUN_STILL_ACTIVE"'::jsonb;
 elsif not covered then blockers:=blockers||'"LEGACY_RUN_REQUIRES_TECHNICAL_REVIEW"'::jsonb;
 else
  for a in select distinct coalesce(case when w.operation='payout' then w.reference end,e.payout_id,prepared.id) as payout
   from finance_private.run_work_attempts w
   left join public.paypal_payout_events e on w.operation='event' and e.id=w.reference
   left join public.payouts prepared on w.operation='prepare' and prepared.finance_batch_item_id=w.reference
   where w.run_id=j.id and (w.operation<>'prepare' or prepared.id is not null)
  loop
   reason:=null;
   select * into p from public.payouts where id=a.payout;
   select * into s from public.paypal_payout_submissions where payout_id=a.payout;
   select * into q from public.paypal_payout_reconciliations where payout_id=a.payout order by sequence desc limit 1;
   if p.id is null or s.payout_id is null then reason:='MISSING_SUBMISSION';
   elsif s.state='prepared' and s.attempt_count=0 and s.batch_id is null and p.paypal_batch_id is null and p.status='sending' then
    -- The stored instruction has never been submitted. Preserve it and its reserve.
    null;
   elsif q.id is null or q.outcome<>'applied' or q.completed_at is null or q.response->>'http' is distinct from '200'
    or q.status_after is distinct from p.status or q.batch_id is distinct from coalesce(s.batch_id,p.paypal_batch_id)
    or q.batch_id is null or exists(select 1 from public.paypal_payout_events e where e.payout_id=p.id and e.state in('pending','review')) then reason:='PROVIDER_RESULT_NOT_RECONCILED';
   elsif p.status='paid' and not exists(select 1 from public.finance_journal z where z.kind='payout_confirmed' and z.reference=p.id::text) then reason:='LEDGER_CONFIRMATION_MISSING';
   end if;
   if reason is not null then blockers:=blockers||jsonb_build_array(reason||'/'||coalesce(a.payout::text,'unknown'));end if;
   items:=items||jsonb_build_array(jsonb_build_object('payout',a.payout,'status',p.status,'ready',reason is null,'reason',reason,
    'proof',q.id,'submission_hash',md5(to_jsonb(s)::text)));
  end loop;
 end if;
 return jsonb_build_object('environment',p_environment,'run',j.id,'run_state',j.state,'lease_until',j.lease_until,'covered',covered,
  'attempts',(select count(*) from finance_private.run_work_attempts where run_id=j.id),'items',items,'blockers',blockers);
end$$;
revoke all on function finance_private.recovery_basis(text) from public,anon,authenticated,service_role;

do $migration$
declare v text;anchor text;
begin
 v:=pg_get_functiondef('finance_private.case_basis(uuid)'::regprocedure);
 anchor:=E' elsif i.code=''CASE_OVERDUE'' then';
 if position(anchor in v)=0 then raise exception 'Revisar case_basis antes de instalar recuperación';end if;
 execute replace(v,anchor,$insert$
 elsif i.code='PROVIDER_INTERRUPTED' then
  s:=finance_private.recovery_basis(i.reference);
  if i.state='open' and jsonb_array_length(s->'blockers')=0 then v_actions:=v_actions||'"close_review"'::jsonb;end if;
 elsif i.code='CASE_OVERDUE' then$insert$);
 v:=pg_get_functiondef('public.finance_case_act(uuid,uuid,text,text,text,text,text,text,text,timestamptz)'::regprocedure);
 anchor:=E' elsif p_action=''ack_alert'' then';
 if position(anchor in v)=0 then raise exception 'Revisar case_act antes de instalar recuperación';end if;
 execute replace(v,anchor,$insert$
 elsif p_action='close_review' and i.code='PROVIDER_INTERRUPTED' then
  if p_party<>'platform' or p_category<>'platform_processing' then raise exception 'La recuperación del servidor corresponde a Fans Reserve';end if;
  update finance_private.provider_limits set active_run=null,updated_at=now()
   where environment=i.reference and active_run=(v#>>'{source,run}')::uuid;
  if not found then raise exception 'La ronda cambió; vuelve a comprobar la evidencia';end if;
  v_result:=jsonb_build_object('interrupted_run_released',v#>>'{source,run}','other_gates_preserved',true,'funds_changed',false,'sent',false);
 elsif p_action='ack_alert' then$insert$);
end$migration$;

-- Minimum schedule metadata only. No balances, recipients, provider payloads or keys.
create function public.finance_review_health()returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('checked_at',now(),'jobs',coalesce((select jsonb_agg(x order by x.started_at desc)from(
  select id,state,started_at,finished_at,lease_until,execute_requested,
   jsonb_build_object('trigger',summary->>'trigger','schedule_profile',summary->>'schedule_profile')as summary
  from public.finance_job_runs where summary->>'trigger'='scheduled-review' order by started_at desc limit 10)x),'[]'::jsonb),
  'execution_enabled',coalesce((select execution_enabled from finance_private.automation_settings where id),false),
  'handoff_enabled',coalesce((select batch_handoff_enabled from finance_private.settings where id),false))
$$;
revoke all on function public.finance_review_health()from public,anon,authenticated;
grant execute on function public.finance_review_health()to service_role;
select pg_notify('pgrst','reload schema');
