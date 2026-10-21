-- Queue rotation only. No payout, reserve, permission gate or provider wait is released.
create table finance_private.work_attempts(
 environment text not null check(environment in('live','sandbox')),
 operation text not null check(operation in('event','payout','prepare')),
 reference uuid not null,last_attempt_at timestamptz not null,
 primary key(environment,operation,reference)
);
alter table finance_private.work_attempts enable row level security;
revoke all on finance_private.work_attempts from public,anon,authenticated,service_role;

create function public.finance_job_attempt(p_run uuid,p_operation text,p_reference uuid)
returns void language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);
 if p_reference is null or p_operation is null or not(
  (p_operation='event' and exists(select 1 from public.paypal_payout_events e join public.paypal_payout_submissions s on s.payout_id=e.payout_id where e.id=p_reference and s.environment=j.environment))
  or(p_operation='payout' and exists(select 1 from public.paypal_payout_submissions s where s.payout_id=p_reference and s.environment=j.environment))
  or(p_operation='prepare' and exists(select 1 from public.finance_batch_items i join public.finance_batches b on b.id=i.batch_id where i.id=p_reference and b.cutoff=public.payout_credit_cutoff(now())))
 )then raise exception 'Caso de trabajo no válido';end if;
 insert into finance_private.work_attempts(environment,operation,reference,last_attempt_at)values(j.environment,p_operation,p_reference,now())
 on conflict(environment,operation,reference)do update set last_attempt_at=greatest(work_attempts.last_attempt_at,excluded.last_attempt_at);
end$$;
revoke all on function public.finance_job_attempt(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.finance_job_attempt(uuid,text,uuid) to service_role;

create or replace function public.finance_job_work(p_run uuid,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;v_execute boolean;c jsonb;v_cutoff timestamptz;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);v_execute:=j.execute_requested and finance_private.execution_block(j.environment) is null;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Límite de trabajo no válido';end if;
 v_cutoff:=public.payout_credit_cutoff(now());
 if v_execute and not exists(select 1 from public.finance_batches where cutoff=v_cutoff and state='frozen') then
  c:=finance_private.candidates();
  if exists(select 1 from jsonb_array_elements(c) x where x->>'reason' is null and (x->>'available')::numeric>0) then
   perform finance_private.freeze_batch(gen_random_uuid(),v_cutoff,md5(c::text),(select operator_user_id from finance_private.automation_settings where id));
  end if;
 end if;
 return (with candidates as(
  select 'event' as operation,e.payout_id as payout,p.user_id,e.id as event,null::uuid as item,e.received_at as at
   from public.paypal_payout_events e join public.payouts p on p.id=e.payout_id join public.paypal_payout_submissions s on s.payout_id=p.id
   where e.state='pending' and s.environment=j.environment
  union all select 'payout',p.id,p.user_id,null::uuid,null::uuid,p.requested_at from public.payouts p join public.paypal_payout_submissions s on s.payout_id=p.id
   where p.status='sending' and s.environment=j.environment and (coalesce(s.batch_id,p.paypal_batch_id) is not null or (v_execute and s.state<>'manual_review' and exists(select 1 from public.finance_execution_reservations x where x.payout_id=p.id)))
   and not exists(select 1 from public.paypal_payout_events e where e.payout_id=p.id and e.state='pending')
  union all select 'prepare',null::uuid,i.user_id,null::uuid,i.id,b.created_at from public.finance_batch_items i join public.finance_batches b on b.id=i.batch_id
   where v_execute and b.state='frozen' and b.cutoff=v_cutoff and i.state='reserved' and not exists(select 1 from public.payouts p where p.finance_batch_item_id=i.id)
 )select coalesce(jsonb_agg(to_jsonb(w)-'last_attempt_at'),'[]'::jsonb)from(
  select c.*,a.last_attempt_at from candidates c left join finance_private.work_attempts a
   on a.environment=j.environment and a.operation=c.operation and a.reference=coalesce(c.event,c.payout,c.item)
  order by a.last_attempt_at nulls first,c.at,c.operation,coalesce(c.event,c.payout,c.item) limit p_limit
 )w);
end$$;
select pg_notify('pgrst','reload schema');
