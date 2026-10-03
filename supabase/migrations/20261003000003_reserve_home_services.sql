-- Reserve: professional services at a private address (Carlos, 2026-10-03).
--
-- A chef or a trainer may give the experience at their own place (restaurant,
-- shop, studio or home) or at the place the fan proposes. Two venue types:
--   creator-place · fan-place
-- Only for the experience types in src/config/reserve.ts HOME_SERVICE_TYPES,
-- only for Cocina and Fitness custom requests, and always with manual approval.
-- Hotel rooms, "discreet" places and vehicles stay out. Free text such as
-- "en mi casa" stays blocked in requests (reserve_text_blocked is unchanged).
--
-- Additive: replaces reserve_location_ok and check_vip_experience, adds one
-- trigger on vip_bookings. LEGAL: product draft, requires legal review before
-- production launch.

create or replace function public.reserve_location_ok(p_location text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_location in ('online', 'public-place', 'restaurant', 'event-venue', 'convention', 'studio', 'gym', 'salon',
                        'culinary-space', 'art-space', 'gaming-venue', 'commercial-space', 'creator-place', 'fan-place');
$$;
revoke execute on function public.reserve_location_ok(text) from public, anon, authenticated;

create or replace function public.check_vip_experience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error text := public.reserve_details_error(new.details);
  v_home boolean := coalesce(new.details->'locationTypes', '[]'::jsonb) ?| array['creator-place', 'fan-place'];
begin
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  if v_home then
    if new.type not in ('cooking-class', 'catering', 'tasting', 'gastronomic-experience', 'training-1-1') then
      raise exception 'Esta experiencia no se puede ofrecer a domicilio';
    end if;
    if coalesce(new.details->>'approval', '') <> 'manual' then
      raise exception 'Las experiencias a domicilio requieren tu aprobación manual';
    end if;
  end if;
  -- What is offered (excludes and conditions say what is not offered).
  if public.reserve_text_blocked(concat_ws(' ', new.title, new.description, new.details->>'venue', new.details->>'city',
                                           new.details->'includes', new.details->'requirements'->>'notes')) then
    raise exception 'Fans Reserve no permite esta experiencia. Revisa la descripción: solo experiencias permitidas, en lugares permitidos y dentro de la plataforma.';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_vip_experience() from public, anon, authenticated;

-- Custom requests carry their venue type in details.locationType: a private
-- address only for creators whose category offers home services.
create or replace function public.check_vip_booking_home()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.details->>'locationType' in ('creator-place', 'fan-place')
     and lower(public.creator_category(new.creator_profile_id)) not in ('cocina', 'fitness') then
    raise exception 'Este creator no ofrece experiencias a domicilio';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_vip_booking_home() from public, anon, authenticated;
drop trigger if exists check_vip_booking_home on public.vip_bookings;
create trigger check_vip_booking_home
  before insert or update of details on public.vip_bookings
  for each row execute function public.check_vip_booking_home();
