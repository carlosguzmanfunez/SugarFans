-- Cupos en vivo (Carlos, 2026-11-10): nobody keeps a live slot without paying.
-- 1) A fan who takes a live slot has 5 minutes to pay (was 10; other automatic
--    Reserve bookings keep 15, bookings the creator accepts keep 120).
-- 2) reserve_live_release: when the fan closes the payment window without paying,
--    the slot goes back on the board at once instead of waiting for those minutes.
-- Moves no money: a slot whose PayPal payment is already being captured is never
-- released (reserve_capture_begin and this function lock the same booking row).
-- Safe to run more than once.
begin;

do $$
declare definition text; changed text;
begin
  definition := pg_get_functiondef('public.reserve_fan_lifecycle()'::regprocedure);
  if position('''liveDropId'' then 5 else 15 end' in definition) > 0 then return; end if; -- already applied
  if position('liveDropId' in definition) > 0 then
    -- The 10-minute version (20261110040000) is in place.
    changed := replace(definition, '''liveDropId'' then 10 else 15 end', '''liveDropId'' then 5 else 15 end');
  else
    changed := replace(definition, 'then 120 else 15 end',
      E'then 120 when coalesce(new.details, ''{}''::jsonb) ? ''liveDropId'' then 5 else 15 end');
  end if;
  if changed = definition then raise exception 'Unexpected reserve_fan_lifecycle source'; end if;
  execute changed;
end $$;

-- The fan gives back the live slot they have not paid. Returns true when it was freed.
-- Not a strike against the fan: giving a slot back quickly is what we want.
create or replace function public.reserve_live_release(p_booking uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare b public.vip_bookings;
begin
  if auth.uid() is null then return false; end if;
  select * into b from public.vip_bookings where id = p_booking for update;
  if b.id is null or b.fan_id is distinct from auth.uid() then return false; end if;
  if b.status <> 'accepted' or b.paid_at is not null or not (coalesce(b.details, '{}'::jsonb) ? 'liveDropId') then return false; end if;
  if exists (select 1 from public.reserve_capture_attempts a where a.booking_id = b.id and a.state = 'checking') then return false; end if;
  update public.vip_bookings set status = 'expired', updated_at = now(),
    details = details || jsonb_build_object('paymentExpiredAt', now(), 'expiryReason', 'released')
  where id = b.id;
  return true;
end;
$$;
revoke execute on function public.reserve_live_release(uuid) from public, anon, authenticated;
grant execute on function public.reserve_live_release(uuid) to authenticated;

commit;
