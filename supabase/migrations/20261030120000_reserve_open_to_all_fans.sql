-- Reserve is open to every registered fan (Carlos, 2026-10-30). Fans only confirm
-- they're 18+ at sign-up; only creators verify their ID. So an experience can no
-- longer ask for "verified fans" or "subscribers only": both flags are always false.
-- reserve_create_booking and reserve_book_event_seat still read the flags, so with
-- them always false nobody is turned away. Safe to run more than once.

create or replace function public.reserve_open_to_all_fans()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.details := jsonb_set(
    coalesce(new.details, '{}'::jsonb),
    '{requirements}',
    coalesce(new.details->'requirements', '{}'::jsonb)
      || jsonb_build_object('verifiedFans', false, 'subscribersOnly', false)
  );
  return new;
end;
$$;

drop trigger if exists reserve_open_to_all_fans on public.vip_experiences;
create trigger reserve_open_to_all_fans
  before insert or update of details on public.vip_experiences
  for each row execute function public.reserve_open_to_all_fans();

-- Experiences already published.
update public.vip_experiences
   set details = jsonb_set(
     details,
     '{requirements}',
     coalesce(details->'requirements', '{}'::jsonb)
       || jsonb_build_object('verifiedFans', false, 'subscribersOnly', false)
   )
 where coalesce((details->'requirements'->>'verifiedFans')::boolean, false)
    or coalesce((details->'requirements'->>'subscribersOnly')::boolean, false);
