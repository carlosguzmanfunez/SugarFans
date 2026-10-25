-- Supervised, evidence-bound exceptional refunds. This migration sends no money.
-- The provider writer still validates the signed event and its queried parent.
create table finance_private.refund_exceptions(
 event_id uuid primary key references finance_private.refund_events(id),
 kind text not null check(kind in ('credits','contract')),
 payment_ref text not null,refund_id text not null,amount numeric(12,2) not null,
 fee_returned numeric(12,2) not null,payment_amount numeric(12,2) not null,
 proof jsonb not null,created_at timestamptz not null default now()
);
alter table finance_private.refund_exceptions enable row level security;
revoke all on finance_private.refund_exceptions from public,anon,authenticated,service_role;
create trigger refund_exception_immutable before update or delete on finance_private.refund_exceptions
 for each row execute function finance_private.immutable();
create index refund_exception_payment on finance_private.refund_exceptions(payment_ref,refund_id);

alter table public.coin_purchases add column refunded_amount numeric(12,2) not null default 0,
 add column refunded_coins bigint not null default 0;
alter table public.coin_purchases add constraint coin_partial_refund_bounds check(
 refunded_amount between 0 and price and refunded_amount::text<>'NaN' and refunded_coins between 0 and coins);
alter table public.transactions add column refunded_coins bigint not null default 0;
alter table public.transactions add constraint gift_refund_coin_bounds check(
 refunded_coins>=0 and (refunded_coins=0 or (kind='gift' and refunded_coins<=round(amount*100))));

create or replace function public.coin_balance(p_user uuid) returns bigint
 language sql stable security definer set search_path='' as $$
 select coalesce((select sum(c.coins-c.refunded_coins) from public.coin_purchases c where c.user_id=p_user and c.status='paid'),0)
 - coalesce((select sum(round(t.amount*100)-t.refunded_coins) from public.transactions t
 where t.payer_id=p_user and t.kind='gift' and t.status='paid'),0)::bigint;
$$;

create function finance_private.remember_refund_exception(p_id uuid,p_kind text,p_ref text,p_refund jsonb,p_payment jsonb,p_amount numeric,p_fee numeric,p_original numeric)
 returns void language plpgsql set search_path='' as $$
declare v finance_private.refund_exceptions;e finance_private.refund_events;
begin
 select * into v from finance_private.refund_exceptions where event_id=p_id;
 if v.event_id is not null then
  if (v.kind,v.payment_ref,v.proof) is distinct from (p_kind,p_ref,jsonb_build_object('refund',p_refund,'payment',p_payment)) then
   raise exception 'El comprobante excepcional cambió; conservar la evidencia original';end if;
  return;
 end if;
 insert into finance_private.refund_exceptions(event_id,kind,payment_ref,refund_id,amount,fee_returned,payment_amount,proof)
 values(p_id,p_kind,p_ref,p_refund->>'id',p_amount,p_fee,p_original,jsonb_build_object('refund',p_refund,'payment',p_payment));
 -- Retain each queried Créditos receipt before review, just like cash sales.
 -- Otherwise two partial receipts recovered after a total refund could wait
 -- forever for each other even though both proofs had already arrived.
 if p_kind='credits' then
  select * into e from finance_private.refund_events where id=p_id;
  insert into finance_private.refund_receipts(environment,sender,refund_id,payment_ref,amount,fee_returned,proof,event_id)
   values(e.environment,e.sender,p_refund->>'id',p_ref,p_amount,p_fee,jsonb_build_object('refund',p_refund,'payment',p_payment),p_id) on conflict do nothing;
 end if;
end$$;

-- Install only at the two validated exception exits; never bypass the provider checks.
do $$declare d text;old text;begin
 d:=pg_get_functiondef('public.paypal_refund_apply(uuid,text,jsonb,jsonb)'::regprocedure);
 old:=$old$  elsif v_coins.id is not null then
   return finance_private.refund_attention(p_id,p_ref,'Devolución de Créditos: conciliar billetera y regalos antes de aplicar');end if;$old$;
 if position(old in d)=0 then raise exception 'Revisar salida de Créditos antes de instalar';end if;
 d:=replace(d,old,$new$  elsif v_coins.id is not null then
   perform finance_private.remember_refund_exception(p_id,'credits',p_ref,p_refund,p_payment,v_amount,v_fee,v_payment_amount);
   return finance_private.refund_attention(p_id,p_ref,'Devolución de Créditos: conciliar billetera y regalos antes de aplicar');end if;$new$);
 old:=$old$  return finance_private.refund_attention(p_id,p_ref,'La devolución parcial requiere revisar el contrato, descuento o historial especial');end if;$old$;
 if position(old in d)=0 then raise exception 'Revisar salida de contrato antes de instalar';end if;
 d:=replace(d,old,$new$  perform finance_private.remember_refund_exception(p_id,'contract',p_ref,p_refund,p_payment,v_amount,v_fee,v_payment_amount);
  return finance_private.refund_attention(p_id,p_ref,'La devolución parcial requiere revisar el contrato, descuento o historial especial');end if;$new$);
 -- A full refund following a supervised partial purchase must use the same accounting.
 d:=replace(d,'and not exists(select 1 from finance_private.refund_receipts where payment_ref=p_ref) then',
 'and not exists(select 1 from finance_private.refund_receipts where payment_ref=p_ref) and not exists(select 1 from finance_private.refund_exceptions where payment_ref=p_ref) then');
 execute d;
end$$;

alter table public.finance_case_actions drop constraint finance_case_actions_action_check;
alter table public.finance_case_actions add constraint finance_case_actions_action_check
 check(action in ('note','coverage','release_hold','ack_alert','close_review','refund_resolution','refund_recheck'));
create index refund_resolution_payment on public.finance_case_actions((result->>'payment_ref')) where action='refund_resolution';

-- All values are cumulative. The operator allocates only the service/tax portions,
-- documented by the original contract. The creator's share cannot be entered by hand.
create function finance_private.refund_resolution_plan(p_incident uuid,p_service numeric,p_tax numeric) returns jsonb
 language plpgsql set search_path='' as $$
declare i public.finance_incidents;e finance_private.refund_events;x finance_private.refund_exceptions;
 t public.transactions;c public.coin_purchases;g public.transactions;r record;
 total numeric;fees numeric;original_fee numeric;core numeric;loss numeric;units bigint;needed bigint;take bigint;
 wallet bigint;items jsonb:='[]';v jsonb;basis jsonb;cnt integer;issue text;
begin
 select * into i from public.finance_incidents where id=p_incident and code='REFUND_REVIEW';
 if i.id is null then return jsonb_build_object('issue','No encontramos el expediente de devolución.');end if;
 select * into e from finance_private.refund_events where id::text=i.reference;
 select * into x from finance_private.refund_exceptions where event_id=e.id;
 if x.event_id is null then return jsonb_build_object('issue','Falta consultar y conservar el comprobante de esta devolución.','can_recheck',
 e.state='review' and e.reason in ('Devolución de Créditos: conciliar billetera y regalos antes de aplicar','La devolución parcial requiere revisar el contrato, descuento o historial especial'));end if;
 if e.state<>'review' or i.state<>'open' then return jsonb_build_object('issue','Esta devolución ya fue atendida o está siendo consultada.');end if;
 if e.reason not in ('Devolución de Créditos: conciliar billetera y regalos antes de aplicar','La devolución parcial requiere revisar el contrato, descuento o historial especial') then
  return jsonb_build_object('issue','El aviso tiene otra incongruencia que debe investigarse antes de conciliar.');end if;
 if p_service is null or p_tax is null or p_service::text='NaN' or p_tax::text='NaN' or p_service<0 or p_tax<0 or round(p_service,2)<>p_service or round(p_tax,2)<>p_tax then
  return jsonb_build_object('issue','Indica importes válidos de servicio e impuestos, en USD con dos decimales.');end if;
 if exists(select 1 from finance_private.refund_receipts where payment_ref=x.payment_ref and (environment,sender) is distinct from (e.environment,e.sender)) then
  return jsonb_build_object('issue','El cobro tiene comprobantes de otro entorno o aplicación.');end if;
 if exists(select 1 from finance_private.refund_receipts where environment=e.environment and sender=e.sender and refund_id=x.refund_id
  and (payment_ref,amount,fee_returned) is distinct from (x.payment_ref,x.amount,x.fee_returned)) then
  return jsonb_build_object('issue','El comprobante difiere de la evidencia conservada.');end if;
 select coalesce(sum(amount),0),coalesce(sum(fee_returned),0) into total,fees from finance_private.refund_receipts
  where environment=e.environment and sender=e.sender and payment_ref=x.payment_ref and refund_id<>x.refund_id;
 total:=total+x.amount;fees:=fees+x.fee_returned;
 if total>x.payment_amount or fees>total then return jsonb_build_object('issue','Las devoluciones superan el cobro original.');end if;
 if total<x.payment_amount and (x.proof#>>'{payment,status}'='REFUNDED' or x.proof#>>'{payment,state}'='refunded') then
  return jsonb_build_object('issue','PayPal informa devolución total; faltan comprobantes individuales.');end if;
 basis:=jsonb_build_object('event',to_jsonb(e),'proof',to_jsonb(x),'receipts',(select coalesce(jsonb_agg(to_jsonb(z) order by z.refund_id),'[]') from finance_private.refund_receipts z where payment_ref=x.payment_ref));
 if x.kind='contract' then
  select count(*) into cnt from public.transactions z where z.kind<>'referral' and (z.paypal_ref=x.payment_ref or (z.key like 'paypal-sub:%' and split_part(z.key,':',3)=x.payment_ref));
  select * into t from public.transactions z where z.kind<>'referral' and (z.paypal_ref=x.payment_ref or (z.key like 'paypal-sub:%' and split_part(z.key,':',3)=x.payment_ref)) limit 1;
  if cnt<>1 or t.amount<>x.payment_amount or (t.status not in ('paid','disputed') and not(t.status='refunded' and total=t.amount and t.refunded_amount=total)) or t.kind not in ('tip','subscription','renewal','vip') then
   return jsonb_build_object('issue','El cobro no corresponde a una única venta compatible.');end if;
  original_fee:=t.gateway_fee;
  -- Missing historical fees require the original queried PayPal fee, never an estimate.
  if original_fee is null then
   if x.proof#>>'{payment,seller_receivable_breakdown,paypal_fee,currency_code}'='USD'
    and x.proof#>>'{payment,seller_receivable_breakdown,paypal_fee,value}' ~ '^[0-9]+([.][0-9]{1,2})?$' then
    original_fee:=(x.proof#>>'{payment,seller_receivable_breakdown,paypal_fee,value}')::numeric;
   elsif x.proof#>>'{payment,transaction_fee,currency}'='USD' and x.proof#>>'{payment,transaction_fee,value}' ~ '^[0-9]+([.][0-9]{1,2})?$' then
    original_fee:=(x.proof#>>'{payment,transaction_fee,value}')::numeric;
   end if;
  end if;
  core:=t.amount-original_fee-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0);
  if original_fee is null or original_fee<0 or core<=0 or fees>original_fee or t.creator_share<0 or t.amount*t.creator_share>core+.01 then
   return jsonb_build_object('issue','Falta una base original comprobable. No se puede inventar la comisión ni el reparto.');end if;
  if p_service>coalesce(t.service_fee,0) or p_tax>coalesce(t.tax_amount,0) or p_service+p_tax>total-fees then
   return jsonb_build_object('issue','La parte de servicio o impuestos supera su importe original o la devolución neta.');end if;
  if total=t.amount and (p_service<>coalesce(t.service_fee,0) or p_tax<>coalesce(t.tax_amount,0)) then
   return jsonb_build_object('issue','La devolución total debe incluir la totalidad del servicio y los impuestos originales.');end if;
  loss:=case when total=t.amount then t.amount*t.creator_share else least(t.amount*t.creator_share,greatest(0,(total-fees-p_service-p_tax)*t.amount*t.creator_share/core)) end;
  if exists(select 1 from public.finance_case_actions a where a.action='refund_resolution' and a.result->>'payment_ref'=x.payment_ref
   and (coalesce((a.result->>'service_refund')::numeric,0)>p_service or coalesce((a.result->>'tax_refund')::numeric,0)>p_tax)) then
   return jsonb_build_object('issue','Los importes acumulados de servicio e impuestos no pueden retroceder.');end if;
  items:=jsonb_build_array(jsonb_build_object('transaction',t.id,'creator',t.creator_name,'creator_profile_id',t.creator_profile_id,
   'original_earnings',t.amount*t.creator_share,'previous_loss',t.creator_refund_loss,'loss',round(loss,8),'covered',t.platform_covers,'status',t.status));
  basis:=basis||jsonb_build_object('sale',to_jsonb(t),'bonuses',(select coalesce(jsonb_agg(to_jsonb(z) order by z.id),'[]') from public.transactions z where z.key='bonus:'||t.id::text and z.kind='referral'));
  v:=jsonb_build_object('kind','contract','collection_fee',original_fee,'original_service',coalesce(t.service_fee,0),'original_tax',coalesce(t.tax_amount,0));
 else
  select count(*) into cnt from public.coin_purchases where paypal_ref=x.payment_ref;
  select * into c from public.coin_purchases where paypal_ref=x.payment_ref limit 1;
  if cnt<>1 or c.price<>x.payment_amount or c.status<>'paid' or c.coins<=0 or c.price<=0 or p_service<>0 or p_tax<>0 then
   return jsonb_build_object('issue','La compra de Créditos no tiene una base única y compatible.');end if;
  if exists(select 1 from public.coin_purchases cp where cp.user_id=c.user_id and cp.status='disputed')
   or exists(select 1 from public.transactions tx where tx.payer_id=c.user_id and tx.kind='gift' and tx.status='disputed')
   or exists(select 1 from public.coin_purchases cp join finance_private.income_events pending on
    (cp.paypal_ref=coalesce(pending.body#>>'{resource,sale_id}',pending.body#>>'{resource,id}') or exists(
     select 1 from jsonb_array_elements(coalesce(pending.body#>'{resource,disputed_transactions}','[]')) part where part->>'seller_transaction_id'=cp.paypal_ref))
    where cp.user_id=c.user_id and pending.state<>'applied') then
   return jsonb_build_object('issue','La billetera tiene otra disputa o aviso de cobro pendiente; concílialo primero.');end if;
  if exists(select 1 from finance_private.refund_events z join public.coin_purchases cp on cp.paypal_ref=z.result->>'payment_ref'
   where cp.user_id=c.user_id and z.state in ('pending','review') and z.id<>e.id and cp.id<>c.id) then
   return jsonb_build_object('issue','Primero concilia la otra devolución pendiente de esta billetera.');end if;
  units:=case when total=c.price then c.coins else round(c.coins*total/c.price) end;
  wallet:=public.coin_balance(c.user_id);
  if units<c.refunded_coins or wallet<0 then return jsonb_build_object('issue','La billetera tiene diferencias anteriores; requiere conciliación antes de descontar.');end if;
  needed:=greatest(0,units-c.refunded_coins-wallet);
  for g in select * from public.transactions z where z.kind='gift' and z.status='paid' and z.payer_id=c.user_id order by z.created_at desc,z.id desc loop
   exit when needed=0;
   take:=least(needed,round(g.amount*100)::bigint-g.refunded_coins);
   if take<=0 then continue;end if;
   if g.amount<=0 or g.creator_share<0 or g.creator_share>1 or g.refunded_amount<>round(g.refunded_coins::numeric/100,2) then
    return jsonb_build_object('issue','Un regalo tiene ajustes anteriores incompatibles; concílialo antes de continuar.');end if;
   items:=items||jsonb_build_array(jsonb_build_object('transaction',g.id,'creator',g.creator_name,'creator_profile_id',g.creator_profile_id,
    'coins',take,'total_coins',g.refunded_coins+take,'original_earnings',g.amount*g.creator_share,'previous_loss',g.creator_refund_loss,
    'loss',round(g.amount*g.creator_share*(g.refunded_coins+take)/(g.amount*100),8),'covered',g.platform_covers,'status',g.status));
   needed:=needed-take;
  end loop;
  if needed>0 then return jsonb_build_object('issue','No hay suficientes Créditos y regalos conciliables para justificar el ajuste.');end if;
  basis:=basis||jsonb_build_object('purchases',(select jsonb_agg(to_jsonb(z) order by z.id) from public.coin_purchases z where z.user_id=c.user_id),
   'gifts',(select coalesce(jsonb_agg(to_jsonb(z) order by z.id),'[]') from public.transactions z where z.payer_id=c.user_id and z.kind='gift'),
   'bonuses',(select coalesce(jsonb_agg(to_jsonb(z) order by z.id),'[]') from public.transactions z where z.kind='referral' and z.key in(select 'bonus:'||a.id::text from public.transactions a where a.payer_id=c.user_id and a.kind='gift')));
  v:=jsonb_build_object('kind','credits','purchase',c.id,'fan',c.user_id,'wallet_before',wallet,'removed_coins',units-c.refunded_coins,
   'total_removed_coins',units,'wallet_after',greatest(0,wallet-(units-c.refunded_coins)));
 end if;
 v:=v||jsonb_build_object('issue',null,'incident',i.id,'event',e.id,'payment_ref',x.payment_ref,'original_amount',x.payment_amount,
  'refund',x.amount,'total_refund',total,'fee_returned',fees,'service_refund',p_service,'tax_refund',p_tax,'full',total=x.payment_amount,'items',items);
 return v||jsonb_build_object('hash',md5((basis||v)::text));
end$$;

create function public.finance_refund_preview(p_incident uuid,p_service numeric default 0,p_tax numeric default 0) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin perform finance_private.assert_admin();perform finance_private.lock_book();
 return finance_private.refund_resolution_plan(p_incident,p_service,p_tax);
end$$;

create function public.finance_refund_resolve(p_incident uuid,p_key uuid,p_expected text,p_service numeric,p_tax numeric,p_evidence text,p_reason text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;a public.finance_case_actions;i public.finance_incidents;x finance_private.refund_exceptions;e finance_private.refund_events;
 item jsonb;t public.transactions;b public.transactions;ratio numeric;res jsonb:='{}';decision uuid:=gen_random_uuid();
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or length(trim(coalesce(p_evidence,''))) not between 10 and 1000 or length(trim(coalesce(p_reason,''))) not between 20 and 2000 then
  raise exception 'Documenta los comprobantes y el motivo de esta conciliación';end if;
 select * into a from public.finance_case_actions where request_key=p_key;
 if a.id is not null then
  if (a.incident_id,a.action,a.expected_hash,a.evidence,a.reason,(a.result->>'service_refund')::numeric,(a.result->>'tax_refund')::numeric) is distinct from
   (p_incident,'refund_resolution',p_expected,trim(p_evidence),trim(p_reason),p_service,p_tax) then raise exception 'Referencia de decisión reutilizada';end if;
  return jsonb_build_object('id',a.id,'result',a.result);
 end if;
 v:=finance_private.refund_resolution_plan(p_incident,p_service,p_tax);
 if v->>'issue' is not null then raise exception '%',v->>'issue';end if;
 if p_expected is null or v->>'hash' is distinct from p_expected then raise exception 'La devolución o la billetera cambió; actualiza y revisa nuevamente';end if;
 select * into i from public.finance_incidents where id=p_incident;
 select * into e from finance_private.refund_events where id=(v->>'event')::uuid for update;
 select * into x from finance_private.refund_exceptions where event_id=e.id;
 insert into finance_private.refund_receipts(environment,sender,refund_id,payment_ref,amount,fee_returned,proof,event_id)
 values(e.environment,e.sender,x.refund_id,x.payment_ref,x.amount,x.fee_returned,x.proof,e.id) on conflict do nothing;
 for item in select * from jsonb_array_elements(v->'items') loop
  select * into t from public.transactions where id::text=item->>'transaction' for update;
  if v->>'kind'='credits' then
   update public.transactions set refunded_coins=(item->>'total_coins')::bigint,refunded_amount=round((item->>'total_coins')::numeric/100,2),
    creator_refund_loss=(item->>'loss')::numeric,
    status=case when (item->>'total_coins')::bigint=round(t.amount*100) then 'refunded' else status end where id=t.id;
   ratio:=(item->>'total_coins')::numeric/(t.amount*100);
  else
   update public.transactions set refunded_amount=(v->>'total_refund')::numeric,refunded_gateway_fee=(v->>'fee_returned')::numeric,
    creator_refund_loss=(item->>'loss')::numeric where id=t.id;
   ratio:=case when t.amount*t.creator_share>0 then (item->>'loss')::numeric/(t.amount*t.creator_share) else 0 end;
  end if;
  for b in select * from public.transactions where key='bonus:'||t.id::text and kind='referral' loop
   update public.transactions set refunded_amount=least(amount,round(amount*ratio,2)),creator_refund_loss=least(amount*creator_share,amount*creator_share*ratio) where id=b.id;
  end loop;
  perform finance_private.incident(null,'DISPUTE_CASE',t.id::text,'Revisar devolución · '||coalesce(t.creator_name,t.creator_profile_id),
   'Devolución excepcional conciliada. Falta evaluar causa y cobertura; no libera fondos.');
  perform finance_private.place_hold(p.id,'safety','partial-refund/'||x.payment_ref,'Revisa la causa y cobertura de esta devolución antes del próximo pago')
   from public.profiles p where p.role='creator' and p.creator_profile_id=t.creator_profile_id;
 end loop;
 if v->>'kind'='credits' then
  update public.coin_purchases set refunded_amount=(v->>'total_refund')::numeric,refunded_coins=(v->>'total_removed_coins')::bigint,
   status=case when (v->>'full')::boolean then 'refunded' else status end where id=(v->>'purchase')::uuid;
 elsif (v->>'full')::boolean then res:=finance_private.income_money_back(x.payment_ref,'refund');
 end if;
 res:=res||jsonb_build_object('state','applied','payment_ref',x.payment_ref,'refunded_amount',(v->>'total_refund')::numeric,'full',(v->>'full')::boolean,
  'service_refund',p_service,'tax_refund',p_tax,'supervised',true,'decision',decision,'external_charge',false);
 update finance_private.refund_events set state='applied',reason=null,result=res where id=e.id;
 -- Equivalent duplicate notices are closed together, but their original records stay intact.
 update finance_private.refund_events z set state='applied',reason=null,result=res from finance_private.refund_exceptions y
  where y.event_id=z.id and y.event_id<>e.id and z.environment=e.environment and z.sender=e.sender
  and y.payment_ref=x.payment_ref and z.state='review'
  and z.reason in ('Devolución de Créditos: conciliar billetera y regalos antes de aplicar','La devolución parcial requiere revisar el contrato, descuento o historial especial')
  and ((y.refund_id=x.refund_id and y.amount=x.amount and y.fee_returned=x.fee_returned) or ((v->>'full')::boolean and exists(
   select 1 from finance_private.refund_receipts receipt where receipt.environment=z.environment and receipt.sender=z.sender
    and receipt.refund_id=y.refund_id and receipt.payment_ref=y.payment_ref and receipt.amount=y.amount and receipt.fee_returned=y.fee_returned)));
 if exists(select 1 from finance_private.income_disputes where payment_ref=x.payment_ref) then perform finance_private.refresh_income_dispute(x.payment_ref);end if;
 insert into public.finance_case_actions(id,request_key,incident_id,episode,action,party,category,evidence,reason,expected_hash,before_snapshot,result,created_by)
 values(decision,p_key,i.id,i.episode,'refund_resolution','undetermined','unresolved',trim(p_evidence),trim(p_reason),p_expected,v,res,auth.uid());
 update public.finance_incidents z set state='resolved',resolved_at=now() where z.code='REFUND_REVIEW' and exists(
  select 1 from finance_private.refund_events ev where ev.id::text=z.reference and ev.state='applied' and ev.result->>'decision'=decision::text);
 return jsonb_build_object('id',decision,'result',res);
end$$;

create or replace function finance_private.refunded_sale_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if old.refunded_amount>0 and (new.amount,new.creator_share,new.gateway_fee,new.key,new.paypal_ref,new.creator_profile_id,new.created_at,new.service_fee,new.tax_amount)
  is distinct from (old.amount,old.creator_share,old.gateway_fee,old.key,old.paypal_ref,old.creator_profile_id,old.created_at,old.service_fee,old.tax_amount) then
  raise exception 'Conservar la base original de una venta con devoluciones; registrar correcciones por separado';end if;
 return new;
end$$;
create function finance_private.coin_refund_basis_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if old.refunded_amount>0 and (new.id,new.coins,new.price,new.paypal_ref,new.created_at,new.pack_id)
  is distinct from (old.id,old.coins,old.price,old.paypal_ref,old.created_at,old.pack_id) then
  raise exception 'Conservar la compra original de Créditos que ya tiene devoluciones';end if;
 return new;
end$$;
create trigger coin_refund_basis_guard before update on public.coin_purchases for each row execute function finance_private.coin_refund_basis_guard();

-- Historical exceptional notices predate the retained query proof. Requeue only
-- these known exceptions; malformed/colliding notices cannot be force-approved.
create function public.finance_refund_recheck(p_incident uuid,p_key uuid,p_evidence text,p_reason text) returns void
 language plpgsql security definer set search_path='' as $$
declare i public.finance_incidents;e finance_private.refund_events;a public.finance_case_actions;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or length(trim(coalesce(p_evidence,''))) not between 10 and 1000 or length(trim(coalesce(p_reason,''))) not between 20 and 2000 then raise exception 'Documenta el motivo y los comprobantes';end if;
 select * into a from public.finance_case_actions where request_key=p_key;
 if a.id is not null then
  if (a.incident_id,a.action,a.evidence,a.reason) is distinct from (p_incident,'refund_recheck',trim(p_evidence),trim(p_reason)) then raise exception 'Referencia de decisión reutilizada';end if;return;
 end if;
 select * into i from public.finance_incidents where id=p_incident and code='REFUND_REVIEW' and state='open';
 select * into e from finance_private.refund_events where id::text=i.reference;
 if e.state is distinct from 'review' or e.reason not in ('Devolución de Créditos: conciliar billetera y regalos antes de aplicar','La devolución parcial requiere revisar el contrato, descuento o historial especial')
  or exists(select 1 from finance_private.refund_exceptions where event_id=e.id) then raise exception 'Este aviso no admite una nueva consulta supervisada';end if;
 insert into public.finance_case_actions(request_key,incident_id,episode,action,party,category,evidence,reason,expected_hash,before_snapshot,result,created_by)
 values(p_key,i.id,i.episode,'refund_recheck','undetermined','unresolved',trim(p_evidence),trim(p_reason),md5(to_jsonb(e)::text),to_jsonb(e),'{"queued":true,"external_charge":false}',auth.uid());
 update finance_private.refund_events set state='pending',reason='Nueva consulta supervisada solicitada',recovery_attempts=0,recovery_until=null where id=e.id;
end$$;

-- Serialise Créditos spending with refunds before its balance check, not only
-- in the AFTER-statement ledger trigger. This also prevents simultaneous gifts
-- from spending the same wallet balance.
do $$declare d text;fn text;pos integer;begin
 foreach fn in array array['public.send_gift(text,text,text,text,text,text)','public.buy_coins(text,uuid)'] loop
  d:=pg_get_functiondef(fn::regprocedure);pos:=position(E'\nbegin\n' in d);
  if pos=0 then raise exception 'Revisar bloqueo de billetera: %',fn;end if;
  d:=overlay(d placing E'\nbegin\n  perform finance_private.lock_book();\n' from pos for 7);
  execute d;
 end loop;
end$$;

revoke all on function public.finance_refund_preview(uuid,numeric,numeric),public.finance_refund_resolve(uuid,uuid,text,numeric,numeric,text,text),public.finance_refund_recheck(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.finance_refund_preview(uuid,numeric,numeric),public.finance_refund_resolve(uuid,uuid,text,numeric,numeric,text,text),public.finance_refund_recheck(uuid,uuid,text,text) to authenticated;
revoke all on all functions in schema finance_private from public,anon,authenticated,service_role;
