-- Reserve discount for followers (Carlos, 2026-10-11).
-- 1. Experiences can carry details.followerDiscount (0/5/10/15/20/25%) next to
--    subscriberDiscount. It applies to fans who have followed the creator for 7
--    days or more (unfollowing resets the date). A subscriber who also follows
--    gets the larger of the two. Bookings record discountKind.
-- 2. Any fan discount comes out of the creator's part: Fans Reserve's cut of a
--    Reserve payment (and the 5% service fee of special accounts) is computed on
--    the full price, using the booking's listPrice.
-- Function bodies are the live ones (checked 2026-10-11) with only these changes.

-- The fan's discount on one experience: percentage and which one applied.
create or replace function public.reserve_fan_discount(p_fan uuid, p_creator_profile_id text, d jsonb, out pct integer, out kind text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub integer := 0;
  v_follow integer := 0;
begin
  if public.has_subscription(p_fan, p_creator_profile_id) then
    v_sub := coalesce((d->>'subscriberDiscount')::int, 0);
  end if;
  if exists (select 1 from public.follows f
             where f.user_id = p_fan and f.creator_profile_id = p_creator_profile_id
               and f.created_at <= now() - interval '7 days') then
    v_follow := coalesce((d->>'followerDiscount')::int, 0);
  end if;
  if v_sub = 0 and v_follow = 0 then
    pct := 0;
  elsif v_sub >= v_follow then
    pct := v_sub;
    kind := 'subscriber';
  else
    pct := v_follow;
    kind := 'follower';
  end if;
end;
$$;
revoke execute on function public.reserve_fan_discount(uuid, text, jsonb) from public, anon, authenticated;

-- Full price of a Reserve payment before the fan's discount (the amount itself
-- when there was none or the payment isn't a Reserve booking).
create or replace function public.reserve_list_price(p_kind text, p_key text, p_amount numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_list numeric;
begin
  if p_kind = 'vip' and p_key ~ '^vip:[0-9a-f-]{36}$' then
    select (b.details->>'listPrice')::numeric into v_list from public.vip_bookings b where b.id = substr(p_key, 5)::uuid;
  end if;
  return coalesce(v_list, p_amount);
end;
$$;
revoke execute on function public.reserve_list_price(text, text, numeric) from public, anon, authenticated;

create or replace function public.reserve_details_error(d jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_modality text := d->>'modality';
  v_locations jsonb := coalesce(d->'locationTypes', '[]'::jsonb);
  v_loc text;
begin
  if d = '{}'::jsonb then
    return null;
  end if;
  if v_modality is null or v_modality not in ('virtual', 'presencial', 'evento', 'profesional') then
    return 'Elige la modalidad';
  end if;
  if jsonb_typeof(v_locations) <> 'array' or jsonb_array_length(v_locations) = 0 then
    return 'Elige una ubicación permitida para esta experiencia';
  end if;
  for v_loc in select jsonb_array_elements_text(v_locations) loop
    if not public.reserve_location_ok(v_loc) or (v_modality = 'virtual') <> (v_loc = 'online') then
      return 'Elige una ubicación permitida para esta experiencia';
    end if;
  end loop;
  if coalesce((d->>'maxParticipants')::int, 0) not between 1 and 50 then
    return 'Indica el número máximo de participantes';
  end if;
  if coalesce((d->>'minNoticeHours')::int, -1) not in (24, 48, 72, 168) then
    return 'Elige la anticipación mínima';
  end if;
  if coalesce(d->>'approval', '') not in ('manual', 'automatic') then
    return 'Elige cómo apruebas las reservas';
  end if;
  if coalesce(d->>'cancellationPolicy', '') not in ('flexible', 'moderate', 'strict') then
    return 'Elige la política de cancelación';
  end if;
  if d ? 'subscriberDiscount' and (d->>'subscriberDiscount')::int not in (0, 5, 10, 15, 20, 25) then
    return 'Descuento no válido';
  end if;
  if d ? 'followerDiscount' and (d->>'followerDiscount')::int not in (0, 5, 10, 15, 20, 25) then
    return 'Descuento no válido';
  end if;
  if d ? 'days' and exists (select 1 from jsonb_array_elements_text(d->'days') x where x::int not between 0 and 6) then
    return 'Días no válidos';
  end if;
  return null;
exception
  when others then
    return 'Datos de la experiencia no válidos';
end;
$$;


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
  v_discount_kind text;
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
  if not (extract(dow from p_date)::smallint = any (v_av.days)) or not (p_time = any (v_av.hours))
     or (jsonb_array_length(coalesce(d->'days', '[]')) > 0 and not (d->'days') @> to_jsonb(extract(dow from p_date)::int))
     or (jsonb_array_length(coalesce(d->'hours', '[]')) > 0 and not (d->'hours') @> to_jsonb(p_time)) then
    raise exception 'Ese horario no está disponible';
  end if;
  select pct, kind into v_discount, v_discount_kind from public.reserve_fan_discount(v_fan.id, v_exp.creator_profile_id, d);
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
            'discountPercent', case when v_discount > 0 then v_discount end,
            'discountKind', case when v_discount > 0 then v_discount_kind end)))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
end;
$$;


create or replace function public.reserve_book_event_seat(p_experience_id text, p_message text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fan public.profiles;
  v_exp public.vip_experiences;
  d jsonb;
  v_date date;
  v_time text;
  v_seats integer;
  v_taken integer;
  v_sub boolean;
  v_discount integer;
  v_discount_kind text;
  v_price numeric;
  v_status text := 'pending';
  v_id uuid;
begin
  select * into v_fan from public.profiles where id = auth.uid();
  if v_fan.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  -- Locks the event so two fans can't take the last seat at once.
  select * into v_exp from public.vip_experiences where id = p_experience_id and active for update;
  if v_exp.id is null then
    raise exception 'Evento no encontrado';
  end if;
  d := v_exp.details;
  if coalesce(d->>'format', '') <> 'event' then
    raise exception 'Esta experiencia no es un Reserve Event';
  end if;
  if v_fan.creator_profile_id = v_exp.creator_profile_id then
    raise exception 'No puedes reservar tu propio evento';
  end if;
  if public.is_cut_off(v_fan.id, v_exp.creator_profile_id) then
    raise exception 'No puedes reservar con este perfil';
  end if;
  if public.reserve_text_blocked(p_message, true) then
    raise exception 'Fans Reserve no permite esta solicitud. Reserve es para experiencias concretas, en venues o lugares públicos y dentro de la plataforma.';
  end if;
  if coalesce((d->'requirements'->>'verifiedFans')::boolean, false) and not v_fan.is_verified then
    raise exception 'Este evento es solo para fans con identidad verificada';
  end if;
  v_sub := public.has_subscription(v_fan.id, v_exp.creator_profile_id);
  if coalesce((d->'requirements'->>'subscribersOnly')::boolean, false) and not v_sub then
    raise exception 'Este evento es solo para suscriptores';
  end if;
  v_date := (d->>'eventDate')::date;
  v_time := d->>'eventTime';
  -- The event's time is the creator's local time and the server runs in UTC.
  if (v_date + v_time::time) < (now() at time zone 'utc') - interval '14 hours' then
    raise exception 'Este evento ya pasó';
  end if;
  v_seats := coalesce((d->>'maxParticipants')::int, 0);
  select count(*) into v_taken from public.vip_bookings
    where experience_id = v_exp.id and details->>'kind' = 'event' and status in ('pending', 'accepted', 'confirmed');
  if v_taken >= v_seats then
    raise exception 'No quedan plazas para este evento';
  end if;
  select pct, kind into v_discount, v_discount_kind from public.reserve_fan_discount(v_fan.id, v_exp.creator_profile_id, d);
  v_price := round(v_exp.price * (100 - v_discount) / 100, 2);
  if d->>'approval' = 'automatic' then
    v_status := 'accepted';
  end if;
  insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email,
                                   date, time, message, duration_minutes, status, details)
  values (v_exp.id, v_exp.creator_profile_id, v_exp.title, v_exp.creator_name, v_price, v_fan.id, v_fan.name, v_fan.email,
          v_date, v_time, left(coalesce(trim(p_message), ''), 500), v_exp.duration_minutes, v_status,
          jsonb_strip_nulls(jsonb_build_object(
            'kind', 'event', 'typeId', v_exp.type, 'modality', coalesce(d->>'modality', 'virtual'), 'participants', 1,
            'locationType', case when coalesce(d->>'modality', 'virtual') <> 'virtual' then d->'locationTypes'->>0 end,
            'city', case when coalesce(d->>'modality', 'virtual') <> 'virtual' then d->>'city' end,
            'venue', case when coalesce(d->>'modality', 'virtual') <> 'virtual' then d->>'venue' end,
            'listPrice', case when v_discount > 0 then v_exp.price end,
            'discountPercent', case when v_discount > 0 then v_discount end,
            'discountKind', case when v_discount > 0 then v_discount_kind end)))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya tienes una plaza en este evento';
end;
$$;


create or replace function public.set_reward_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee numeric;
  v_rate numeric;
  v_list numeric;
begin
  if new.kind in ('subscription', 'renewal', 'tip', 'vip') and new.amount > 0 then
    v_fee := public.sale_gateway_fee(new.kind, new.key, new.amount);
    v_rate := least(0.90, public.reward_share(new.creator_profile_id, new.payer_id, new.created_at));
    new.gateway_fee := v_fee;
    -- A Reserve fan discount comes out of the creator's part: Fans Reserve keeps
    -- what it would have kept at the full price.
    v_list := greatest(new.amount, public.reserve_list_price(new.kind, new.key, new.amount));
    new.creator_share := greatest(0, round((v_rate * (new.amount - v_fee) - (1 - v_rate) * (v_list - new.amount)) / new.amount, 4));
  end if;
  return new;
end;
$$;


create or replace function public.set_special_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.special_accounts;
  v_fee numeric;
  v_service numeric;
  v_tax numeric;
  v_list numeric;
begin
  if new.kind <> 'vip' or new.amount <= 0 then
    return new;
  end if;
  select * into s from public.special_accounts
    where creator_profile_id = new.creator_profile_id and revoked_at is null and reserve_net;
  if s.creator_profile_id is null then
    return new;
  end if;
  v_fee := public.sale_gateway_fee(new.kind, new.key, new.amount);
  -- The 5% service fee is taken on the full price: a fan discount comes out of the creator's part.
  v_list := greatest(new.amount, public.reserve_list_price(new.kind, new.key, new.amount));
  v_service := least(new.amount - v_fee, round(v_list * 0.05, 2));
  v_tax := least(new.amount - v_fee - v_service, round(new.amount * s.tax_rate, 2));
  new.gateway_fee := v_fee;
  new.service_fee := v_service;
  new.tax_amount := v_tax;
  new.creator_share := greatest(0, least(1, round((new.amount - v_fee - v_service - v_tax) / new.amount, 4)));
  return new;
end;
$$;

