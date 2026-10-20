-- Neutral provider email copy for NEW manual and batch withdrawal snapshots only.
-- Existing immutable snapshots keep their original payload for safe retries.
-- No backfill, money movement, state transition or automatic-executor change.

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
      'email_subject','Tu retiro de Fans Reserve',
      'email_message','Consulta el estado de tu retiro en Ingresos de Fans Reserve y en tu cuenta PayPal. Un retiro en proceso todavía no confirma la entrega del dinero.'),
    'items',jsonb_build_array(jsonb_build_object('recipient_type','EMAIL',
      'receiver',v->>'email','amount',jsonb_build_object('value',to_char((v->>'net')::numeric,'FM999999999990.00'),'currency','USD'),
      'sender_item_id',v_id::text,'note','Retiro de tus ganancias en Fans Reserve')));
  insert into public.paypal_payout_submissions(payout_id,environment,sender_client_id,request_body,net,fee)
  values(v_id,p_environment,p_sender,v_body,(v->>'net')::numeric,(v->>'fee')::numeric);
  return jsonb_build_object('id',v_id,'net',v->'net','fee',v->'fee');
end;
$$;

create or replace function public.finance_batch_prepare_payout(p_item uuid,p_environment text,p_sender text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.finance_batch_items;p public.payouts;v_id uuid;v_body jsonb;
begin
 perform finance_private.lock_book();
 select * into p from public.payouts where finance_batch_item_id=p_item;
 if p.id is not null then return jsonb_build_object('id',p.id,'net',p.net,'fee',p.fee);end if;
 if not (select batch_handoff_enabled from finance_private.settings where id) then raise exception 'La ejecución de lotes continúa deshabilitada';end if;
 if p_environment is null or p_environment not in ('sandbox','live') or nullif(p_sender,'') is null or length(p_sender)>512 then raise exception 'Emisor no válido';end if;
 select * into i from public.finance_batch_items where id=p_item;
 if i.id is null or i.state<>'reserved' then raise exception 'Ítem no disponible para envío';end if;
 if not exists(select 1 from public.profiles where id=i.user_id and role='creator' and creator_profile_id=i.creator_profile_id and is_verified)
   or public.is_suspended(i.user_id) or exists(select 1 from public.account_restrictions where user_id=i.user_id and payouts_frozen)
   or not exists(select 1 from public.payout_accounts where user_id=i.user_id and lower(paypal_email)=lower(i.receiver))
   or public.creator_available_balance(i.user_id)<0 or i.gross<public.payout_min(i.user_id)
   or i.fee<>public.payout_fee_for(i.user_id,i.gross)
   or exists(select 1 from public.payouts where user_id=i.user_id and status='sending')
   or exists(select 1 from public.transactions where creator_profile_id=i.creator_profile_id and status='disputed' and not platform_covers) then
   raise exception 'El creador requiere una nueva revisión antes del envío';end if;
 if exists(select 1 from public.finance_allocations a join public.finance_sources s on s.id=a.source_id
   join public.finance_batches b on b.id=i.batch_id where a.batch_item_id=i.id and
   (s.eligible_at>=b.cutoff or s.amount<(select sum(aa.amount) from finance_private.active_allocations aa where aa.source_id=s.id))) then
   raise exception 'Las ganancias asignadas cambiaron después del cierre';end if;
 insert into public.payouts(user_id,creator_name,amount,fee,net,account_label,available_before,status,paid_at,scheduled_for,finance_batch_item_id)
 values(i.user_id,i.creator_name,i.gross,i.fee,i.net,public.payout_label(i.receiver),public.creator_available_balance(i.user_id)+i.gross,
   'sending',null,(now() at time zone 'America/Tegucigalpa')::date,i.id) returning id into v_id;
 v_body:=jsonb_build_object('sender_batch_header',jsonb_build_object('sender_batch_id',v_id::text,
   'email_subject','Tu retiro de Fans Reserve','email_message','Consulta el estado de tu retiro en Ingresos de Fans Reserve y en tu cuenta PayPal. Un retiro en proceso todavía no confirma la entrega del dinero.'),
   'items',jsonb_build_array(jsonb_build_object('recipient_type','EMAIL','receiver',i.receiver,
     'amount',jsonb_build_object('value',to_char(i.net,'FM999999999990.00'),'currency','USD'),
     'sender_item_id',v_id::text,'note','Retiro de tus ganancias en Fans Reserve')));
 insert into public.paypal_payout_submissions(payout_id,environment,sender_client_id,request_body,net,fee)
 values(v_id,p_environment,p_sender,v_body,i.net,i.fee);
 return jsonb_build_object('id',v_id,'net',i.net,'fee',i.fee);
end;
$$;

revoke all on function public.paypal_payout_begin(uuid,text,text) from public,anon,authenticated;
revoke all on function public.finance_batch_prepare_payout(uuid,text,text) from public,anon,authenticated;
grant execute on function public.paypal_payout_begin(uuid,text,text) to service_role;
grant execute on function public.finance_batch_prepare_payout(uuid,text,text) to service_role;
