-- Cost-only reconciliation. Never sends money or reprices an original sale.
alter table public.coin_purchases add column gateway_fee numeric(12,2),
 add column collection_fee_receipt uuid references finance_private.collection_receipts(id),
 add column collection_fee_status text not null default 'estimated' check(collection_fee_status in('estimated','verified'));
alter table public.coin_purchases add constraint coin_collection_cost_bounds check(gateway_fee is null or(gateway_fee>=0 and gateway_fee<=price and gateway_fee::text<>'NaN')),
 add constraint coin_collection_receipt_status check((collection_fee_status='verified')=(collection_fee_receipt is not null));
create index coin_collection_receipt on public.coin_purchases(collection_fee_receipt)where collection_fee_receipt is not null;
create function finance_private.stamp_coin_collection()returns trigger language plpgsql security definer set search_path=''as $$
declare r finance_private.collection_receipts;
begin
 new.gateway_fee:=null;new.collection_fee_receipt:=null;new.collection_fee_status:='estimated';
 select * into r from finance_private.collection_receipts where id=nullif(current_setting('fansreserve.collection_receipt',true),'')::uuid;
 if r.id is null then return new;end if;
 if r.kind<>'capture'or r.payment_kind<>'coins'or r.gross<>new.price or r.payer_id is distinct from new.user_id
  or not exists(select 1 from public.paypal_orders o where o.id=r.order_id and o.user_id=new.user_id and o.kind='coins'and o.params->>'packId'=new.pack_id and o.amount=new.price)then raise exception 'COLLECTION_FEE_INVALID';end if;
 new.gateway_fee:=r.fee;new.collection_fee_receipt:=r.id;new.collection_fee_status:='verified';return new;
end$$;
create trigger a_coin_collection before insert on public.coin_purchases for each row execute function finance_private.stamp_coin_collection();
create function finance_private.coin_collection_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if(new.gateway_fee,new.collection_fee_receipt,new.collection_fee_status)is distinct from(old.gateway_fee,old.collection_fee_receipt,old.collection_fee_status)
  or(old.collection_fee_status='verified'and(new.price,new.coins,new.pack_id,new.paypal_ref,new.created_at)is distinct from(old.price,old.coins,old.pack_id,old.paypal_ref,old.created_at))then
  raise exception 'Conservar la compra y su costo originales; registrar diferencias por separado';end if;return new;
end$$;
create trigger coin_collection_guard before update on public.coin_purchases for each row execute function finance_private.coin_collection_guard();

create table finance_private.collection_cost_queries(
 request_key uuid primary key,kind text not null check(kind in('coins','sale')),source_id uuid not null,source_hash text not null,
 environment text not null check(environment in('sandbox','live')),sender text not null,proof jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),sequence bigint generated always as identity unique
);
create index collection_cost_query_source on finance_private.collection_cost_queries(kind,source_id,sequence desc);
create table finance_private.collection_cost_resolutions(
 id uuid primary key default gen_random_uuid(),request_key uuid not null unique,kind text not null check(kind in('coins','sale')),
 source_id uuid not null,receipt_id uuid not null references finance_private.collection_receipts(id),expected_hash text not null,
 before_snapshot jsonb not null,actual_fee numeric(12,2)not null,comparison_fee numeric(12,2),
 creator_credit numeric(12,2)not null check(creator_credit>=0),adjustment_id uuid references public.finance_adjustments(id),
 platform_extra_cost numeric(12,2)not null check(platform_extra_cost>=0),evidence text not null,reason text not null,actor uuid not null,
 created_at timestamptz not null default now(),unique(kind,source_id)
);
create index collection_cost_resolution_receipt on finance_private.collection_cost_resolutions(receipt_id);
create index collection_cost_resolution_adjustment on finance_private.collection_cost_resolutions(adjustment_id)where adjustment_id is not null;
create table finance_private.collection_credit_updates(
 resolution_id uuid not null references finance_private.collection_cost_resolutions(id),revision bigint not null,
 delta numeric(12,2)not null,remaining_credit numeric(12,2)not null check(remaining_credit>=0),
 adjustment_id uuid not null unique references public.finance_adjustments(id),snapshot jsonb not null,
 created_at timestamptz not null default now(),primary key(resolution_id,revision)
);
alter table finance_private.collection_credit_updates enable row level security;
revoke all on finance_private.collection_credit_updates from public,anon,authenticated,service_role;
create trigger collection_credit_update_immutable before update or delete on finance_private.collection_credit_updates for each row execute function finance_private.immutable();
alter table finance_private.collection_cost_queries enable row level security;alter table finance_private.collection_cost_resolutions enable row level security;
revoke all on finance_private.collection_cost_queries,finance_private.collection_cost_resolutions from public,anon,authenticated,service_role;
create trigger collection_cost_query_immutable before update or delete on finance_private.collection_cost_queries for each row execute function finance_private.immutable();
create trigger collection_cost_resolution_immutable before update or delete on finance_private.collection_cost_resolutions for each row execute function finance_private.immutable();

-- Follow explicit human reversals, including a reversal of a reversal. They
-- remain in the books but require review before an automatic linked update.
create function finance_private.collection_manual_changes(p_resolution uuid)returns table(id uuid,amount numeric)
language sql stable set search_path=''as $$
 with recursive linked(id,amount)as(
  select a.id,a.amount from public.finance_adjustments a join finance_private.collection_credit_updates u on u.adjustment_id=a.id where u.resolution_id=p_resolution
  union
  select a.id,a.amount from public.finance_adjustments a join linked parent on a.reverses=parent.id
 )select l.id,l.amount from linked l where not exists(select 1 from finance_private.collection_credit_updates u where u.adjustment_id=l.id and u.resolution_id=p_resolution);
$$;
create function finance_private.hold_collection_manual_change()returns trigger language plpgsql security definer set search_path=''as $$
declare d finance_private.collection_cost_resolutions;
begin
 if new.reverses is null then return null;end if;
 for d in select r.*from finance_private.collection_cost_resolutions r where exists(select 1 from finance_private.collection_manual_changes(r.id)m where m.id=new.id)loop
  perform finance_private.place_hold(new.user_id,'safety','collection-cost/'||d.id,'Hay una reversión manual del abono de costo. Revisar el historial antes de volver a modificarlo.');
 end loop;return null;
end$$;
create trigger collection_cost_manual_change after insert on public.finance_adjustments for each row execute function finance_private.hold_collection_manual_change();

-- No historic row is stamped as verified retroactively. A later proof is an overlay.
create view finance_private.collection_cost_sources as
 select 'coins'::text as kind,c.id,c.created_at,c.price as gross,c.gateway_fee as recorded_fee,c.collection_fee_status,c.paypal_ref as reference,
 c.user_id as payer_id,null::text as creator_profile_id,'Compra de Créditos'::text as creator,c.status,to_jsonb(c)as original
 from public.coin_purchases c
 union all
 select 'sale',t.id,t.created_at,t.amount,t.gateway_fee,t.collection_fee_status,coalesce(t.paypal_ref,case when t.key like 'paypal-sub:%'then split_part(t.key,':',3)end),
 t.payer_id,t.creator_profile_id,t.creator_name,t.status,to_jsonb(t)from public.transactions t where t.kind in('tip','subscription','renewal','vip');
revoke all on finance_private.collection_cost_sources from public,anon,authenticated,service_role;

create function finance_private.collection_cost_context(p_kind text,p_id uuid)returns jsonb language plpgsql stable set search_path=''as $$
declare s finance_private.collection_cost_sources;o public.paypal_orders;sub public.paypal_subscriptions;receipt_kind text:='capture';
begin
 select * into s from finance_private.collection_cost_sources where kind=p_kind and id=p_id;
 if s.id is null then return jsonb_build_object('issue','No encontramos ese cobro.');end if;
 if coalesce(s.reference,'')!~'^[A-Za-z0-9-]{1,255}$'then return jsonb_build_object('issue','Falta una referencia original válida de PayPal; requiere comprobantes históricos.');end if;
 if(select count(*)from finance_private.collection_cost_sources where reference=s.reference)<>1 then return jsonb_build_object('issue','La referencia corresponde a más de un cobro; requiere revisión.');end if;
 if s.original->>'key'like'paypal-sub:%'then
  receipt_kind:='sale';select * into sub from public.paypal_subscriptions where id=split_part(s.original->>'key',':',2);
  if sub.id is null or sub.user_id is distinct from s.payer_id or sub.creator_id is distinct from s.creator_profile_id or sub.amount<>s.gross then
   return jsonb_build_object('issue','Falta vincular el cobro con su suscripción original.');end if;
 else
  select * into o from public.paypal_orders where capture_id=s.reference and status in('completed','refunded');
  if o.id is null or o.user_id is distinct from s.payer_id or o.amount<>s.gross
   or(p_kind='coins'and(o.kind<>'coins'or o.params->>'packId'is distinct from s.original->>'pack_id'))
   or(p_kind='sale'and not((o.kind='tip'and s.original->>'kind'='tip'and o.params->>'creatorProfileId'=s.creator_profile_id)
    or(o.kind='booking'and s.original->>'kind'='vip'and s.original->>'key'='vip:'||(o.params->>'bookingId'))))then
   return jsonb_build_object('issue','Falta vincular el cobro con su pedido original; no se consultará una referencia ajena.');end if;
 end if;
 return jsonb_build_object('issue',null,'kind',p_kind,'id',p_id,'reference',s.reference,'gross',s.gross,'payer',s.payer_id,'creator',s.creator_profile_id,
  'receipt_kind',receipt_kind,'order',o.id,'subscription',sub.id,'payment_kind',case when p_kind='coins'then'coins'when receipt_kind='sale'then'subscription'else o.kind end,
  'hash',md5(s.original::text));
end$$;
create function public.finance_collection_context(p_kind text,p_id uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
begin perform finance_private.assert_admin();return finance_private.collection_cost_context(p_kind,p_id);end$$;

-- Called only by the server after authenticated GETs to fixed PayPal paths.
create function public.paypal_collection_cost_store(p_kind text,p_id uuid,p_key uuid,p_expected text,p_environment text,p_sender text,p_proof jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ctx jsonb;resource jsonb:=p_proof->'resource';entry jsonb;part jsonb;fee numeric;other_fee numeric;r finance_private.collection_receipts;
 q finance_private.collection_cost_queries;result jsonb;issue text;count_entries integer;
begin
 perform finance_private.lock_book();
 if p_key is null or p_environment not in('sandbox','live')or nullif(trim(p_sender),'')is null then raise exception 'Consulta de costo no válida';end if;
 select * into q from finance_private.collection_cost_queries where request_key=p_key;
 if q.request_key is not null then
  if(q.kind,q.source_id,q.environment,q.sender,q.source_hash)is distinct from(p_kind,p_id,p_environment,p_sender,p_expected)then raise exception 'Referencia de consulta reutilizada';end if;return q.result;end if;
 ctx:=finance_private.collection_cost_context(p_kind,p_id);
 if ctx->>'issue'is not null then return ctx;end if;
 if ctx->>'hash'is distinct from p_expected then return jsonb_build_object('issue','El cobro cambió durante la consulta; actualiza antes de continuar.');end if;
 begin
  if resource->>'id'is distinct from ctx->>'reference'then raise exception 'Comprobante de otro cobro';end if;
  if ctx->>'receipt_kind'='capture'then
   if coalesce(resource->>'status','')not in('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')or finance_private.collection_money(resource->'amount')<>(ctx->>'gross')::numeric
    or p_proof#>>'{order,id}'is distinct from ctx->>'order'then raise exception 'Pedido o importe incompatible';end if;
   select count(*)into count_entries from jsonb_array_elements(p_proof#>'{order,purchase_units}')u,jsonb_array_elements(u#>'{payments,captures}')c where c->>'id'=ctx->>'reference';
   select c into part from jsonb_array_elements(p_proof#>'{order,purchase_units}')u,jsonb_array_elements(u#>'{payments,captures}')c where c->>'id'=ctx->>'reference'limit 1;
   if count_entries<>1 or finance_private.collection_money(part->'amount')<>(ctx->>'gross')::numeric then raise exception 'Captura no vinculada al pedido';end if;
   fee:=finance_private.collection_money(resource#>'{seller_receivable_breakdown,paypal_fee}');
   if resource#>'{seller_receivable_breakdown,gross_amount}'is not null and finance_private.collection_money(resource#>'{seller_receivable_breakdown,gross_amount}')<>(ctx->>'gross')::numeric then raise exception 'Importe bruto incompatible';end if;
   if resource#>'{seller_receivable_breakdown,net_amount}'is not null and finance_private.collection_money(resource#>'{seller_receivable_breakdown,net_amount}')<>(ctx->>'gross')::numeric-fee then raise exception 'Importe recibido incompatible';end if;
   if part#>'{seller_receivable_breakdown,paypal_fee}'is not null and finance_private.collection_money(part#>'{seller_receivable_breakdown,paypal_fee}')<>fee then raise exception 'Dos costos distintos';end if;
   if resource#>'{seller_receivable_breakdown,paypal_fee_in_receivable_currency}'is not null and finance_private.collection_money(resource#>'{seller_receivable_breakdown,paypal_fee_in_receivable_currency}')<>fee then raise exception 'Conversión incompatible';end if;
   if exists(select 1 from jsonb_array_elements(coalesce(resource#>'{seller_receivable_breakdown,platform_fees}','[]'))x where finance_private.collection_money(x->'amount')<>0)then raise exception 'Comisiones multiparte requieren revisión';end if;
  else
   if coalesce(resource->>'state',resource->>'status','')not in('completed','partially_refunded','refunded')or resource#>>'{amount,currency}'is distinct from'USD'
    or coalesce(resource#>>'{amount,total}','')!~'^[0-9]{1,10}([.][0-9]{1,2})?$'or(resource#>>'{amount,total}')::numeric<>(ctx->>'gross')::numeric
    or p_proof#>>'{subscription,id}'is distinct from ctx->>'subscription'
    or p_proof#>>'{subscription,custom_id}'is distinct from(ctx->>'payer')||':'||(ctx->>'creator')then raise exception 'Venta no vinculada a su suscripción';end if;
   if resource->'transaction_fee'is not null and resource->'transaction_fee'<>'null'::jsonb then fee:=finance_private.collection_money(resource->'transaction_fee','currency');end if;
   select count(*)into count_entries from jsonb_array_elements(coalesce(p_proof#>'{subscription_transactions,transactions}','[]'))x where x->>'id'=ctx->>'reference';
   if count_entries>1 then raise exception 'Venta repetida en el historial';end if;
   select x into entry from jsonb_array_elements(coalesce(p_proof#>'{subscription_transactions,transactions}','[]'))x where x->>'id'=ctx->>'reference';
   if resource->>'billing_agreement_id'is distinct from ctx->>'subscription'and(resource->>'billing_agreement_id'is not null or entry is null)then raise exception 'Suscripción incompatible';end if;
   if entry is not null then
    if finance_private.collection_money(entry#>'{amount_with_breakdown,gross_amount}')<>(ctx->>'gross')::numeric then raise exception 'Historial de otro importe';end if;
    if entry#>'{amount_with_breakdown,fee_amount}'is not null then other_fee:=finance_private.collection_money(entry#>'{amount_with_breakdown,fee_amount}');if fee is not null and fee<>other_fee then raise exception 'Dos costos distintos';end if;fee:=other_fee;end if;
    if fee is not null and entry#>'{amount_with_breakdown,net_amount}'is not null and finance_private.collection_money(entry#>'{amount_with_breakdown,net_amount}')<>(ctx->>'gross')::numeric-fee then raise exception 'Neto incompatible';end if;
   end if;
   if resource->'receivable_amount'is not null and fee is not null and finance_private.collection_money(resource->'receivable_amount','currency')<>(ctx->>'gross')::numeric-fee then raise exception 'Neto incompatible';end if;
  end if;
  if fee is null or fee<0 or fee>(ctx->>'gross')::numeric then raise exception 'Falta un costo válido de PayPal';end if;
 exception when raise_exception or invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then issue:='El comprobante no permite confirmar el costo: '||sqlerrm;end;
 if issue is null then
  insert into finance_private.collection_receipts(environment,sender,kind,reference,gross,fee,order_id,subscription_id,payment_kind,payer_id,creator_profile_id,proof)
  values(p_environment,p_sender,ctx->>'receipt_kind',ctx->>'reference',(ctx->>'gross')::numeric,fee,ctx->>'order',ctx->>'subscription',ctx->>'payment_kind',(ctx->>'payer')::uuid,ctx->>'creator',p_proof)on conflict do nothing;
  select * into r from finance_private.collection_receipts where kind=ctx->>'receipt_kind'and reference=ctx->>'reference';
  if(r.environment,r.sender,r.gross,r.fee,r.order_id,r.subscription_id,r.payment_kind,r.payer_id,r.creator_profile_id)is distinct from
   (p_environment,p_sender,(ctx->>'gross')::numeric,fee,ctx->>'order',ctx->>'subscription',ctx->>'payment_kind',(ctx->>'payer')::uuid,ctx->>'creator')then issue:='El costo difiere de un comprobante conservado. Requiere revisión; no se reemplazó.';end if;
 end if;
 result:=jsonb_build_object('issue',issue,'receipt',case when issue is null then r.id end);
 insert into finance_private.collection_cost_queries(request_key,kind,source_id,source_hash,environment,sender,proof,result)values(p_key,p_kind,p_id,p_expected,p_environment,p_sender,p_proof,result);return result;
end$$;

create function finance_private.collection_cost_receipt(p_kind text,p_id uuid)returns finance_private.collection_receipts language sql stable set search_path=''as $$
 select r from finance_private.collection_cost_sources s join finance_private.collection_receipts r on r.reference=s.reference and r.gross=s.gross
  and r.payer_id is not distinct from s.payer_id and r.creator_profile_id is not distinct from s.creator_profile_id
  and((p_kind='coins'and r.kind='capture'and r.payment_kind='coins')or(p_kind='sale'and r.kind=case when s.original->>'key'like'paypal-sub:%'then'sale'else'capture'end
   and((r.payment_kind='tip'and s.original->>'kind'='tip')or(r.payment_kind='booking'and s.original->>'kind'='vip')or(r.payment_kind='subscription'and s.original->>'kind'in('subscription','renewal')))))where s.kind=p_kind and s.id=p_id;
$$;

create function finance_private.collection_cost_plan(p_kind text,p_id uuid)returns jsonb language plpgsql stable set search_path=''as $$
declare s finance_private.collection_cost_sources;r finance_private.collection_receipts;d finance_private.collection_cost_resolutions;
 t public.transactions;baseline numeric;ratio numeric;credit numeric:=0;who uuid;issue text;v jsonb;last_issue text;
begin
 select * into s from finance_private.collection_cost_sources where kind=p_kind and id=p_id;
 if s.id is null then return jsonb_build_object('issue','No encontramos ese cobro.');end if;
 r:=finance_private.collection_cost_receipt(p_kind,p_id);select * into d from finance_private.collection_cost_resolutions where kind=p_kind and source_id=p_id;
 select result->>'issue'into last_issue from finance_private.collection_cost_queries where kind=p_kind and source_id=p_id order by sequence desc limit 1;
 baseline:=case when p_kind='coins'then coalesce(s.recorded_fee,public.gateway_fee_estimate(s.gross))else s.recorded_fee end;
 if r.id is null then issue:='Falta consultar y comprobar el costo original de PayPal.';
 elsif d.id is null and s.collection_fee_status<>'verified'and p_kind='sale'then
  select * into t from public.transactions where id=p_id;
  if t.status<>'paid'or t.refunded_amount<>0 or t.creator_refund_loss<>0 or exists(select 1 from finance_private.income_disputes where payment_ref=s.reference)then
   issue:='La venta tiene devolución, disputa o historial especial; revisa su expediente antes de ajustar el costo.';
  elsif r.fee<baseline and exists(select 1 from public.transactions where kind='referral'and key='bonus:'||t.id::text)then
   issue:='La venta tiene una bonificación por invitación. Hay que revisar su límite e historial; no se recalculará automáticamente.';
  elsif baseline is null or baseline::text='NaN'or baseline<0 or t.amount-baseline-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0)<=0 then
   issue:='Falta la base de costo original; no se puede inventar lo que se descontó al creador.';
  else
   ratio:=t.amount*t.creator_share/(t.amount-baseline-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0));
   if ratio is null or ratio<0 or ratio>1 or ratio::text='NaN'or t.amount-r.fee-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0)<0 then issue:='El reparto original requiere revisar su contrato.';
   else credit:=round(greatest(0,baseline-r.fee)*ratio,2);end if;
   if credit>0 then
    select id into who from public.profiles where creator_profile_id=s.creator_profile_id and role='creator';
    if(select count(*)from public.profiles where creator_profile_id=s.creator_profile_id and role='creator')<>1 then issue:='Revisa quién es el propietario del saldo antes de abonarlo.';end if;
   end if;
  end if;
 end if;
 if d.id is null and last_issue is not null then issue:='Falta aclarar el último comprobante consultado: '||last_issue;end if;
 if s.reference is not null and(select count(*)from finance_private.collection_cost_sources where reference=s.reference)<>1 then issue:='La referencia corresponde a más de un cobro; revisa el historial antes de abonar.';end if;
 if d.id is null and exists(select 1 from public.finance_adjustments where reference='COBRO/'||p_id::text)then issue:='Ya existe una corrección con esta referencia; revisa el historial antes de abonar otra vez.';end if;
 if credit>100000 then issue:='El abono supera el límite de una corrección supervisada; requiere revisión contable.';end if;
 if d.id is not null and exists(select 1 from finance_private.collection_manual_changes(d.id))then issue:='Este abono tiene una reversión manual. Revisa sus correcciones y el bloqueo antes de continuar.';end if;
 v:=jsonb_build_object('issue',issue,'kind',p_kind,'id',p_id,'reference',s.reference,'creator',s.creator,'gross',s.gross,'recorded_fee',s.recorded_fee,
  'comparison_fee',baseline,'comparison_is_estimate',p_kind='coins'and s.recorded_fee is null,'actual_fee',r.fee,'receipt',r.id,
  'fee_difference',r.fee-baseline,'creator_credit',credit,'creator_user',who,'original_ratio',ratio,
  'platform_extra_cost',greatest(0,r.fee-baseline),'needs_resolution',d.id is null and s.collection_fee_status<>'verified',
  'resolution',d.id,'adjustment',d.adjustment_id,'resolved_credit',d.creator_credit,'resolved_at',d.created_at,
  'active_credit',case when d.id is null then null else coalesce((select remaining_credit from finance_private.collection_credit_updates where resolution_id=d.id order by revision desc limit 1),d.creator_credit)+coalesce((select sum(amount)from finance_private.collection_manual_changes(d.id)),0)end);
 return v||jsonb_build_object('hash',md5((s.original||v)::text));
end$$;
create function public.finance_collection_preview(p_kind text,p_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform finance_private.assert_admin();perform finance_private.lock_book();return finance_private.collection_cost_plan(p_kind,p_id);end$$;
create function public.finance_collection_resolve(p_kind text,p_id uuid,p_key uuid,p_expected text,p_evidence text,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare v jsonb;d finance_private.collection_cost_resolutions;adjustment uuid;source jsonb;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or length(trim(coalesce(p_evidence,'')))not between 10 and 1000 or length(trim(coalesce(p_reason,'')))not between 20 and 2000 then raise exception 'Documenta los comprobantes y el motivo de esta conciliación';end if;
 select * into d from finance_private.collection_cost_resolutions where request_key=p_key;
 if d.id is not null then
  if(d.kind,d.source_id,d.expected_hash,d.evidence,d.reason)is distinct from(p_kind,p_id,p_expected,trim(p_evidence),trim(p_reason))then raise exception 'Referencia de decisión reutilizada';end if;return jsonb_build_object('id',d.id,'adjustment',d.adjustment_id);end if;
 v:=finance_private.collection_cost_plan(p_kind,p_id);
 if v->>'issue'is not null then raise exception '%',v->>'issue';end if;
 if not(v->>'needs_resolution')::boolean or v->>'resolution'is not null then raise exception 'El costo ya está comprobado o conciliado';end if;
 if p_expected is null or v->>'hash'is distinct from p_expected then raise exception 'El cobro o sus comprobantes cambiaron; actualiza la vista previa';end if;
 select original into source from finance_private.collection_cost_sources where kind=p_kind and id=p_id;
 source:=source||jsonb_build_object('income_rechecks',coalesce((select jsonb_agg(to_jsonb(e)order by e.id)from finance_private.income_events e join finance_private.collection_receipts receipt on receipt.id=(v->>'receipt')::uuid
  where e.state='review'and e.reason='COLLECTION_FEE_HISTORICAL_DIFFERENCE'and e.environment=receipt.environment and e.sender=receipt.sender and e.body#>>'{resource,id}'=receipt.reference),'[]'));
 if(v->>'creator_credit')::numeric>0 then
  adjustment:=(public.finance_creator_adjust((v->>'creator_user')::uuid,(v->>'creator_credit')::numeric,'Costo de cobro comprobado; devolución de estimación excesiva. '||trim(p_reason),gen_random_uuid(),'COBRO/'||p_id::text,null)->>'id')::uuid;
 end if;
 insert into finance_private.collection_cost_resolutions(request_key,kind,source_id,receipt_id,expected_hash,before_snapshot,actual_fee,comparison_fee,creator_credit,adjustment_id,platform_extra_cost,evidence,reason,actor)
 values(p_key,p_kind,p_id,(v->>'receipt')::uuid,p_expected,source||jsonb_build_object('preview',v),(v->>'actual_fee')::numeric,(v->>'comparison_fee')::numeric,(v->>'creator_credit')::numeric,adjustment,(v->>'platform_extra_cost')::numeric,trim(p_evidence),trim(p_reason),auth.uid())returning * into d;
 if adjustment is not null then insert into finance_private.collection_credit_updates(resolution_id,revision,delta,remaining_credit,adjustment_id,snapshot)
  values(d.id,1,d.creator_credit,d.creator_credit,adjustment,source);end if;
 -- Recheck only the matching historical-cost notices. Do not release a hold,
 -- finish a payment, or acknowledge another kind of inconsistent event.
 update finance_private.income_events set state='pending',reason=null,attempts=0,next_attempt_at=now(),lease_token=null,lease_until=null
 where id in(select(x->>'id')::uuid from jsonb_array_elements(source->'income_rechecks')x)
  and state='review'and reason='COLLECTION_FEE_HISTORICAL_DIFFERENCE';
 return jsonb_build_object('id',d.id,'adjustment',d.adjustment_id);
end$$;

-- The additional earning follows its sale. A later refund/dispute cannot leave
-- an orphan credit. Deferred until all refund components are persisted.
create function finance_private.sync_collection_credit()returns trigger language plpgsql security definer set search_path=''as $$
declare d finance_private.collection_cost_resolutions;t public.transactions;last_credit finance_private.collection_credit_updates;
 original_adjustment public.finance_adjustments;a public.finance_adjustments;new_source uuid;
 wanted numeric;original_gain numeric;new_gain numeric;old_current numeric;refund_core numeric;ratio numeric;service_back numeric;tax_back numeric;delta numeric;
begin
 select * into d from finance_private.collection_cost_resolutions where kind='sale'and source_id=coalesce(new.id,old.id);
 if d.id is null then return null;end if;perform finance_private.lock_book();select * into t from public.transactions where id=d.source_id;
 if t.id is null or jsonb_build_array(t.amount,t.creator_share,t.gateway_fee,t.key,t.paypal_ref,t.creator_profile_id,t.created_at,t.service_fee,t.tax_amount)is distinct from
  jsonb_build_array((d.before_snapshot->>'amount')::numeric,(d.before_snapshot->>'creator_share')::numeric,(d.before_snapshot->>'gateway_fee')::numeric,d.before_snapshot->>'key',d.before_snapshot->>'paypal_ref',d.before_snapshot->>'creator_profile_id',(d.before_snapshot->>'created_at')::timestamptz,(d.before_snapshot->>'service_fee')::numeric,(d.before_snapshot->>'tax_amount')::numeric)then raise exception 'Conservar la base original de la venta conciliada';end if;
 if d.creator_credit=0 then return null;end if;
 select * into original_adjustment from public.finance_adjustments where id=d.adjustment_id;
 select * into last_credit from finance_private.collection_credit_updates where resolution_id=d.id order by revision desc limit 1;
 if exists(select 1 from finance_private.collection_manual_changes(d.id))then
  perform finance_private.place_hold(original_adjustment.user_id,'safety','collection-cost/'||d.id,'Hay una reversión manual del abono de costo. Revisar antes de volver a modificarlo.');return null;end if;
 ratio:=(d.before_snapshot#>>'{preview,original_ratio}')::numeric;
 if t.platform_covers and t.status in('paid','refunded','disputed')then wanted:=d.creator_credit;
 elsif t.status in('failed','refunded','disputed')then wanted:=0;
 elsif t.status='paid'and t.refunded_amount=0 then wanted:=d.creator_credit;
 else
  service_back:=0;tax_back:=0;
  if coalesce(t.service_fee,0)<>0 or coalesce(t.tax_amount,0)<>0 then
   select (result->>'service_refund')::numeric,(result->>'tax_refund')::numeric into service_back,tax_back from public.finance_case_actions
    where action='refund_resolution'and result->>'payment_ref'=coalesce(t.paypal_ref,case when t.key like'paypal-sub:%'then split_part(t.key,':',3)end)
    and(result->>'refunded_amount')::numeric=t.refunded_amount order by sequence desc limit 1;
   if service_back is null or tax_back is null then
    perform finance_private.place_hold(original_adjustment.user_id,'safety','collection-cost/'||d.id,'Falta el desglose de la devolución para revisar el abono del costo.');return null;end if;
  end if;
  original_gain:=round(t.amount*t.creator_share,2);old_current:=greatest(0,round(original_gain-t.creator_refund_loss,2));
  refund_core:=t.refunded_amount-t.refunded_gateway_fee-service_back-tax_back;
  new_gain:=greatest(0,round((t.amount-d.actual_fee-coalesce(t.service_fee,0)-coalesce(t.tax_amount,0)-refund_core)*ratio,2));
  wanted:=least(d.creator_credit,greatest(0,new_gain-old_current));
 end if;
 delta:=wanted-last_credit.remaining_credit;if delta=0 then return null;end if;
 insert into public.finance_adjustments(request_key,user_id,creator_profile_id,amount,eligible_at,reason,reference,created_by)
 values(gen_random_uuid(),original_adjustment.user_id,original_adjustment.creator_profile_id,delta,original_adjustment.eligible_at,
  'El abono por costo de cobro sigue el resultado de su venta; resolución '||d.id,'COBRO/'||d.source_id||'/'||(last_credit.revision+1),d.actor)returning * into a;
 insert into public.finance_sources(creator_profile_id,kind,reference,amount,eligible_at,revision,snapshot)
 values(a.creator_profile_id,'adjustment',a.id::text,a.amount,a.eligible_at,1,to_jsonb(a))returning id into new_source;
 insert into public.finance_source_revisions(source_id,revision,before_amount,after_amount,before_eligible_at,after_eligible_at,snapshot)
 values(new_source,1,0,a.amount,a.eligible_at,a.eligible_at,to_jsonb(a));
 perform finance_private.post('adjustment/'||a.id,a.creator_profile_id,case when delta>0 then'operating_clearing'else'creator_payable'end,
  case when delta>0 then'creator_payable'else'operating_clearing'end,abs(delta),'collection_cost_credit',a.id::text,to_jsonb(a));
 insert into finance_private.collection_credit_updates(resolution_id,revision,delta,remaining_credit,adjustment_id,snapshot)
 values(d.id,last_credit.revision+1,delta,wanted,a.id,to_jsonb(t));perform finance_private.review_changed(a.creator_profile_id);return null;
end$$;
create constraint trigger collection_cost_credit_sync after update or delete on public.transactions deferrable initially deferred for each row execute function finance_private.sync_collection_credit();
create function finance_private.collection_resolved_sale_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if exists(select 1 from finance_private.collection_cost_resolutions where kind='sale'and source_id=old.id)then
  if tg_op='DELETE'then raise exception 'Conservar la venta con costo conciliado';end if;
  if(new.amount,new.creator_share,new.gateway_fee,new.key,new.paypal_ref,new.creator_profile_id,new.created_at,new.service_fee,new.tax_amount)
   is distinct from(old.amount,old.creator_share,old.gateway_fee,old.key,old.paypal_ref,old.creator_profile_id,old.created_at,old.service_fee,old.tax_amount)then
   raise exception 'Conservar la base original de la venta conciliada';end if;
 end if;if tg_op='DELETE'then return old;end if;return new;
end$$;
create trigger collection_resolved_sale_guard before update or delete on public.transactions for each row execute function finance_private.collection_resolved_sale_guard();

create function public.finance_collection_costs(p_offset integer default 0)returns jsonb language plpgsql stable security definer set search_path=''as $$
begin
 perform finance_private.assert_admin();if p_offset is null or p_offset<0 then raise exception 'Página no válida';end if;
 return jsonb_build_object('total',(select count(*)from finance_private.collection_cost_sources where kind='coins'or collection_fee_status<>'verified'),
 'items',coalesce((select jsonb_agg(line order by at desc,id)from(select s.id,s.created_at as at,finance_private.collection_cost_plan(s.kind,s.id)||jsonb_build_object('at',s.created_at,'status',s.status)as line
 from finance_private.collection_cost_sources s where s.kind='coins'or s.collection_fee_status<>'verified'order by s.created_at desc,s.id offset p_offset limit 50)q),'[]'));
end$$;
create function public.finance_coin_purchases()returns jsonb language plpgsql stable security definer set search_path=''as $$
begin perform finance_private.assert_admin();return coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object(
 'actual_gateway_fee',r.fee,'actual_fee_verified',r.id is not null,'fee_verified_later',r.id is not null and c.collection_fee_status<>'verified',
 'refunded_gateway_fee',coalesce((select sum(x.fee_returned)from finance_private.refund_receipts x where x.payment_ref=c.paypal_ref and x.environment=r.environment and x.sender=r.sender),0))order by c.created_at desc,c.id)
 from public.coin_purchases c left join lateral finance_private.collection_cost_receipt('coins',c.id)r on true),'[]');end$$;
create function public.finance_collection_export()returns jsonb language plpgsql stable security definer set search_path=''as $$
begin perform finance_private.assert_admin();return coalesce((select jsonb_agg(finance_private.collection_cost_plan(s.kind,s.id)||jsonb_build_object('at',s.created_at,'status',s.status)order by s.created_at,s.id)
 from finance_private.collection_cost_sources s where s.kind='coins'or s.collection_fee_status<>'verified'),'[]');end$$;
create function public.finance_admin_payments()returns jsonb language plpgsql stable security definer set search_path=''as $$
begin perform finance_private.assert_admin();return coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('actual_gateway_fee',r.fee,'actual_fee_verified',r.id is not null,
 'fee_verified_later',r.id is not null and t.collection_fee_status<>'verified')order by t.created_at desc,t.id)
 from public.transactions t left join lateral finance_private.collection_cost_receipt('sale',t.id)r on true),'[]');end$$;
create function public.finance_creator_totals()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare result jsonb;begin perform finance_private.assert_admin();
 with parties as(select creator_profile_id,sum(amount)filter(where eligible_at<public.payout_credit_cutoff(now()))as closed,
  coalesce(sum(amount)filter(where eligible_at>=public.payout_credit_cutoff(now())),0)as pending from public.finance_sources group by creator_profile_id),
 balances as(select coalesce(closed,0)-coalesce((select sum(a.amount)from finance_private.active_allocations a join public.finance_sources s on s.id=a.source_id where s.creator_profile_id=p.creator_profile_id),0)as available,pending from parties p),
 journal as(select a.code,coalesce(sum(case when j.credit_account=a.code then j.amount else-j.amount end),0)as balance from public.finance_accounts a left join public.finance_journal j on j.credit_account=a.code or j.debit_account=a.code group by a.code)
 select jsonb_build_object('available',coalesce(sum(greatest(0,available)),0),'recoverable',coalesce(sum(greatest(0,-available)),0),'pending',coalesce(sum(pending),0),
 'reserved',(select balance from journal where code='creator_reserved'),'sending',(select balance from journal where code='creator_sending'),
 'paid',-(select sum(balance)from journal where code in('payout_clearing','fee_clearing')))into result from balances;return result;
end$$;

-- A documented resolution lets a later income review finish without repricing.
do $$declare d text;anchor text;begin
 d:=replace(pg_get_functiondef('finance_private.prepare_collection(uuid,text,text,numeric,jsonb)'::regprocedure),chr(13),'');
 anchor:='if old_sale.amount<>p_gross or old_sale.gateway_fee is distinct from fee then return ''COLLECTION_FEE_HISTORICAL_DIFFERENCE'';end if;';
 if position(anchor in d)=0 then raise exception 'Revisar control histórico de costos antes de instalar';end if;
 d:=replace(d,anchor,$new$if old_sale.amount<>p_gross then return 'COLLECTION_FEE_HISTORICAL_DIFFERENCE';end if;
  if old_sale.gateway_fee is distinct from fee and not exists(select 1 from finance_private.collection_cost_resolutions resolution where resolution.kind='sale'and resolution.source_id=old_sale.id and resolution.receipt_id=existing.id
   and resolution.before_snapshot->>'amount'=to_jsonb(old_sale)->>'amount'and resolution.before_snapshot->>'gateway_fee'is not distinct from to_jsonb(old_sale)->>'gateway_fee'
   and resolution.before_snapshot->>'creator_share'=to_jsonb(old_sale)->>'creator_share')then return 'COLLECTION_FEE_HISTORICAL_DIFFERENCE';end if;$new$);execute d;
end$$;
revoke all on all functions in schema finance_private from public,anon,authenticated,service_role;
revoke all on function public.paypal_collection_cost_store(text,uuid,uuid,text,text,text,jsonb)from public,anon,authenticated;
grant execute on function public.paypal_collection_cost_store(text,uuid,uuid,text,text,text,jsonb)to service_role;
revoke all on function public.finance_collection_context(text,uuid),public.finance_collection_preview(text,uuid),public.finance_collection_resolve(text,uuid,uuid,text,text,text),public.finance_collection_costs(integer),public.finance_coin_purchases(),public.finance_collection_export(),public.finance_admin_payments()from public,anon,service_role;
grant execute on function public.finance_collection_context(text,uuid),public.finance_collection_preview(text,uuid),public.finance_collection_resolve(text,uuid,uuid,text,text,text),public.finance_collection_costs(integer),public.finance_coin_purchases(),public.finance_collection_export(),public.finance_admin_payments()to authenticated;
select pg_notify('pgrst','reload schema');
revoke all on function public.finance_creator_totals()from public,anon,service_role;
grant execute on function public.finance_creator_totals()to authenticated;
