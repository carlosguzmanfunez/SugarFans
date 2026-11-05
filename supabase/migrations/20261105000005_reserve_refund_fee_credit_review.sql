-- PayPal normally keeps its collection fee when a payment is refunded. If a
-- refund ever reports part of that fee returned (seller_payable_breakdown.
-- paypal_fee > 0), the fan was charged a fee that PayPal gave back. That case
-- keeps the "Revisar devolución" review so the team returns the difference.
begin;
do $patch$
declare d text;n text;
 fn regprocedure:='finance_private.refund_apply_before_test_archive(uuid,text,jsonb,jsonb)'::regprocedure;
 old text:='finance_private.reserve_refund_expected(t.id,v_total)';
begin
 d:=replace(pg_get_functiondef(fn),chr(13),'');
 if (length(d)-length(replace(d,old,'')))/length(old)<>3 then
  raise exception 'refund_apply_before_test_archive changed; patch not applied';end if;
 n:=replace(d,old,'(coalesce(v_fees,0)=0 and '||old||')');
 execute n;
end $patch$;
revoke all on function finance_private.refund_apply_before_test_archive(uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
commit;
