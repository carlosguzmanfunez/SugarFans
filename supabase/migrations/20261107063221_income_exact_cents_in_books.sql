-- A finite fraction of gross can lie just below an exact cent (6.409999...).
-- When combined with a legacy half-cent, prefix rounding could lose a cent.
-- Use the immutable cent amount on NEW rows; retain legacy arithmetic verbatim.
-- No sync/backfill is run here. Historical sources and journal entries stay put.
do $migration$
declare d text; anchor text;
begin
 d:=replace(pg_get_functiondef('finance_private.sync_creator(text)'::regprocedure),chr(13),'');
 anchor:='amount*creator_share-case when platform_covers';
 if position(anchor in d)=0 then raise exception 'Revisar cálculo original del libro antes de fijar centavos';end if;
 d:=replace(d,anchor,'coalesce(creator_initial_amount,amount*creator_share)-case when platform_covers');
 execute d;

 d:=replace(pg_get_functiondef('public.creator_available_balance(uuid)'::regprocedure),chr(13),'');
 anchor:='t.amount*t.creator_share-case when t.platform_covers';
 if position(anchor in d)=0 then raise exception 'Revisar saldo original antes de fijar centavos';end if;
 d:=replace(d,anchor,'coalesce(t.creator_initial_amount,t.amount*t.creator_share)-case when t.platform_covers');
 execute d;

 d:=replace(pg_get_functiondef('public.finance_creator_statement(date,uuid)'::regprocedure),chr(13),'');
 anchor:='t.refunded_coins,t.creator_share,refund_record.basis';
 if position(anchor in d)=0 or position('t.amount*t.creator_share' in d)=0
  or position('then amount*creator_share/(' in d)=0 then
  raise exception 'Revisar base del estado de cuenta antes de fijar centavos';end if;
 d:=replace(d,anchor,'t.refunded_coins,t.creator_share,t.creator_initial_amount,refund_record.basis');
 d:=replace(d,'t.amount*t.creator_share','coalesce(t.creator_initial_amount,t.amount*t.creator_share)');
 d:=replace(d,'then amount*creator_share/(','then coalesce(creator_initial_amount,amount*creator_share)/(');
 execute d;
end$migration$;
notify pgrst,'reload schema';
