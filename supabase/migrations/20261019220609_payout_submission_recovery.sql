-- Deploy after the fallback retirement and before the new server.
-- No historical backfill: a missing original recipient/environment is not safe
-- to reconstruct from today's account. Such withdrawals require review.
create table public.paypal_payout_submissions (
  payout_id uuid primary key references public.payouts(id) on delete restrict,
  environment text not null check (environment in ('sandbox', 'live')),
  sender_client_id text not null check (length(sender_client_id) between 1 and 512),
  request_body jsonb not null check (jsonb_typeof(request_body) = 'object'
    and request_body #>> '{sender_batch_header,sender_batch_id}' = payout_id::text),
  net numeric(12,2) not null check (net > 0),
  fee numeric(12,2) not null check (fee >= 0),
  state text not null default 'prepared' check (state in ('prepared','uncertain','submitted','manual_review','rejected')),
  batch_id text,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check (state <> 'submitted' or batch_id is not null)
);
alter table public.paypal_payout_submissions enable row level security;
-- Only the narrowly granted server RPCs access this table. No browser access.
revoke all on table public.paypal_payout_submissions from public, anon, authenticated, service_role;

-- The existing start holds the creator lock and reserves the whole credited
-- balance. Persist its exact provider payload in the SAME transaction.
create or replace function public.paypal_payout_begin(p_user uuid, p_environment text, p_sender text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_id uuid; v_body jsonb;
begin
  if p_environment is null or p_environment not in ('sandbox','live')
     or nullif(trim(p_sender),'') is null or length(p_sender) > 512 then
    raise exception 'Configuración del emisor de PayPal no válida';
  end if;
  v := public.paypal_payout_start(p_user);
  v_id := (v->>'id')::uuid;
  v_body := jsonb_build_object(
    'sender_batch_header', jsonb_build_object('sender_batch_id',v_id::text,
      'email_subject','Recibiste tu retiro de Fans Reserve',
      'email_message','Tus ganancias en Fans Reserve ya están en tu cuenta PayPal.'),
    'items',jsonb_build_array(jsonb_build_object('recipient_type','EMAIL',
      'receiver',v->>'email','amount',jsonb_build_object('value',to_char((v->>'net')::numeric,'FM999999999990.00'),'currency','USD'),
      'sender_item_id',v_id::text,'note','Retiro de tus ganancias en Fans Reserve')));
  insert into public.paypal_payout_submissions(payout_id,environment,sender_client_id,request_body,net,fee)
  values(v_id,p_environment,p_sender,v_body,(v->>'net')::numeric,(v->>'fee')::numeric);
  return jsonb_build_object('id',v_id,'net',v->'net','fee',v->'fee');
end;
$$;

-- Short transaction; never keep a database lock open during an HTTP request.
-- The token fences late responses. A lease expiry can retry only the SAME key
-- and payload. Provider deduplication is 30 days; stop at 29 days conservatively.
create or replace function public.paypal_payout_claim(p_user uuid, p_id uuid, p_environment text, p_sender text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.payouts; s public.paypal_payout_submissions; v_batch text; v_token uuid;
begin
  select * into p from public.payouts where id=p_id and user_id=p_user for update;
  if p.id is null then raise exception 'Retiro no encontrado'; end if;
  if p.status <> 'sending' then
    return jsonb_build_object('operation','done','status',p.status,'net',p.net,'fee',p.fee);
  end if;
  select * into s from public.paypal_payout_submissions where payout_id=p_id for update;
  if s.payout_id is not null and (s.environment is distinct from p_environment or s.sender_client_id is distinct from p_sender) then
    return jsonb_build_object('operation','review','reason','SENDER_CHANGED');
  end if;
  if s.batch_id is not null and p.paypal_batch_id is not null and s.batch_id <> p.paypal_batch_id then
    return jsonb_build_object('operation','review','reason','BATCH_MISMATCH');
  end if;
  v_batch := coalesce(s.batch_id,p.paypal_batch_id);
  if v_batch is not null then
    return jsonb_build_object('operation','check','batch',v_batch,'payload',s.request_body,
      'net',coalesce(s.net,p.net),'fee',coalesce(s.fee,p.fee));
  end if;
  if s.payout_id is null then
    return jsonb_build_object('operation','review','reason','LEGACY_SNAPSHOT_MISSING');
  end if;
  -- A recovery POST could be the first request PayPal actually receives.
  -- Preserve current identity/restriction checks without replacing the snapshot.
  -- Known batches above remain queryable even when new sending is restricted.
  if not exists (select 1 from public.profiles where id=p_user and role='creator' and is_verified)
     or public.is_suspended(p_user)
     or exists (select 1 from public.account_restrictions where user_id=p_user and payouts_frozen)
     or public.creator_available_balance(p_user) < 0 then
    return jsonb_build_object('operation','review','reason','ACCOUNT_RESTRICTED');
  end if;
  if s.state = 'manual_review' or s.attempt_count >= 5
     or s.first_attempt_at <= now() - interval '29 days' then
    update public.paypal_payout_submissions set state='manual_review',last_error='Límite de recuperación automática alcanzado' where payout_id=p_id;
    return jsonb_build_object('operation','review','reason','RECOVERY_LIMIT');
  end if;
  if s.lease_until > now() or s.next_attempt_at > now() then
    return jsonb_build_object('operation','wait');
  end if;
  v_token := gen_random_uuid();
  update public.paypal_payout_submissions set state='uncertain',
    first_attempt_at=coalesce(first_attempt_at,now()),last_attempt_at=now(),attempt_count=attempt_count+1,
    lease_token=v_token,lease_until=now()+interval '2 minutes',next_attempt_at=null
  where payout_id=p_id;
  return jsonb_build_object('operation','submit','token',v_token,'attempt',s.attempt_count+1,
    'payload',s.request_body,'net',s.net,'fee',s.fee);
end;
$$;

-- A rejection can release the reservation only for a definitive FIRST attempt.
-- A later rejection cannot prove that an earlier uncertain submission failed.
create or replace function public.paypal_payout_submission_result(
  p_user uuid, p_id uuid, p_token uuid, p_outcome text, p_batch text, p_error text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.payouts; s public.paypal_payout_submissions;
begin
  select * into p from public.payouts where id=p_id and user_id=p_user for update;
  if p.id is null then raise exception 'Retiro no encontrado'; end if;
  select * into s from public.paypal_payout_submissions where payout_id=p_id for update;
  if s.payout_id is null or s.lease_token is distinct from p_token or p_token is null then
    return jsonb_build_object('applied',false,'status',p.status);
  end if;
  if p_outcome is null or p_outcome not in ('accepted','uncertain','rejected') then
    raise exception 'Resultado del envío no válido';
  end if;
  if p_outcome='accepted' then
    if nullif(trim(p_batch),'') is null or length(p_batch)>128 then raise exception 'Identificador de lote no válido'; end if;
    if p.paypal_batch_id is not null and p.paypal_batch_id <> p_batch then
      update public.paypal_payout_submissions set state='manual_review',last_error='Lotes contradictorios',lease_token=null,lease_until=null where payout_id=p_id;
      return jsonb_build_object('applied',false,'status',p.status);
    end if;
    update public.paypal_payout_submissions set state='submitted',batch_id=p_batch,
      lease_token=null,lease_until=null,next_attempt_at=null,last_error=null where payout_id=p_id;
    -- Save the batch before polling PayPal, even if delivery is still pending.
    update public.payouts set paypal_batch_id=p_batch where id=p_id;
  elsif p_outcome='rejected' and s.attempt_count=1 and p.status='sending'
        and p.paypal_batch_id is null and s.batch_id is null then
    update public.paypal_payout_submissions set state='rejected',last_error=left(p_error,500),lease_token=null,lease_until=null where payout_id=p_id;
    update public.payouts set status='failed',error=left(p_error,500) where id=p_id;
    p.status := 'failed';
  else
    update public.paypal_payout_submissions set state='uncertain',last_error=left(p_error,500),
      lease_token=null,lease_until=null,next_attempt_at=now()+interval '2 minutes' where payout_id=p_id;
  end if;
  return jsonb_build_object('applied',true,'status',p.status);
end;
$$;

revoke all on function public.paypal_payout_begin(uuid,text,text) from public,anon,authenticated;
revoke all on function public.paypal_payout_claim(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.paypal_payout_submission_result(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.paypal_payout_begin(uuid,text,text) to service_role;
grant execute on function public.paypal_payout_claim(uuid,uuid,text,text) to service_role;
grant execute on function public.paypal_payout_submission_result(uuid,uuid,uuid,text,text,text) to service_role;
