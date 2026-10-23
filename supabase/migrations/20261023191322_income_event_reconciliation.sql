-- Durable incoming payments, lifecycle events, disputes and reversals.
-- No schedule, money gate, production history or provider setting is enabled.
create table finance_private.income_events(
 id uuid primary key default gen_random_uuid(),environment text not null check(environment in ('sandbox','live')),sender text not null,
 event_id text not null,body jsonb not null,received_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','processing','applied','review')),
 attempts integer not null default 0,lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz,
 reason text,result jsonb,checked_at timestamptz,unique(environment,sender,event_id)
);
create table finance_private.income_attempts(
 sequence bigint generated always as identity primary key,event_id uuid not null references finance_private.income_events,
 token uuid not null unique,started_at timestamptz not null default now()
);
create table finance_private.income_proofs(
 attempt bigint primary key references finance_private.income_attempts(sequence),proof jsonb not null,outcome text not null,
 recorded_at timestamptz not null default now()
);
create table finance_private.income_resources(
 environment text not null,sender text not null,kind text not null,reference text not null,
 sequence bigint not null,provider_at timestamptz,basis jsonb not null,primary key(environment,sender,kind,reference)
);
create table finance_private.income_disputes(
 environment text not null,sender text not null,dispute_id text not null,payment_ref text not null,
 status text not null,outcome text,refunded numeric(12,2),proof jsonb not null,
 primary key(environment,sender,dispute_id,payment_ref)
);
create table finance_private.income_actions(
 id uuid primary key default gen_random_uuid(),environment text not null,sender text not null,event_id uuid not null references finance_private.income_events,
 kind text not null check(kind in ('cancel_subscription','refund_sale','refund_capture')),reference text not null,
 amount numeric(12,2),state text not null default 'prepared' check(state in ('prepared','attempted','confirmed','review')),
 attempted_at timestamptz,proof jsonb,unique(environment,sender,kind,reference)
);
create index income_events_pending on finance_private.income_events(next_attempt_at,received_at) where state in ('pending','processing','review');
create index income_disputes_payment on finance_private.income_disputes(payment_ref);
alter table finance_private.refund_events add column recovery_until timestamptz,add column recovery_checked_at timestamptz,
 add column recovery_attempts integer not null default 0,add column followup_complete boolean not null default false;
create table finance_private.refund_followups(event_id uuid primary key references finance_private.refund_events,proof jsonb not null,confirmed_at timestamptz not null default now());
alter table finance_private.refund_followups enable row level security;
revoke all on finance_private.refund_followups from public,anon,authenticated,service_role;
create trigger refund_followup_immutable before update or delete on finance_private.refund_followups for each row execute function finance_private.immutable();
do $$declare t text;begin
 foreach t in array array['income_events','income_attempts','income_proofs','income_resources','income_disputes','income_actions'] loop
  execute format('alter table finance_private.%I enable row level security',t);
  execute format('revoke all on finance_private.%I from public,anon,authenticated,service_role',t);
 end loop;
end$$;
revoke all on sequence finance_private.income_attempts_sequence_seq from public,anon,authenticated,service_role;
create trigger income_attempt_immutable before update or delete on finance_private.income_attempts for each row execute function finance_private.immutable();
create trigger income_proof_immutable before update or delete on finance_private.income_proofs for each row execute function finance_private.immutable();
-- The initial query proof and any final classification may share an attempt.
-- Preserve the first exact response rather than rewriting it on classification.
create function finance_private.income_proof_once() returns trigger language plpgsql set search_path='' as $$
begin if exists(select 1 from finance_private.income_proofs where attempt=new.attempt) then return null;end if;return new;end$$;
create trigger income_proof_once before insert on finance_private.income_proofs for each row execute function finance_private.income_proof_once();
create trigger income_event_guard before update or delete on finance_private.income_events for each row execute function finance_private.refund_event_guard();

-- Retire the old arbitrary state writer. Only verified reconciliation may call its private body.
do $$declare d text;begin
 d:=pg_get_functiondef('public.paypal_money_back(text,text)'::regprocedure);
 execute replace(d,'FUNCTION public.paypal_money_back(','FUNCTION finance_private.income_money_back(');
 d:=pg_get_functiondef('public.paypal_refund_apply(uuid,text,jsonb,jsonb)'::regprocedure);
 execute replace(d,'public.paypal_money_back(','finance_private.income_money_back(');
end$$;
create or replace function public.paypal_money_back(p_ref text,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
begin raise exception 'Conciliar primero el aviso guardado y su consulta actual a PayPal';end$$;
revoke all on function public.paypal_money_back(text,text) from public,anon,authenticated,service_role;

do $$declare d text;begin
 d:=pg_get_functiondef('public.paypal_refund_receive(text,text,jsonb)'::regprocedure);
 execute replace(d,'FUNCTION public.paypal_refund_receive(','FUNCTION finance_private.refund_receive_before_income(');
end$$;
create or replace function public.paypal_refund_receive(p_environment text,p_sender text,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved jsonb;e finance_private.refund_events;ref text;who record;
begin
 saved:=finance_private.refund_receive_before_income(p_environment,p_sender,p_event);
 select * into e from finance_private.refund_events where id=(saved->>'id')::uuid;
 if e.state in ('pending','review') then
  ref:=e.body#>>'{resource,sale_id}';
  if ref is null then select substring(link->>'href' from '/v2/payments/captures/([A-Za-z0-9-]+)$') into ref
   from jsonb_array_elements(coalesce(e.body#>'{resource,links}','[]')) link where link->>'rel'='up' limit 1;end if;
  if ref is not null then
   update finance_private.refund_events set result=coalesce(result,'{}')||jsonb_build_object('payment_ref',ref) where id=e.id;
   for who in select distinct p.id from public.profiles p join public.transactions sale on sale.creator_profile_id=p.creator_profile_id
    where p.role='creator' and (sale.paypal_ref=ref or (sale.key like 'paypal-sub:%' and split_part(sale.key,':',3)=ref)
     or (sale.kind='gift' and exists(select 1 from public.coin_purchases coin where coin.paypal_ref=ref and coin.user_id=sale.payer_id))) loop
    perform finance_private.place_hold(who.id,'safety','incoming-refund/'||e.id||'/'||who.id,'Conciliar la devolución guardada antes de liberar el siguiente pago');
   end loop;
  end if;
 end if;
 return saved;
end$$;

create function finance_private.income_hold(p_id uuid,p_ref text,p_reason text) returns void language plpgsql set search_path='' as $$
declare who record;
begin
 for who in select distinct p.id from public.profiles p join public.transactions sale on sale.creator_profile_id=p.creator_profile_id
  where p.role='creator' and (sale.paypal_ref=p_ref or (sale.key like 'paypal-sub:%' and split_part(sale.key,':',3)=p_ref)
   or (sale.kind='gift' and exists(select 1 from public.coin_purchases c where c.paypal_ref=p_ref and c.user_id=sale.payer_id))) loop
  perform finance_private.place_hold(who.id,'safety','income/'||p_id||'/'||who.id,p_reason);
 end loop;
end$$;
create function finance_private.income_review(p_id uuid,p_reason text) returns jsonb language plpgsql set search_path='' as $$
begin
 update finance_private.income_events set state='review',reason=p_reason,lease_token=null,lease_until=null where id=p_id;
 perform finance_private.incident(null,'INCOME_EVENT',p_id::text,'Un aviso de cobro necesita revisión',p_reason);
 return jsonb_build_object('state','review','reason',p_reason);
end$$;
create function public.paypal_income_receive(p_environment text,p_sender text,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e finance_private.income_events;r jsonb;ref text;
begin
 perform finance_private.lock_book();
 if p_environment is null or p_environment not in ('sandbox','live') or length(coalesce(p_sender,'')) not between 1 and 255
  or length(coalesce(p_event->>'id','')) not between 1 and 255 or coalesce(p_event->>'event_type','') not in
  ('PAYMENT.CAPTURE.COMPLETED','PAYMENT.SALE.COMPLETED','PAYMENT.CAPTURE.REVERSED','PAYMENT.SALE.REVERSED',
   'CUSTOMER.DISPUTE.CREATED','CUSTOMER.DISPUTE.UPDATED','CUSTOMER.DISPUTE.RESOLVED',
   'BILLING.SUBSCRIPTION.ACTIVATED','BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.EXPIRED','BILLING.SUBSCRIPTION.SUSPENDED') then raise exception 'Aviso de cobro no válido';end if;
 insert into finance_private.income_events(environment,sender,event_id,body) values(p_environment,p_sender,p_event->>'id',p_event) on conflict do nothing;
 select * into e from finance_private.income_events where environment=p_environment and sender=p_sender and event_id=p_event->>'id';
 if e.body is distinct from p_event then
  perform finance_private.income_review(e.id,'EVENT_ID_CONFLICT');
  for r in select value from jsonb_array_elements(coalesce(e.body#>'{resource,disputed_transactions}','[]')) loop
   perform finance_private.income_hold(e.id,r->>'seller_transaction_id','El ID de un aviso cambió de contenido');end loop;
  perform finance_private.income_hold(e.id,e.body#>>'{resource,id}','El ID de un aviso cambió de contenido');
 end if;
 -- Signed risk notices block only identifiable exposed creators while the provider is unavailable.
 if e.state<>'applied' and (p_event->>'event_type' like 'CUSTOMER.DISPUTE.%' or p_event->>'event_type' like '%.REVERSED') then
  for r in select value from jsonb_array_elements(coalesce(e.body#>'{resource,disputed_transactions}','[]')) loop
   perform finance_private.income_hold(e.id,r->>'seller_transaction_id','Conciliar el aviso de disputa y su resultado actual');end loop;
  perform finance_private.income_hold(e.id,coalesce(e.body#>>'{resource,sale_id}',e.body#>>'{resource,id}'),'Conciliar el aviso de reversión antes de liberar fondos');
 end if;
 select * into e from finance_private.income_events where id=e.id;
 return jsonb_build_object('id',e.id,'state',e.state);
end$$;
create function public.paypal_income_claim(p_id uuid,p_environment text,p_sender text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e finance_private.income_events;v uuid:=gen_random_uuid();seq bigint;
begin
 perform finance_private.lock_book();select * into e from finance_private.income_events where id=p_id;
 if e.id is null or (e.environment,e.sender) is distinct from (p_environment,p_sender) then raise exception 'Aviso no disponible en esta conexión';end if;
 if e.state='applied' then return jsonb_build_object('operation','done','result',e.result);end if;
 if e.state='review' then return jsonb_build_object('operation','review','reason',e.reason);end if;
 if e.result ? 'actions' then update finance_private.income_events set checked_at=now() where id=e.id;return jsonb_build_object('operation','effects','actions',e.result->'actions');end if;
 if e.lease_until>now() or e.next_attempt_at>now() then return jsonb_build_object('operation','wait');end if;
 if e.attempts>=12 then return finance_private.income_review(e.id,'RETRY_LIMIT')||jsonb_build_object('operation','review');end if;
 insert into finance_private.income_attempts(event_id,token) values(e.id,v) returning sequence into seq;
 update finance_private.income_events set state='processing',attempts=attempts+1,checked_at=now(),lease_token=v,lease_until=now()+interval '2 minutes',next_attempt_at=null where id=e.id;
 return jsonb_build_object('operation','work','id',e.id,'token',v,'sequence',seq,'body',e.body);
end$$;
create function public.paypal_income_retry(p_id uuid,p_token uuid,p_proof jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e finance_private.income_events;a finance_private.income_attempts;
begin
 perform finance_private.lock_book();select * into e from finance_private.income_events where id=p_id;
 if e.state<>'processing' or e.lease_token is distinct from p_token then return jsonb_build_object('state','stale');end if;
 select * into a from finance_private.income_attempts where token=p_token;
 insert into finance_private.income_proofs(attempt,proof,outcome) values(a.sequence,coalesce(p_proof,'{}'),'retry') on conflict do nothing;
 update finance_private.income_events set state='pending',reason=left(p_reason,300),lease_token=null,lease_until=null,next_attempt_at=now()+interval '30 seconds' where id=e.id;
 return jsonb_build_object('state','pending');
end$$;
create function public.paypal_income_context(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e finance_private.income_events;order_id text;ref text;
begin
 select * into e from finance_private.income_events where id=p_id;
 if e.id is null then raise exception 'Aviso no encontrado';end if;
 order_id:=e.body#>>'{resource,supplementary_data,related_ids,order_id}';ref:=e.body#>>'{resource,id}';
 return jsonb_build_object('order',(select id from public.paypal_orders where id=order_id or capture_id=ref limit 1),
 'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'capture_id',o.capture_id)) from public.paypal_orders o where o.capture_id in
 (select x->>'seller_transaction_id' from jsonb_array_elements(coalesce(e.body#>'{resource,disputed_transactions}','[]')) x)),'[]'));
end$$;

-- Dispute outcomes never invent a refund ID or a second debit. Buyer-favour
-- resolutions wait for the individual refund receipts, including provider-query backfills.
create function finance_private.refresh_income_dispute(p_ref text) returns boolean language plpgsql set search_path='' as $$
declare required numeric;open_case boolean;t public.transactions;c public.coin_purchases;
begin
 select coalesce(sum(refunded) filter(where outcome='RESOLVED_BUYER_FAVOUR'),0),
  coalesce(bool_or(status<>'RESOLVED' or coalesce(outcome,'') not in ('RESOLVED_SELLER_FAVOUR','RESOLVED_BUYER_FAVOUR') or (outcome='RESOLVED_BUYER_FAVOUR' and refunded is null)),false)
 into required,open_case from finance_private.income_disputes where payment_ref=p_ref;
 select * into t from public.transactions sale where sale.kind<>'referral' and (sale.paypal_ref=p_ref or (sale.key like 'paypal-sub:%' and split_part(sale.key,':',3)=p_ref)) limit 1;
 if t.id is null then
  select * into c from public.coin_purchases where paypal_ref=p_ref limit 1;
  if c.id is null then return false;end if;
  if not open_case and required=0 then perform finance_private.income_money_back(p_ref,'release');return true;
  elsif not open_case and required=c.price and c.status='refunded' then return true;
  else perform finance_private.income_money_back(p_ref,'dispute');return false;end if;
 end if;
 if not open_case and t.refunded_amount>=required then
  perform finance_private.income_money_back(p_ref,'release');return true;
 end if;
 perform finance_private.income_money_back(p_ref,'dispute');return false;
end$$;
create function finance_private.income_action(p_event uuid,p_kind text,p_ref text,p_amount numeric default null) returns uuid language plpgsql set search_path='' as $$
declare e finance_private.income_events;a finance_private.income_actions;
begin
 select * into e from finance_private.income_events where id=p_event;
 insert into finance_private.income_actions(environment,sender,event_id,kind,reference,amount) values(e.environment,e.sender,e.id,p_kind,p_ref,p_amount) on conflict do nothing;
 select * into a from finance_private.income_actions where (environment,sender,kind,reference)=(e.environment,e.sender,p_kind,p_ref);
 if a.amount is distinct from p_amount then raise exception 'El importe del seguimiento cambió';end if;
 return a.id;
end$$;

create function public.paypal_income_apply(p_id uuid,p_token uuid,p_proof jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e finance_private.income_events;a finance_private.income_attempts;v finance_private.income_resources;sub_version finance_private.income_resources;
 s public.paypal_subscriptions;o public.paypal_orders;t public.transactions;c public.coin_purchases;resource jsonb;sub jsonb;entry jsonb;basis jsonb;v_result jsonb:='{}';
 v_kind text;ref text;typ text;native_at timestamptz;sub_at timestamptz;sub_basis jsonb;amount numeric;refund_amount numeric;outcome text;status text;reply text;waiting boolean:=false;
 actions jsonb:='[]';action_id uuid;reason text;existing_refs text[];provider_refs text[];
begin
 perform finance_private.lock_book();select * into e from finance_private.income_events where id=p_id;
 if e.id is null or e.state<>'processing' or e.lease_token is distinct from p_token or e.lease_until<=now() then raise exception 'La consulta perdió su turno; vuelve a comprobar el aviso';end if;
 select * into a from finance_private.income_attempts where token=p_token;
 insert into finance_private.income_proofs values(a.sequence,p_proof,'queried',now());
 resource:=p_proof->'resource';typ:=e.body->>'event_type';
 v_kind:=case when typ like 'CUSTOMER.DISPUTE.%' then 'dispute' when typ like 'BILLING.SUBSCRIPTION.%' then 'subscription' when typ like 'PAYMENT.SALE.%' then 'sale' else 'capture' end;
 ref:=case when v_kind='dispute' then resource->>'dispute_id' else resource->>'id' end;
 if ref is null or ref is distinct from (case when v_kind='dispute' then e.body#>>'{resource,dispute_id}' else coalesce(e.body#>>'{resource,sale_id}',e.body#>>'{resource,id}') end) then
  insert into finance_private.income_proofs values(a.sequence,p_proof,'review',now());return finance_private.income_review(p_id,'RESOURCE_MISMATCH');end if;
 status:=coalesce(resource->>'status',resource->>'state');outcome:=resource#>>'{dispute_outcome,outcome_code}';
 begin native_at:=coalesce(resource->>'status_update_time',resource->>'update_time',resource->>'create_time')::timestamptz;exception when others then native_at:=null;end;
 if native_at is not null and not isfinite(native_at) then native_at:=null;end if;
 basis:=jsonb_build_object('status',status,'amount',resource->'amount','custom_id',resource->'custom_id','outcome',outcome,'refund',resource#>'{dispute_outcome,amount_refunded}','transactions',resource->'disputed_transactions');
 select * into v from finance_private.income_resources saved where (saved.environment,saved.sender,saved.kind,saved.reference)=(e.environment,e.sender,v_kind,ref);
 if (v.sequence>a.sequence) then return public.paypal_income_retry(p_id,p_token,p_proof,'NEWER_QUERY_ALREADY_APPLIED');end if;
 if native_at is not null and v.provider_at>native_at then
  insert into finance_private.income_proofs values(a.sequence,p_proof,'stale',now());update finance_private.income_events set state='applied',result='{"stale":true}',lease_token=null,lease_until=null where id=e.id;
  return jsonb_build_object('state','applied','stale',true);end if;
 if v_kind in ('subscription','dispute') and native_at is null then
  insert into finance_private.income_proofs values(a.sequence,p_proof,'review',now());return finance_private.income_review(p_id,'PROVIDER_VERSION_REQUIRED');end if;
 if v.provider_at=native_at and v.basis is distinct from basis then
  insert into finance_private.income_proofs values(a.sequence,p_proof,'review',now());return finance_private.income_review(p_id,'PROVIDER_VERSION_CONFLICT');end if;

 if v_kind='subscription' then
  select * into s from public.paypal_subscriptions where id=ref;
  if s.id is null then return public.paypal_income_retry(p_id,p_token,p_proof,'SUBSCRIPTION_NOT_REGISTERED');end if;
  if resource->>'custom_id' is distinct from s.user_id::text||':'||s.creator_id then
   insert into finance_private.income_proofs values(a.sequence,p_proof,'review',now());return finance_private.income_review(p_id,'SUBSCRIPTION_OWNER_MISMATCH');end if;
  if status='ACTIVE' then perform public.paypal_subscription_activate(ref);
  elsif status in ('CANCELLED','EXPIRED','SUSPENDED') then perform public.paypal_subscription_ended(ref,status='SUSPENDED');
  else return public.paypal_income_retry(p_id,p_token,p_proof,'SUBSCRIPTION_NOT_FINAL');end if;
 elsif v_kind='sale' and typ='PAYMENT.SALE.COMPLETED' then
  sub:=p_proof->'subscription';
  if coalesce(resource#>>'{amount,currency}','')<>'USD' or coalesce(resource#>>'{amount,total}','') !~ '^[0-9]+([.][0-9]{1,2})?$' then
   insert into finance_private.income_proofs values(a.sequence,p_proof,'review',now());return finance_private.income_review(p_id,'SALE_AMOUNT_OR_CURRENCY');end if;
  amount:=(resource#>>'{amount,total}')::numeric;
  select * into s from public.paypal_subscriptions where id=e.body#>>'{resource,billing_agreement_id}';
  if s.id is null then return public.paypal_income_retry(p_id,p_token,p_proof,'SUBSCRIPTION_NOT_REGISTERED');end if;
  if (sub->>'id') is distinct from s.id or sub->>'custom_id' is distinct from s.user_id::text||':'||s.creator_id or amount<>s.amount then
   insert into finance_private.income_proofs values(a.sequence,p_proof,'review',now());return finance_private.income_review(p_id,'SALE_SUBSCRIPTION_MISMATCH');end if;
  begin sub_at:=coalesce(sub->>'status_update_time',sub->>'update_time',sub->>'create_time')::timestamptz;exception when others then sub_at:=null;end;
  if sub_at is null or not isfinite(sub_at) then return finance_private.income_review(p_id,'PROVIDER_VERSION_REQUIRED');end if;
  sub_basis:=jsonb_build_object('status',sub->>'status','amount',sub->'amount','custom_id',sub->'custom_id','outcome',sub#>>'{dispute_outcome,outcome_code}','refund',sub#>'{dispute_outcome,amount_refunded}','transactions',sub->'disputed_transactions');
  select * into sub_version from finance_private.income_resources where (environment,sender,kind,reference)=(e.environment,e.sender,'subscription',s.id);
  if sub_version.sequence>a.sequence or sub_version.provider_at>sub_at then return public.paypal_income_retry(p_id,p_token,p_proof,'NEWER_SUBSCRIPTION_QUERY_ALREADY_APPLIED');end if;
  if sub_version.provider_at=sub_at and sub_version.basis is distinct from sub_basis then return finance_private.income_review(p_id,'PROVIDER_VERSION_CONFLICT');end if;
  if (resource->>'billing_agreement_id' is not null and resource->>'billing_agreement_id'<>s.id) or
   (resource->>'billing_agreement_id' is null and not exists(select 1 from jsonb_array_elements(coalesce(p_proof#>'{subscription_transactions,transactions}','[]')) pay
    where pay->>'id'=ref and pay->>'status'='COMPLETED' and pay#>>'{amount_with_breakdown,gross_amount,currency_code}'='USD'
      and pay#>>'{amount_with_breakdown,gross_amount,value}'=resource#>>'{amount,total}')) then
   insert into finance_private.income_proofs values(a.sequence,p_proof,'review',now());return finance_private.income_review(p_id,'SALE_SUBSCRIPTION_MISMATCH');end if;
  if status is distinct from 'completed' then return public.paypal_income_retry(p_id,p_token,p_proof,'SALE_NOT_COMPLETED');end if;
  insert into finance_private.income_resources values(e.environment,e.sender,'subscription',s.id,a.sequence,sub_at,sub_basis)
   on conflict(environment,sender,kind,reference) do update set sequence=excluded.sequence,provider_at=excluded.provider_at,basis=excluded.basis;
  begin
   if sub->>'status'='ACTIVE' then perform public.paypal_subscription_activate(s.id);end if;
   reply:=public.paypal_subscription_payment(s.id,ref,amount);
  exception when others then
   if SQLERRM ~ '(perfil de ejemplo|perfil.*demostraci|creador no está disponible|creador.*suspend|No puedes pagarte a ti mismo|No puedes.*propio|misma persona|guard_self_payment|guard_demo_creator_money)' then reply:='orphan';else raise;end if;
  end;
  if reply='unknown' then return public.paypal_income_retry(p_id,p_token,p_proof,'SUBSCRIPTION_NOT_REGISTERED');end if;
  if reply='orphan' then
   perform public.paypal_subscription_ended(s.id,true);
   actions:=jsonb_build_array(finance_private.income_action(e.id,'cancel_subscription',s.id),finance_private.income_action(e.id,'refund_sale',ref,amount));
  elsif sub->>'status' in ('CANCELLED','EXPIRED','SUSPENDED') then perform public.paypal_subscription_ended(s.id,sub->>'status'='SUSPENDED');end if;
 elsif v_kind='capture' and typ='PAYMENT.CAPTURE.COMPLETED' then
  select * into o from public.paypal_orders where id=p_proof#>>'{order,id}';
  if o.id is null then return public.paypal_income_retry(p_id,p_token,p_proof,'ORDER_NOT_REGISTERED');end if;
  if status is distinct from 'COMPLETED' or resource#>>'{amount,currency_code}' is distinct from 'USD' or
   coalesce(resource#>>'{amount,value}','') !~ '^[0-9]+([.][0-9]{1,2})?$' then return public.paypal_income_retry(p_id,p_token,p_proof,'CAPTURE_NOT_COMPLETED');end if;
  amount:=(resource#>>'{amount,value}')::numeric;
  if amount<>o.amount or not exists(select 1 from jsonb_array_elements(p_proof#>'{order,purchase_units}') unit,
    jsonb_array_elements(unit#>'{payments,captures}') cap where cap->>'id'=ref and cap->>'status'='COMPLETED' and cap#>>'{amount,value}'=resource#>>'{amount,value}' and cap#>>'{amount,currency_code}'='USD') then
   insert into finance_private.income_proofs values(a.sequence,p_proof,'review',now());return finance_private.income_review(p_id,'CAPTURE_ORDER_MISMATCH');end if;
  if o.status='created' then
   begin
    if public.paypal_self_pay(o.user_id,o.kind,o.params,p_proof#>>'{order,payer,email_address}') then raise exception 'No puedes pagarte a ti mismo';end if;
    perform public.paypal_fulfill(o.id,o.user_id,ref,amount);
   exception when others then
    if SQLERRM ~ '(perfil de ejemplo|perfil.*demostraci|creador no está disponible|creador.*suspend|No puedes pagarte a ti mismo|No puedes.*propio|misma persona|guard_self_payment|guard_demo_creator_money)' then
     actions:=jsonb_build_array(finance_private.income_action(e.id,'refund_capture',ref,amount));else raise;end if;
   end;
  elsif o.status<>'completed' then return finance_private.income_review(p_id,'ORDER_ALREADY_CLOSED');end if;
 elsif v_kind='dispute' then
  if jsonb_array_length(coalesce(resource->'disputed_transactions','[]'))=0 then return public.paypal_income_retry(p_id,p_token,p_proof,'DISPUTE_TRANSACTIONS_REQUIRED');end if;
  if status not in ('OPEN','WAITING_FOR_BUYER_RESPONSE','WAITING_FOR_SELLER_RESPONSE','UNDER_REVIEW','RESOLVED') then return finance_private.income_review(p_id,'DISPUTE_STATUS_UNKNOWN');end if;
  select array_agg(payment_ref order by payment_ref) into existing_refs from finance_private.income_disputes where (environment,sender,dispute_id)=(e.environment,e.sender,ref);
  select array_agg(x->>'seller_transaction_id' order by x->>'seller_transaction_id') into provider_refs from jsonb_array_elements(resource->'disputed_transactions') x;
  if existing_refs is not null and existing_refs is distinct from provider_refs then return finance_private.income_review(p_id,'DISPUTE_REFERENCES_CHANGED');end if;
  if exists(select 1 from jsonb_array_elements(resource->'disputed_transactions') disputed where not exists(
   select 1 from public.transactions sale where sale.kind<>'referral' and (sale.paypal_ref=disputed->>'seller_transaction_id' or (sale.key like 'paypal-sub:%' and split_part(sale.key,':',3)=disputed->>'seller_transaction_id')))
   and not exists(select 1 from public.coin_purchases coin where coin.paypal_ref=disputed->>'seller_transaction_id'))
   then return public.paypal_income_retry(p_id,p_token,p_proof,'DISPUTED_PAYMENT_NOT_REGISTERED');end if;
  if status='RESOLVED' and outcome='RESOLVED_BUYER_FAVOUR' then
   if jsonb_array_length(resource->'disputed_transactions')<>1 or resource#>>'{dispute_outcome,amount_refunded,currency_code}' is distinct from 'USD'
    or coalesce(resource#>>'{dispute_outcome,amount_refunded,value}','') !~ '^[0-9]+([.][0-9]{1,2})?$' then return finance_private.income_review(p_id,'DISPUTE_REFUND_ALLOCATION_REQUIRED');end if;
   refund_amount:=(resource#>>'{dispute_outcome,amount_refunded,value}')::numeric;
  end if;
  for entry in select value from jsonb_array_elements(resource->'disputed_transactions') loop
   select * into t from public.transactions sale where sale.kind<>'referral' and (sale.paypal_ref=entry->>'seller_transaction_id' or (sale.key like 'paypal-sub:%' and split_part(sale.key,':',3)=entry->>'seller_transaction_id')) limit 1;
   select * into c from public.coin_purchases where paypal_ref=entry->>'seller_transaction_id' limit 1;
   if entry ? 'gross_amount' and (entry#>>'{gross_amount,currency_code}' is distinct from 'USD' or
    case when coalesce(entry#>>'{gross_amount,value}','') ~ '^[0-9]+([.][0-9]{1,2})?$' then (entry#>>'{gross_amount,value}')::numeric<>coalesce(t.amount,c.price) else true end)
    then return finance_private.income_review(p_id,'DISPUTE_PAYMENT_AMOUNT_MISMATCH');end if;
   if refund_amount is not null and (refund_amount<=0 or refund_amount>coalesce(t.amount,c.price)) then return finance_private.income_review(p_id,'DISPUTE_REFUND_OUT_OF_BOUNDS');end if;
   insert into finance_private.income_disputes values(e.environment,e.sender,ref,entry->>'seller_transaction_id',status,outcome,refund_amount,resource)
    on conflict(environment,sender,dispute_id,payment_ref) do update set status=excluded.status,outcome=excluded.outcome,refunded=excluded.refunded,proof=excluded.proof;
   perform finance_private.income_hold(e.id,entry->>'seller_transaction_id','Revisar la causa y cobertura de la disputa conciliada');
   if not finance_private.refresh_income_dispute(entry->>'seller_transaction_id') and status='RESOLVED' then waiting:=true;end if;
  end loop;
 elsif typ in ('PAYMENT.SALE.REVERSED','PAYMENT.CAPTURE.REVERSED') then
  if status not in ('refunded','reversed','REFUNDED','REVERSED') then return public.paypal_income_retry(p_id,p_token,p_proof,'REVERSAL_NOT_CONFIRMED');end if;
  if coalesce(resource#>>'{amount,currency}',resource#>>'{amount,currency_code}') is distinct from 'USD' then return finance_private.income_review(p_id,'REVERSAL_CURRENCY');end if;
  if not exists(select 1 from public.transactions sale where sale.paypal_ref=ref or (sale.key like 'paypal-sub:%' and split_part(sale.key,':',3)=ref))
   and not exists(select 1 from public.coin_purchases where paypal_ref=ref) then return public.paypal_income_retry(p_id,p_token,p_proof,'REVERSED_PAYMENT_NOT_REGISTERED');end if;
  if coalesce(resource#>>'{amount,value}',resource#>>'{amount,total}','') !~ '^[0-9]+([.][0-9]{1,2})?$' or
   not exists(select 1 from(select sale.amount as gross from public.transactions sale where sale.kind<>'referral' and (sale.paypal_ref=ref or (sale.key like 'paypal-sub:%' and split_part(sale.key,':',3)=ref))
    union all select wallet_purchase.price from public.coin_purchases wallet_purchase where wallet_purchase.paypal_ref=ref) original where original.gross=coalesce(resource#>>'{amount,value}',resource#>>'{amount,total}')::numeric)
   then return finance_private.income_review(p_id,'REVERSAL_AMOUNT_MISMATCH');end if;
  v_result:=finance_private.income_money_back(ref,'refund');
  if v_result->>'subscription' is not null then actions:=jsonb_build_array(finance_private.income_action(e.id,'cancel_subscription',v_result->>'subscription'));end if;
 else return finance_private.income_review(p_id,'UNSUPPORTED_EVENT');end if;

 insert into finance_private.income_resources values(e.environment,e.sender,v_kind,ref,a.sequence,native_at,basis)
 on conflict(environment,sender,kind,reference) do update set sequence=excluded.sequence,provider_at=excluded.provider_at,basis=excluded.basis;
 insert into finance_private.income_proofs values(a.sequence,p_proof,case when waiting then 'waiting_refund' else 'applied' end,now());
 v_result:=v_result||jsonb_build_object('state',case when waiting or jsonb_array_length(actions)>0 then 'pending' else 'applied' end,'waiting_refund',waiting);
 if jsonb_array_length(actions)>0 then v_result:=v_result||jsonb_build_object('actions',actions);end if;
 update finance_private.income_events set state=v_result->>'state',result=v_result,reason=case when waiting then 'INDIVIDUAL_REFUND_RECEIPTS_REQUIRED' end,
  lease_token=null,lease_until=null,next_attempt_at=case when waiting then now()+interval '30 seconds' end where id=e.id;
 return v_result;
end$$;

create table finance_private.income_action_checks(
 id bigint generated always as identity primary key,action_id uuid not null references finance_private.income_actions,
 proof jsonb not null,confirmed boolean not null,created_at timestamptz not null default now()
);
alter table finance_private.income_action_checks enable row level security;
revoke all on finance_private.income_action_checks from public,anon,authenticated,service_role;
revoke all on sequence finance_private.income_action_checks_id_seq from public,anon,authenticated,service_role;
create trigger income_action_check_immutable before update or delete on finance_private.income_action_checks for each row execute function finance_private.immutable();
create function public.paypal_income_action_claim(p_id uuid,p_environment text,p_sender text,p_allow_send boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a finance_private.income_actions;op text;
begin
 perform finance_private.lock_book();select * into a from finance_private.income_actions where id=p_id;
 if a.id is null or (a.environment,a.sender) is distinct from (p_environment,p_sender) then raise exception 'Seguimiento no disponible';end if;
 op:=case when a.state='confirmed' then 'done' when a.state='prepared' and p_allow_send then 'send' else 'check' end;
 if op='send' then update finance_private.income_actions set state='attempted',attempted_at=now() where id=a.id;end if;
 return jsonb_build_object('id',a.id,'operation',op,'kind',a.kind,'reference',a.reference,'amount',a.amount,'key',case when a.kind='cancel_subscription' then 'cancel-' else 'refund-' end||a.reference);
end$$;
create function public.paypal_income_action_confirm(p_id uuid,p_proof jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a finance_private.income_actions;native jsonb:=p_proof->'resource';ok boolean:=false;v_amount text;
begin
 perform finance_private.lock_book();select * into a from finance_private.income_actions where id=p_id;
 if a.id is null then raise exception 'Seguimiento no encontrado';end if;
 if a.state='confirmed' then return jsonb_build_object('confirmed',true);end if;
 if native->>'id'=a.reference then
  if a.kind='cancel_subscription' then ok:=coalesce(native->>'status','') in ('CANCELLED','EXPIRED');
  else
   v_amount:=coalesce(native#>>'{amount,total}',native#>>'{amount,value}');
   ok:=coalesce(native->>'status',native->>'state','') in ('REFUNDED','refunded') and
    coalesce(native#>>'{amount,currency_code}',native#>>'{amount,currency}')='USD' and
    case when coalesce(v_amount,'') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount::numeric=a.amount else false end;
  end if;
 end if;
 insert into finance_private.income_action_checks(action_id,proof,confirmed) values(a.id,p_proof,ok);
 update finance_private.income_actions set state=case when ok then 'confirmed' when attempted_at is not null then 'review' else state end,proof=p_proof where id=a.id;
 if not ok and a.attempted_at is not null then perform finance_private.incident(null,'INCOME_ACTION',a.id::text,'Un seguimiento de cobro sigue sin confirmación','Conserva su referencia. Consulta el resultado; no repitas una devolución cuyo resultado sea incierto.');end if;
 return jsonb_build_object('confirmed',ok);
end$$;
create function public.paypal_income_complete(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e finance_private.income_events;done boolean;
begin
 perform finance_private.lock_book();select * into e from finance_private.income_events where id=p_id;
 if e.state='review' then return jsonb_build_object('state','review');end if;
 select not exists(select 1 from jsonb_array_elements_text(e.result->'actions') ids join finance_private.income_actions act on act.id=ids::uuid where act.state<>'confirmed') into done;
 if e.result ? 'actions' and done then update finance_private.income_events set state='applied',reason=null,result=result||'{"state":"applied"}' where id=e.id;end if;
 return jsonb_build_object('state',case when e.result ? 'actions' and done then 'applied' else e.state end);
end$$;
create function public.paypal_income_pending(p_environment text,p_sender text,p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_limit not between 1 and 5 then raise exception 'Límite de recuperación no válido';end if;
 return coalesce((select jsonb_agg(id) from(select id from finance_private.income_events where environment=p_environment and sender=p_sender
  and state in ('pending','processing') and coalesce(lease_until,'-infinity')<=now() and coalesce(next_attempt_at,'-infinity')<=now() order by coalesce(checked_at,'-infinity'),received_at,id limit p_limit) pending),'[]');
end$$;
create function public.paypal_income_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform finance_private.assert_admin();
 return jsonb_build_object('pending',(select count(*) from finance_private.income_events where state in ('pending','processing'))+(select count(*) from finance_private.refund_events where state='pending' or (state='applied' and result->>'subscription' is not null and not followup_complete)),
 'review',(select count(*) from finance_private.income_events where state='review')+(select count(*) from finance_private.refund_events where state='review'),
 'items',coalesce((select jsonb_agg(row_to_json(x)) from(select * from(
  select id,body->>'event_type' as type,state,attempts,received_at,reason from finance_private.income_events where state<>'applied'
  union all select id,body->>'event_type',case when state='applied' then 'pending' else state end,recovery_attempts,received_at,reason from finance_private.refund_events where state<>'applied' or (result->>'subscription' is not null and not followup_complete)
 ) combined order by received_at,id limit 30)x),'[]'));
end$$;
create function public.paypal_refund_pending(p_environment text,p_sender text,p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e finance_private.refund_events;outbox jsonb:='[]';
begin
 if p_limit not between 1 and 5 then raise exception 'Límite de recuperación no válido';end if;
 for e in select * from finance_private.refund_events where environment=p_environment and sender=p_sender and coalesce(recovery_until,'-infinity')<=now()
  and (state='pending' or (state='applied' and result->>'subscription' is not null and not followup_complete)) order by coalesce(recovery_checked_at,'-infinity'),received_at,id limit p_limit for update skip locked loop
  if e.recovery_attempts>=12 then perform finance_private.refund_attention(e.id,e.result->>'payment_ref','La devolución agotó sus consultas de recuperación; requiere revisión humana');continue;end if;
  update finance_private.refund_events set recovery_until=now()+interval '2 minutes',recovery_checked_at=now(),recovery_attempts=recovery_attempts+1 where id=e.id;
  outbox:=outbox||jsonb_build_array(jsonb_build_object('id',e.id,'body',e.body));
 end loop;return outbox;
end$$;
create function public.paypal_refund_recovery_finish(p_id uuid) returns void language sql security definer set search_path='' as $$
 update finance_private.refund_events set recovery_until=now()+interval '30 seconds' where id=p_id;
$$;
create function public.paypal_refund_followup(p_id uuid,p_resource jsonb) returns void language plpgsql security definer set search_path='' as $$
declare e finance_private.refund_events;
begin
 perform finance_private.lock_book();select * into e from finance_private.refund_events where id=p_id;
 if e.state is distinct from 'applied' or e.result->>'subscription' is null or p_resource->>'id' is distinct from e.result->>'subscription'
  or coalesce(p_resource->>'status','') not in ('CANCELLED','EXPIRED') then raise exception 'Falta confirmar la cancelación de la suscripción reembolsada';end if;
 insert into finance_private.refund_followups(event_id,proof) values(e.id,p_resource) on conflict do nothing;
 update finance_private.refund_events set followup_complete=true where id=e.id;
end$$;

-- A refund receipt may complete an already resolved partial dispute. The
-- original refund writer still owns all deductions and immutable receipt IDs.
do $$declare d text;begin
 d:=pg_get_functiondef('public.paypal_refund_apply(uuid,text,jsonb,jsonb)'::regprocedure);
 d:=replace(d,' if v_count=0 then',$orphan$ if v_count=0 and exists(select 1 from finance_private.income_actions followup
  where followup.environment=e.environment and followup.sender=e.sender and followup.reference=p_ref and followup.kind in ('refund_sale','refund_capture')
   and followup.state='confirmed' and followup.amount=v_payment_amount and v_amount<=followup.amount) then
  select * into r from finance_private.refund_receipts where environment=e.environment and sender=e.sender and refund_id=v_id;
  if r.refund_id is not null and (r.payment_ref,r.amount,r.fee_returned) is distinct from (p_ref,v_amount,v_fee) then
   return finance_private.refund_attention(p_id,p_ref,'El comprobante de devolución cambió; conservar el original');end if;
  insert into finance_private.refund_receipts(environment,sender,refund_id,payment_ref,amount,fee_returned,proof,event_id)
   values(e.environment,e.sender,v_id,p_ref,v_amount,v_fee,jsonb_build_object('refund',p_refund,'payment',p_payment),p_id) on conflict do nothing;
  v_result:=jsonb_build_object('state','applied','payment_ref',p_ref,'orphan_refund',true,'refunded_amount',v_amount);
  update finance_private.refund_events set state='applied',reason=null,result=v_result where id=p_id;return v_result;
 end if;
 if v_count=0 then$orphan$);
 execute d;
 d:=pg_get_functiondef('public.paypal_refund_apply(uuid,text,jsonb,jsonb)'::regprocedure);
 execute replace(d,' if not v_full then',E' if exists(select 1 from finance_private.income_disputes where payment_ref=p_ref) then perform finance_private.refresh_income_dispute(p_ref);end if;\n if not v_full then');
 d:=pg_get_functiondef('public.finance_job_review(uuid)'::regprocedure);
 d:=replace(d,'from finance_private.refund_events where state=''review'' or (state=''pending'' and received_at<now()-interval ''5 minutes'')',
  'from finance_private.refund_events where state=''review'' or (received_at<now()-interval ''5 minutes'' and (state=''pending'' or (state=''applied'' and result->>''subscription'' is not null and not followup_complete)))');
 execute replace(d,' update public.finance_incidents set state=''resolved'',resolved_at=now() where state=''open'' and last_seen_run is distinct from p_run',
 $observe$ for t in select * from finance_private.income_events where state='review' or (state in ('pending','processing') and received_at<now()-interval '5 minutes') loop
  perform finance_private.incident(p_run,'INCOME_EVENT',t.id::text,'Un aviso de cobro necesita revisión',coalesce(t.reason,'Aviso guardado; consulta su resultado desde el panel.'));
 end loop;
 for t in select * from finance_private.income_actions where state='review' loop
  perform finance_private.incident(p_run,'INCOME_ACTION',t.id::text,'Un seguimiento de cobro sigue sin confirmación','Consulta su resultado conservando la referencia original. No repitas la devolución.');
 end loop;
 update public.finance_incidents set state='resolved',resolved_at=now() where state='open' and last_seen_run is distinct from p_run$observe$);
 d:=pg_get_functiondef('finance_private.hold_blockers(uuid,uuid)'::regprocedure);
 execute replace(d,' return v;',$block$ if exists(select 1 from finance_private.income_events pending where pending.state<>'applied' and exists(
  select 1 from public.finance_payout_holds h where h.user_id=p.id and h.reference='income/'||pending.id||'/'||p.id)) then v:=v||'"INCOMING_EVENT_PENDING"'::jsonb;end if;
 return v;$block$);
end$$;

create function finance_private.income_coin_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='gift' and exists(select 1 from public.coin_purchases coin join finance_private.income_events pending on
  (coin.paypal_ref=coalesce(pending.body#>>'{resource,sale_id}',pending.body#>>'{resource,id}') or
    exists(select 1 from jsonb_array_elements(coalesce(pending.body#>'{resource,disputed_transactions}','[]')) part where part->>'seller_transaction_id'=coin.paypal_ref))
  where coin.user_id=new.payer_id and pending.state<>'applied') then raise exception 'Tu billetera tiene un aviso pendiente de conciliación';end if;
 if new.kind='gift' and exists(select 1 from public.coin_purchases coin join finance_private.refund_events pending on coin.paypal_ref=pending.result->>'payment_ref'
  where coin.user_id=new.payer_id and pending.state in ('pending','review')) then raise exception 'Tu billetera tiene una devolución pendiente de conciliación';end if;
 return new;
end$$;
create trigger income_coin_guard before insert on public.transactions for each row execute function finance_private.income_coin_guard();

revoke all on all functions in schema finance_private from public,anon,authenticated,service_role;
revoke all on function public.paypal_income_receive(text,text,jsonb),public.paypal_income_claim(uuid,text,text),public.paypal_income_retry(uuid,uuid,jsonb,text),
 public.paypal_income_context(uuid),public.paypal_income_apply(uuid,uuid,jsonb),public.paypal_income_action_claim(uuid,text,text,boolean),public.paypal_income_action_confirm(uuid,jsonb),
 public.paypal_income_complete(uuid),public.paypal_income_pending(text,text,integer),public.paypal_income_list() from public,anon,authenticated,service_role;
revoke all on function public.paypal_refund_pending(text,text,integer),public.paypal_refund_recovery_finish(uuid),public.paypal_refund_followup(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.paypal_refund_pending(text,text,integer),public.paypal_refund_recovery_finish(uuid),public.paypal_refund_followup(uuid,jsonb) to service_role;
grant execute on function public.paypal_income_receive(text,text,jsonb),public.paypal_income_claim(uuid,text,text),public.paypal_income_retry(uuid,uuid,jsonb,text),
 public.paypal_income_context(uuid),public.paypal_income_apply(uuid,uuid,jsonb),public.paypal_income_action_claim(uuid,text,text,boolean),public.paypal_income_action_confirm(uuid,jsonb),
 public.paypal_income_complete(uuid),public.paypal_income_pending(text,text,integer) to service_role;
grant execute on function public.paypal_income_list() to authenticated;
