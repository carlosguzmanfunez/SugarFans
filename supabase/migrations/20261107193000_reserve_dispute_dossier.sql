-- PayPal dispute dossier for a Reserve booking (Carlos, 2026-11-07).
--
-- Read-only admin query that gathers, for ONE booking, the evidence PayPal's
-- Resolution Center asks for: booking details, PayPal order/capture ids and
-- fee, the fan's terms acceptance (date + version), cancellation/refund
-- requests, any dispute already recorded from PayPal, and the attendance
-- receipt (LiveKit-signed joins/leaves and reminders, via the existing
-- reserve_session_status()).
--
-- Look-up by booking id, PayPal order id or PayPal capture (transaction) id,
-- because PayPal's dispute e-mail only shows the transaction id.
--
-- No writes, no new tables, no new grants on private tables. Same explicit
-- auth.uid()/is_admin() check as reserve_admin_session_list().
create function public.reserve_admin_dispute_dossier(p_reference text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 ref text:=trim(coalesce(p_reference,''));
 b public.vip_bookings;
 fan public.profiles;
 v_booking uuid;
 refs text[];
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then
  raise exception 'Solo administración puede preparar expedientes de disputa' using errcode='42501';
 end if;
 if length(ref) not between 6 and 64 or ref !~ '^[A-Za-z0-9-]+$' then
  raise exception 'Escribe la referencia de la reserva o el ID de transacción de PayPal' using errcode='22023';
 end if;
 if ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  v_booking:=ref::uuid;
 else
  select case when o.params->>'bookingId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (o.params->>'bookingId')::uuid end
    into v_booking
    from public.paypal_orders o
   where o.kind='booking' and (o.id=upper(ref) or o.capture_id=upper(ref))
   order by o.created_at desc limit 1;
 end if;
 select * into b from public.vip_bookings where id=v_booking;
 if b.id is null then
  raise exception 'No encontramos una reserva con esa referencia o transacción de PayPal' using errcode='P0002';
 end if;
 select * into fan from public.profiles where id=b.fan_id;
 select array_agg(x) into refs from (
  select o.id as x from public.paypal_orders o where o.kind='booking' and o.params->>'bookingId'=b.id::text
  union select o.capture_id from public.paypal_orders o
   where o.kind='booking' and o.params->>'bookingId'=b.id::text and o.capture_id is not null) r;

 return jsonb_build_object(
  'generated_at',statement_timestamp(),
  'booking',jsonb_build_object(
    'id',b.id,'title',b.title,'experience_id',b.experience_id,'creator_name',b.creator_name,
    'creator_profile_id',b.creator_profile_id,'fan_name',b.fan_name,'fan_email',b.fan_email,
    'price',b.price,'status',b.status,'date',b.date,'time',b.time,
    'time_zone',coalesce(b.time_zone,'America/Tegucigalpa'),'duration_minutes',b.duration_minutes,
    'modality',coalesce(b.details->>'modality','virtual'),'kind',b.details->>'kind',
    'fan_message',left(coalesce(b.message,''),1000),
    'session_policy_version',coalesce(b.details->>'sessionPolicyVersion','legacy'),
    'reserve_rules_version',b.reserve_rules_version,
    'created_at',b.created_at,'updated_at',b.updated_at,'paid_at',b.paid_at,
    'confirmation_email_sent_at',b.email_sent_at),
  'fan',jsonb_build_object(
    'id',fan.id,'account_created_at',fan.created_at,
    'terms_accepted_at',fan.terms_accepted_at,'terms_version',fan.terms_version,
    'terms_history',coalesce((select jsonb_agg(jsonb_build_object('version',t.version,'method',t.method,'accepted_at',t.accepted_at)
       order by t.accepted_at) from public.terms_acceptances t where t.user_id=b.fan_id),'[]'::jsonb),
    'reserve_bookings_with_creator',(select count(*) from public.vip_bookings x
       where x.fan_id=b.fan_id and x.creator_profile_id=b.creator_profile_id and x.status in('confirmed','completed'))),
  'payments',coalesce((select jsonb_agg(jsonb_build_object('order_id',o.id,'capture_id',o.capture_id,'amount',o.amount,
     'fee',o.fee,'status',o.status,'created_at',o.created_at,'completed_at',o.completed_at) order by o.created_at)
     from public.paypal_orders o where o.kind='booking' and o.params->>'bookingId'=b.id::text),'[]'::jsonb),
  'refund_requests',coalesce((select jsonb_agg(jsonb_build_object('amount',r.amount,'reason',r.reason,'state',r.state,
     'creator_fault',r.creator_fault,'recovered_fee',r.recovered_fee,'created_at',r.created_at,'updated_at',r.updated_at)
     order by r.created_at) from public.reserve_refund_requests r where r.booking_id=b.id),'[]'::jsonb),
  'disputes',coalesce((select jsonb_agg(jsonb_build_object('dispute_id',d.dispute_id,'payment_ref',d.payment_ref,
     'status',d.status,'outcome',d.outcome,'refunded',d.refunded) order by d.dispute_id)
     from finance_private.income_disputes d where d.payment_ref = any(coalesce(refs,'{}'))),'[]'::jsonb),
  'attendance',case when b.duration_minutes>0 then public.reserve_session_status(b.id) else null end
 );
end $$;
revoke all on function public.reserve_admin_dispute_dossier(text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_admin_dispute_dossier(text) to authenticated;
comment on function public.reserve_admin_dispute_dossier(text) is
 'Read-only admin evidence bundle for a PayPal dispute on a Reserve booking. Explicit auth.uid/is_admin check.';

-- Who pays PayPal's chargeback fee (Carlos, 2026-11-07). PayPal charges it to
-- our account whether we win or lose. The admin decides per case:
--   * platform: Fans Reserve absorbs it (only recorded, no balance change).
--   * creator: one negative ledger adjustment through the existing
--     creator_adjust_core(). The ledger takes it from the creator's available
--     balance first, then from earnings of the open cycle before the next
--     payout; if it is still short, the balance stays negative: we already paid
--     PayPal, and the debt is recovered from future earnings.
-- One decision per booking; history stays immutable (undo = reversal in the
-- existing adjustments tool). The creator gets a bell notice.
create table public.reserve_dispute_fees(
 booking_id uuid primary key references public.vip_bookings(id),
 payment_ref text not null,
 fee numeric(10,2) not null check(fee>0 and fee<=100),
 payer text not null check(payer in('platform','creator')),
 adjustment_id uuid unique references public.finance_adjustments(id),
 note text not null default '',
 created_by uuid not null,
 created_at timestamptz not null default now()
);
alter table public.reserve_dispute_fees enable row level security;
create policy reserve_dispute_fees_read on public.reserve_dispute_fees for select to authenticated
 using((select public.is_admin()) or exists(select 1 from public.vip_bookings b where b.id=booking_id
   and b.creator_profile_id=(select public.my_creator_profile_id())));
revoke all on public.reserve_dispute_fees from public,anon,authenticated,service_role;
grant select on public.reserve_dispute_fees to authenticated;
create trigger reserve_dispute_fees_immutable before update or delete on public.reserve_dispute_fees
 for each row execute function finance_private.immutable();

create function public.reserve_dispute_fee_assign(p_reference text,p_fee numeric,p_payer text,p_key uuid,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 d jsonb; b public.vip_bookings; v_creator uuid; v_ref text; v_adj uuid; existing public.reserve_dispute_fees;
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then
  raise exception 'Solo administración puede decidir quién paga el contracargo' using errcode='42501';
 end if;
 if p_payer not in('platform','creator') or p_key is null or p_fee is null or p_fee::text in('NaN','Infinity')
    or p_fee<=0 or p_fee>100 or p_fee<>round(p_fee,2) or length(coalesce(p_note,''))>300 then
  raise exception 'Indica la comisión del contracargo en USD (hasta 100) y quién la paga' using errcode='22023';
 end if;
 d:=public.reserve_admin_dispute_dossier(p_reference);
 select * into b from public.vip_bookings where id=(d->'booking'->>'id')::uuid for update;
 select * into existing from public.reserve_dispute_fees where booking_id=b.id;
 if existing.booking_id is not null then
  if (existing.fee,existing.payer) is distinct from (p_fee,p_payer) then
   raise exception 'Ya se decidió quién paga este contracargo. Para cambiarlo, revierte el ajuste en Finanzas' using errcode='23505';
  end if;
  return to_jsonb(existing);
 end if;
 select coalesce((select p->>'capture_id' from jsonb_array_elements(d->'payments') p where p->>'capture_id' is not null limit 1),
                 (select p->>'order_id' from jsonb_array_elements(d->'payments') p limit 1),b.id::text) into v_ref;
 if p_payer='creator' then
  select id into v_creator from public.profiles where creator_profile_id=b.creator_profile_id and role='creator' limit 1;
  if v_creator is null then raise exception 'No encontramos la cuenta del creador de esta reserva'; end if;
  select (finance_private.creator_adjust_core(v_creator,-p_fee,
    'Comisión de PayPal por contracargo en la reserva «'||left(b.title,80)||'»',p_key,'CONTRACARGO/'||v_ref)->>'id')::uuid into v_adj;
  insert into public.notifications(user_id,kind,creator_profile_id,title,body,link)
  values(v_creator,'reserve_update',b.creator_profile_id,
   left('Descuento por contracargo: USD '||to_char(p_fee,'FM990.00'),160),
   left('Un fan abrió un contracargo por «'||b.title||'». Se descuenta de tu saldo disponible; si no alcanza, de tus ganancias del ciclo antes de tu pago, o de ganancias futuras.',200),
   '/creator/dashboard?tab=earnings');
 end if;
 insert into public.reserve_dispute_fees(booking_id,payment_ref,fee,payer,adjustment_id,note,created_by)
 values(b.id,v_ref,p_fee,p_payer,v_adj,trim(coalesce(p_note,'')),auth.uid()) returning * into existing;
 return to_jsonb(existing);
end $$;
revoke all on function public.reserve_dispute_fee_assign(text,numeric,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_dispute_fee_assign(text,numeric,text,uuid,text) to authenticated;
