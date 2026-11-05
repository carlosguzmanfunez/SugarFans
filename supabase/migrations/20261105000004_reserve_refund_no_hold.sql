-- A partial PayPal refund that Fans Reserve itself requested through a Reserve
-- cancellation (the fan's share minus PayPal's collection fee) is expected.
-- It is applied without opening a "Revisar devolución" case and without
-- freezing the creator's payouts. Any refund that does not match an approved
-- request exactly keeps the existing review, hold and alert.
begin;

create function finance_private.reserve_refund_expected(p_tx uuid,p_total numeric)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.reserve_refund_requests r
  where r.transaction_id=p_tx and r.state in('approved','completed') and not r.creator_fault
   and r.reason in('voluntary','withdrawal') and r.amount=p_total
   and not exists(select 1 from public.credit_grants g where g.booking_id=r.booking_id))
$$;
revoke all on function finance_private.reserve_refund_expected(uuid,numeric) from public,anon,authenticated,service_role;

do $patch$
declare d text;n text;
 fn regprocedure:='finance_private.refund_apply_before_test_archive(uuid,text,jsonb,jsonb)'::regprocedure;
 discount text:=$a$or (t.kind='vip' and exists(select 1 from public.vip_bookings x where t.key='vip:'||x.id::text and coalesce((x.details->>'listPrice')::numeric,0)>t.amount))$a$;
 incident text:=$a$ perform finance_private.incident(null,'DISPUTE_CASE',t.id::text,'Revisar devolución · '||t.creator_name,'Devolución registrada con comprobante. Revisa causa y cobertura; el reparto original no cambia.');$a$;
 hold text:=$a$ if not v_full then
  perform finance_private.place_hold(p.id,'safety','partial-refund/'||p_ref,'Revisa la atribución y cobertura de la devolución parcial antes del próximo pago')$a$;
begin
 d:=replace(pg_get_functiondef(fn),chr(13),'');
 if position(discount in d)=0 or position(incident in d)=0 or position(hold in d)=0 then
  raise exception 'refund_apply_before_test_archive changed; patch not applied';end if;
 n:=replace(d,discount,$a$or (t.kind='vip' and not finance_private.reserve_refund_expected(t.id,v_total) and exists(select 1 from public.vip_bookings x where t.key='vip:'||x.id::text and coalesce((x.details->>'listPrice')::numeric,0)>t.amount))$a$);
 n:=replace(n,incident,$a$ if not finance_private.reserve_refund_expected(t.id,v_total) then
 perform finance_private.incident(null,'DISPUTE_CASE',t.id::text,'Revisar devolución · '||t.creator_name,'Devolución registrada con comprobante. Revisa causa y cobertura; el reparto original no cambia.');
 end if;$a$);
 n:=replace(n,hold,$a$ if not v_full and not finance_private.reserve_refund_expected(t.id,v_total) then
  perform finance_private.place_hold(p.id,'safety','partial-refund/'||p_ref,'Revisa la atribución y cobertura de la devolución parcial antes del próximo pago')$a$);
 execute n;
end $patch$;
revoke all on function finance_private.refund_apply_before_test_archive(uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
commit;
