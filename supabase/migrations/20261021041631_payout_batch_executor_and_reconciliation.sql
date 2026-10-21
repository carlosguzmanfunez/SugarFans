-- Review is enabled; all automatic money gates remain OFF. No HTTP or cron in SQL.
create table finance_private.automation_settings(
 id boolean primary key default true check(id), review_enabled boolean not null default true,
 execution_enabled boolean not null default false, environment text not null default 'live' check(environment in ('sandbox','live')),
 operator_user_id uuid references public.profiles(id), provider_test_reference text,
 live_authorization_reference text, fee_limit numeric(12,2) check(fee_limit>=0 and fee_limit::text not in ('NaN','Infinity','-Infinity'))
);
alter table finance_private.automation_settings enable row level security;
insert into finance_private.automation_settings(id) values(true);
do $$begin
 if to_regclass('security_private.owner_account') is not null then
  execute 'update finance_private.automation_settings set operator_user_id=(select user_id from security_private.owner_account limit 1) where id';
 end if;
end$$;
create table public.finance_job_runs(
 id uuid primary key default gen_random_uuid(), environment text not null check(environment in ('sandbox','live')),
 execute_requested boolean not null, state text not null default 'running' check(state in ('running','finished','failed','expired')),
 started_at timestamptz not null default now(),lease_until timestamptz not null default now()+interval '3 minutes',
 finished_at timestamptz, summary jsonb not null default '{}'
);
create index finance_jobs_running on public.finance_job_runs(lease_until) where state='running';
create table public.finance_funding_checks(
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique,environment text not null check(environment in ('sandbox','live')),
 available numeric(14,2) not null check(available>=0 and available::text not in ('NaN','Infinity','-Infinity')),
 observed_at timestamptz not null, reference text not null,created_by uuid not null,created_at timestamptz not null default now()
);
create index finance_funding_latest on public.finance_funding_checks(environment,observed_at desc);
create trigger finance_funding_immutable before update or delete on public.finance_funding_checks for each row execute function finance_private.immutable();
create table public.finance_execution_reservations(
 payout_id uuid primary key references public.payouts(id), funding_id uuid not null references public.finance_funding_checks(id),
 budget numeric(14,2) not null check(budget>0),created_at timestamptz not null default now()
);
create trigger finance_execution_reservations_immutable before update or delete on public.finance_execution_reservations for each row execute function finance_private.immutable();
create table public.finance_incidents(
 id uuid primary key default gen_random_uuid(),fingerprint text not null unique,code text not null,reference text not null,
 title text not null,detail text not null,state text not null default 'open' check(state in ('open','resolved')),
 episode integer not null default 1,first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),
 last_seen_run uuid references public.finance_job_runs(id),resolved_at timestamptz
);
create index finance_incidents_open on public.finance_incidents(last_seen_at) where state='open';
create table public.finance_alert_queue(
 id uuid primary key default gen_random_uuid(),incident_id uuid not null references public.finance_incidents(id),episode integer not null,
 subject text not null,body text not null,recipient text,state text not null default 'pending' check(state in ('pending','sending','sent','review','cancelled')),
 created_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz,
 attempts integer not null default 0,first_attempt_at timestamptz,sent_at timestamptz,last_error text,unique(incident_id,episode)
);
create index finance_alert_due on public.finance_alert_queue(created_at) where state in ('pending','sending');
create table public.finance_statement_imports(
 id uuid primary key default gen_random_uuid(),request_key uuid not null unique,environment text not null check(environment in ('sandbox','live')),
 digest text not null,is_test boolean not null,created_by uuid not null,created_at timestamptz not null default now()
);
create table public.finance_statement_lines(
 id uuid primary key default gen_random_uuid(),import_id uuid not null references public.finance_statement_imports(id),
 environment text not null check(environment in ('sandbox','live')),source text not null check(source in ('paypal','bank')),
 external_id text not null,kind text not null check(kind in ('payout','fee','transfer')),reference text not null,
 amount numeric(14,2) not null check(amount>=0 and amount::text not in ('NaN','Infinity','-Infinity')),currency text not null check(currency='USD'),
 occurred_at timestamptz not null, unique(environment,source,external_id),check(source<>'bank' or kind='transfer')
);
create trigger finance_statement_imports_immutable before update or delete on public.finance_statement_imports for each row execute function finance_private.immutable();
create trigger finance_statement_lines_immutable before update or delete on public.finance_statement_lines for each row execute function finance_private.immutable();
create index finance_statement_reference on public.finance_statement_lines(environment,source,kind,reference,amount);
create index if not exists payouts_provider_item on public.payouts(paypal_item_id) where paypal_item_id is not null;
do $$declare t text;begin
 foreach t in array array['finance_job_runs','finance_funding_checks','finance_execution_reservations','finance_incidents','finance_alert_queue','finance_statement_imports','finance_statement_lines'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 end loop;
end$$;
revoke all on table finance_private.automation_settings from public,anon,authenticated,service_role;

-- A notification probe has no financial side effects. One stable delivery per recipient/day.
create table public.finance_alert_tests(
 id uuid primary key default gen_random_uuid(),recipient text not null,day date not null,created_by uuid not null,
 state text not null check(state in ('sending','pending','sent','review')),lease_token uuid,lease_until timestamptz,
 first_attempt_at timestamptz not null default now(),attempts integer not null default 1,last_error text,sent_at timestamptz,
 unique(recipient,day)
);
alter table public.finance_alert_tests enable row level security;
revoke all on public.finance_alert_tests from public,anon,authenticated,service_role;
create function public.finance_alert_test_claim(p_user uuid,p_recipient text) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.finance_alert_tests;v_token uuid:=gen_random_uuid();
begin
 perform finance_private.lock_book();
 if not exists(select 1 from public.profiles where id=p_user and role='admin') or p_recipient is null or p_recipient !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p_recipient)>254 then raise exception 'Prueba no autorizada';end if;
 select * into t from public.finance_alert_tests where recipient=p_recipient and day=(now() at time zone 'UTC')::date;
 if t.id is not null then
  if t.state='sent' then return jsonb_build_object('id',t.id,'operation','sent');end if;
  if t.state='review' or (t.state='sending' and t.lease_until>now()) then return jsonb_build_object('id',t.id,'operation','busy');end if;
  if t.attempts>=5 or t.first_attempt_at<now()-interval '23 hours' then update public.finance_alert_tests set state='review' where id=t.id;return jsonb_build_object('id',t.id,'operation','review');end if;
  update public.finance_alert_tests set state='sending',lease_token=v_token,lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=t.id;
 else
  insert into public.finance_alert_tests(recipient,day,created_by,state,lease_token,lease_until) values(p_recipient,(now() at time zone 'UTC')::date,p_user,'sending',v_token,now()+interval '2 minutes') returning * into t;
 end if;
 return jsonb_build_object('id',t.id,'token',v_token,'operation','send');
end$$;
create function public.finance_alert_test_finish(p_id uuid,p_token uuid,p_error text default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.finance_alert_tests set state=case when p_error is null then 'sent' else 'pending' end,sent_at=case when p_error is null then now() else null end,last_error=left(p_error,500),lease_token=null,lease_until=null
 where id=p_id and lease_token=p_token and state='sending';return found;
end$$;
revoke all on function public.finance_alert_test_claim(uuid,text),public.finance_alert_test_finish(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finance_alert_test_claim(uuid,text),public.finance_alert_test_finish(uuid,uuid,text) to service_role;

create function finance_private.reason_label(p_reason text) returns text language sql immutable set search_path='' as $$
 select case p_reason when 'IDENTITY_REQUIRED' then 'Falta verificar su identidad' when 'ACCOUNT_FROZEN' then 'Los retiros de esta cuenta están en revisión'
 when 'SUSPENDED' then 'La cuenta está suspendida' when 'RECIPIENT_REQUIRED' then 'Falta una cuenta PayPal válida' when 'OWNER_AMBIGUOUS' then 'Revisar el propietario del perfil'
 when 'DISPUTE_OPEN' then 'Hay una disputa pendiente' when 'NEGATIVE_BALANCE' then 'Hay saldo por recuperar' when 'SOURCE_CHANGED_AFTER_CLOSE' then 'Una ganancia cambió después del cierre'
 when 'EXECUTOR_DISABLED' then 'Los envíos automáticos están apagados' when 'COMMERCIAL_AUTHORIZATION_REQUIRED' then 'Falta la autorización escrita de PayPal'
 when 'PROVIDER_TEST_REQUIRED' then 'Falta registrar la prueba de entrega con PayPal' when 'FEE_LIMIT_REQUIRED' then 'Falta el presupuesto máximo de comisión'
 when 'OPERATOR_REQUIRED' then 'Falta identificar la cuenta responsable' when 'OUTSIDE_PAYMENT_WINDOW' then 'Estamos fuera de la ventana del 26 al 1'
 when 'ENVIRONMENT_MISMATCH' then 'La conexión y las cuentas usan entornos distintos' when 'RECONCILIATION_REQUIRED' then 'Hay diferencias en los reportes'
 when 'TRANSFER_UNMATCHED' then 'Falta la otra parte de la transferencia entre PayPal y banco' when 'PAYOUT_UNKNOWN' then 'No encontramos el retiro de esta referencia'
 when 'PAYOUT_NOT_CONFIRMED' then 'PayPal todavía no confirmó el retiro' when 'NET_MISMATCH' then 'El importe no coincide con el pago'
 when 'FEE_VARIANCE' then 'La comisión reportada difiere de la estimada' when 'AMBIGUOUS_REFERENCE' then 'La referencia aparece más de una vez'
 else 'Revisa el detalle del movimiento antes de continuar' end;
$$;

-- Matching never rewrites earnings, withdrawals or the estimated fee. Variances require review.
create function finance_private.statement_results() returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by occurred_at desc,id),'[]'::jsonb) from (
 select l.*,p.id as payout_id,p.net as expected_net,p.fee as estimated_fee,
 case when (select count(*) from public.finance_statement_lines d where d.environment=l.environment and d.source=l.source and d.kind=l.kind and d.reference=l.reference)>1 then 'review'
   when l.kind='transfer' then case when (select count(*) from public.finance_statement_lines o where o.environment=l.environment and o.source<>l.source and o.kind='transfer' and o.reference=l.reference and o.amount=l.amount)=1 then 'matched' else 'review' end
   when p.id is null or p.status<>'paid' then 'review'
   when l.kind='payout' and l.amount=p.net then 'matched'
   when l.kind='fee' and l.amount=p.fee then 'matched' else 'review' end as state,
 case when (select count(*) from public.finance_statement_lines d where d.environment=l.environment and d.source=l.source and d.kind=l.kind and d.reference=l.reference)>1 then 'AMBIGUOUS_REFERENCE'
   when l.kind='transfer' then case when (select count(*) from public.finance_statement_lines o where o.environment=l.environment and o.source<>l.source and o.kind='transfer' and o.reference=l.reference and o.amount=l.amount)=1 then null else 'TRANSFER_UNMATCHED' end
   when p.id is null then 'PAYOUT_UNKNOWN' when p.status<>'paid' then 'PAYOUT_NOT_CONFIRMED'
   when l.kind='payout' and l.amount<>p.net then 'NET_MISMATCH'
   when l.kind='fee' and l.amount<>p.fee then 'FEE_VARIANCE' else null end as reason
 from public.finance_statement_lines l left join public.payouts p on l.kind in ('payout','fee') and p.paypal_item_id=l.reference
 and exists(select 1 from public.paypal_payout_submissions s where s.payout_id=p.id and s.environment=l.environment)
 ) r;
$$;
create function public.finance_statement_import(p_key uuid,p_environment text,p_test boolean,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.finance_statement_imports;r jsonb;o public.finance_statement_lines;v_amount numeric;v_at timestamptz;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or p_environment is distinct from (select environment from finance_private.automation_settings where id)
  or p_test is distinct from (p_environment='sandbox') or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows) not between 1 and 200 then raise exception 'Indica un reporte de 1 a 200 filas del entorno de estas cuentas';end if;
 select * into v from public.finance_statement_imports where request_key=p_key;
 if v.id is not null then
  if (v.environment,v.is_test,v.digest) is distinct from (p_environment,p_test,md5(p_rows::text)) then raise exception 'Referencia de importación reutilizada';end if;
  return jsonb_build_object('id',v.id);
 end if;
 insert into public.finance_statement_imports(request_key,environment,digest,is_test,created_by) values(p_key,p_environment,md5(p_rows::text),p_test,auth.uid()) returning * into v;
 for r in select * from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'source','') not in ('paypal','bank') or coalesce(r->>'kind','') not in ('payout','fee','transfer')
    or nullif(trim(r->>'external_id'),'') is null or length(r->>'external_id')>200 or nullif(trim(r->>'reference'),'') is null or length(r->>'reference')>200
    or r->>'currency' is distinct from 'USD' or (r->>'source'='bank' and r->>'kind'<>'transfer') then raise exception 'Revisa origen, referencia, moneda USD y tipo de cada fila';end if;
  v_amount:=(r->>'amount')::numeric;v_at:=(r->>'occurred_at')::timestamptz;
  if v_amount is null or v_amount<0 or v_amount<>round(v_amount,2) or v_amount::text in ('NaN','Infinity','-Infinity') or v_at is null or not isfinite(v_at) then raise exception 'Indica importes válidos con dos decimales y fecha';end if;
  select * into o from public.finance_statement_lines where environment=p_environment and source=r->>'source' and external_id=trim(r->>'external_id');
  if o.id is not null then
   if (o.kind,o.reference,o.amount,o.currency,o.occurred_at) is distinct from (r->>'kind',trim(r->>'reference'),v_amount,'USD',v_at) then raise exception 'Una fila ya importada contiene datos diferentes; conserva el original';end if;
  else insert into public.finance_statement_lines(import_id,environment,source,external_id,kind,reference,amount,currency,occurred_at)
   values(v.id,p_environment,r->>'source',trim(r->>'external_id'),r->>'kind',trim(r->>'reference'),v_amount,'USD',v_at);end if;
 end loop;
 return jsonb_build_object('id',v.id);
end$$;
create function public.finance_funding_record(p_key uuid,p_environment text,p_available numeric,p_at timestamptz,p_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.finance_funding_checks;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or p_environment is distinct from (select environment from finance_private.automation_settings where id)
   or p_available is null or p_available<0 or p_available<>round(p_available,2) or p_available::text in ('NaN','Infinity','-Infinity')
   or p_at is null or p_at<now()-interval '24 hours' or p_at>now()+interval '5 minutes' or length(trim(coalesce(p_reference,''))) not between 10 and 500 then
   raise exception 'Registra el saldo disponible en PayPal en USD, su referencia y una comprobación de las últimas 24 horas';end if;
 select * into v from public.finance_funding_checks where request_key=p_key;
 if v.id is not null then
  if (v.environment,v.available,v.observed_at,v.reference) is distinct from (p_environment,p_available,p_at,trim(p_reference)) then raise exception 'Referencia de fondos reutilizada';end if;
 else insert into public.finance_funding_checks(request_key,environment,available,observed_at,reference,created_by)
  values(p_key,p_environment,p_available,p_at,trim(p_reference),auth.uid()) returning * into v;end if;
 return jsonb_build_object('id',v.id);
end$$;
create function finance_private.execution_block(p_environment text) returns text language plpgsql stable set search_path='' as $$
declare s finance_private.automation_settings;
begin
 select * into s from finance_private.automation_settings where id;
 if p_environment is distinct from s.environment then return 'ENVIRONMENT_MISMATCH';end if;
 if not s.review_enabled or not s.execution_enabled or not (select batch_handoff_enabled from finance_private.settings where id) then return 'EXECUTOR_DISABLED';end if;
 if nullif(trim(s.provider_test_reference),'') is null then return 'PROVIDER_TEST_REQUIRED';end if;
 if s.environment='live' and nullif(trim(s.live_authorization_reference),'') is null then return 'COMMERCIAL_AUTHORIZATION_REQUIRED';end if;
 if s.fee_limit is null then return 'FEE_LIMIT_REQUIRED';end if;
 if not exists(select 1 from public.profiles where id=s.operator_user_id and role='admin') then return 'OPERATOR_REQUIRED';end if;
 if not public.payout_window_open(now()) then return 'OUTSIDE_PAYMENT_WINDOW';end if;
 if exists(select 1 from jsonb_array_elements(finance_private.statement_results()) x where x->>'state'='review') then return 'RECONCILIATION_REQUIRED';end if;
 return null;
end$$;
-- Reuse the reviewed reservation contract, with an explicit actor for scheduled work.
create function finance_private.freeze_batch(p_key uuid,p_cutoff timestamptz,p_expected text,p_actor uuid)
returns jsonb language plpgsql set search_path='' as $$
declare b public.finance_batches;r jsonb;v_candidates jsonb;v_item uuid;v_fee numeric;
begin
 perform finance_private.lock_book();
 select * into b from public.finance_batches where request_key=p_key;
 if b.id is not null then if b.cutoff is distinct from p_cutoff then raise exception 'Referencia de lote reutilizada';end if;return jsonb_build_object('id',b.id);end if;
 if p_key is null or p_actor is null or p_cutoff is distinct from public.payout_credit_cutoff(now()) or not public.payout_window_open(now()) then raise exception 'Revisa el cierre corriente; los lotes se apartan del 26 al 1, hora de Honduras';end if;
 if exists(select 1 from public.finance_batches where cutoff=p_cutoff and state='frozen') then raise exception 'Este cierre ya tiene un lote apartado';end if;
 v_candidates:=finance_private.candidates();
 if md5(v_candidates::text) is distinct from p_expected then raise exception 'Los saldos cambiaron; actualiza y revisa el lote antes de apartarlo';end if;
 if not exists(select 1 from jsonb_array_elements(v_candidates) x where x->>'reason' is null and (x->>'available')::numeric>0) then raise exception 'No hay creadores listos para este lote';end if;
 insert into public.finance_batches(request_key,cutoff,version,created_by) values(p_key,p_cutoff,coalesce((select max(version) from public.finance_batches where cutoff=p_cutoff),0)+1,p_actor) returning * into b;
 for r in select * from jsonb_array_elements(v_candidates) loop
  if (r->>'available')::numeric<=0 then continue;end if;v_fee:=(r->>'fee')::numeric;
  insert into public.finance_batch_items(batch_id,user_id,creator_profile_id,creator_name,gross,fee,net,receiver,state,reason)
  values(b.id,(r->>'user_id')::uuid,r->>'creator_profile_id',r->>'name',(r->>'available')::numeric,v_fee,(r->>'available')::numeric-v_fee,r->>'receiver',case when r->>'reason' is null then 'reserved' else 'held' end,r->>'reason') returning id into v_item;
  if r->>'reason' is null then
   perform finance_private.allocate(r->>'creator_profile_id',(r->>'available')::numeric,p_cutoff,null,v_item);
   perform finance_private.post('batch/'||v_item||'/reserve',r->>'creator_profile_id','creator_payable','creator_reserved',(r->>'available')::numeric,'batch_reserved',v_item::text,jsonb_build_object('batch',b.id,'cutoff',p_cutoff,'item',v_item));
  end if;
 end loop;
 return jsonb_build_object('id',b.id);
end$$;
create or replace function public.finance_batch_freeze(p_key uuid,p_cutoff timestamptz,p_expected text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin perform finance_private.assert_admin();return finance_private.freeze_batch(p_key,p_cutoff,p_expected,auth.uid());end$$;

create function finance_private.incident(p_run uuid,p_code text,p_reference text,p_title text,p_detail text)
returns void language plpgsql set search_path='' as $$
declare i public.finance_incidents;
begin
 insert into public.finance_incidents(fingerprint,code,reference,title,detail,last_seen_run)
 values(p_code||'/'||p_reference,p_code,p_reference,left(p_title,200),left(p_detail,2000),p_run)
 on conflict(fingerprint) do update set state='open',episode=case when finance_incidents.state='resolved' then finance_incidents.episode+1 else finance_incidents.episode end,
  title=excluded.title,detail=excluded.detail,last_seen_at=now(),last_seen_run=p_run,resolved_at=null returning * into i;
 insert into public.finance_alert_queue(incident_id,episode,subject,body)
 values(i.id,i.episode,case when (select environment from finance_private.automation_settings where id)='sandbox' then 'Prueba Sandbox · ' else '' end||'Fans Reserve: '||i.title,
 case when (select environment from finance_private.automation_settings where id)='sandbox' then E'PRUEBA CON DATOS FICTICIOS. No corresponde a dinero real.\n\n' else '' end||i.detail||E'\n\nRevisa Pagos a creadores en tu panel administrativo. Los fondos en revisión se conservan hasta conciliar el resultado.') on conflict(incident_id,episode) do nothing;
end$$;
create function public.finance_job_start(p_environment text,p_execute boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;
begin
 perform finance_private.lock_book();
 if p_environment not in ('sandbox','live') or p_execute is null then raise exception 'Entorno no válido';end if;
 if not (select review_enabled from finance_private.automation_settings where id) then return jsonb_build_object('operation','disabled');end if;
 if exists(select 1 from public.finance_job_runs where state='running' and lease_until>now()) then return jsonb_build_object('operation','busy');end if;
 update public.finance_job_runs set state='expired',finished_at=now() where state='running';
 insert into public.finance_job_runs(environment,execute_requested) values(p_environment,p_execute) returning * into j;
 return jsonb_build_object('operation','run','id',j.id,'blocked',case when p_execute then finance_private.execution_block(p_environment) else 'REVIEW_ONLY' end);
end$$;
create function finance_private.assert_job(p_run uuid) returns public.finance_job_runs language plpgsql set search_path='' as $$
declare j public.finance_job_runs;
begin select * into j from public.finance_job_runs where id=p_run; if j.id is null or j.state<>'running' or j.lease_until<=now() then raise exception 'La ejecución venció; conserva sus referencias y reanuda con una revisión nueva';end if;return j;end$$;
create function public.finance_job_review(p_run uuid) returns integer language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;r jsonb;t record;v_count integer;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);
 for r in select * from jsonb_array_elements(finance_private.candidates()) loop
  if (r->>'available')::numeric<0 or ((r->>'available')::numeric>0 and r->>'reason' is not null and r->>'reason' not in ('BELOW_MINIMUM','BATCH_RESERVED','PAYOUT_IN_PROGRESS')) then
   perform finance_private.incident(p_run,coalesce(r->>'reason','NEGATIVE_BALANCE'),r->>'user_id','Un creador necesita revisión',coalesce(r->>'name','Creador')||': '||finance_private.reason_label(coalesce(r->>'reason','NEGATIVE_BALANCE'))||'.');
  end if;
 end loop;
 for t in select * from public.finance_batch_items where state='review' loop perform finance_private.incident(p_run,'BATCH_REVIEW',t.id::text,'Una ganancia cambió después del cierre',t.creator_name||': revisa las ganancias asignadas antes de preparar su envío.');end loop;
 if extract(day from now() at time zone 'America/Tegucigalpa')=1 and exists(select 1 from public.finance_batch_items i join public.finance_batches b on b.id=i.batch_id where b.state='frozen' and i.state='reserved' and b.cutoff=public.payout_credit_cutoff(now()) and not exists(select 1 from public.payouts p where p.finance_batch_item_id=i.id)) then
  perform finance_private.incident(p_run,'BATCH_BACKLOG',public.payout_credit_cutoff(now())::text,'Quedan pagos en el último día de la ventana','Todavía hay envíos por preparar. Revisa las incidencias y la capacidad del ejecutor antes de que termine el día 1, hora de Honduras.');end if;
 for t in select p.id,p.creator_name,s.state from public.payouts p left join public.paypal_payout_submissions s on s.payout_id=p.id
 where p.status='sending' and (s.state='manual_review' or (p.requested_at<now()-interval '30 minutes' and coalesce(s.state,'')<>'prepared')) loop
  perform finance_private.incident(p_run,'PAYOUT_PENDING',t.id::text,'Un retiro sigue sin confirmación',t.creator_name||': el dinero permanece separado mientras se confirma el envío con PayPal.');
 end loop;
 for t in select * from public.paypal_payout_events where state='review' or (state='pending' and received_at<now()-interval '5 minutes') loop perform finance_private.incident(p_run,'PROVIDER_EVENT',t.id::text,'Un aviso de PayPal requiere conciliación','Un aviso está pendiente o contiene una referencia que requiere revisión. Se conserva su contenido original.');end loop;
 for r in select * from jsonb_array_elements(finance_private.statement_results()) where value->>'state'='review' loop perform finance_private.incident(p_run,'STATEMENT_REVIEW',r->>'id','Un reporte no coincide con las cuentas','Revisa la fila '||(r->>'external_id')||'. '||finance_private.reason_label(r->>'reason')||'. Los saldos de creadores no se modifican automáticamente por esta diferencia.');end loop;
 if j.execute_requested and finance_private.execution_block(j.environment) is not null then perform finance_private.incident(p_run,'EXECUTION_BLOCKED',j.environment,'El envío automático está detenido',finance_private.reason_label(finance_private.execution_block(j.environment))||'. La revisión permanece disponible.');end if;
 update public.finance_incidents set state='resolved',resolved_at=now() where state='open' and last_seen_run is distinct from p_run and code not in ('JOB_FAILURE','PREPARATION_FAILED');
 update public.finance_alert_queue a set state='cancelled' from public.finance_incidents i where a.incident_id=i.id and (i.state='resolved' or a.episode<>i.episode) and (a.state='pending' or (a.state='sending' and a.lease_until<=now()));
 select count(*) into v_count from public.finance_incidents where state='open';return v_count;
end$$;
create function public.finance_job_work(p_run uuid,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;v_execute boolean;c jsonb;v_cutoff timestamptz;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);v_execute:=j.execute_requested and finance_private.execution_block(j.environment) is null;
 if p_limit not between 1 and 10 then raise exception 'Límite de trabajo no válido';end if;
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
create function public.finance_job_allow_submit(p_run uuid,p_user uuid,p_payout uuid,p_sender text)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;f public.finance_funding_checks;v_used numeric;v_fee numeric;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);
 if not j.execute_requested or finance_private.execution_block(j.environment) is not null then return false;end if;
 select * into f from public.finance_funding_checks where environment=j.environment and observed_at between now()-interval '24 hours' and now() order by observed_at desc,created_at desc limit 1;
 select fee_limit into v_fee from finance_private.automation_settings where id;
 select coalesce(sum(p.net+greatest(p.fee,v_fee)),0) into v_used from public.payouts p join public.paypal_payout_submissions s on s.payout_id=p.id
 where s.environment=j.environment and (p.status='sending' or (p.status='paid' and coalesce(p.paid_at,p.requested_at)>=f.observed_at));
 return f.id is not null and f.available>=v_used and exists(select 1 from public.payouts p join public.paypal_payout_submissions s on s.payout_id=p.id join public.finance_execution_reservations x on x.payout_id=p.id
  join public.profiles u on u.id=p.user_id where p.id=p_payout and p.user_id=p_user and p.status='sending' and s.environment=j.environment and s.sender_client_id=p_sender
  and u.role='creator' and u.is_verified and not public.is_suspended(u.id) and not exists(select 1 from public.account_restrictions where user_id=u.id and payouts_frozen)
  and not exists(select 1 from public.transactions where creator_profile_id=u.creator_profile_id and status='disputed' and not platform_covers) and public.creator_available_balance(u.id)>=0);
end$$;
create function public.finance_job_prepare(p_run uuid,p_item uuid,p_sender text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;i public.finance_batch_items;f public.finance_funding_checks;v jsonb;v_used numeric;v_budget numeric;v_fee_limit numeric;v_prior public.payouts;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);
 if not j.execute_requested or finance_private.execution_block(j.environment) is not null then raise exception 'El ejecutor no tiene las autorizaciones necesarias';end if;
 select * into i from public.finance_batch_items where id=p_item;
 select * into v_prior from public.payouts where finance_batch_item_id=p_item;
 if v_prior.id is not null then return jsonb_build_object('id',v_prior.id,'net',v_prior.net,'fee',v_prior.fee,'user_id',v_prior.user_id);end if;
 select * into f from public.finance_funding_checks where environment=j.environment and observed_at>=now()-interval '24 hours' and observed_at<=now() order by observed_at desc,created_at desc limit 1;
 select fee_limit into v_fee_limit from finance_private.automation_settings where id;
 if i.id is null or i.fee>v_fee_limit then raise exception 'Revisa el presupuesto de comisión antes del envío';end if;
 if f.id is null then raise exception 'Falta comprobar el saldo disponible en PayPal durante las últimas 24 horas';end if;
 select coalesce(sum(p.net+greatest(p.fee,v_fee_limit)),0) into v_used from public.payouts p join public.paypal_payout_submissions s on s.payout_id=p.id
 where s.environment=j.environment and (p.status='sending' or (p.status='paid' and coalesce(p.paid_at,p.requested_at)>=f.observed_at));
 v_budget:=i.net+v_fee_limit;
 if f.available-v_used<v_budget then raise exception 'Los fondos comprobados no alcanzan para este envío y su presupuesto de comisión';end if;
 v:=public.finance_batch_prepare_payout(p_item,j.environment,p_sender);
 insert into public.finance_execution_reservations(payout_id,funding_id,budget) values((v->>'id')::uuid,f.id,v_budget) on conflict(payout_id) do nothing;
 update public.finance_incidents set state='resolved',resolved_at=now() where code='PREPARATION_FAILED' and reference=p_item::text and state='open';
 return v||jsonb_build_object('user_id',i.user_id);
end$$;
create function public.finance_job_finish(p_run uuid,p_summary jsonb,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);
 if jsonb_typeof(p_summary) is distinct from 'object' or length(p_summary::text)>10000 then raise exception 'Resumen no válido';end if;
 update public.finance_job_runs set state=case when p_error is null then 'finished' else 'failed' end,finished_at=now(),summary=p_summary where id=p_run;
 if p_error is not null then perform finance_private.incident(p_run,'JOB_FAILURE','executor','La revisión automática necesita atención',left(p_error,1000));
 else update public.finance_incidents set state='resolved',resolved_at=now() where code='JOB_FAILURE' and state='open';end if;
end$$;
create function public.finance_job_item_error(p_run uuid,p_item uuid,p_message text) returns void language plpgsql security definer set search_path='' as $$
begin perform finance_private.lock_book();perform finance_private.assert_job(p_run);
 perform finance_private.incident(p_run,'PREPARATION_FAILED',p_item::text,'Un envío necesita revisión',left(p_message,1000));end$$;
create function public.finance_alert_claim(p_recipient text,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.finance_alert_queue;v jsonb:='[]';v_token uuid;
begin
 if p_recipient is null or p_recipient !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p_recipient)>254 or p_limit not between 1 and 10 then raise exception 'Destinatario o límite no válido';end if;
 for a in select q.* from public.finance_alert_queue q join public.finance_incidents i on i.id=q.incident_id
  where i.state='open' and q.episode=i.episode and q.state in ('pending','sending') and coalesce(q.lease_until,'-infinity')<=now() and coalesce(q.next_attempt_at,'-infinity')<=now()
  order by q.created_at limit p_limit for update of q skip locked loop
  if a.attempts>=5 or a.first_attempt_at<now()-interval '23 hours' then update public.finance_alert_queue set state='review' where id=a.id;continue;end if;
  v_token:=gen_random_uuid();update public.finance_alert_queue set state='sending',recipient=coalesce(recipient,p_recipient),lease_token=v_token,lease_until=now()+interval '2 minutes',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()) where id=a.id;
  v:=v||jsonb_build_array(jsonb_build_object('id',a.id,'token',v_token,'to',coalesce(a.recipient,p_recipient),'subject',a.subject,'body',a.body,'key','finance-'||a.id));
 end loop;return v;
end$$;
create function public.finance_alert_finish(p_id uuid,p_token uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.finance_alert_queue set state=case when p_error is null then 'sent' else 'pending' end,sent_at=case when p_error is null then now() else null end,
 last_error=left(p_error,500),lease_token=null,lease_until=null,next_attempt_at=case when p_error is null then null else now()+interval '5 minutes' end where id=p_id and lease_token=p_token and state='sending';
 return found;
end$$;
create function public.finance_operations() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s finance_private.automation_settings;
begin
 perform finance_private.assert_admin();select * into s from finance_private.automation_settings where id;
 return jsonb_build_object('environment',s.environment,'review_enabled',s.review_enabled,'execution_enabled',s.execution_enabled and (select batch_handoff_enabled from finance_private.settings where id),
  'authorization_confirmed',nullif(trim(s.live_authorization_reference),'') is not null,'provider_tested',nullif(trim(s.provider_test_reference),'') is not null,'blocked',finance_private.execution_block(s.environment),
  'fee_limit',s.fee_limit,'incidents',coalesce((select jsonb_agg(to_jsonb(i) order by i.first_seen_at) from public.finance_incidents i where state='open'),'[]'::jsonb),
  'alerts_pending',(select count(*) from public.finance_alert_queue where state in ('pending','sending','review')),
  'jobs',coalesce((select jsonb_agg(j) from(select id,environment,state,started_at,finished_at,summary from public.finance_job_runs order by started_at desc limit 10) j),'[]'::jsonb),
  'funding',(select to_jsonb(f) from public.finance_funding_checks f where environment=s.environment order by observed_at desc,created_at desc limit 1),
  'statements',finance_private.statement_results());
end$$;
revoke all on all functions in schema finance_private from public,anon,authenticated,service_role;
revoke all on function public.finance_statement_import(uuid,text,boolean,jsonb),public.finance_funding_record(uuid,text,numeric,timestamptz,text),public.finance_operations() from public,anon;
grant execute on function public.finance_statement_import(uuid,text,boolean,jsonb),public.finance_funding_record(uuid,text,numeric,timestamptz,text),public.finance_operations() to authenticated;
revoke all on function public.finance_job_start(text,boolean),public.finance_job_review(uuid),public.finance_job_work(uuid,integer),public.finance_job_allow_submit(uuid,uuid,uuid,text),public.finance_job_prepare(uuid,uuid,text),public.finance_job_finish(uuid,jsonb,text),public.finance_job_item_error(uuid,uuid,text),public.finance_alert_claim(text,integer),public.finance_alert_finish(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finance_job_start(text,boolean),public.finance_job_review(uuid),public.finance_job_work(uuid,integer),public.finance_job_allow_submit(uuid,uuid,uuid,text),public.finance_job_prepare(uuid,uuid,text),public.finance_job_finish(uuid,jsonb,text),public.finance_job_item_error(uuid,uuid,text),public.finance_alert_claim(text,integer),public.finance_alert_finish(uuid,uuid,text) to service_role;
select pg_notify('pgrst','reload schema');
