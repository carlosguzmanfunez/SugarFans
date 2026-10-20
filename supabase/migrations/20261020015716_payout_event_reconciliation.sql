-- Apply before the server. Old writers fail closed during the rollout.
-- Payout events only: subscription, capture and dispute inboxes are separate work.
create table public.paypal_payout_events (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('sandbox','live')),
  sender_client_id text not null,
  event_id text not null,
  body jsonb not null,
  payout_id uuid references public.payouts(id) on delete restrict,
  state text not null default 'pending' check (state in ('pending','reconciled','review')),
  reason text,
  received_at timestamptz not null default now(),
  reconciled_at timestamptz,
  unique(environment,sender_client_id,event_id)
);
create index paypal_payout_events_pending on public.paypal_payout_events(payout_id) where state='pending';

-- A query is committed BEFORE HTTP. Its original response and decision are
-- committed together with the payout change. No network calls inside a lock.
create table public.paypal_payout_reconciliations (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  payout_id uuid not null references public.payouts(id) on delete restrict,
  event_id uuid references public.paypal_payout_events(id) on delete restrict,
  batch_id text not null,
  source text not null check (source in ('poll','webhook','cancel')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  response jsonb,
  outcome text not null default 'pending' check (outcome in ('pending','applied','retry','review','stale')),
  previous_status text,
  status_after text,
  reason text
);
create index paypal_payout_reconciliations_latest on public.paypal_payout_reconciliations(payout_id,sequence desc);
alter table public.paypal_payout_events enable row level security;
alter table public.paypal_payout_reconciliations enable row level security;
revoke all on table public.paypal_payout_events,public.paypal_payout_reconciliations from public,anon,authenticated,service_role;
revoke all on sequence public.paypal_payout_reconciliations_sequence_seq from public,anon,authenticated,service_role;

-- The server calls this only AFTER verifying the signature with PayPal.
create function public.paypal_payout_event_receive(p_environment text,p_sender text,p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.paypal_payout_events; v_ref text; v_id uuid; v_batch text;
begin
  if p_environment is null or p_environment not in ('sandbox','live') or nullif(p_sender,'') is null
     or length(p_sender)>512 or jsonb_typeof(p_event) is distinct from 'object'
     or nullif(p_event->>'id','') is null or length(p_event->>'id')>200
     or not (coalesce(p_event->>'event_type','') like 'PAYMENT.PAYOUTS-ITEM.%'
       or coalesce(p_event->>'event_type','') like 'PAYMENT.PAYOUTSBATCH.%') then
    raise exception 'Evento de retiro no válido';
  end if;
  v_ref := coalesce(p_event #>> '{resource,payout_item,sender_item_id}',
    p_event #>> '{resource,batch_header,sender_batch_header,sender_batch_id}',p_event #>> '{resource,sender_batch_id}');
  if v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_id from public.payouts where id=v_ref::uuid;
  end if;
  v_batch := coalesce(p_event #>> '{resource,payout_batch_id}',p_event #>> '{resource,batch_header,payout_batch_id}');
  if v_ref is null and v_batch is not null then
    select id into v_id from public.payouts where paypal_batch_id=v_batch;
  end if;
  insert into public.paypal_payout_events(environment,sender_client_id,event_id,body,payout_id,state,reason)
  values(p_environment,p_sender,p_event->>'id',p_event,v_id,
    case when v_id is null then 'review' else 'pending' end,
    case when v_id is null then 'PAYOUT_NOT_FOUND' end)
  on conflict(environment,sender_client_id,event_id) do nothing;
  select * into e from public.paypal_payout_events
    where environment=p_environment and sender_client_id=p_sender and event_id=p_event->>'id' for update;
  if e.body is distinct from p_event then
    -- Preserve the original signed event. Never replace it with a reused ID.
    update public.paypal_payout_events set state='review',reason='EVENT_ID_REUSED' where id=e.id;
    e.state := 'review';
  end if;
  return jsonb_build_object('id',e.id,'payout',e.payout_id,'state',e.state);
end;
$$;

create function public.paypal_payout_reconcile_begin(p_id uuid,p_user uuid,p_environment text,p_sender text,p_event uuid,p_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payouts; s public.paypal_payout_submissions; e public.paypal_payout_events;
  v_batch text; v_query uuid; v_reason text;
begin
  select * into p from public.payouts where id=p_id and (p_user is null or user_id=p_user) for update;
  if p.id is null then raise exception 'Retiro no encontrado'; end if;
  select * into s from public.paypal_payout_submissions where payout_id=p_id for update;
  if p_source is null or p_source not in ('poll','webhook','cancel') then raise exception 'Origen no válido'; end if;
  if p_event is not null then
    select * into e from public.paypal_payout_events where id=p_event and payout_id=p_id
      and environment=p_environment and sender_client_id=p_sender for update;
    if e.id is null then raise exception 'Evento no corresponde al retiro'; end if;
    if e.state <> 'pending' then return jsonb_build_object('operation','done','status',p.status); end if;
  end if;
  if s.payout_id is null then v_reason := 'ORIGINAL_SNAPSHOT_MISSING';
  elsif s.environment is distinct from p_environment or s.sender_client_id is distinct from p_sender then v_reason := 'SENDER_CHANGED';
  elsif s.batch_id is not null and p.paypal_batch_id is not null and s.batch_id<>p.paypal_batch_id then v_reason := 'BATCH_MISMATCH';
  end if;
  v_batch := coalesce(s.batch_id,p.paypal_batch_id,e.body #>> '{resource,payout_batch_id}',e.body #>> '{resource,batch_header,payout_batch_id}');
  if v_batch is null or v_batch !~ '^[A-Za-z0-9_-]{1,128}$' then v_reason := coalesce(v_reason,'BATCH_MISSING'); end if;
  if v_reason is not null then
    update public.paypal_payout_events set state='review',reason=v_reason where id=p_event;
    return jsonb_build_object('operation','review','status',p.status,'reason',v_reason);
  end if;
  insert into public.paypal_payout_reconciliations(payout_id,event_id,batch_id,source)
    values(p_id,p_event,v_batch,p_source) returning id into v_query;
  return jsonb_build_object('operation','query','query',v_query,'batch',v_batch,'status',p.status);
end;
$$;

create function public.paypal_payout_reconcile_finish(p_query uuid,p_response jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.paypal_payout_reconciliations; p public.payouts; s public.paypal_payout_submissions;
  v_item jsonb; v_data jsonb; v_provider text; v_next text; v_outcome text := 'applied'; v_reason text; v_count integer;
begin
  -- Same lock order as submission recovery: payout, snapshot, then query/event.
  select * into a from public.paypal_payout_reconciliations where id=p_query;
  if a.id is null then raise exception 'Consulta no encontrada'; end if;
  select * into p from public.payouts where id=a.payout_id for update;
  select * into s from public.paypal_payout_submissions where payout_id=p.id for update;
  select * into a from public.paypal_payout_reconciliations where id=p_query for update;
  if a.completed_at is not null then
    return jsonb_build_object('status',p.status,'outcome',a.outcome,'reason',a.reason);
  end if;
  v_next := p.status;
  v_data := p_response->'data';
  if exists(select 1 from public.paypal_payout_reconciliations where payout_id=p.id and sequence>a.sequence) then
    v_outcome := 'stale'; v_reason := 'NEWER_QUERY_STARTED';
  elsif p_response->>'http' is distinct from '200' then
    v_outcome := 'retry'; v_reason := 'PROVIDER_UNAVAILABLE';
  elsif jsonb_typeof(v_data->'items') is distinct from 'array' then
    v_outcome := 'retry'; v_reason := 'ITEM_NOT_READY';
  else
    select count(*),jsonb_agg(x)->0 into v_count,v_item
      from jsonb_array_elements(v_data->'items') x where x #>> '{payout_item,sender_item_id}'=p.id::text;
    if v_count=0 then v_outcome := 'retry'; v_reason := 'ITEM_NOT_READY';
    elsif v_count<>1 or v_data #>> '{batch_header,payout_batch_id}' is distinct from a.batch_id
       or v_data #>> '{batch_header,sender_batch_header,sender_batch_id}' is distinct from p.id::text
       or s.payout_id is null
       or (s.batch_id is not null and s.batch_id<>a.batch_id)
       or (p.paypal_batch_id is not null and p.paypal_batch_id<>a.batch_id)
       or coalesce(v_item->>'payout_item_id','') !~ '^[A-Za-z0-9_-]{1,128}$'
       or (p.paypal_item_id is not null and p.paypal_item_id<>v_item->>'payout_item_id')
       or (v_item->>'payout_batch_id' is not null and v_item->>'payout_batch_id'<>a.batch_id)
       or v_item #>> '{payout_item,amount,currency}' is distinct from 'USD'
       or v_item #>> '{payout_item,recipient_type}' is distinct from s.request_body #>> '{items,0,recipient_type}'
       or coalesce(v_item #>> '{payout_item,amount,value}','') !~ '^[0-9]+([.][0-9]{1,2})?$'
       or lower(v_item #>> '{payout_item,receiver}') is distinct from lower(s.request_body #>> '{items,0,receiver}') then
      v_outcome := 'review'; v_reason := 'PROVIDER_IDENTITY_MISMATCH';
    elsif (v_item #>> '{payout_item,amount,value}')::numeric is distinct from s.net then
      v_outcome := 'review'; v_reason := 'PROVIDER_AMOUNT_MISMATCH';
    else
      v_provider := coalesce(v_item->>'transaction_status','UNKNOWN');
      if v_provider='SUCCESS' then v_next := 'paid';
      elsif v_provider in ('RETURNED','REFUNDED','REVERSED') then v_next := 'failed';
      elsif v_provider='FAILED' and p.status<>'paid' then v_next := 'failed';
      elsif p.status='paid' then
        -- FAILED or a pending status cannot undo a previously credited item.
        v_outcome := 'review'; v_reason := 'PAID_STATE_CONFLICT';
      elsif p.status='failed' then
        -- A late authoritative delivery/pending state re-reserves the original
        -- withdrawal even if the creator already withdrew the released balance.
        v_next := 'sending';
      end if;
      if p.status='failed' and v_next<>'failed' then
        v_outcome := 'review'; v_reason := 'LATE_STATE_REPAIRED';
      end if;
      if v_reason in ('PAID_STATE_CONFLICT','LATE_STATE_REPAIRED') then
        insert into public.account_restrictions(user_id,payouts_frozen) values(p.user_id,true)
          on conflict(user_id) do update set payouts_frozen=true;
      end if;
      update public.payouts set status=v_next,
        paid_at=case when v_next='paid' then coalesce(paid_at,now()) else paid_at end,
        paypal_batch_id=a.batch_id,paypal_item_id=v_item->>'payout_item_id',
        error=case when v_next='failed' then left(coalesce(v_item #>> '{errors,name}',v_provider),500) else null end
        where id=p.id;
      update public.paypal_payout_submissions set state='submitted',batch_id=a.batch_id,
        lease_token=null,lease_until=null,next_attempt_at=null where payout_id=p.id;
    end if;
  end if;
  -- The evidence and the balance change are one atomic commit. On any error,
  -- both roll back and the signed event remains pending for another attempt.
  update public.paypal_payout_reconciliations set completed_at=now(),response=p_response,
    outcome=v_outcome,previous_status=p.status,status_after=v_next,reason=v_reason where id=a.id;
  update public.paypal_payout_events set state=case when v_outcome in ('retry','stale') then 'pending'
    when v_outcome='review' then 'review' else 'reconciled' end,
    reason=v_reason,reconciled_at=case when v_outcome='applied' then now() end where id=a.event_id and state='pending';
  return jsonb_build_object('status',v_next,'outcome',v_outcome,'reason',v_reason,'paypalStatus',v_provider);
end;
$$;

-- Opening earnings retries durable pending events too, including returned items
-- whose local payout was already paid. This is not the automatic payout executor.
create function public.paypal_payout_event_pending(p_user uuid)
returns jsonb language sql security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'payout',e.payout_id) order by e.received_at),'[]'::jsonb)
  from public.paypal_payout_events e join public.payouts p on p.id=e.payout_id
  where e.state='pending' and p.user_id=p_user;
$$;

create or replace function public.paypal_payout_mark(p_id uuid,p_status text,p_batch_id text,p_item_id text,p_error text)
returns void language plpgsql security invoker set search_path='' as $$
begin raise exception 'Conciliar y persistir la respuesta de PayPal antes de modificar un retiro'; end;
$$;
revoke all on function public.paypal_payout_mark(uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.paypal_payout_event_receive(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.paypal_payout_reconcile_begin(uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.paypal_payout_reconcile_finish(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.paypal_payout_event_pending(uuid) from public,anon,authenticated;
grant execute on function public.paypal_payout_event_receive(text,text,jsonb) to service_role;
grant execute on function public.paypal_payout_reconcile_begin(uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.paypal_payout_reconcile_finish(uuid,jsonb) to service_role;
grant execute on function public.paypal_payout_event_pending(uuid) to service_role;
