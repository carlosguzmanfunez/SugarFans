-- Local/QA first. No payment executor is enabled by this migration.
begin;
alter table public.vip_bookings add column payment_due_at timestamptz;
alter table public.vip_bookings add column payment_checking boolean not null default false;
alter table public.vip_bookings add column reserve_rules_version integer not null default 0;
create index vip_bookings_payment_due on public.vip_bookings(payment_due_at) where status='accepted';

create table public.reserve_policy_incidents(
 id uuid primary key default gen_random_uuid(), fan_id uuid not null references public.profiles(id),
 booking_id uuid not null references public.vip_bookings(id), kind text not null check(kind in('unpaid','cancelled')),
 occurred_at timestamptz not null, unique(booking_id,kind)
);
create index reserve_incidents_fan on public.reserve_policy_incidents(fan_id,occurred_at);
alter table public.reserve_policy_incidents enable row level security;
create policy reserve_incidents_read on public.reserve_policy_incidents for select to authenticated
 using(fan_id=(select auth.uid()) or (select public.is_admin()));
revoke all on public.reserve_policy_incidents from public,anon,authenticated;
grant select on public.reserve_policy_incidents to authenticated;

create table public.reserve_access_blocks(
 fan_id uuid primary key references public.profiles(id), blocked_until timestamptz not null,
 reason text not null check(reason in('unpaid','cancelled')), updated_at timestamptz not null default now()
);
alter table public.reserve_access_blocks enable row level security;
create policy reserve_blocks_read on public.reserve_access_blocks for select to authenticated
 using(fan_id=(select auth.uid()) or (select public.is_admin()));
revoke all on public.reserve_access_blocks from public,anon,authenticated;
grant select on public.reserve_access_blocks to authenticated;

create table public.reserve_capture_attempts(
 order_id text primary key references public.paypal_orders(id), booking_id uuid not null references public.vip_bookings(id),
 state text not null check(state in('checking','completed','failed')), started_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index reserve_capture_booking on public.reserve_capture_attempts(booking_id,state);
alter table public.reserve_capture_attempts enable row level security;
revoke all on public.reserve_capture_attempts from public,anon,authenticated;

create or replace function public.reserve_record_incident(p_fan uuid,p_booking uuid,p_kind text,p_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare n int; added uuid; v_last timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('reserve-fan:'||p_fan,0));
 insert into public.reserve_policy_incidents(fan_id,booking_id,kind,occurred_at) values(p_fan,p_booking,p_kind,p_at)
 on conflict(booking_id,kind) do nothing returning id into added;
 if added is null then return; end if;
 select max(occurred_at) into v_last from public.reserve_policy_incidents where fan_id=p_fan and kind=p_kind;
 select count(*) into n from public.reserve_policy_incidents where fan_id=p_fan and kind=p_kind
  and occurred_at between v_last-interval '30 days' and v_last;
 if n>=3 then
  insert into public.reserve_access_blocks(fan_id,blocked_until,reason) values(p_fan,v_last+interval '72 hours',p_kind)
  on conflict(fan_id) do update set blocked_until=greatest(reserve_access_blocks.blocked_until,excluded.blocked_until),
   reason=case when excluded.blocked_until>=reserve_access_blocks.blocked_until then excluded.reason else reserve_access_blocks.reason end,updated_at=now();
 end if;
end $$;
revoke all on function public.reserve_record_incident(uuid,uuid,text,timestamptz) from public,anon,authenticated;

create or replace function public.reserve_expire_payments(p_fan uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare b public.vip_bookings; n int:=0;
begin
 for b in select * from public.vip_bookings x where x.status='accepted' and x.payment_due_at<=now()
  and (p_fan is null or x.fan_id=p_fan)
  and not exists(select 1 from public.reserve_capture_attempts a where a.booking_id=x.id and a.state='checking')
  order by x.payment_due_at for update skip locked
 loop
  update public.vip_bookings set status='expired',updated_at=now(),
   details=details||jsonb_build_object('paymentExpiredAt',b.payment_due_at,'expiryReason','unpaid') where id=b.id;
  if b.reserve_rules_version=1 and not(coalesce(b.details,'{}') ? 'ticketId') then
   perform public.reserve_record_incident(b.fan_id,b.id,'unpaid',b.payment_due_at);
  end if;
  insert into public.notifications(user_id,kind,creator_profile_id,title,body,link)
   values(b.fan_id,'reserve_update',b.creator_profile_id,'Se liberó tu reserva sin pagar',left(b.title||'. Terminó el plazo de pago. Revisa Reserve para ver tu disponibilidad.',200),'/profile#mis-reservas');
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.reserve_expire_payments(uuid) from public,anon,authenticated;

create or replace function public.reserve_fan_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_bucket text; v_count int; v_duplicate bool; v_until timestamptz; v_minutes int; v_start timestamptz;
begin
 if tg_op='INSERT' then new.reserve_rules_version:=1; end if;
 if tg_op='UPDATE' then
  new.reserve_rules_version:=old.reserve_rules_version;
  new.payment_due_at:=old.payment_due_at;
  if old.status='accepted' and new.status in('cancelled','expired','rejected') and exists(
   select 1 from public.reserve_capture_attempts where booking_id=old.id and state='checking'
  ) then raise exception 'Estamos comprobando el pago con PayPal. No repetiremos el cobro ni liberaremos el horario hasta aclararlo.'; end if;
 end if;
 if new.status='accepted' and (tg_op='INSERT' or old.status is distinct from new.status) then
  v_minutes:=case when coalesce(new.details->>'kind','')='custom' or (tg_op='UPDATE' and old.status in('pending','countered')) then 120 else 15 end;
  new.details:=coalesce(new.details,'{}')||jsonb_build_object('approvalRequired',v_minutes=120);
  v_start:=(new.date+new.time::time) at time zone coalesce(new.time_zone,
   (select time_zone from public.vip_availability where creator_profile_id=new.creator_profile_id),
   (select time_zone from public.vip_experiences where id=new.experience_id),'America/Tegucigalpa');
  if v_start<=now() then raise exception 'La experiencia ya comenzó. Elige una nueva fecha antes de aceptar.'; end if;
  new.payment_due_at:=least(now()+make_interval(mins=>v_minutes),v_start);
  new.reserve_rules_version:=1;
 end if;
 new.payment_checking:=new.status='accepted' and exists(select 1 from public.reserve_capture_attempts where booking_id=new.id and state='checking');
 if tg_op='UPDATE' and old.status='accepted' and new.status='confirmed' and old.payment_due_at<=now() and not exists(select 1 from public.reserve_capture_attempts where booking_id=new.id and state='checking') and not(coalesce(new.details,'{}') ? 'ticketId') then raise exception 'Terminó el plazo de pago de esta reserva'; end if;
 if new.status='confirmed' then new.payment_due_at:=null; end if;
 -- Only new proposals and new accepted reservations consume an access quota.
 if new.status not in('pending','countered','accepted','confirmed') then return new; end if;
 if tg_op='UPDATE' and (
  new.status=old.status or (old.status='accepted' and new.status='confirmed') or
  (old.status='pending' and new.status='countered')
 ) then return new; end if;
 v_bucket:=case when new.status in('pending','countered') then 'proposal' else 'reservation' end;
 perform pg_advisory_xact_lock(hashtextextended('reserve-fan:'||new.fan_id,0));
 select blocked_until into v_until from public.reserve_access_blocks where fan_id=new.fan_id;
 if v_until>now() then raise exception 'Tu acceso a nuevas reservas está suspendido hasta %. Puedes pagar reservas existentes, cancelar, pedir devoluciones y reportar.',v_until; end if;
 select count(*),coalesce(bool_or(b.creator_profile_id=new.creator_profile_id),false) into v_count,v_duplicate
 from public.vip_bookings b where b.fan_id=new.fan_id and b.id<>new.id and
 case when v_bucket='proposal' then b.status in('pending','countered')
 else b.status in('accepted','confirmed','reschedule_requested')
  and public.reserve_booking_start(b)+make_interval(mins=>coalesce(b.duration_minutes,60))>now()
  and (b.status<>'accepted' or b.payment_due_at is null or b.payment_due_at>now()
    or exists(select 1 from public.reserve_capture_attempts where booking_id=b.id and state='checking')) end;
 if v_duplicate then raise exception 'Solo puedes tener una % activa por creador.',case when v_bucket='proposal' then 'propuesta' else 'reserva' end; end if;
 if v_count>=3 then raise exception 'Puedes tener hasta tres % simultáneas con creadores diferentes.',case when v_bucket='proposal' then 'propuestas' else 'reservas' end; end if;
 return new;
end $$;
revoke all on function public.reserve_fan_lifecycle() from public,anon,authenticated;
create trigger aa_reserve_fan_lifecycle before insert or update on public.vip_bookings for each row execute function public.reserve_fan_lifecycle();

create function public.reserve_event_capacity_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.vip_experiences; taken int;
begin
 if coalesce(new.details->>'kind','')<>'event' or new.status not in('accepted','confirmed') then return new; end if;
 if tg_op='UPDATE' and old.status in('accepted','confirmed') then return new; end if;
 select * into e from public.vip_experiences where id=new.experience_id for update;
 select count(*) into taken from public.vip_bookings where experience_id=new.experience_id and id<>new.id and status in('accepted','confirmed');
 if taken>=coalesce((e.details->>'maxParticipants')::integer,0) then raise exception 'No quedan plazas para este evento. No se aceptó ni cobró la solicitud.'; end if;
 return new;
end $$;
revoke all on function public.reserve_event_capacity_guard() from public,anon,authenticated;
-- Acquire the event row before the fan lock, matching automatic event bookings.
create trigger a0_reserve_event_capacity before insert or update on public.vip_bookings for each row execute function public.reserve_event_capacity_guard();

-- Pending requests describe an idea; they no longer hold time or event capacity.
drop index public.vip_bookings_active_slot;
create unique index vip_bookings_active_slot on public.vip_bookings(creator_profile_id,date,time,(coalesce(time_zone,'')))
 where status in('accepted','confirmed') and coalesce(details->>'kind','')<>'event';
do $$
declare target regprocedure; d text;
begin
 foreach target in array array['public.reserve_clock_conflict()'::regprocedure,'public.reserve_taken_slots(text)'::regprocedure,
 'public.vip_taken_slots(text)'::regprocedure,'public.reserve_event_seats(text[])'::regprocedure,'public.reserve_book_event_seat(text,text)'::regprocedure]
 loop
  d:=pg_get_functiondef(target);
  d:=replace(d,'''pending'',''accepted'',''confirmed''','''accepted'',''confirmed''');
  d:=replace(d,'''pending'', ''accepted'', ''confirmed''','''accepted'', ''confirmed''');
  execute d;
 end loop;
end $$;

create or replace function public.reserve_access()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v uuid:=auth.uid(); r jsonb; u int; c int; nr int; np int;
begin
 if v is null then raise exception 'Debes iniciar sesión'; end if;
 perform public.reserve_expire_payments(v);
 select count(*) filter(where kind='unpaid'),count(*) filter(where kind='cancelled') into u,c from public.reserve_policy_incidents where fan_id=v and occurred_at>=now()-interval '30 days';
 select count(*) filter(where status in('accepted','confirmed','reschedule_requested') and public.reserve_booking_start(b)+make_interval(mins=>coalesce(duration_minutes,60))>now()),
  count(*) filter(where status in('pending','countered')) into nr,np from public.vip_bookings b where fan_id=v;
 select jsonb_build_object('blockedUntil',case when blocked_until>now() then blocked_until end,'reason',reason) into r from public.reserve_access_blocks where fan_id=v;
 return coalesce(r,'{}')||jsonb_build_object('unpaid',u,'cancelled',c,'reservations',nr,'proposals',np);
end $$;
revoke all on function public.reserve_access() from public,anon,authenticated;
grant execute on function public.reserve_access() to authenticated;

create or replace function public.reserve_capture_begin(p_order text,p_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.paypal_orders; b public.vip_bookings;
begin
 select * into o from public.paypal_orders where id=p_order;
 if o.id is null or o.user_id<>p_user then raise exception 'Pedido no encontrado'; end if;
 if o.kind<>'booking' then return '{"ok":true}'; end if;
 select * into b from public.vip_bookings where id=(o.params->>'bookingId')::uuid for update;
 if exists(select 1 from public.reserve_capture_attempts where order_id=p_order and state='checking') then return '{"ok":true,"checking":true}'; end if;
 if b.status<>'accepted' or (b.payment_due_at is not null and b.payment_due_at<=now()) then raise exception 'Terminó el plazo para pagar esta reserva. No se realizó el cobro.'; end if;
 if exists(select 1 from public.reserve_capture_attempts where booking_id=b.id and order_id<>p_order and state='checking') then raise exception 'Ya hay un pago de esta reserva en comprobación. No repitas el pago.'; end if;
 insert into public.reserve_capture_attempts(order_id,booking_id,state) values(p_order,b.id,'checking')
 on conflict(order_id) do update set state='checking',updated_at=now();
 update public.vip_bookings set payment_checking=true where id=b.id;
 return '{"ok":true}';
end $$;
revoke all on function public.reserve_capture_begin(text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_capture_begin(text,uuid) to service_role;

create or replace function public.reserve_capture_finish(p_order text,p_failed boolean default false)
returns void language sql security definer set search_path='' as $$
 update public.reserve_capture_attempts set state=case when p_failed then 'failed' else 'completed' end,updated_at=now() where order_id=p_order;
 update public.vip_bookings set payment_checking=false where id=(select booking_id from public.reserve_capture_attempts where order_id=p_order)
$$;
revoke all on function public.reserve_capture_finish(text,boolean) from public,anon,authenticated;
grant execute on function public.reserve_capture_finish(text,boolean) to service_role;

-- Provider reconciliation can confirm a capture even after its original deadline.
-- The checking record keeps the slot reserved while the network outcome is unknown.
create or replace function public.reserve_capture_synced()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' then update public.reserve_capture_attempts set state='completed',updated_at=now() where order_id=new.id; end if;
 return new;
end $$;
revoke all on function public.reserve_capture_synced() from public,anon,authenticated;
create trigger reserve_capture_synced after update of status on public.paypal_orders for each row execute function public.reserve_capture_synced();

-- Existing accepted reservations get a fresh two-hour grace period, no historic strikes.
-- This maintenance update is controlled directly (the lifecycle preserves old columns).
alter table public.vip_bookings disable trigger aa_reserve_fan_lifecycle;
update public.vip_bookings set payment_due_at=now()+interval '2 hours',reserve_rules_version=0 where status='accepted';
alter table public.vip_bookings enable trigger aa_reserve_fan_lifecycle;

select cron.schedule('expire-reserve-payments','* * * * *','select public.reserve_expire_payments()');
create table public.reserve_refund_requests(
 id uuid primary key default gen_random_uuid(),booking_id uuid not null unique references public.vip_bookings(id),
 fan_id uuid not null references public.profiles(id),transaction_id uuid not null references public.transactions(id),
 amount numeric(12,2) not null check(amount>0),reason text not null,
 state text not null check(state in('pending','approved','completed','declined')),
 creator_fault boolean not null default false,requested_by uuid not null,approved_by uuid,
 previous_loss numeric not null default 0,recovered_fee numeric(12,2) not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),note text not null default ''
);
alter table public.reserve_refund_requests enable row level security;
create policy reserve_refunds_read on public.reserve_refund_requests for select to authenticated
 using(fan_id=(select auth.uid()) or (select public.is_admin()) or exists(
  select 1 from public.vip_bookings b where b.id=booking_id and b.creator_profile_id=(select public.my_creator_profile_id())));
revoke all on public.reserve_refund_requests from public,anon,authenticated;
grant select on public.reserve_refund_requests to authenticated;

alter function public.reserve_cancel(uuid) set schema finance_private;
alter function finance_private.reserve_cancel(uuid) rename to reserve_cancel_credits_legacy;
revoke all on function finance_private.reserve_cancel_credits_legacy(uuid) from public,anon,authenticated,service_role;

create function public.reserve_cancel_v2(p_booking_id uuid,p_choice text default 'original',p_reason text default 'voluntary')
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.vip_bookings; t public.transactions;r public.reserve_refund_requests;v_creator bool;v_percent int;v_result jsonb;v_credits bool;
begin
 perform finance_private.lock_book();
 select * into b from public.vip_bookings where id=p_booking_id for update;
 if b.id is null or not(b.fan_id=auth.uid() or b.creator_profile_id=public.my_creator_profile_id()) then raise exception 'Reserva no encontrada'; end if;
 if p_choice not in('original','credits') or p_reason not in('voluntary','withdrawal','creator_failure') then raise exception 'Elige cómo solicitar la devolución'; end if;
 v_creator:=b.creator_profile_id=public.my_creator_profile_id() and b.fan_id<>auth.uid();
 if b.status in('pending','countered','accepted') and b.paid_at is null then
  v_result:=finance_private.reserve_cancel_credits_legacy(b.id);
  -- Only voluntary abandonment of an accepted hold counts as a cancellation.
  if not v_creator and b.status='accepted' and p_reason='voluntary' and b.reserve_rules_version=1 then
   perform public.reserve_record_incident(b.fan_id,b.id,'cancelled',now());
  end if;
  return v_result;
 end if;
 select * into r from public.reserve_refund_requests where booking_id=b.id;
 if r.id is not null then return jsonb_build_object('paid',true,'refundCoins',0,'refundState',r.state,'requestId',r.id); end if;
 if b.status not in('confirmed','completed') then raise exception 'Esta reserva ya no se puede cancelar'; end if;
 if not v_creator and p_reason='voluntary' and public.reserve_booking_start(b)<=now() then raise exception 'La experiencia ya empezó. Reporta el problema para solicitar revisión.'; end if;
 v_percent:=case when v_creator or p_reason in('withdrawal','creator_failure') then 100
  when public.reserve_booking_start(b)>=now()+interval '24 hours' then 100 else 50 end;
 v_credits:=exists(select 1 from public.credit_spends where booking_id=b.id) or coalesce(b.details,'{}') ? 'ticketId';
 if (p_choice='credits' and p_reason='voluntary' and not v_creator) or v_credits then
  v_result:=finance_private.reserve_cancel_credits_legacy(b.id);
  update public.vip_bookings set details=details||jsonb_build_object('cancellation',details->'cancellation'||jsonb_build_object('refundChoice','credits','reason',p_reason)) where id=b.id;
  if not v_creator and not v_credits then
   insert into public.reserve_refund_requests(booking_id,fan_id,transaction_id,amount,reason,state,requested_by)
   select b.id,b.fan_id,x.id,round(x.amount*(v_result->>'refundPercent')::numeric/100,2),'voluntary','pending',auth.uid()
    from public.transactions x where x.key='vip:'||b.id;
  end if;
 else
  select * into t from public.transactions where key='vip:'||b.id and kind='vip' for update;
  if t.id is null or t.status<>'paid' or t.refunded_amount<>0 or t.creator_refund_loss<>0 then raise exception 'El pago requiere revisión antes de devolverlo'; end if;
  insert into public.reserve_refund_requests(booking_id,fan_id,transaction_id,amount,reason,state,creator_fault,requested_by,approved_by,previous_loss)
  values(b.id,b.fan_id,t.id,round(t.amount*v_percent/100,2),
   case when v_creator then 'creator_cancelled' else p_reason end,
   case when v_creator then 'approved' else 'pending' end,v_creator,auth.uid(),
   case when v_creator then auth.uid() end,t.creator_refund_loss) returning * into r;
  update public.vip_bookings set details=details||jsonb_build_object('refundRequest',jsonb_build_object('id',r.id,'state',r.state,'reason',r.reason)) where id=b.id;
  -- Hold the creator's corresponding earnings while the original-method refund is pending.
  update public.transactions set creator_refund_loss=t.amount*t.creator_share*v_percent/100 where id=t.id;
  if p_reason<>'creator_failure' or v_creator then
   update public.vip_bookings set status='cancelled',updated_at=now(),
    details=(details-'reschedule')||jsonb_build_object('cancellation',jsonb_build_object('by',case when v_creator then 'creator' else 'fan' end,
     'at',now(),'paid',true,'refundPercent',v_percent,'refundCoins',0,'refundChoice','original','reason',case when v_creator then 'creator_cancelled' else p_reason end,'refundState','pending')) where id=b.id;
  end if;
  insert into public.notifications(user_id,kind,creator_profile_id,title,body,link) values
   (b.fan_id,'reserve_update',b.creator_profile_id,case when v_creator then left(b.creator_name||' canceló tu reserva',160) else 'Solicitud de devolución registrada' end,left(b.title||'. Importe solicitado: USD '||r.amount||'. Se devolverá por el medio original cuando se confirme; no se acreditaron Créditos.',200),'/profile#mis-reservas');
  insert into public.email_outbox(user_id,booking_id,to_email,subject,body) values(b.fan_id,b.id,b.fan_email,'Devolución solicitada: '||b.title,
   'Se registró la devolución de USD '||r.amount||' al medio de pago original por '||case when v_creator then 'cancelación del creador' else 'tu solicitud' end||'. El importe no se considera devuelto hasta confirmar el comprobante del proveedor. Consulta Mis reservas para ver el estado.');
  v_result:=jsonb_build_object('paid',true,'by',case when v_creator then 'creator' else 'fan' end,'refundCoins',0,'refundPercent',v_percent,'refundState','pending','requestId',r.id);
 end if;
 -- Paid cancellations need classification before a strike: a label cannot waive legal rights.
 return v_result;
end $$;
revoke all on function public.reserve_cancel_v2(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_cancel_v2(uuid,text,text) to authenticated;
create function public.reserve_cancel(p_booking_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select public.reserve_cancel_v2(p_booking_id,'original','voluntary')
$$;
revoke all on function public.reserve_cancel(uuid) from public,anon,authenticated;
grant execute on function public.reserve_cancel(uuid) to authenticated;

create function public.reserve_refund_decide(p_id uuid,p_decision text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.reserve_refund_requests;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if char_length(trim(p_note))<10 or p_decision not in('approve','decline','legal') then raise exception 'Documenta la decisión con al menos diez caracteres'; end if;
 select * into r from public.reserve_refund_requests where id=p_id for update;
 if r.id is null or r.state<>'pending' then raise exception 'La solicitud ya no está pendiente de revisión'; end if;
 if p_decision='legal' then
  if exists(select 1 from public.credit_grants where booking_id=r.booking_id) and (select sum(coins) from public.credit_grants where booking_id=r.booking_id)<(select amount*100 from public.transactions where id=r.transaction_id) then
   raise exception 'Ya se acreditó una parte en Créditos. Resuelve primero ese saldo mediante una corrección supervisada para evitar una devolución doble.';
  end if;
  update public.reserve_refund_requests set reason='withdrawal',amount=(select amount from public.transactions where id=r.transaction_id) where id=r.id;
  update public.transactions set creator_refund_loss=amount*creator_share where id=r.transaction_id;
 end if;
 update public.reserve_refund_requests set state=case when p_decision in('approve','legal') and exists(select 1 from public.credit_grants where booking_id=r.booking_id) then 'completed' when p_decision in('approve','legal') then 'approved' else 'declined' end,
  creator_fault=case when reason='creator_failure' and p_decision='approve' then true else creator_fault end,
  approved_by=auth.uid(),note=left(trim(p_note),1000),updated_at=now() where id=r.id;
 if p_decision='approve' and r.reason='voluntary' then
  perform public.reserve_record_incident(r.fan_id,r.booking_id,'cancelled',r.created_at);
 end if;
 update public.vip_bookings set details=jsonb_set(details,'{refundRequest,state}',to_jsonb(case when p_decision in('approve','legal') then 'approved'::text else 'declined'::text end),true) where id=r.booking_id;
 if p_decision='approve' and r.reason='creator_failure' then
  update public.vip_bookings set status='cancelled',details=details||jsonb_build_object('cancellation',jsonb_build_object('by','creator','at',now(),
   'paid',true,'refundPercent',100,'refundCoins',0,'refundChoice','original','reason','creator_failure','refundState','pending')) where id=r.booking_id;
 elsif p_decision='decline' and r.reason='creator_failure' then
  update public.transactions set creator_refund_loss=r.previous_loss where id=r.transaction_id and refunded_amount=0 and status='paid';
 end if;
end $$;
revoke all on function public.reserve_refund_decide(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_refund_decide(uuid,text,text) to authenticated;

-- Strictly derived from a completed refund and its verified original fee.
-- No caller supplies a debit amount, recipient or evidence.
create function finance_private.reserve_recover_failure_fee(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.reserve_refund_requests;t public.transactions;b public.vip_bookings;
 retained numeric;delta numeric;v_user uuid;v_id uuid;v_source uuid;v_eligible timestamptz;v_reason text;a public.finance_adjustments;
begin
 perform finance_private.lock_book();
 select * into r from public.reserve_refund_requests where id=p_id for update;
 if r.id is null or r.state<>'completed' or not r.creator_fault then return; end if;
 select * into t from public.transactions where id=r.transaction_id;
 if exists(select 1 from public.credit_grants where booking_id=r.booking_id) then raise exception 'Esta cancelación ya fue acreditada en Créditos voluntarios. No se enviará otra devolución.'; end if;
 if t.collection_fee_status<>'verified' or t.refunded_amount<t.amount then return; end if;
 retained:=greatest(0,coalesce(t.gateway_fee,0)-coalesce(t.refunded_gateway_fee,0));
 delta:=r.recovered_fee-retained;
 if delta=0 then return; end if;
 select * into b from public.vip_bookings where id=r.booking_id;
 select id into v_user from public.profiles where creator_profile_id=b.creator_profile_id and role='creator' limit 1;
 if v_user is null then raise exception 'No encontramos al creador para registrar el costo'; end if;
 v_reason:='Costo comprobado de PayPal no devuelto por incumplimiento del creador. Reserva '||b.id||'; cobro '||coalesce(t.paypal_ref,'')||
  '; comisión original USD '||t.gateway_fee||'; devuelta por PayPal USD '||coalesce(t.refunded_gateway_fee,0)||'; costo pendiente USD '||retained||'.';
 v_eligible:=case when delta<0 then '-infinity'::timestamptz else now() end;
 v_id:=gen_random_uuid();
 insert into public.finance_adjustments(request_key,user_id,creator_profile_id,amount,eligible_at,reason,reference,created_by)
 values(v_id,v_user,b.creator_profile_id,delta,v_eligible,v_reason,'reserve-failure/'||r.id||'/'||v_id,coalesce(r.approved_by,r.requested_by)) returning * into a;
 insert into public.finance_sources(creator_profile_id,kind,reference,amount,eligible_at,revision,snapshot)
 values(b.creator_profile_id,'adjustment',a.id::text,delta,v_eligible,1,to_jsonb(a)) returning id into v_source;
 insert into public.finance_source_revisions(source_id,revision,before_amount,after_amount,before_eligible_at,after_eligible_at,snapshot)
 values(v_source,1,0,delta,v_eligible,v_eligible,to_jsonb(a));
 perform finance_private.post('adjustment/'||a.id,b.creator_profile_id,
  case when delta>0 then 'operating_clearing' else 'creator_payable' end,
  case when delta>0 then 'creator_payable' else 'operating_clearing' end,abs(delta),'reserve_failure_fee',a.id::text,to_jsonb(a));
 perform finance_private.review_changed(b.creator_profile_id);
 update public.reserve_refund_requests set recovered_fee=retained,updated_at=now() where id=r.id;
 insert into public.notifications(user_id,kind,creator_profile_id,title,body,link)
 values(v_user,'reserve_update',b.creator_profile_id,'Ajuste del costo de PayPal',left(v_reason,200),'/creator/dashboard?tab=earnings');
end $$;
revoke all on function finance_private.reserve_recover_failure_fee(uuid) from public,anon,authenticated,service_role;

create function public.reserve_refund_tx_synced()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.reserve_refund_requests;
begin
 for r in select * from public.reserve_refund_requests where transaction_id=new.id and state in('approved','completed')
 loop
  if new.refunded_amount>=r.amount then
   update public.reserve_refund_requests set state='completed',updated_at=now() where id=r.id;
   update public.vip_bookings set details=jsonb_set(details,'{cancellation,refundState}','"completed"',false) where id=r.booking_id;
   update public.vip_bookings set details=jsonb_set(details,'{refundRequest,state}','"completed"',true) where id=r.booking_id;
   perform finance_private.reserve_recover_failure_fee(r.id);
  end if;
 end loop;
 return new;
end $$;
revoke all on function public.reserve_refund_tx_synced() from public,anon,authenticated;
create trigger reserve_refund_tx_synced after update of refunded_amount,refunded_gateway_fee on public.transactions
for each row execute function public.reserve_refund_tx_synced();

create function public.reserve_refund_list() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'bookingId',r.booking_id,'fanId',r.fan_id,'title',b.title,
  'fanName',b.fan_name,'amount',r.amount,'reason',r.reason,'state',r.state,'createdAt',r.created_at,'paymentRef',t.paypal_ref,
  'note',r.note,'funding',case when exists(select 1 from public.credit_grants where booking_id=r.booking_id) then 'credits' else 'original' end,
  'recoveredFee',r.recovered_fee,'feePending',r.creator_fault and r.state='completed' and t.collection_fee_status<>'verified') order by r.created_at desc)
  from public.reserve_refund_requests r join public.vip_bookings b on b.id=r.booking_id join public.transactions t on t.id=r.transaction_id
  where public.is_admin() or r.fan_id=auth.uid() or b.creator_profile_id=public.my_creator_profile_id()),'[]');
end $$;
revoke all on function public.reserve_refund_list() from public,anon,authenticated;
grant execute on function public.reserve_refund_list() to authenticated;

create function public.reserve_refund_prepare(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reserve_refund_requests;t public.transactions;
begin
 perform finance_private.assert_admin();
 select * into r from public.reserve_refund_requests where id=p_id;
 if r.id is null or r.state not in('approved','completed') then raise exception 'Primero revisa y aprueba la devolución'; end if;
 select * into t from public.transactions where id=r.transaction_id;
 if t.paypal_ref is null then raise exception 'El medio original requiere atención manual; no enviaremos un pago distinto'; end if;
 if t.status='disputed' then raise exception 'Hay una disputa abierta. Resuélvela antes de enviar otra devolución.'; end if;
 return jsonb_build_object('capture',t.paypal_ref,'amount',r.amount,'state',r.state,'requestKey','reserve-refund-'||r.id);
end $$;
revoke all on function public.reserve_refund_prepare(uuid) from public,anon,authenticated;
grant execute on function public.reserve_refund_prepare(uuid) to authenticated;
create table public.reserve_refund_attempts(request_id uuid primary key references public.reserve_refund_requests(id),
 started_at timestamptz not null default now(),refund_id text);
alter table public.reserve_refund_attempts enable row level security;
revoke all on public.reserve_refund_attempts from public,anon,authenticated;

create function public.reserve_refund_claim(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reserve_refund_requests; a public.reserve_refund_attempts; v uuid;
begin
 perform finance_private.assert_admin();
 select * into r from public.reserve_refund_requests where id=p_id for update;
 if r.id is null or r.state<>'approved' then raise exception 'La devolución no está aprobada'; end if;
 insert into public.reserve_refund_attempts(request_id) values(p_id) on conflict do nothing returning request_id into v;
 select * into a from public.reserve_refund_attempts where request_id=p_id;
 return jsonb_build_object('send',v is not null,'refundId',a.refund_id);
end $$;
revoke all on function public.reserve_refund_claim(uuid) from public,anon,authenticated;
grant execute on function public.reserve_refund_claim(uuid) to authenticated;
create function public.reserve_refund_sent(p_id uuid,p_ref text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_ref !~ '^[A-Za-z0-9-]{1,255}$' then raise exception 'Referencia de devolución inválida'; end if;
 update public.reserve_refund_attempts set refund_id=p_ref where request_id=p_id and (refund_id is null or refund_id=p_ref);
end $$;
revoke all on function public.reserve_refund_sent(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_refund_sent(uuid,text) to service_role;
commit;


