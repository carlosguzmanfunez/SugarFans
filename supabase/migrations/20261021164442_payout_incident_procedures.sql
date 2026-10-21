-- Attribution is evidence-based; it is not permission to debit a fan or waive platform fault.
-- No automatic money gate, transaction status or historical payout is changed by deployment.
create table public.finance_case_actions(
 id uuid primary key default gen_random_uuid(),sequence bigint generated always as identity unique,
 request_key uuid not null unique,incident_id uuid not null references public.finance_incidents(id),episode integer not null,
 action text not null check(action in ('note','coverage','release_hold','ack_alert','close_review')),
 party text not null check(party in ('undetermined','creator','fan','platform','provider')),
 category text not null check(category in ('unresolved','human_input','service_delivery','platform_processing','provider_processing','other')),
 evidence text not null,reason text not null,notice text,followup_at timestamptz,
 expected_hash text not null,before_snapshot jsonb not null,result jsonb not null,
 created_by uuid not null,created_at timestamptz not null default now()
);
create index finance_case_actions_incident on public.finance_case_actions(incident_id,sequence desc);
create table public.finance_payout_holds(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,
 kind text not null check(kind in ('fee','safety','manual')),reference text not null unique,
 payout_id uuid references public.payouts(id),reason text not null,created_at timestamptz not null default now()
);
create index finance_payout_holds_user on public.finance_payout_holds(user_id);
create table public.finance_hold_releases(
 hold_id uuid primary key references public.finance_payout_holds(id),
 decision_id uuid not null unique references public.finance_case_actions(id) deferrable initially deferred,
 created_at timestamptz not null default now()
);
do $$declare t text;begin
 foreach t in array array['finance_case_actions','finance_payout_holds','finance_hold_releases'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger case_record_immutable before update or delete on public.%I for each row execute function finance_private.immutable()',t);
 end loop;
end$$;
revoke all on sequence public.finance_case_actions_sequence_seq from public,anon,authenticated,service_role;

-- Preserve already frozen accounts; adoption never releases a restriction.
insert into public.finance_payout_holds(user_id,kind,reference,payout_id,reason)
 select p.user_id,'fee','adopt-fee/'||h.id,p.id,h.reason from public.finance_fee_holds h join public.payouts p on p.id=h.payout_id
 where exists(select 1 from public.account_restrictions r where r.user_id=p.user_id and r.payouts_frozen);
insert into public.finance_payout_holds(user_id,kind,reference,reason)
 select r.user_id,'safety','adopt-freeze/'||r.user_id,'Bloqueo previo: concilia sus causas y documenta la revisión antes de liberar'
 from public.account_restrictions r where r.payouts_frozen and not exists(select 1 from public.finance_payout_holds h where h.user_id=r.user_id);

-- Notification failure is shown in the dashboard; never email a failure about its own failed email.
create or replace function finance_private.incident(p_run uuid,p_code text,p_reference text,p_title text,p_detail text)
returns void language plpgsql set search_path='' as $$
declare i public.finance_incidents;
begin
 insert into public.finance_incidents(fingerprint,code,reference,title,detail,last_seen_run)
 values(p_code||'/'||p_reference,p_code,p_reference,left(p_title,200),left(p_detail,2000),p_run)
 on conflict(fingerprint) do update set state='open',episode=case when finance_incidents.state='resolved' then finance_incidents.episode+1 else finance_incidents.episode end,
 title=excluded.title,detail=excluded.detail,last_seen_at=now(),last_seen_run=p_run,resolved_at=null returning * into i;
 if p_code='ALERT_DELIVERY' then return;end if;
 insert into public.finance_alert_queue(incident_id,episode,subject,body)
 values(i.id,i.episode,case when (select environment from finance_private.automation_settings where id)='sandbox' then 'Prueba Sandbox · ' else '' end||'Fans Reserve: '||i.title,
 case when (select environment from finance_private.automation_settings where id)='sandbox' then E'PRUEBA CON DATOS FICTICIOS. No corresponde a dinero real.\n\n' else '' end||i.detail||E'\n\nRevisa Pagos a creadores en tu panel administrativo. Los fondos en revisión se conservan hasta conciliar el resultado.') on conflict(incident_id,episode) do nothing;
end$$;

create function finance_private.place_hold(p_user uuid,p_kind text,p_reference text,p_reason text,p_payout uuid default null)
returns uuid language plpgsql set search_path='' as $$
declare v uuid;
begin
 perform finance_private.lock_book();
 insert into public.finance_payout_holds(user_id,kind,reference,payout_id,reason)
 values(p_user,p_kind,p_reference,p_payout,p_reason) on conflict(reference) do nothing returning id into v;
 if v is null then select id into v from public.finance_payout_holds where reference=p_reference;end if;
 insert into public.account_restrictions(user_id,payouts_frozen) values(p_user,true) on conflict(user_id) do update set payouts_frozen=true;
 perform finance_private.incident(null,'PAYOUT_HOLD',v::text,'Revisar bloqueo · '||coalesce((select name from public.profiles where id=p_user),'Cuenta'),p_reason);
 return v;
end$$;
create function finance_private.capture_freeze() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.payouts_frozen and not exists(select 1 from public.finance_payout_holds h where h.user_id=new.user_id and not exists(select 1 from public.finance_hold_releases r where r.hold_id=h.id)) then
  perform finance_private.place_hold(new.user_id,'safety','freeze/'||gen_random_uuid(),'Bloqueo de seguridad: revisa conciliación, disputas y saldos antes de liberar');
 end if;return new;
end$$;
create trigger finance_capture_freeze after insert or update of payouts_frozen on public.account_restrictions for each row execute function finance_private.capture_freeze();
create function finance_private.guard_unfreeze() returns trigger language plpgsql set search_path='' as $$
begin
 if old.payouts_frozen and not new.payouts_frozen and exists(select 1 from public.finance_payout_holds h where h.user_id=old.user_id and not exists(select 1 from public.finance_hold_releases r where r.hold_id=h.id)) then
  raise exception 'Revisa y libera cada bloqueo desde el expediente de incidencias';end if;
 return new;
end$$;
create trigger finance_guard_unfreeze before update of payouts_frozen on public.account_restrictions for each row execute function finance_private.guard_unfreeze();
create or replace function finance_private.fee_hold(p_payout uuid,p_reference text,p_reason text) returns void language plpgsql set search_path='' as $$
declare v_user uuid;
begin
 insert into public.finance_fee_holds(payout_id,reference,reason) values(p_payout,p_reference,p_reason) on conflict(reference) do nothing;
 select user_id into v_user from public.payouts where id=p_payout;
 perform finance_private.place_hold(v_user,'fee','fee/'||p_reference,p_reason,p_payout);
end$$;

-- Clone reviewed legacy bodies without renaming their public OIDs or weakening owner protections.
do $clone$declare d text;begin
 d:=pg_get_functiondef('public.admin_account_action(uuid,text,text,integer)'::regprocedure);
 execute replace(d,'FUNCTION public.admin_account_action(','FUNCTION finance_private.account_action_before_cases(');
 d:=pg_get_functiondef('public.admin_cover_refund(uuid,boolean)'::regprocedure);
 execute replace(d,'FUNCTION public.admin_cover_refund(','FUNCTION finance_private.cover_before_cases(');
 d:=pg_get_functiondef('public.paypal_payout_reconcile_finish(uuid,jsonb)'::regprocedure);
 execute replace(d,'FUNCTION public.paypal_payout_reconcile_finish(','FUNCTION finance_private.reconcile_before_cases(');
 d:=pg_get_functiondef('public.finance_creator_balance()'::regprocedure);
 execute replace(d,'FUNCTION public.finance_creator_balance(','FUNCTION finance_private.balance_before_cases(');
 if to_regprocedure('public.paypal_money_back(text,text)') is not null then
  d:=pg_get_functiondef('public.paypal_money_back(text,text)'::regprocedure);
  execute replace(d,'FUNCTION public.paypal_money_back(','FUNCTION finance_private.money_back_before_cases(');
  execute $def$create or replace function public.paypal_money_back(p_ref text,p_action text) returns jsonb language plpgsql security definer set search_path='' as $body$begin perform finance_private.lock_book();return finance_private.money_back_before_cases(p_ref,p_action);end$body$$def$;
 end if;
end$clone$;
create or replace function public.paypal_payout_reconcile_finish(p_query uuid,p_response jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin perform finance_private.lock_book();return finance_private.reconcile_before_cases(p_query,p_response);end$$;
create or replace function public.finance_creator_balance() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 v:=finance_private.balance_before_cases();
 return v||jsonb_build_object('holds',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'kind',h.kind,'created_at',h.created_at) order by h.created_at) from public.finance_payout_holds h where h.user_id=auth.uid() and not exists(select 1 from public.finance_hold_releases r where r.hold_id=h.id)),'[]'::jsonb));
end$$;
create or replace function public.admin_account_action(p_user uuid,p_action text,p_reason text,p_days integer default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_action='unfreeze_payouts' then raise exception 'El desbloqueo requiere un expediente con evidencia; abre Incidencias de pagos';end if;
 if p_action='freeze_payouts' and nullif(trim(p_reason),'') is null then raise exception 'Escribe el motivo del bloqueo';end if;
 if p_action='freeze_payouts' and not exists(select 1 from public.finance_payout_holds h where h.user_id=p_user and h.kind='manual' and not exists(select 1 from public.finance_hold_releases r where r.hold_id=h.id)) then
  perform finance_private.place_hold(p_user,'manual','manual/'||gen_random_uuid(),left(trim(p_reason),500));
 end if;
 perform finance_private.account_action_before_cases(p_user,p_action,p_reason,p_days);
end$$;
create or replace function public.admin_cover_refund(p_transaction uuid,p_cover boolean)
returns void language plpgsql security definer set search_path='' as $$
begin perform finance_private.assert_admin();raise exception 'Decide la cobertura desde el expediente de incidencias, con evidencia y responsable';end$$;

create function finance_private.dispute_snapshot(p_ref text) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('transaction',t.id::text,'creator',t.creator_profile_id,'status',t.status,'covered',t.platform_covers,'amount',t.amount,'creator_cut',round(t.amount*t.creator_share,2),
 'source_revision',(select s.revision from public.finance_sources s where s.kind='transaction' and s.creator_profile_id=t.creator_profile_id and s.reference=t.id::text))
 from public.transactions t where t.id::text=p_ref;
$$;
create function finance_private.hold_blockers(p_user uuid,p_payout uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare v jsonb:='[]';p public.profiles;q public.paypal_payout_reconciliations;x public.payouts;r record;b jsonb;
begin
 select * into p from public.profiles where id=p_user;
 if p.id is null or p.role<>'creator' then v:=v||'"CREATOR_REQUIRED"'::jsonb;
 elsif not p.is_verified then v:=v||'"IDENTITY_REQUIRED"'::jsonb;end if;
 if public.is_suspended(p_user) or exists(select 1 from auth.users where id=p_user and (deleted_at is not null or banned_until>now())) then v:=v||'"SUSPENDED"'::jsonb;end if;
 if exists(select 1 from public.payouts where user_id=p_user and status='sending') then v:=v||'"PAYOUT_IN_PROGRESS"'::jsonb;end if;
 if exists(select 1 from public.payouts z left join lateral(select poll_record.* from public.paypal_payout_reconciliations poll_record where poll_record.payout_id=z.id order by sequence desc limit 1) latest on true
  where z.user_id=p_user and ((latest.id is not null and (latest.outcome<>'applied' or latest.status_after is distinct from z.status)) or (z.status='paid' and latest.id is null))) then v:=v||'"PROVIDER_CONFIRMATION_REQUIRED"'::jsonb;end if;
 if exists(select 1 from public.transactions where creator_profile_id=p.creator_profile_id and status='disputed') then v:=v||'"DISPUTE_OPEN"'::jsonb;end if;
 if coalesce(public.creator_available_balance(p_user),0)<0 then v:=v||'"NEGATIVE_BALANCE"'::jsonb;end if;
 if exists(select 1 from public.finance_batch_items where user_id=p_user and state='review') then v:=v||'"SOURCE_CHANGED_AFTER_CLOSE"'::jsonb;end if;
 if exists(select 1 from public.paypal_payout_events e join public.payouts z on z.id=e.payout_id where z.user_id=p_user and e.state in ('pending','review')) then v:=v||'"PROVIDER_EVENT"'::jsonb;end if;
 if exists(select 1 from jsonb_array_elements(finance_private.statement_results()) s join public.payouts z on z.id::text=s->>'payout_id' where z.user_id=p_user and s->>'state'='review') then v:=v||'"RECONCILIATION_REQUIRED"'::jsonb;end if;
 if exists(select 1 from public.transactions t where t.creator_profile_id=p.creator_profile_id and t.status='refunded' and not exists(select 1 from public.finance_case_actions a join public.finance_incidents i on i.id=a.incident_id where i.code='DISPUTE_CASE' and i.reference=t.id::text and a.action='coverage' and a.result->>'assessment_hash'=md5(finance_private.dispute_snapshot(t.id::text)::text))) then v:=v||'"DISPUTE_ASSESSMENT_REQUIRED"'::jsonb;end if;
 if p_payout is not null then
  select * into x from public.payouts where id=p_payout;
  select * into q from public.paypal_payout_reconciliations where payout_id=p_payout order by sequence desc limit 1;
  if x.status not in ('paid','failed') or q.outcome is distinct from 'applied' or q.status_after is distinct from x.status or q.response->>'http' is distinct from '200' then v:=v||'"PROVIDER_CONFIRMATION_REQUIRED"'::jsonb;end if;
  for r in select * from public.finance_fee_resolutions f where f.payout_id=p_payout and not exists(select 1 from public.finance_fee_reversals z where z.resolution_id=f.id) loop
   b:=finance_private.fee_basis(r.line_id);
   if x.status<>'paid' or b->>'issue' is not null or (b->>'actual_fee')::numeric is distinct from r.actual_fee then v:=v||'"FEE_PROOF_CHANGED"'::jsonb;end if;
  end loop;
 end if;
 return v;
end$$;
create function finance_private.case_basis(p_id uuid) returns jsonb language plpgsql volatile set search_path='' as $$
declare i public.finance_incidents;h public.finance_payout_holds;a public.finance_alert_queue;v jsonb;s jsonb;v_actions jsonb:='["note"]';v_blockers jsonb:='[]';v_last uuid;
begin
 select * into i from public.finance_incidents where id=p_id;
 if i.id is null then return jsonb_build_object('issue','CASE_NOT_FOUND');end if;
 if i.state='resolved' then v_actions:='[]';end if;
 select id into v_last from public.finance_case_actions where incident_id=i.id order by sequence desc limit 1;
 s:=jsonb_build_object('reference',i.reference,'detail',i.detail);
 if i.code='DISPUTE_CASE' then
  s:=finance_private.dispute_snapshot(i.reference);
  if s->>'status' in ('disputed','refunded') then v_actions:=v_actions||'"coverage"'::jsonb;end if;
  if i.state='open' and (s->>'status'='paid' or (s->>'status'='refunded' and exists(select 1 from public.finance_case_actions x where x.incident_id=i.id and x.action='coverage' and x.result->>'assessment_hash'=md5(s::text)))) then v_actions:=v_actions||'"close_review"'::jsonb;end if;
 elsif i.code='PAYOUT_HOLD' then
  select * into h from public.finance_payout_holds where id::text=i.reference;
  v_blockers:=finance_private.hold_blockers(h.user_id,h.payout_id);
  s:=to_jsonb(h)||jsonb_build_object('released',exists(select 1 from public.finance_hold_releases where hold_id=h.id),'remaining_holds',(select count(*) from public.finance_payout_holds z where z.user_id=h.user_id and z.id<>h.id and not exists(select 1 from public.finance_hold_releases r where r.hold_id=z.id)),'blockers',v_blockers);
  if h.id is not null and jsonb_array_length(v_blockers)=0 and not exists(select 1 from public.finance_hold_releases where hold_id=h.id) then v_actions:=v_actions||'"release_hold"'::jsonb;end if;
 elsif i.code='ALERT_DELIVERY' then
  select * into a from public.finance_alert_queue where id::text=i.reference;
  s:=jsonb_build_object('alert',a.id,'state',a.state,'attempts',a.attempts,'recipient',a.recipient,'first_attempt_at',a.first_attempt_at,'original_incident',a.incident_id,'original_episode',a.episode);
  if a.state='review' then v_actions:=v_actions||'"ack_alert"'::jsonb;end if;
 elsif i.code='CASE_OVERDUE' then
  select jsonb_build_object('parent_incident',x.incident_id,'followup_at',x.followup_at,'reason',x.reason) into s from public.finance_case_actions x where x.id::text=i.reference;
 end if;
 v:=jsonb_build_object('incident',i.id,'episode',i.episode,'state',i.state,'code',i.code,'title',i.title,'source',s,'actions',v_actions,'last_action',v_last);
 return v||jsonb_build_object('hash',md5(v::text),'issue',null);
end$$;
create function public.finance_case_preview(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform finance_private.assert_admin();
 return finance_private.case_basis(p_id)||jsonb_build_object('history',coalesce((select jsonb_agg(to_jsonb(a) order by a.sequence desc) from public.finance_case_actions a where incident_id=p_id),'[]'::jsonb));
end$$;
create function public.finance_case_list(p_offset integer default 0,p_limit integer default 50,p_reference text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform finance_private.assert_admin();
 if p_offset is null or p_offset not between 0 and 1000000 or p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_reference,''))>100 then raise exception 'Página de expedientes no válida';end if;
 return (with relevant as(select i.* from public.finance_incidents i where (i.state='open' or exists(select 1 from public.finance_case_actions a where a.incident_id=i.id)) and (p_reference is null or i.reference=p_reference or exists(select 1 from public.finance_payout_holds h where h.id::text=i.reference and h.user_id::text=p_reference) or exists(select 1 from public.transactions t join public.profiles p on p.creator_profile_id=t.creator_profile_id where i.code='DISPUTE_CASE' and t.id::text=i.reference and p.id::text=p_reference)))
 select jsonb_build_object('total',(select count(*) from relevant),'items',coalesce((select jsonb_agg(to_jsonb(r) order by (r.state='open') desc,r.first_seen_at desc,r.id) from (select i.id,i.code,i.title,i.detail,i.state,i.episode,i.first_seen_at,i.reference,
 (select a.followup_at from public.finance_case_actions a where a.incident_id=i.id order by sequence desc limit 1) as followup_at
 from relevant i order by (i.state='open') desc,i.first_seen_at desc,i.id limit p_limit offset p_offset) r),'[]'::jsonb)));
end$$;

create function public.finance_case_act(p_id uuid,p_key uuid,p_expected text,p_action text,p_party text,p_category text,p_evidence text,p_reason text,p_notice text default null,p_followup timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;a public.finance_case_actions;h public.finance_payout_holds;i public.finance_incidents;v_id uuid:=gen_random_uuid();v_result jsonb:='{}';v_cover boolean;v_remaining integer;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or length(trim(coalesce(p_evidence,''))) not between 10 and 1000 or length(trim(coalesce(p_reason,''))) not between 20 and 2000
  or p_party is null or p_party not in ('undetermined','creator','fan','platform','provider') or p_category is null or p_category not in ('unresolved','human_input','service_delivery','platform_processing','provider_processing','other') then raise exception 'Indica responsable, causa, evidencia y motivo de la decisión';end if;
 if (p_category='platform_processing' and p_party<>'platform') or (p_category='provider_processing' and p_party<>'provider') or (p_category='unresolved' and p_party<>'undetermined') or (p_category='human_input' and p_party not in ('creator','fan','platform')) or (p_category='service_delivery' and p_party not in ('creator','platform')) then raise exception 'La causa y el responsable deben coincidir; los errores de nuestro equipo corresponden a Fans Reserve';end if;
 select * into a from public.finance_case_actions where request_key=p_key;
 if a.id is not null then
  if (a.incident_id,a.expected_hash,a.action,a.party,a.category,a.evidence,a.reason,a.notice,a.followup_at) is distinct from (p_id,p_expected,p_action,p_party,p_category,trim(p_evidence),trim(p_reason),nullif(trim(p_notice),''),p_followup) then raise exception 'Referencia de decisión reutilizada';end if;
  return jsonb_build_object('id',a.id,'result',a.result);
 end if;
 if p_followup is not null and (p_followup<=now() or p_followup>now()+interval '30 days') then raise exception 'La próxima revisión debe estar entre ahora y 30 días; no modifica plazos del proveedor';end if;
 if p_action='note' and p_followup is null then raise exception 'Indica cuándo volverás a revisar el expediente pendiente';end if;
 if length(coalesce(p_notice,''))>1000 then raise exception 'La constancia de atención es demasiado larga';end if;
 v:=finance_private.case_basis(p_id);
 if v->>'issue' is not null or p_expected is null or v->>'hash' is distinct from p_expected then raise exception 'El expediente cambió; actualiza y revisa la evidencia nuevamente';end if;
 if p_action is null or not (v->'actions' ? p_action) then raise exception 'Esta acción no está permitida mientras persista el riesgo o falte evidencia';end if;
 select * into i from public.finance_incidents where id=p_id;
 if p_action='coverage' then
  if p_party='undetermined' then raise exception 'No decidas quién asume el importe sin atribución documentada';end if;
  v_cover:=p_party<>'creator';
  perform finance_private.cover_before_cases(i.reference::uuid,v_cover);
  v_result:=jsonb_build_object('platform_covers',v_cover,'assessment_hash',md5(finance_private.dispute_snapshot(i.reference)::text),'contract','creator-agreement/6.2.3','external_charge',false);
 elsif p_action='release_hold' then
  select * into h from public.finance_payout_holds where id::text=i.reference;
  insert into public.finance_hold_releases(hold_id,decision_id) values(h.id,v_id);
  select count(*) into v_remaining from public.finance_payout_holds z where z.user_id=h.user_id and not exists(select 1 from public.finance_hold_releases r where r.hold_id=z.id);
  if v_remaining=0 then update public.account_restrictions set payouts_frozen=false where user_id=h.user_id;end if;
  v_result:=jsonb_build_object('hold',h.id,'remaining_holds',v_remaining,'unfrozen',v_remaining=0);
 elsif p_action='ack_alert' then
  if length(trim(coalesce(p_notice,'')))<10 then raise exception 'Registra la constancia de atención humana por dashboard, correo confirmado o soporte';end if;
  update public.finance_alert_queue set state='cancelled' where id::text=i.reference and state='review';
  if not found then raise exception 'El aviso cambió; no reinicies sus intentos';end if;
  v_result:=jsonb_build_object('human_attention',true,'email_delivered',false,'underlying_incident_closed',false);
 end if;
 insert into public.finance_case_actions(id,request_key,incident_id,episode,action,party,category,evidence,reason,notice,followup_at,expected_hash,before_snapshot,result,created_by)
 values(v_id,p_key,p_id,i.episode,p_action,p_party,p_category,trim(p_evidence),trim(p_reason),nullif(trim(p_notice),''),p_followup,p_expected,v,v_result,auth.uid());
 if p_action in ('release_hold','ack_alert','close_review') then
  update public.finance_incidents set state='resolved',resolved_at=now() where id=p_id;
  update public.finance_alert_queue set state='cancelled' where incident_id=p_id and (state='pending' or (state='sending' and lease_until<=now()));
 end if;
 return jsonb_build_object('id',v_id,'result',v_result);
end$$;

-- The original review keeps its checks; new sources are observed before its auto-resolution step.
create or replace function public.finance_job_review(p_run uuid) returns integer language plpgsql security definer set search_path='' as $$
declare j public.finance_job_runs;r jsonb;t record;v_count integer;
begin
 perform finance_private.lock_book();j:=finance_private.assert_job(p_run);
 for r in select * from jsonb_array_elements(finance_private.candidates()) loop
  if (r->>'available')::numeric<0 or ((r->>'available')::numeric>0 and r->>'reason' is not null and r->>'reason' not in ('BELOW_MINIMUM','BATCH_RESERVED','PAYOUT_IN_PROGRESS')) then
   perform finance_private.incident(p_run,coalesce(r->>'reason','NEGATIVE_BALANCE'),r->>'user_id','Un creador necesita revisión',coalesce(r->>'name','Creador')||': '||finance_private.reason_label(coalesce(r->>'reason','NEGATIVE_BALANCE'))||'.');end if;
 end loop;
 for t in select * from public.finance_batch_items where state='review' loop perform finance_private.incident(p_run,'BATCH_REVIEW',t.id::text,'Una ganancia cambió después del cierre',t.creator_name||': revisa las ganancias asignadas antes de preparar su envío.');end loop;
 if extract(day from now() at time zone 'America/Tegucigalpa')=1 and exists(select 1 from public.finance_batch_items i join public.finance_batches b on b.id=i.batch_id where b.state='frozen' and i.state='reserved' and b.cutoff=public.payout_credit_cutoff(now()) and not exists(select 1 from public.payouts p where p.finance_batch_item_id=i.id)) then
  perform finance_private.incident(p_run,'BATCH_BACKLOG',public.payout_credit_cutoff(now())::text,'Quedan pagos en el último día de la ventana','Todavía hay envíos por preparar. Revisa las incidencias y la capacidad del ejecutor antes de que termine el día 1, hora de Honduras.');end if;
 for t in select p.id,p.creator_name,s.state from public.payouts p left join public.paypal_payout_submissions s on s.payout_id=p.id where p.status='sending' and (s.state='manual_review' or (p.requested_at<now()-interval '30 minutes' and coalesce(s.state,'')<>'prepared')) loop
  perform finance_private.incident(p_run,'PAYOUT_PENDING',t.id::text,'Un retiro sigue sin confirmación',t.creator_name||': el dinero permanece separado mientras se confirma el envío con PayPal.');end loop;
 for t in select * from public.paypal_payout_events where state='review' or (state='pending' and received_at<now()-interval '5 minutes') loop perform finance_private.incident(p_run,'PROVIDER_EVENT',t.id::text,'Un aviso de PayPal requiere conciliación','Un aviso está pendiente o contiene una referencia que requiere revisión. Se conserva su contenido original.');end loop;
 for r in select * from jsonb_array_elements(finance_private.statement_results()) where value->>'state'='review' loop perform finance_private.incident(p_run,'STATEMENT_REVIEW',r->>'id','Un reporte no coincide con las cuentas','Revisa la fila '||(r->>'external_id')||'. '||finance_private.reason_label(r->>'reason')||'. Los saldos de creadores no se modifican automáticamente por esta diferencia.');end loop;
 if j.execute_requested and finance_private.execution_block(j.environment) is not null then perform finance_private.incident(p_run,'EXECUTION_BLOCKED',j.environment,'El envío automático está detenido',finance_private.reason_label(finance_private.execution_block(j.environment))||'. La revisión permanece disponible.');end if;
 for t in select * from public.transactions x where x.status in ('disputed','refunded') and x.kind<>'referral'
  and (x.status='disputed' or not exists(select 1 from public.finance_case_actions a join public.finance_incidents i on i.id=a.incident_id where i.code='DISPUTE_CASE' and i.reference=x.id::text and a.action='coverage' and a.result->>'assessment_hash'=md5(finance_private.dispute_snapshot(x.id::text)::text))) loop
  perform finance_private.incident(p_run,'DISPUTE_CASE',t.id::text,'Revisar venta · '||coalesce((select name from public.profiles where creator_profile_id=t.creator_profile_id and role='creator' order by id limit 1),'Creador'),'Clasifica la causa con evidencia. El estado de PayPal, la atribución y la cobertura contable son decisiones distintas.');end loop;
 for t in select h.* from public.finance_payout_holds h where not exists(select 1 from public.finance_hold_releases z where z.hold_id=h.id)
  and (exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=h.user_id and p.role='creator' and not public.is_suspended(p.id) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
   or exists(select 1 from public.payouts p left join lateral(select r.outcome from public.paypal_payout_reconciliations r where r.payout_id=p.id order by sequence desc limit 1) latest on true where p.user_id=h.user_id and (p.status='sending' or latest.outcome in ('pending','retry','review')))) loop
  perform finance_private.incident(p_run,'PAYOUT_HOLD',t.id::text,'Revisar bloqueo · '||coalesce((select name from public.profiles where id=t.user_id),'Cuenta'),t.reason);end loop;
 for t in select * from public.finance_alert_queue where state='review' loop
  perform finance_private.incident(p_run,'ALERT_DELIVERY',t.id::text,'Un aviso necesita atención humana','El correo agotó sus intentos o su plazo seguro. Atiende el incidente desde el dashboard o un canal alterno y documenta la constancia; no reinicies el envío.');end loop;
 for t in select a.* from public.finance_case_actions a join public.finance_incidents i on i.id=a.incident_id where i.state='open' and i.code not in ('CASE_OVERDUE','ALERT_DELIVERY') and a.action='note' and a.followup_at<=now() and not exists(select 1 from public.finance_case_actions z where z.incident_id=a.incident_id and z.sequence>a.sequence) loop
  perform finance_private.incident(p_run,'CASE_OVERDUE',t.id::text,'Una revisión pendiente venció','Revisa el expediente original y documenta su seguimiento. El plazo interno no prorroga los plazos de PayPal.');end loop;
 if exists(select 1 from public.finance_batch_items i join public.finance_batches b on b.id=i.batch_id where b.state='frozen' and i.state='reserved' and not exists(select 1 from public.payouts p where p.finance_batch_item_id=i.id)) and not exists(select 1 from public.finance_funding_checks f where f.environment=j.environment and f.observed_at>now()-interval '24 hours' and f.available>0) then
  perform finance_private.incident(p_run,'FUNDING_REVIEW',j.environment,'Actualizar evidencia de fondos','La evidencia del saldo falta o venció. Comprueba el saldo actual y registra una evidencia nueva; no cambies la fecha de la anterior.');end if;
 update public.finance_incidents set state='resolved',resolved_at=now() where state='open' and last_seen_run is distinct from p_run and code not in ('JOB_FAILURE','PREPARATION_FAILED');
 update public.finance_alert_queue a set state='cancelled' from public.finance_incidents i where a.incident_id=i.id and (i.state='resolved' or a.episode<>i.episode) and (a.state='pending' or (a.state='sending' and a.lease_until<=now()));
 select count(*) into v_count from public.finance_incidents where state='open';return v_count;
end$$;
create or replace function public.finance_alert_claim(p_recipient text,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.finance_alert_queue;v jsonb:='[]';v_token uuid;
begin
 perform finance_private.lock_book();
 if p_recipient is null or p_recipient !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p_recipient)>254 or p_limit not between 1 and 10 then raise exception 'Destinatario o límite no válido';end if;
 for a in select q.* from public.finance_alert_queue q join public.finance_incidents i on i.id=q.incident_id where i.state='open' and q.episode=i.episode and q.state in ('pending','sending') and coalesce(q.lease_until,'-infinity')<=now() and coalesce(q.next_attempt_at,'-infinity')<=now() order by q.created_at limit p_limit for update of q skip locked loop
  if a.attempts>=5 or a.first_attempt_at<=now()-interval '23 hours' then
   update public.finance_alert_queue set state='review',lease_token=null,lease_until=null where id=a.id;
   perform finance_private.incident(null,'ALERT_DELIVERY',a.id::text,'Un aviso necesita atención humana','El correo agotó sus intentos o su plazo seguro. Documenta la atención por otro canal sin reiniciar el envío.');continue;end if;
  v_token:=gen_random_uuid();update public.finance_alert_queue set state='sending',recipient=coalesce(recipient,p_recipient),lease_token=v_token,lease_until=now()+interval '2 minutes',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()) where id=a.id;
  v:=v||jsonb_build_array(jsonb_build_object('id',a.id,'token',v_token,'to',coalesce(a.recipient,p_recipient),'subject',a.subject,'body',a.body,'key','finance-'||a.id));
 end loop;return v;
end$$;
create or replace function public.finance_alert_finish(p_id uuid,p_token uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.finance_alert_queue;
begin
 perform finance_private.lock_book();
 update public.finance_alert_queue set state=case when p_error is null then 'sent' when attempts>=5 or first_attempt_at<=now()-interval '23 hours' then 'review' else 'pending' end,
 sent_at=case when p_error is null then now() else null end,last_error=left(p_error,500),lease_token=null,lease_until=null,next_attempt_at=case when p_error is null then null else now()+interval '5 minutes' end
 where id=p_id and lease_token=p_token and state='sending' returning * into a;
 if a.id is null then return false;end if;
 if a.state='review' then perform finance_private.incident(null,'ALERT_DELIVERY',a.id::text,'Un aviso necesita atención humana','El correo agotó sus intentos o su plazo seguro. Documenta la atención por otro canal sin reiniciar el envío.');end if;
 return true;
end$$;

revoke all on all functions in schema finance_private from public,anon,authenticated,service_role;
revoke all on function public.finance_case_list(integer,integer,text),public.finance_case_preview(uuid),public.finance_case_act(uuid,uuid,text,text,text,text,text,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.finance_case_list(integer,integer,text),public.finance_case_preview(uuid),public.finance_case_act(uuid,uuid,text,text,text,text,text,text,text,timestamptz) to authenticated;
select pg_notify('pgrst','reload schema');
