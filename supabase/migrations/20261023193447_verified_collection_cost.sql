-- Actual collection costs are proved before creating a new creator earning.
-- No historical share, withdrawal, execution gate or schedule is repriced.
create table finance_private.collection_receipts (
 id uuid primary key default gen_random_uuid(), environment text not null check(environment in ('sandbox','live')),
 sender text not null, kind text not null check(kind in ('capture','sale')), reference text not null,
 gross numeric(12,2) not null check(gross>0), fee numeric(12,2) not null check(fee>=0 and fee<=gross),
 order_id text, subscription_id text, payment_kind text not null, payer_id uuid, creator_profile_id text,
 proof jsonb not null, created_at timestamptz not null default now(),
 unique(kind,reference)
);
alter table finance_private.collection_receipts enable row level security;
revoke all on finance_private.collection_receipts from public,anon,authenticated,service_role;
create trigger collection_receipt_immutable before update or delete on finance_private.collection_receipts
 for each row execute function finance_private.immutable();
alter table public.transactions add column collection_fee_receipt uuid references finance_private.collection_receipts(id),
 add column collection_fee_status text not null default 'estimated' check(collection_fee_status in ('estimated','verified','not_applicable'));
alter table public.transactions add constraint collection_receipt_status check ((collection_fee_status='verified')=(collection_fee_receipt is not null));
create index transactions_collection_receipt on public.transactions(collection_fee_receipt) where collection_fee_receipt is not null;

-- No numeric coercion of null, empty strings, negative values or other currencies.
create function finance_private.collection_money(p_money jsonb,p_currency text default 'currency_code') returns numeric
language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p_money) is distinct from 'object' or p_money->>p_currency is distinct from 'USD'
  or coalesce(p_money->>'value','') !~ '^[0-9]{1,10}([.][0-9]{1,2})?$' then
  raise exception 'COLLECTION_FEE_INVALID';end if;
 return (p_money->>'value')::numeric;
end$$;

create function finance_private.prepare_collection(p_event uuid,p_kind text,p_ref text,p_gross numeric,p_proof jsonb) returns text
language plpgsql set search_path='' as $$
declare e finance_private.income_events;r finance_private.collection_receipts;existing finance_private.collection_receipts;
 resource jsonb:=p_proof->'resource';breakdown jsonb;fee numeric;other_fee numeric;net numeric;entry jsonb;
 o public.paypal_orders;s public.paypal_subscriptions;old_sale public.transactions;entry_count integer;order_capture jsonb;
begin
 perform set_config('fansreserve.collection_receipt','',true);
 select * into e from finance_private.income_events where id=p_event;
 if e.id is null or e.state<>'processing' or e.lease_until<=now() or resource->>'id' is distinct from p_ref then return 'COLLECTION_FEE_INVALID';end if;
 if p_kind='capture' then
  select * into o from public.paypal_orders where id=p_proof#>>'{order,id}';
  breakdown:=resource->'seller_receivable_breakdown';
  if breakdown->'paypal_fee' is null or breakdown->'paypal_fee'='null'::jsonb then return 'COLLECTION_FEE_MISSING';end if;
  fee:=finance_private.collection_money(breakdown->'paypal_fee');
  select cap into order_capture from jsonb_array_elements(p_proof#>'{order,purchase_units}') unit,
   jsonb_array_elements(unit#>'{payments,captures}') cap where cap->>'id'=p_ref limit 1;
  if order_capture#>'{seller_receivable_breakdown,paypal_fee}' is not null and
   finance_private.collection_money(order_capture#>'{seller_receivable_breakdown,paypal_fee}')<>fee then return 'COLLECTION_FEE_CONFLICT';end if;
  if breakdown ? 'gross_amount' and finance_private.collection_money(breakdown->'gross_amount')<>p_gross then return 'COLLECTION_FEE_INVALID';end if;
  if breakdown ? 'net_amount' and finance_private.collection_money(breakdown->'net_amount')<>p_gross-fee then return 'COLLECTION_FEE_INVALID';end if;
  if breakdown ? 'paypal_fee_in_receivable_currency' and finance_private.collection_money(breakdown->'paypal_fee_in_receivable_currency')<>fee then return 'COLLECTION_FEE_INVALID';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(breakdown->'platform_fees','[]')) x where finance_private.collection_money(x->'amount')<>0) then return 'COLLECTION_FEE_INVALID';end if;
  if o.id is null or o.amount<>p_gross then return 'COLLECTION_FEE_INVALID';end if;
  r.order_id:=o.id;r.payment_kind:=o.kind;r.payer_id:=o.user_id;
  r.creator_profile_id:=case when o.kind='booking' then (select creator_profile_id from public.vip_bookings where id=(o.params->>'bookingId')::uuid) else o.params->>'creatorProfileId' end;
 else
  select * into s from public.paypal_subscriptions where id=e.body#>>'{resource,billing_agreement_id}';
  if s.id is null or s.amount<>p_gross then return 'COLLECTION_FEE_INVALID';end if;
  r.subscription_id:=s.id;r.payment_kind:='subscription';r.payer_id:=s.user_id;r.creator_profile_id:=s.creator_id;
  if resource ? 'transaction_fee' and resource->'transaction_fee'<>'null'::jsonb then fee:=finance_private.collection_money(resource->'transaction_fee','currency');end if;
  select count(*) into entry_count from jsonb_array_elements(coalesce(p_proof#>'{subscription_transactions,transactions}','[]')) x where x->>'id'=p_ref;
  if entry_count>1 then return 'COLLECTION_FEE_INVALID';end if;
  select x into entry from jsonb_array_elements(coalesce(p_proof#>'{subscription_transactions,transactions}','[]')) x where x->>'id'=p_ref;
  if entry is not null then
   if entry->>'status' is distinct from 'COMPLETED' or finance_private.collection_money(entry#>'{amount_with_breakdown,gross_amount}')<>p_gross then return 'COLLECTION_FEE_INVALID';end if;
   if entry#>'{amount_with_breakdown,fee_amount}' is not null and entry#>'{amount_with_breakdown,fee_amount}'<>'null'::jsonb then
    other_fee:=finance_private.collection_money(entry#>'{amount_with_breakdown,fee_amount}');
    if fee is not null and fee<>other_fee then return 'COLLECTION_FEE_CONFLICT';end if;fee:=other_fee;
   end if;
   if fee is not null and entry#>'{amount_with_breakdown,net_amount}' is not null and finance_private.collection_money(entry#>'{amount_with_breakdown,net_amount}')<>p_gross-fee then return 'COLLECTION_FEE_INVALID';end if;
  end if;
  if resource ? 'receivable_amount' and fee is not null and finance_private.collection_money(resource->'receivable_amount','currency')<>p_gross-fee then return 'COLLECTION_FEE_INVALID';end if;
  if fee is null then return 'COLLECTION_FEE_MISSING';end if;
 end if;
 if fee<0 or fee>p_gross then return 'COLLECTION_FEE_INVALID';end if;
 insert into finance_private.collection_receipts(environment,sender,kind,reference,gross,fee,order_id,subscription_id,payment_kind,payer_id,creator_profile_id,proof)
 values(e.environment,e.sender,p_kind,p_ref,p_gross,fee,r.order_id,r.subscription_id,r.payment_kind,r.payer_id,r.creator_profile_id,p_proof) on conflict do nothing;
 select * into existing from finance_private.collection_receipts where kind=p_kind and reference=p_ref;
 if (existing.environment,existing.sender,existing.gross,existing.fee,existing.order_id,existing.subscription_id,existing.payment_kind,existing.payer_id,existing.creator_profile_id)
  is distinct from (e.environment,e.sender,p_gross,fee,r.order_id,r.subscription_id,r.payment_kind,r.payer_id,r.creator_profile_id) then return 'COLLECTION_FEE_CONFLICT';end if;
 -- A later receipt never rewrites historical earnings, bonuses or refund bases.
 for old_sale in select * from public.transactions t where t.kind<>'referral' and
  (t.paypal_ref=p_ref or (t.key like 'paypal-sub:%' and split_part(t.key,':',3)=p_ref)) loop
  if old_sale.amount<>p_gross or old_sale.gateway_fee is distinct from fee then return 'COLLECTION_FEE_HISTORICAL_DIFFERENCE';end if;
 end loop;
 perform set_config('fansreserve.collection_receipt',existing.id::text,true);
 return null;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then return 'COLLECTION_FEE_INVALID';
 when raise_exception then if SQLERRM='COLLECTION_FEE_INVALID' then return 'COLLECTION_FEE_INVALID';else raise;end if;
end$$;

create function finance_private.stamp_collection_fee() returns trigger language plpgsql security definer set search_path='' as $$
declare r finance_private.collection_receipts;receipt_id uuid;
begin
 new.collection_fee_receipt:=null;new.collection_fee_status:=case when new.kind in ('tip','subscription','renewal','vip') then 'estimated' else 'not_applicable' end;
 if new.kind not in ('tip','subscription','renewal','vip') then return new;end if;
 receipt_id:=nullif(current_setting('fansreserve.collection_receipt',true),'')::uuid;
 if receipt_id is null then return new;end if;
 select * into r from finance_private.collection_receipts where id=receipt_id;
 if r.id is null or r.gross<>new.amount or r.payer_id is distinct from new.payer_id or r.creator_profile_id is distinct from new.creator_profile_id
  or not ((r.payment_kind='tip' and new.kind='tip') or (r.payment_kind='booking' and new.kind='vip' and new.key='vip:'||(select params->>'bookingId' from public.paypal_orders where id=r.order_id))
  or (r.payment_kind='subscription' and new.kind in ('subscription','renewal') and new.key='paypal-sub:'||r.subscription_id||':'||r.reference)) then raise exception 'COLLECTION_FEE_INVALID';end if;
 new.collection_fee_receipt:=r.id;new.collection_fee_status:='verified';new.gateway_fee:=r.fee;new.paypal_ref:=r.reference;
 return new;
end$$;
create trigger a_collection_fee before insert on public.transactions for each row execute function finance_private.stamp_collection_fee();

-- Preserve the agreed levels, referral rewards, Reserve discount and service/tax formulas.
do $$declare d text;fn text;begin
 foreach fn in array array['public.set_reward_share()','public.set_special_share()'] loop
  d:=pg_get_functiondef(fn::regprocedure);
  if position('v_fee := public.sale_gateway_fee(new.kind, new.key, new.amount);' in d)=0 then raise exception 'Revisar el reparto antes de instalar el costo comprobado';end if;
  execute replace(d,'v_fee := public.sale_gateway_fee(new.kind, new.key, new.amount);',
   'v_fee := case when new.collection_fee_status=''verified'' then new.gateway_fee else public.sale_gateway_fee(new.kind, new.key, new.amount) end;');
 end loop;
 d:=pg_get_functiondef('public.paypal_income_apply(uuid,uuid,jsonb)'::regprocedure);
 d:=replace(d,E'\r\n',E'\n');
 if position('reply:=public.paypal_subscription_payment(s.id,ref,amount);' in d)=0 or position('perform public.paypal_fulfill(o.id,o.user_id,ref,amount);' in d)=0 then raise exception 'Revisar la conciliación antes de instalar el costo comprobado';end if;
 d:=replace(d,'  begin'||chr(10)||'   if sub->>''status''=''ACTIVE'' then',
 $sale$  reason:=finance_private.prepare_collection(e.id,'sale',ref,amount,p_proof);
  if reason is not null then
   perform finance_private.income_hold(e.id,ref,'Falta comprobar el costo de PayPal de este cobro');
   if reason='COLLECTION_FEE_MISSING' then return public.paypal_income_retry(p_id,p_token,p_proof,reason);else return finance_private.income_review(p_id,reason);end if;
  end if;
  begin
   if sub->>'status'='ACTIVE' then$sale$);
 d:=replace(d,'  if o.status=''created'' then',
 $capture$  reason:=finance_private.prepare_collection(e.id,'capture',ref,amount,p_proof);
  if reason is not null then
   perform finance_private.income_hold(e.id,ref,'Falta comprobar el costo de PayPal de este cobro');
   if reason='COLLECTION_FEE_MISSING' then return public.paypal_income_retry(p_id,p_token,p_proof,reason);else return finance_private.income_review(p_id,reason);end if;
  end if;
  if o.status='created' then$capture$);
 if position('prepare_collection(e.id,''sale''' in d)=0 or position('prepare_collection(e.id,''capture''' in d)=0 then raise exception 'No se instaló la comprobación del costo';end if;
 d:=replace(d,'reply:=public.paypal_subscription_payment(s.id,ref,amount);','reply:=public.paypal_subscription_payment(s.id,ref,amount); perform set_config(''fansreserve.collection_receipt'','''',true);');
 d:=replace(d,'perform public.paypal_fulfill(o.id,o.user_id,ref,amount);','perform public.paypal_fulfill(o.id,o.user_id,ref,amount); perform set_config(''fansreserve.collection_receipt'','''',true);');
 d:=replace(d,' return v_result;', ' perform set_config(''fansreserve.collection_receipt'','''',true); return v_result;');
 execute d;
end$$;
create function finance_private.collection_basis_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.collection_fee_receipt,new.collection_fee_status) is distinct from (old.collection_fee_receipt,old.collection_fee_status) then raise exception 'El comprobante se asigna al registrar el cobro; conservar el original';end if;
 if old.collection_fee_status='verified' then
  if (new.gateway_fee,new.amount,new.creator_share,new.key,new.paypal_ref,new.creator_profile_id,new.created_at,new.service_fee,new.tax_amount)
   is distinct from (old.gateway_fee,old.amount,old.creator_share,old.key,old.paypal_ref,old.creator_profile_id,old.created_at,old.service_fee,old.tax_amount)
   or (new.payer_id is distinct from old.payer_id and not(new.payer_id is null and not exists(select 1 from public.profiles where id=old.payer_id))) then
   raise exception 'Conservar el cobro y costo comprobados; registrar correcciones por separado';end if;
 end if;
 return new;
end$$;
create trigger collection_basis_guard before update on public.transactions for each row execute function finance_private.collection_basis_guard();
revoke all on function finance_private.collection_money(jsonb,text),finance_private.prepare_collection(uuid,text,text,numeric,jsonb),
 finance_private.stamp_collection_fee(),finance_private.collection_basis_guard() from public,anon,authenticated,service_role;
