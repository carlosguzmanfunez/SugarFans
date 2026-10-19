-- Experience categories are stored in details.categoryId, independently of the
-- creator's primary category. Existing untagged experiences and custom requests
-- retain their current profile-category fallback. No profile or historical row
-- is rewritten. Deploy this migration before the client that offers these tags.

create or replace function public.reserve_experience_category_types(p_category text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select c.types from (values
    ('modelaje-glamour', array['live-1-1','video-call','qa-session','personal-greeting','themed-talk','fashion-beauty-talk','behind-the-scenes','custom-content','meet-greet','appearance','event','fan-event','photo-session','collaboration','production']),
    ('fitness', array['coaching','custom-routine','assessment','training-1-1','qa-session','clinic','workshop','event','meet-greet']),
    ('cocina', array['cooking-class','culinary-consulting','qa-session','live-1-1','catering','tasting','gastronomic-experience','event','workshop']),
    ('musica', array['music-class','listening-session','feedback','creative-session','qa-session','early-access','studio-session','meet-greet','workshop','event','appearance']),
    ('gaming', array['private-match','coaching','gaming-session','stream-1-1','qa-session','tournament','event','meet-greet']),
    ('arte', array['art-class','portfolio-review','mentoring','creative-session','workshop','art-session','event']),
    ('belleza', array['beauty-consulting','styling','makeup-session','qa-session','workshop','event']),
    ('lifestyle', array['qa-session','live-1-1','coaching','themed-talk','behind-the-scenes','early-access','meet-greet','event','appearance','themed-experience']),
    ('educacion', array['mentoring','coaching','qa-session','feedback','workshop','event'])
  ) as c(id, types) where c.id = p_category;
$$;
revoke execute on function public.reserve_experience_category_types(text) from public, anon, authenticated;

-- Preserve the existing trigger's restricted privileges, moderation, details
-- validation and manual approval rules. A category is validated before it may
-- determine the home-service rule; arbitrary labels cannot bypass that rule.
create or replace function public.check_vip_experience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error text := public.reserve_details_error(new.details);
  v_home boolean := coalesce(new.details->'locationTypes', '[]'::jsonb) ?| array['creator-place', 'fan-place'];
  v_category text := coalesce(new.details->>'categoryId', public.creator_category(new.creator_profile_id));
  v_types text[];
begin
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  if new.details ? 'categoryId' then
    v_types := public.reserve_experience_category_types(new.details->>'categoryId');
    if jsonb_typeof(new.details->'categoryId') <> 'string' or v_types is null then
      raise exception 'Elige una categoría válida para esta experiencia';
    end if;
    if not coalesce(new.type = any(v_types), false) then
      raise exception 'La categoría no admite este tipo de experiencia';
    end if;
  end if;
  if v_home then
    if public.reserve_category_no_home(v_category) then
      raise exception 'Esta experiencia no se puede ofrecer a domicilio';
    end if;
    if coalesce(new.details->>'approval', '') <> 'manual' then
      raise exception 'Las experiencias a domicilio requieren tu aprobación manual';
    end if;
  end if;
  if public.reserve_text_blocked(concat_ws(' ', new.title, new.description, new.details->>'venue', new.details->>'city',
                                           new.details->'includes', new.details->'requirements'->>'notes')) then
    raise exception 'Fans Reserve no permite esta experiencia. Revisa la descripción: solo experiencias permitidas, en lugares permitidos y dentro de la plataforma.';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_vip_experience() from public, anon, authenticated;

-- The category of a named experience comes from its stored row, never from a
-- fan-supplied label. Custom/legacy bookings keep the profile fallback.
create or replace function public.check_vip_booking_home()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
begin
  if new.details->>'locationType' in ('creator-place', 'fan-place') then
    select case when e.type = any(public.reserve_experience_category_types(e.details->>'categoryId'))
      then e.details->>'categoryId' end into v_category
      from public.vip_experiences e
      where e.id = new.experience_id and e.creator_profile_id = new.creator_profile_id;
    v_category := coalesce(v_category, public.creator_category(new.creator_profile_id));
    if public.reserve_category_no_home(v_category) then
      raise exception 'Esta experiencia no se puede reservar a domicilio';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_vip_booking_home() from public, anon, authenticated;
