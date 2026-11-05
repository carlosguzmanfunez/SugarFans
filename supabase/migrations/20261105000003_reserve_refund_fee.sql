-- Reserve refunds keep PayPal's collection fee on voluntary cancellations
-- (Carlos, 2026-11-05). A fan who cancels a paid Reserve gets back 100% (24 h or
-- more before) or 50% (less than 24 h), MINUS the PayPal collection fee of that
-- payment, which PayPal does not give back. Créditos stay full (no PayPal
-- movement). Creator cancellations, creator failures and legal withdrawals stay
-- at 100% with no deduction (the creator still covers the unrecovered fee).
--
-- Only reserve_cancel_v2() changes, copied from 20261104044251 with three edits:
--   1. the refund request amount subtracts t.gateway_fee on voluntary fan cancels;
--   2. the interim creator_refund_loss uses the same net proration that
--      paypal_refund_apply() applies when PayPal's notice arrives, so the kept
--      part is split like a sale (example $25: refund $10.85, creator $10.00);
--   3. the booking and result record refundAmount and refundFee for the UI.
-- Safe to re-run (create or replace).

create or replace function public.reserve_cancel_v2(p_booking_id uuid,p_choice text default 'original',p_reason text default 'voluntary')
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.vip_bookings; t public.transactions;r public.reserve_refund_requests;v_creator bool;v_percent int;v_result jsonb;v_credits bool;
 v_fee numeric:=0;v_amount numeric;v_earning numeric;v_loss numeric;
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
  -- Voluntary fan cancellation: PayPal's collection fee for this payment is not
  -- refundable (Carlos, 2026-11-05). Creator cancellations, creator failures and
  -- legal withdrawals keep the full refund.
  v_amount:=round(t.amount*v_percent/100,2);
  if not v_creator and p_reason='voluntary' then
   v_fee:=least(greatest(coalesce(t.gateway_fee,0),0),v_amount);
   v_amount:=v_amount-v_fee;
   if v_amount<=0 then raise exception 'La comisión de cobro de PayPal cubre todo el importe a devolver. Elige recibir Créditos.'; end if;
  end if;
  insert into public.reserve_refund_requests(booking_id,fan_id,transaction_id,amount,reason,state,creator_fault,requested_by,approved_by,previous_loss)
  values(b.id,b.fan_id,t.id,v_amount,
   case when v_creator then 'creator_cancelled' else p_reason end,
   case when v_creator then 'approved' else 'pending' end,v_creator,auth.uid(),
   case when v_creator then auth.uid() end,t.creator_refund_loss) returning * into r;
  update public.vip_bookings set details=details||jsonb_build_object('refundRequest',jsonb_build_object('id',r.id,'state',r.state,'reason',r.reason)) where id=b.id;
  -- Hold the creator's corresponding earnings while the original-method refund is pending.
  -- Same proration PayPal's refund notice applies later: the creator loses the
  -- refunded share of the NET, so the kept part is split like any sale.
  v_earning:=t.amount*t.creator_share;
  v_loss:=case when v_fee>0 and t.amount>coalesce(t.gateway_fee,0)
   then least(v_earning,v_amount*v_earning/(t.amount-t.gateway_fee))
   else v_earning*v_percent/100 end;
  update public.transactions set creator_refund_loss=v_loss where id=t.id;
  if p_reason<>'creator_failure' or v_creator then
   update public.vip_bookings set status='cancelled',updated_at=now(),
    details=(details-'reschedule')||jsonb_build_object('cancellation',jsonb_build_object('by',case when v_creator then 'creator' else 'fan' end,
     'at',now(),'paid',true,'refundPercent',v_percent,'refundAmount',v_amount,'refundFee',v_fee,'refundCoins',0,'refundChoice','original','reason',case when v_creator then 'creator_cancelled' else p_reason end,'refundState','pending')) where id=b.id;
  end if;
  insert into public.notifications(user_id,kind,creator_profile_id,title,body,link) values
   (b.fan_id,'reserve_update',b.creator_profile_id,case when v_creator then left(b.creator_name||' canceló tu reserva',160) else 'Solicitud de devolución registrada' end,left(b.title||'. Importe solicitado: USD '||r.amount||case when v_fee>0 then ' (sin la comisión de PayPal de USD '||v_fee||')' else '' end||'. Se devolverá por el medio original cuando se confirme; no se acreditaron Créditos.',200),'/profile#mis-reservas');
  insert into public.email_outbox(user_id,booking_id,to_email,subject,body) values(b.fan_id,b.id,b.fan_email,'Devolución solicitada: '||b.title,
   'Se registró la devolución de USD '||r.amount||' al medio de pago original por '||case when v_creator then 'cancelación del creador' else 'tu solicitud' end||'. El importe no se considera devuelto hasta confirmar el comprobante del proveedor. Consulta Mis reservas para ver el estado.');
  v_result:=jsonb_build_object('paid',true,'by',case when v_creator then 'creator' else 'fan' end,'refundCoins',0,'refundPercent',v_percent,'refundAmount',v_amount,'refundFee',v_fee,'refundState','pending','requestId',r.id);
 end if;
 -- Paid cancellations need classification before a strike: a label cannot waive legal rights.
 return v_result;
end $$;
revoke all on function public.reserve_cancel_v2(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_cancel_v2(uuid,text,text) to authenticated;

