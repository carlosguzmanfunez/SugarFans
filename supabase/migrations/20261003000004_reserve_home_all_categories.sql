-- Reserve: private addresses in every category but Modelos (Carlos, 2026-10-03).
--
-- 20261003000003 limited "Lugar del creator" / "Lugar que propone el fan" to
-- Cocina and Fitness. Now any category offers them for in-person experiences and
-- custom requests, except Modelos (stored as 'Modelos', 'modelaje-glamour' or an
-- older name). Experiences still need manual approval; hotels, "discreet" places
-- and vehicles stay out; free text such as "en mi casa" stays blocked.
--
-- Additive: replaces check_vip_experience and check_vip_booking_home, adds one
-- helper. LEGAL: product draft, requires legal review before production launch.

create or replace function public.reserve_category_no_home(p_category text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(trim(coalesce(p_category, ''))) in ('modelos', 'modelaje-glamour', 'modelaje & glamour', 'modelaje', 'modelaje y glamour');
$$;
revoke execute on function public.reserve_category_no_home(text) from public, anon, authenticated;

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
    if public.reserve_category_no_home(public.creator_category(new.creator_profile_id)) then
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

create or replace function public.check_vip_booking_home()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.details->>'locationType' in ('creator-place', 'fan-place')
     and public.reserve_category_no_home(public.creator_category(new.creator_profile_id)) then
    raise exception 'Este creator no ofrece experiencias a domicilio';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_vip_booking_home() from public, anon, authenticated;
