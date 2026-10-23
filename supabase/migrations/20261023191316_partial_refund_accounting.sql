-- Partial refunds preserve the original sale, its fee and its agreed share.
-- No payment gate, schedule, historical refund or historical journal is changed.
alter table public.transactions
 add column refunded_amount numeric(12,2) not null default 0,
 add column refunded_gateway_fee numeric(12,2) not null default 0,
 add column creator_refund_loss numeric(18,8) not null default 0;
alter table public.transactions add constraint transaction_refund_bounds check (
 refunded_amount>=0 and refunded_amount<=amount and refunded_amount::text<>'NaN'
 and refunded_gateway_fee>=0 and refunded_gateway_fee<=refunded_amount and refunded_gateway_fee::text<>'NaN'
 and creator_refund_loss>=0 and creator_refund_loss<=amount*creator_share and creator_refund_loss::text<>'NaN');

create table finance_private.refund_events (
 id uuid primary key default gen_random_uuid(),environment text not null check(environment in ('sandbox','live')),
 sender text not null,event_id text not null,body jsonb not null,received_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','applied','review')),
 reason text,result jsonb,unique(environment,sender,event_id)
);
create table finance_private.refund_receipts (
 environment text not null,sender text not null,refund_id text not null,payment_ref text not null,
 amount numeric(12,2) not null check(amount>0),fee_returned numeric(12,2) not null check(fee_returned>=0 and fee_returned<=amount),
 proof jsonb not null,event_id uuid not null references finance_private.refund_events(id),created_at timestamptz not null default now(),
 primary key(environment,sender,refund_id)
);
create index refund_receipts_payment on finance_private.refund_receipts(payment_ref,environment,sender);
create index refund_events_open on finance_private.refund_events((result->>'payment_ref'),received_at) where state in ('pending','review');
create index transactions_subscription_sale_ref on public.transactions(split_part(key,':',3)) where key like 'paypal-sub:%';
alter table finance_private.refund_events enable row level security;
alter table finance_private.refund_receipts enable row level security;
revoke all on finance_private.refund_events,finance_private.refund_receipts from public,anon,authenticated,service_role;
create trigger refund_receipt_immutable before update or delete on finance_private.refund_receipts
 for each row execute function finance_private.immutable();
create function finance_private.refund_event_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Conservar el aviso original de devolución';end if;
 if (new.id,new.environment,new.sender,new.event_id,new.body,new.received_at) is distinct from
    (old.id,old.environment,old.sender,old.event_id,old.body,old.received_at) then raise exception 'El aviso original es inmutable';end if;
 return new;
end$$;
create trigger refund_event_guard before update or delete on finance_private.refund_events for each row execute function finance_private.refund_event_guard();

create function finance_private.refund_attention(p_id uuid,p_ref text,p_reason text) returns jsonb
language plpgsql set search_path='' as $$
declare p record;
begin
 update finance_private.refund_events set state='review',reason=p_reason,result=coalesce(result,'{}')||jsonb_build_object('payment_ref',p_ref) where id=p_id;
 for p in select distinct u.id from public.profiles u join public.transactions t on t.creator_profile_id=u.creator_profile_id
  where u.role='creator' and (t.paypal_ref=p_ref or (t.key like 'paypal-sub:%' and split_part(t.key,':',3)=p_ref)
   or (t.kind='gift' and t.status='paid' and exists(select 1 from public.coin_purchases c where c.paypal_ref=p_ref and c.user_id=t.payer_id))) loop
  perform finance_private.place_hold(p.id,'safety','incoming-refund/'||p_id,'Una devolución necesita conciliación: '||p_reason);
 end loop;
 perform finance_private.incident(null,'REFUND_REVIEW',p_id::text,'Una devolución necesita revisión',p_reason);
 return jsonb_build_object('state','review','reason',p_reason);
end$$;

create function public.paypal_refund_receive(p_environment text,p_sender text,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e finance_private.refund_events;
begin
 perform finance_private.lock_book();
 if p_environment is null or p_environment not in ('sandbox','live') or length(coalesce(p_sender,'')) not between 1 and 255
  or jsonb_typeof(p_event)<>'object' or length(coalesce(p_event->>'id','')) not between 1 and 255
  or coalesce(p_event->>'event_type','') not in ('PAYMENT.CAPTURE.REFUNDED','PAYMENT.SALE.REFUNDED') then raise exception 'Aviso de devolución no válido';end if;
 insert into finance_private.refund_events(environment,sender,event_id,body) values(p_environment,p_sender,p_event->>'id',p_event)
 on conflict do nothing;
 select * into e from finance_private.refund_events where environment=p_environment and sender=p_sender and event_id=p_event->>'id';
 if e.body is distinct from p_event then
  perform finance_private.refund_attention(e.id,coalesce(e.result->>'payment_ref',''),'El mismo ID de aviso llegó con contenido diferente');
  return jsonb_build_object('id',e.id,'state','review');
 end if;
 return jsonb_build_object('id',e.id,'state',e.state,'result',e.result);
end$$;

-- Only ordinary cash sales can be calculated automatically. Special/tax/discount
-- contracts and Créditos retain their evidence for a separate supervised decision.
create function public.paypal_refund_apply(p_id uuid,p_ref text,p_refund jsonb,p_payment jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e finance_private.refund_events;r finance_private.refund_receipts;t public.transactions;b public.transactions;
 v_amount numeric;v_fee numeric;v_total numeric;v_fees numeric;v_loss numeric;v_id text;v_kind text;
 v_currency text;v_payment_currency text;v_payment_amount numeric;v_parent text;v_result jsonb;v_full boolean;v_count integer;v_coins record;
begin
 perform finance_private.lock_book();
 select * into e from finance_private.refund_events where id=p_id for update;
 if e.id is null then raise exception 'Aviso de devolución no encontrado';end if;
 if e.state='applied' then return e.result;end if;
 if e.state='review' then return jsonb_build_object('state','review','reason',e.reason);end if;
 v_kind:=case when e.body->>'event_type'='PAYMENT.CAPTURE.REFUNDED' then 'capture' else 'sale' end;
 v_id:=p_refund->>'id';
 if coalesce(v_id,'')='' or v_id is distinct from e.body#>>'{resource,id}' or coalesce(p_ref,'')='' or p_payment->>'id' is distinct from p_ref then
  return finance_private.refund_attention(p_id,p_ref,'La consulta no corresponde al aviso o al cobro original');end if;
 if (v_kind='capture' and p_refund->>'status' is distinct from 'COMPLETED') or
    (v_kind='sale' and p_refund->>'state' is distinct from 'completed') then return jsonb_build_object('state','pending','reason','Devolución todavía no confirmada');end if;
 if v_kind='capture' then
  select substring(x->>'href' from '/v2/payments/captures/([A-Za-z0-9-]+)$') into v_parent
   from jsonb_array_elements(coalesce(p_refund->'links','[]')) x where x->>'rel'='up' limit 1;
 else v_parent:=p_refund->>'sale_id';end if;
 if v_parent is distinct from p_ref then return finance_private.refund_attention(p_id,p_ref,'El comprobante no vincula la devolución al cobro original');end if;
 if coalesce(p_refund#>>'{amount,value}',p_refund#>>'{amount,total}','') !~ '^[0-9]+([.][0-9]{1,2})?$'
  or coalesce(p_payment#>>'{amount,value}',p_payment#>>'{amount,total}','') !~ '^[0-9]+([.][0-9]{1,2})?$' then
  return finance_private.refund_attention(p_id,p_ref,'Importe de devolución o cobro no válido');end if;
 v_amount:=coalesce(p_refund#>>'{amount,value}',p_refund#>>'{amount,total}')::numeric;
 v_payment_amount:=coalesce(p_payment#>>'{amount,value}',p_payment#>>'{amount,total}')::numeric;
 v_currency:=coalesce(p_refund#>>'{amount,currency_code}',p_refund#>>'{amount,currency}');
 v_payment_currency:=coalesce(p_payment#>>'{amount,currency_code}',p_payment#>>'{amount,currency}');
 if v_amount<=0 or v_currency is distinct from 'USD' or v_payment_currency is distinct from 'USD' then
  return finance_private.refund_attention(p_id,p_ref,'Revisar moneda o importe antes de ajustar ganancias');end if;
 -- A missing fee credit is conservatively zero; it is never inferred from the gross refund.
 if p_refund#>>'{seller_payable_breakdown,paypal_fee,value}' is not null then
  if p_refund#>>'{seller_payable_breakdown,paypal_fee,value}' !~ '^[0-9]+([.][0-9]{1,2})?$'
   or p_refund#>>'{seller_payable_breakdown,paypal_fee,currency_code}' is distinct from 'USD' then
   return finance_private.refund_attention(p_id,p_ref,'La comisión devuelta no está expresada correctamente en USD');end if;
  v_fee:=(p_refund#>>'{seller_payable_breakdown,paypal_fee,value}')::numeric;
 else v_fee:=0;end if;
 if v_fee>v_amount then return finance_private.refund_attention(p_id,p_ref,'La comisión devuelta supera el reembolso');end if;
 if jsonb_array_length(coalesce(p_refund#>'{seller_payable_breakdown,platform_fees}','[]'))>0 then
  return finance_private.refund_attention(p_id,p_ref,'El proveedor informa comisiones multiparte; revisar su distribución');end if;
 select count(*) into v_count from public.transactions x where x.kind<>'referral'
  and (x.paypal_ref=p_ref or (x.key like 'paypal-sub:%' and split_part(x.key,':',3)=p_ref));
 select * into t from public.transactions x where x.kind<>'referral'
  and (x.paypal_ref=p_ref or (x.key like 'paypal-sub:%' and split_part(x.key,':',3)=p_ref)) limit 1;
 if v_count=0 then
  select * into r from finance_private.refund_receipts where environment=e.environment and sender=e.sender and refund_id=v_id;
  if r.refund_id is not null then
   if (r.payment_ref,r.amount,r.fee_returned) is distinct from (p_ref,v_amount,v_fee) then
    return finance_private.refund_attention(p_id,p_ref,'El comprobante de devolución cambió; conservar el original');end if;
   select result into v_result from finance_private.refund_events where id=r.event_id and state='applied';
   if v_result is not null then
    update finance_private.refund_events set state='applied',reason=null,result=v_result where id=p_id;
    return v_result;
   end if;
  end if;
  select id,price,status into v_coins from public.coin_purchases where paypal_ref=p_ref limit 1;
  if v_coins.id is not null and v_amount=v_coins.price and v_payment_amount=v_coins.price
   and not exists(select 1 from finance_private.refund_receipts where payment_ref=p_ref) then
   insert into finance_private.refund_receipts(environment,sender,refund_id,payment_ref,amount,fee_returned,proof,event_id)
    values(e.environment,e.sender,v_id,p_ref,v_amount,v_fee,jsonb_build_object('refund',p_refund,'payment',p_payment),p_id);
   v_result:=public.paypal_money_back(p_ref,'refund')||jsonb_build_object('state','applied','payment_ref',p_ref,'refunded_amount',v_amount,'full',true);
   update finance_private.refund_events set state='applied',reason=null,result=v_result where id=p_id;
   return v_result;
  elsif v_coins.id is not null then
   return finance_private.refund_attention(p_id,p_ref,'Devolución de Créditos: conciliar billetera y regalos antes de aplicar');end if;
  return jsonb_build_object('state','pending','reason','El cobro aún no está registrado; conservar y reintentar');end if;
 if v_count<>1 or t.amount<>v_payment_amount then return finance_private.refund_attention(p_id,p_ref,'El cobro no coincide de forma única con la venta');end if;
 if exists(select 1 from finance_private.refund_receipts where payment_ref=p_ref and (environment,sender) is distinct from (e.environment,e.sender)) then
  return finance_private.refund_attention(p_id,p_ref,'El cobro ya tiene devoluciones de otro entorno o aplicación');end if;
 select * into r from finance_private.refund_receipts where environment=e.environment and sender=e.sender and refund_id=v_id;
 if r.refund_id is not null then
  if (r.payment_ref,r.amount,r.fee_returned) is distinct from (p_ref,v_amount,v_fee) then return finance_private.refund_attention(p_id,p_ref,'El comprobante de devolución cambió; conservar el original');end if;
 else
  insert into finance_private.refund_receipts(environment,sender,refund_id,payment_ref,amount,fee_returned,proof,event_id)
   values(e.environment,e.sender,v_id,p_ref,v_amount,v_fee,jsonb_build_object('refund',p_refund,'payment',p_payment),p_id);
 end if;
 select sum(amount),sum(fee_returned) into v_total,v_fees from finance_private.refund_receipts where environment=e.environment and sender=e.sender and payment_ref=p_ref;
 if v_total>t.amount or (t.gateway_fee is not null and v_fees>t.gateway_fee) then return finance_private.refund_attention(p_id,p_ref,'Los comprobantes superan el cobro o su comisión original');end if;
 v_full:=v_total=t.amount;
 if not v_full and (t.gateway_fee is null or t.amount<=t.gateway_fee or t.kind not in ('subscription','renewal','tip','vip')
  or coalesce(t.service_fee,0)<>0 or coalesce(t.tax_amount,0)<>0
  or (t.kind='vip' and exists(select 1 from public.vip_bookings x where t.key='vip:'||x.id::text and coalesce((x.details->>'listPrice')::numeric,0)>t.amount))
  or t.status='refunded' or t.creator_share*t.amount/(t.amount-t.gateway_fee)>.9002) then
  return finance_private.refund_attention(p_id,p_ref,'La devolución parcial requiere revisar el contrato, descuento o historial especial');end if;
 if ((v_kind='capture' and p_payment->>'status'='REFUNDED') or (v_kind='sale' and p_payment->>'state'='refunded')) and not v_full then
  perform finance_private.place_hold(p.id,'safety','partial-refund/'||p_ref,'PayPal informa devolución total; faltan comprobantes individuales')
   from public.profiles p where p.role='creator' and p.creator_profile_id=t.creator_profile_id;
  update finance_private.refund_events set reason='Faltan comprobantes individuales',result=jsonb_build_object('payment_ref',p_ref) where id=p_id;
  return jsonb_build_object('state','pending','reason','PayPal informa devolución total; faltan comprobantes individuales');end if;
 -- Preserve the original net share, collection fee and gross. Only a confirmed
 -- fee credit reduces the original collection cost. No new tariff is introduced.
 v_loss:=case when v_full then t.amount*t.creator_share else
  least(t.amount*t.creator_share,greatest(0,(v_total-v_fees)*t.amount*t.creator_share/(t.amount-t.gateway_fee))) end;
 update public.transactions set refunded_amount=v_total,refunded_gateway_fee=v_fees,creator_refund_loss=v_loss where id=t.id;
 -- Referral bonuses follow the same net reduction without recalculating reward levels.
 for b in select * from public.transactions where key='bonus:'||t.id::text and kind='referral' loop
  update public.transactions set refunded_amount=case when v_full then amount else least(amount,round(amount*(v_total-v_fees)/(t.amount-t.gateway_fee),2)) end,
   creator_refund_loss=case when v_full then amount*creator_share else least(amount*creator_share,amount*creator_share*(v_total-v_fees)/(t.amount-t.gateway_fee)) end
   where id=b.id;
 end loop;
 if v_full then v_result:=public.paypal_money_back(p_ref,'refund');else v_result:='{}';end if;
 v_result:=v_result||jsonb_build_object('state','applied','payment_ref',p_ref,'refunded_amount',v_total,'full',v_full);
 update finance_private.refund_events set state='applied',reason=null,result=v_result where id=p_id;
 perform finance_private.incident(null,'DISPUTE_CASE',t.id::text,'Revisar devolución · '||t.creator_name,'Devolución registrada con comprobante. Revisa causa y cobertura; el reparto original no cambia.');
 if not v_full then
  perform finance_private.place_hold(p.id,'safety','partial-refund/'||p_ref,'Revisa la atribución y cobertura de la devolución parcial antes del próximo pago')
   from public.profiles p where p.role='creator' and p.creator_profile_id=t.creator_profile_id;
 end if;
 return v_result;
end$$;

-- Unsupported partial Créditos refunds retain exact evidence. Pending review
-- blocks further gift spending, without cancelling the entire original purchase.
create function finance_private.refund_coin_review_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='gift' and exists(select 1 from finance_private.refund_events e join public.coin_purchases c on c.paypal_ref=e.result->>'payment_ref'
  where e.state='review' and c.user_id=new.payer_id) then raise exception 'Tu billetera tiene una devolución pendiente de revisión';end if;
 return new;
end$$;
create trigger refund_coin_review_guard before insert on public.transactions for each row execute function finance_private.refund_coin_review_guard();
create function finance_private.refunded_sale_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if old.refunded_amount>0 and (new.amount,new.creator_share,new.gateway_fee,new.key,new.paypal_ref,new.creator_profile_id,new.created_at)
  is distinct from (old.amount,old.creator_share,old.gateway_fee,old.key,old.paypal_ref,old.creator_profile_id,old.created_at) then
  raise exception 'Conservar la base original de una venta con devoluciones; registrar correcciones por separado';end if;
 return new;
end$$;
create trigger refunded_sale_guard before update on public.transactions for each row execute function finance_private.refunded_sale_guard();

-- Existing aggregate rounding and original eligibility dates are preserved.
do $$declare d text;begin
 d:=pg_get_functiondef('finance_private.sync_creator(text)'::regprocedure);
 if position('then amount*creator_share else 0' in d)=0 then raise exception 'Revisar sync_creator antes de instalar devoluciones';end if;
 d:=replace(d,'then amount*creator_share else 0','then greatest(0,amount*creator_share-case when platform_covers then 0 else creator_refund_loss end) else 0');
 d:=replace(d,'''share'',creator_share,','''share'',creator_share,''refunded_amount'',refunded_amount,''refunded_gateway_fee'',refunded_gateway_fee,''creator_refund_loss'',creator_refund_loss,');
 execute d;
 d:=pg_get_functiondef('public.creator_available_balance(uuid)'::regprocedure);
 if position('sum(t.amount*t.creator_share)' in d)=0 then raise exception 'Revisar saldo antes de instalar devoluciones';end if;
 execute replace(d,'sum(t.amount*t.creator_share)','sum(greatest(0,t.amount*t.creator_share-case when t.platform_covers then 0 else t.creator_refund_loss end))');
 d:=pg_get_functiondef('finance_private.dispute_snapshot(text)'::regprocedure);
 execute replace(d,'''amount'',t.amount,','''amount'',t.amount,''refunded_amount'',t.refunded_amount,''refunded_gateway_fee'',t.refunded_gateway_fee,''creator_refund_loss'',t.creator_refund_loss,');
 d:=pg_get_functiondef('finance_private.cover_before_cases(uuid,boolean)'::regprocedure);
 execute replace(d,'t.status NOT IN (''refunded'', ''disputed'')','(t.status NOT IN (''refunded'', ''disputed'') and t.refunded_amount=0)');
 -- pg_get_functiondef preserves body spelling, not SQL keyword normalization.
 d:=pg_get_functiondef('finance_private.cover_before_cases(uuid,boolean)'::regprocedure);
 execute replace(d,'t.status not in (''refunded'', ''disputed'')','(t.status not in (''refunded'', ''disputed'') and t.refunded_amount=0)');
 d:=pg_get_functiondef('finance_private.case_basis(uuid)'::regprocedure);
 d:=replace(d,'s->>''status'' in (''disputed'',''refunded'')','(s->>''status'' in (''disputed'',''refunded'') or coalesce((s->>''refunded_amount'')::numeric,0)>0)');
 d:=replace(d,'s->>''status''=''paid'' or','(s->>''status''=''paid'' and coalesce((s->>''refunded_amount'')::numeric,0)=0) or');
 execute replace(d,'s->>''status''=''refunded'' and exists','(s->>''status''=''refunded'' or coalesce((s->>''refunded_amount'')::numeric,0)>0) and exists');
 d:=pg_get_functiondef('finance_private.hold_blockers(uuid,uuid)'::regprocedure);
 d:=replace(d,'t.status=''refunded''','(t.status=''refunded'' or t.refunded_amount>0)');
 execute replace(d,' return v;', $block$ if exists(select 1 from finance_private.refund_events e join public.transactions refund_tx on
  (refund_tx.paypal_ref=e.result->>'payment_ref' or (refund_tx.key like 'paypal-sub:%' and split_part(refund_tx.key,':',3)=e.result->>'payment_ref')
   or (refund_tx.kind='gift' and exists(select 1 from public.coin_purchases c where c.paypal_ref=e.result->>'payment_ref' and c.user_id=refund_tx.payer_id)))
  where refund_tx.creator_profile_id=p.creator_profile_id and e.state in ('pending','review')) then v:=v||'"INCOMING_REFUND_REVIEW"'::jsonb;end if;
 return v;$block$);
 -- Keep partial cases alive in the original review rather than reopening every round.
 d:=pg_get_functiondef('public.finance_job_review(uuid)'::regprocedure);
 d:=replace(d,'x.status in (''disputed'',''refunded'')','(x.status in (''disputed'',''refunded'') or x.refunded_amount>0)');
 execute replace(d,' update public.finance_incidents set state=''resolved'',resolved_at=now() where state=''open'' and last_seen_run is distinct from p_run',
 $observe$ for t in select * from finance_private.refund_events where state='review' or (state='pending' and received_at<now()-interval '5 minutes') loop
  perform finance_private.incident(p_run,'REFUND_REVIEW',t.id::text,'Una devolución necesita revisión',coalesce(t.reason,'El aviso firmado está guardado y pendiente de conciliación.'));
 end loop;
 update public.finance_incidents set state='resolved',resolved_at=now() where state='open' and last_seen_run is distinct from p_run$observe$);
end$$;

revoke all on function public.paypal_refund_receive(text,text,jsonb),public.paypal_refund_apply(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.paypal_refund_receive(text,text,jsonb),public.paypal_refund_apply(uuid,text,jsonb,jsonb) to service_role;
revoke all on function finance_private.refund_attention(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function finance_private.refund_event_guard() from public,anon,authenticated,service_role;
revoke all on function finance_private.refund_coin_review_guard() from public,anon,authenticated,service_role;
revoke all on function finance_private.refunded_sale_guard() from public,anon,authenticated,service_role;
