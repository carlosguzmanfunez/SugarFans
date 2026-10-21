-- No gate, funds, recipient, payout or cron is enabled/changed by this migration.
create table finance_private.provider_limits(
 environment text primary key check(environment in('live','sandbox')),
 blocked_until timestamptz not null,failures integer not null check(failures between 0 and 10),
 last_status integer,active_run uuid references public.finance_job_runs(id),updated_at timestamptz not null default now()
);
alter table finance_private.provider_limits enable row level security;
revoke all on finance_private.provider_limits from public,anon,authenticated,service_role;
create or replace function public.finance_provider_gate(p_run uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;t finance_private.provider_limits;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);
 select * into t from finance_private.provider_limits where environment=j.environment;
 return jsonb_build_object('ready',coalesce(t.blocked_until<=now(),true)and(t.active_run is null or t.active_run=p_run),'until',case when t.active_run is not null and t.active_run<>p_run then 'infinity'::timestamptz else t.blocked_until end,'failures',coalesce(t.failures,0),'reason',case when t.active_run is not null and t.active_run<>p_run then 'PROVIDER_INTERRUPTED'else 'PROVIDER_COOLDOWN'end);
end$$;
create or replace function public.finance_provider_enter(p_run uuid)returns void language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);
 if not(public.finance_provider_gate(p_run)->>'ready')::boolean then raise exception 'El proveedor sigue en espera';end if;
 insert into finance_private.provider_limits(environment,blocked_until,failures,active_run)values(j.environment,'-infinity',0,p_run)
 on conflict(environment)do update set active_run=p_run,updated_at=now();
end$$;
create or replace function public.finance_provider_pause(p_run uuid,p_seconds integer,p_status integer)returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;t finance_private.provider_limits;v_until timestamptz;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);
 if p_seconds<0 or p_status is null or not(p_status in(401,429)or p_status between 500 and 599)then raise exception 'Pausa de proveedor no válida';end if;
 v_until:=case when p_seconds is null then 'infinity'::timestamptz else now()+make_interval(secs=>greatest(p_seconds,1))end;
 insert into finance_private.provider_limits(environment,blocked_until,failures,last_status)values(j.environment,v_until,1,p_status)
 on conflict(environment)do update set blocked_until=greatest(provider_limits.blocked_until,excluded.blocked_until),failures=least(provider_limits.failures+1,10),last_status=p_status,active_run=null,updated_at=now() returning * into t;
 return jsonb_build_object('until',t.blocked_until,'failures',t.failures);
end$$;
create or replace function public.finance_provider_success(p_run uuid)returns void language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;
begin perform finance_private.lock_book();j:=finance_private.assert_job(p_run);
 update finance_private.provider_limits set failures=0,active_run=null,updated_at=now()where environment=j.environment and active_run=p_run and blocked_until<=now();
end$$;
revoke all on function public.finance_provider_gate(uuid),public.finance_provider_enter(uuid),public.finance_provider_pause(uuid,integer,integer),public.finance_provider_success(uuid)from public,anon,authenticated;
grant execute on function public.finance_provider_gate(uuid),public.finance_provider_enter(uuid),public.finance_provider_pause(uuid,integer,integer),public.finance_provider_success(uuid)to service_role;
create or replace function public.finance_job_work(p_run uuid,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;v_execute boolean;c jsonb;v_cutoff timestamptz;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);v_execute:=j.execute_requested and finance_private.execution_block(j.environment) is null;
 if p_limit not between 1 and 50 then raise exception 'Límite de trabajo no válido';end if;
 v_cutoff:=public.payout_credit_cutoff(now());
 if v_execute and not exists(select 1 from public.finance_batches where cutoff=v_cutoff and state='frozen') then
  c:=finance_private.candidates();
  if exists(select 1 from jsonb_array_elements(c) x where x->>'reason' is null and (x->>'available')::numeric>0) then
   perform finance_private.freeze_batch(gen_random_uuid(),v_cutoff,md5(c::text),(select operator_user_id from finance_private.automation_settings where id));
  end if;
 end if;
 return (select coalesce(jsonb_agg(w),'[]'::jsonb) from (
  select 'event' as operation,e.payout_id as payout,p.user_id,e.id as event,null::uuid as item,e.received_at as at
   from public.paypal_payout_events e join public.payouts p on p.id=e.payout_id join public.paypal_payout_submissions s on s.payout_id=p.id
   where e.state='pending' and s.environment=j.environment
  union all select 'payout',p.id,p.user_id,null::uuid,null::uuid,p.requested_at from public.payouts p join public.paypal_payout_submissions s on s.payout_id=p.id
   where p.status='sending' and s.environment=j.environment and (coalesce(s.batch_id,p.paypal_batch_id) is not null or (v_execute and s.state<>'manual_review' and exists(select 1 from public.finance_execution_reservations x where x.payout_id=p.id)))
   and not exists(select 1 from public.paypal_payout_events e where e.payout_id=p.id and e.state='pending')
  union all select 'prepare',null::uuid,i.user_id,null::uuid,i.id,b.created_at from public.finance_batch_items i join public.finance_batches b on b.id=i.batch_id
   where v_execute and b.state='frozen' and b.cutoff=v_cutoff and i.state='reserved' and not exists(select 1 from public.payouts p where p.finance_batch_item_id=i.id)
  order by at limit p_limit
 ) w);
end$$;
-- Keep an interrupted-round incident open on daily review, without repeated episodes.
do $migration$
declare v text;anchor text:='perform finance_private.lock_book();j:=finance_private.assert_job(p_run);';
begin
 v:=pg_get_functiondef('public.finance_job_review(uuid)'::regprocedure);
 if position(anchor in v)=0 then raise exception 'Revisar la definición de finance_job_review antes de actualizar';end if;
 if position('PROVIDER_INTERRUPTED' in v)>0 then return;end if;
 v:=replace(v,anchor,anchor||$source$
 for t in select l.* from finance_private.provider_limits l join public.finance_job_runs prior on prior.id=l.active_run where l.active_run<>p_run and(prior.state<>'running'or prior.lease_until<=now())loop
  perform finance_private.incident(p_run,'PROVIDER_INTERRUPTED',t.environment,'Una ronda de pagos necesita revisión','La ronda anterior no confirmó su cierre. Concilia los envíos y documenta su revisión antes de levantar esta espera. Los fondos permanecen separados.');
 end loop;
 $source$);
 execute v;
end$migration$;
select pg_notify('pgrst','reload schema');
