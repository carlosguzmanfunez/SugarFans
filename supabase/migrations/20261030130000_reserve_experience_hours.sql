-- Each Reserve experience can use any day of the week and any hour of the day
-- (Carlos, 2026-10-30). Until now its own days and hours could only narrow the
-- creator's general schedule; now, when set, they replace it. Same function as
-- 20261002000001_reserve.sql except that check. Safe to run more than once.

create or replace function public.reserve_create_booking(
  p_experience_id text, p_date date, p_time text, p_message text, p_participants integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fan public.profiles;
  v_av public.vip_availability;
  v_exp public.vip_experiences;
  d jsonb;
  v_participants integer := coalesce(p_participants, 1);
  v_max integer;
  v_notice integer;
  v_sub boolean;
  v_discount integer;
  v_price numeric;
  v_modality text;
  v_status text := 'pending';
  v_id uuid;
begin
  select * into v_fan from public.profiles where id = auth.uid();
  if v_fan.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into v_exp from public.vip_experiences where id = p_experience_id and active;
  if v_exp.id is null then
    raise exception 'Experiencia no encontrada';
  end if;
  if public.creator_price(v_exp.creator_profile_id) is null then
    raise exception 'Este perfil no existe';
  end if;
  if v_fan.creator_profile_id = v_exp.creator_profile_id then
    raise exception 'No puedes reservar tu propia experiencia';
  end if;
  if public.is_cut_off(v_fan.id, v_exp.creator_profile_id) then
    raise exception 'No puedes reservar con este perfil';
  end if;
  if public.reserve_text_blocked(p_message, true) then
    raise exception 'Fans Reserve no permite esta solicitud. Reserve es para experiencias concretas, en venues o lugares públicos y dentro de la plataforma.';
  end if;
  d := v_exp.details;
  v_modality := coalesce(d->>'modality', 'virtual');
  v_max := coalesce((d->>'maxParticipants')::int, 1);
  if v_participants < 1 or v_participants > v_max then
    raise exception 'Esta experiencia admite hasta % participante(s)', v_max;
  end if;
  if coalesce((d->'requirements'->>'verifiedFans')::boolean, false) and not v_fan.is_verified then
    raise exception 'Esta experiencia es solo para fans con identidad verificada';
  end if;
  v_sub := public.has_subscription(v_fan.id, v_exp.creator_profile_id);
  if coalesce((d->'requirements'->>'subscribersOnly')::boolean, false) and not v_sub then
    raise exception 'Esta experiencia es solo para suscriptores';
  end if;
  if p_date < current_date + 1 or p_date > (current_date + interval '3 months')::date then
    raise exception 'La fecha debe estar dentro de los próximos 3 meses';
  end if;
  -- Dates and hours are the creator's local time and the server runs in UTC:
  -- the app enforces the exact notice, the server allows for any time zone.
  v_notice := coalesce((d->>'minNoticeHours')::int, 24);
  if (p_date + p_time::time) < (now() at time zone 'utc') + make_interval(hours => v_notice) - interval '14 hours' then
    raise exception 'Reserva con al menos % horas de anticipación', v_notice;
  end if;
  select * into v_av from public.vip_availability where creator_profile_id = v_exp.creator_profile_id;
  if v_av.creator_profile_id is null then
    v_av.days := '{1,2,3,4,5}';
    v_av.hours := '{10:00,12:00,16:00,18:00}';
  end if;
  -- The experience's own days and hours (any day, any hour) replace the general schedule.
  if (case when jsonb_array_length(coalesce(d->'days', '[]')) > 0
           then not (d->'days') @> to_jsonb(extract(dow from p_date)::int)
           else not (extract(dow from p_date)::smallint = any (v_av.days)) end
      or case when jsonb_array_length(coalesce(d->'hours', '[]')) > 0
           then not (d->'hours') @> to_jsonb(p_time)
           else not (p_time = any (v_av.hours)) end) then
    raise exception 'Ese horario no está disponible';
  end if;
  v_discount := case when v_sub then coalesce((d->>'subscriberDiscount')::int, 0) else 0 end;
  v_price := round(v_exp.price * (100 - v_discount) / 100, 2);
  -- Automatic approval goes straight to payment, except types that are always reviewed.
  if d->>'approval' = 'automatic' and v_exp.type not in
     ('appearance', 'collaboration', 'production', 'photo-session', 'catering', 'studio-session', 'themed-experience') then
    v_status := 'accepted';
  end if;
  insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email,
                                   date, time, message, duration_minutes, status, details)
  values (v_exp.id, v_exp.creator_profile_id, v_exp.title, v_exp.creator_name, v_price, v_fan.id, v_fan.name, v_fan.email,
          p_date, p_time, left(coalesce(trim(p_message), ''), 500), v_exp.duration_minutes, v_status,
          jsonb_strip_nulls(jsonb_build_object(
            'kind', 'experience', 'typeId', v_exp.type, 'modality', v_modality, 'participants', v_participants,
            'locationType', case when v_modality <> 'virtual' then d->'locationTypes'->>0 end,
            'city', case when v_modality <> 'virtual' then d->>'city' end,
            'venue', case when v_modality <> 'virtual' then d->>'venue' end,
            'listPrice', case when v_discount > 0 then v_exp.price end,
            'discountPercent', case when v_discount > 0 then v_discount end)))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
end;
$$;
