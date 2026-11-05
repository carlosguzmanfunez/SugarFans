-- Preserve current security, city checks and prices while opening today's
-- published slots. Creator notice is still enforced by the booking-clock trigger.
begin;
do $$
declare definition text; changed text;
begin
 definition := pg_get_functiondef('public.reserve_details_error(jsonb)'::regprocedure);
 if position('not in (24, 48, 72, 168)' in definition)=0 then
  raise exception 'Unexpected minimum-notice validator';
 end if;
 execute replace(definition,'not in (24, 48, 72, 168)','not in (0, 1, 2, 6, 12, 24, 48, 72, 168)');

 definition := pg_get_functiondef('public.reserve_create_booking(text,date,text,text,integer)'::regprocedure);
 changed := regexp_replace(definition,'(p_date < [^\n]*::date\)) \+ 1','\1');
 if changed=definition then raise exception 'Unexpected earliest booking date'; end if;
 execute changed;
end $$;
commit;
