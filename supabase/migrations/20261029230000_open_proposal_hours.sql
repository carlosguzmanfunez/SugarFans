-- Fan proposals (custom Reserve requests) can pick any day of the week and any
-- hour: they are proposals, so the creator's general Reserve schedule no longer
-- limits them. Same function as 20261002000001_reserve.sql except that check.
-- Creators' own schedules (vip_availability) can now use any hour of the day;
-- the table never limited the values, only the app did.

create or replace function public.reserve_request_custom(
  p_creator_profile_id text, p_date date, p_time text, p_duration integer, p_budget numeric,
  p_participants integer, p_message text, p_title text, p_details jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fan public.profiles;
  v_modality text := p_details->>'modality';
  v_location text := p_details->>'locationType';
  v_purpose text := p_details->>'purpose';
  v_id uuid;
begin
  select * into v_fan from public.profiles where id = auth.uid();
  if v_fan.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if public.creator_price(p_creator_profile_id) is null then
    raise exception 'Este perfil no existe';
  end if;
  if v_fan.creator_profile_id = p_creator_profile_id then
    raise exception 'No puedes enviarte una solicitud a ti mismo';
  end if;
  if public.is_cut_off(v_fan.id, p_creator_profile_id) then
    raise exception 'No puedes reservar con este perfil';
  end if;
  if v_modality is null or v_modality not in ('virtual', 'presencial', 'evento', 'profesional') then
    raise exception 'Elige una modalidad disponible';
  end if;
  if v_purpose is null or v_purpose not in ('meet-greet', 'class', 'session', 'coaching', 'consulting', 'review', 'collaboration',
                                            'photo-session', 'appearance', 'workshop', 'event', 'other') then
    raise exception 'Elige el propósito de la experiencia';
  end if;
  if v_location is null or not public.reserve_location_ok(v_location) or (v_modality = 'virtual') <> (v_location = 'online') then
    raise exception 'Las experiencias presenciales se hacen en venues, estudios o lugares públicos, nunca en casas, hoteles o habitaciones.';
  end if;
  if v_modality <> 'virtual' and char_length(trim(coalesce(p_details->>'city', ''))) < 2 then
    raise exception 'Indica la ciudad';
  end if;
  if coalesce(p_duration, 0) not between 10 and 180 then
    raise exception 'La duración debe estar entre 10 y 180 minutos';
  end if;
  if coalesce(p_participants, 0) not between 1 and 50 then
    raise exception 'Entre 1 y 50 participantes';
  end if;
  if p_budget is null or p_budget < 5 or p_budget > 5000 then
    raise exception 'El presupuesto debe estar entre $5 y $5000';
  end if;
  if char_length(trim(coalesce(p_message, ''))) < 10 or char_length(p_message) > 500
     or char_length(coalesce(p_title, '')) > 120 or p_title not like 'Experiencia personalizada%'
     or octet_length(p_details::text) > 2000 then
    raise exception 'Revisa los detalles de la solicitud';
  end if;
  if public.reserve_text_blocked(concat_ws(' ', p_message, p_title, p_details->>'city', p_details->>'venue'), true) then
    raise exception 'Fans Reserve no permite esta solicitud. Reserve es para experiencias concretas, en venues o lugares públicos y dentro de la plataforma.';
  end if;
  if p_date < current_date + 1 or p_date > (current_date + interval '3 months')::date then
    raise exception 'La fecha debe estar dentro de los próximos 3 meses';
  end if;
  -- A proposal isn't bound to the creator's Reserve schedule: any day, any hour
  -- (the creator accepts, rejects or counters). Only a well-formed time is required.
  if p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Elige una hora';
  end if;
  insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email,
                                   date, time, message, duration_minutes, status, details)
  values ('custom', p_creator_profile_id, p_title, public.creator_display_name(p_creator_profile_id), round(p_budget, 2),
          v_fan.id, v_fan.name, v_fan.email, p_date, p_time, trim(p_message), p_duration, 'pending',
          jsonb_strip_nulls(jsonb_build_object(
            'kind', 'custom', 'modality', v_modality, 'purpose', v_purpose, 'participants', p_participants,
            'locationType', v_location,
            'city', case when v_modality <> 'virtual' then left(trim(p_details->>'city'), 60) end,
            'venue', case when v_modality <> 'virtual' then nullif(left(trim(coalesce(p_details->>'venue', '')), 80), '') end,
            'flags', case when jsonb_typeof(p_details->'flags') = 'array' then p_details->'flags' end)))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
end;
$$;

revoke execute on function public.reserve_request_custom(text, date, text, integer, numeric, integer, text, text, jsonb) from public, anon;
grant execute on function public.reserve_request_custom(text, date, text, integer, numeric, integer, text, text, jsonb) to authenticated;
