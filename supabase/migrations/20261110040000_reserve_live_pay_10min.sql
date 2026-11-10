-- Cupos en vivo (Carlos, 2026-11-10): a fan who holds a live slot has 10 minutes to pay
-- (other automatic Reserve bookings keep 15; bookings the creator accepts keep 120).
-- Urgency during a live: unpaid holds go back on the board sooner. Only changes the
-- payment window of new holds; moves no money. Safe to run more than once.
begin;
do $$
declare definition text; changed text;
begin
  definition := pg_get_functiondef('public.reserve_fan_lifecycle()'::regprocedure);
  if position('liveDropId' in definition) > 0 then return; end if; -- already applied
  changed := replace(definition, 'then 120 else 15 end',
    E'then 120 when coalesce(new.details, ''{}''::jsonb) ? ''liveDropId'' then 10 else 15 end');
  if changed = definition then raise exception 'Unexpected reserve_fan_lifecycle source'; end if;
  execute changed;
end $$;
commit;
