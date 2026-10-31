-- Declared attendance destination, separate from residence and verified ID country.
-- No GPS, money movements, rewriting of historical bookings or payment activation.
create or replace function security_private.reserve_city_text(p_text text)
returns text language sql immutable set search_path = '' as $$
 select lower(trim(regexp_replace(regexp_replace(pg_catalog.normalize(p_text, 'NFKD'), U&'[\0300-\036f]', '', 'g'), '\s+', ' ', 'g')));
$$;

create or replace function security_private.reserve_location_key(p_location jsonb)
returns text language sql immutable set search_path = '' as $$
 select case when jsonb_typeof(p_location) = 'object'
   and p_location->>'country' = any(string_to_array('HN GT SV NI CR PA MX CO VE EC PE BO CL AR UY PY BR DO PR CU HT JM TT BZ GY SR US CA ES PT FR IT DE GB IE NL BE LU CH AT AD SE NO DK FI PL CZ HU RO GR UA RU TR GQ AO MZ CV MA EG ZA NG KE SN CI CM AE SA IL IN CN JP KR PH ID TH VN MY SG AU NZ', ' '))
   and jsonb_typeof(p_location->'city') = 'string' and jsonb_typeof(p_location->'region') = 'string'
   and char_length(trim(p_location->>'city')) between 2 and 60
   and char_length(trim(p_location->>'region')) between 2 and 60
 then jsonb_build_array(p_location->>'country', security_private.reserve_city_text(p_location->>'region'), security_private.reserve_city_text(p_location->>'city'))::text end;
$$;

create or replace function security_private.reserve_assert_attendance(p_details jsonb)
returns void language plpgsql stable set search_path = '' as $$
begin
 if coalesce(p_details->>'modality','virtual') <> 'virtual' and
   (security_private.reserve_location_key(p_details) is null
    or security_private.reserve_location_key(p_details->'attendance') is distinct from security_private.reserve_location_key(p_details)
    or coalesce(p_details->'attendance'->>'confirmedAt','') = '') then
   raise exception 'Selecciona y confirma la ciudad donde asistirás antes de pagar esta experiencia presencial.';
 end if;
end;
$$;

create or replace function public.reserve_select_attendance_city(p_country text, p_region text, p_city text)
returns void language plpgsql security definer set search_path = '' as $$
declare
 v_location jsonb := jsonb_build_object('country',p_country,'region',trim(p_region),'city',trim(p_city),'confirmedAt',now());
begin
 if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
 if security_private.reserve_location_key(v_location) is null then
   raise exception 'Indica el país, el departamento o estado y la ciudad de asistencia.';
 end if;
 update public.profiles set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('reserveAttendance',v_location) where id = auth.uid();
 if not found then raise exception 'Cuenta no encontrada'; end if;
end;
$$;

-- Validate actual experience destination, not the creator's ID nationality.
create or replace function public.reserve_check_experience_city()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if coalesce(new.details->>'modality','virtual') <> 'virtual' and new.active
    and security_private.reserve_location_key(new.details) is null then
   -- Legacy incomplete offers remain readable by their creator so they can fix them.
   -- Unrelated updates to those offers do not invent their country.
   if tg_op = 'INSERT' then
     raise exception 'Indica el país, el departamento o estado y la ciudad de la experiencia.';
   elsif new.details is distinct from old.details or not old.active then
     raise exception 'Completa el país, el departamento o estado y la ciudad de la experiencia.';
   end if;
 end if;
 return new;
end;
$$;
drop trigger if exists reserve_check_experience_city on public.vip_experiences;
create trigger reserve_check_experience_city before insert or update on public.vip_experiences
 for each row execute function public.reserve_check_experience_city();

-- RPCs for private sessions, seats and tickets all pass through this guard.
create or replace function public.reserve_check_booking_city()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_location jsonb; v_exp public.vip_experiences; v_key text;
begin
 if tg_op = 'UPDATE' then
   if coalesce(old.details->>'modality','virtual') is distinct from coalesce(new.details->>'modality','virtual')
      or (coalesce(old.details->>'modality','virtual') <> 'virtual' and
        (security_private.reserve_city_text(old.details->>'city') is distinct from security_private.reserve_city_text(new.details->>'city')
         or (security_private.reserve_location_key(old.details) is not null and security_private.reserve_location_key(old.details) is distinct from security_private.reserve_location_key(new.details)))) then
     raise exception 'El lugar de una reserva no se cambia después de solicitarla. Cancela y acuerda una nueva reserva.';
   end if;
   -- Already paid records, cancellation and reconciliation remain accessible even
   -- after the fan chooses a different destination for a later trip.
   if new.status = 'confirmed' and old.status <> 'confirmed' then
     perform security_private.reserve_assert_attendance(new.details);
   end if;
   return new;
 end if;
 select * into v_exp from public.vip_experiences where id = new.experience_id;
 if v_exp.id is not null then
   -- Older booking RPCs copy city but not country/region: derive all three here.
   new.details := new.details || jsonb_strip_nulls(jsonb_build_object('modality',coalesce(v_exp.details->>'modality','virtual'),
     'city',v_exp.details->>'city','country',v_exp.details->>'country','region',v_exp.details->>'region'));
 end if;
 if coalesce(new.details->>'modality','virtual') = 'virtual' then return new; end if;
 select settings->'reserveAttendance' into v_location from public.profiles where id = new.fan_id;
 if new.experience_id = 'custom' then
   -- The custom-request RPC accepts a city; the confirmed destination supplies
   -- country and region. Fans cannot invent the creator's service coverage.
   new.details := new.details || jsonb_build_object('country',v_location->>'country','region',v_location->>'region');
   if not exists(select 1 from public.vip_experiences e where e.creator_profile_id = new.creator_profile_id and e.active
     and coalesce(e.details->>'modality','virtual') <> 'virtual'
     and security_private.reserve_location_key(e.details) = security_private.reserve_location_key(new.details)) then
     raise exception 'Este creador no ofrece experiencias presenciales en la ciudad seleccionada.';
   end if;
 end if;
 v_key := security_private.reserve_location_key(new.details);
 if v_key is null or v_key is distinct from security_private.reserve_location_key(v_location)
    or coalesce(v_location->>'confirmedAt','') = '' then
   raise exception 'Selecciona y confirma la ciudad donde asistirás. Debe coincidir con la de la experiencia.';
 end if;
 new.details := new.details || jsonb_build_object('attendance',jsonb_build_object(
   'country',new.details->>'country','region',new.details->>'region','city',new.details->>'city','confirmedAt',now()));
 return new;
end;
$$;
drop trigger if exists reserve_check_booking_city on public.vip_bookings;
create trigger reserve_check_booking_city before insert or update on public.vip_bookings
 for each row execute function public.reserve_check_booking_city();

-- Explicit payment acknowledgement; only the fan can confirm their booking.
create or replace function public.reserve_confirm_booking_attendance(p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.vip_bookings; v_location jsonb; v_exp public.vip_experiences; v_details jsonb;
begin
 select * into b from public.vip_bookings where id=p_booking_id for update;
 if auth.uid() is null or b.id is null or b.fan_id is distinct from auth.uid() then raise exception 'Reserva no encontrada'; end if;
 if b.status not in ('pending','accepted','countered') then raise exception 'Esta reserva ya no está pendiente de pago'; end if;
 if coalesce(b.details->>'modality','virtual') = 'virtual' then return; end if;
 v_details := b.details;
 -- A previous catalogue booking can be completed only against a published,
 -- explicit destination with the same city. Never infer country from an ID.
 if security_private.reserve_location_key(v_details) is null and b.experience_id <> 'custom' then
   select * into v_exp from public.vip_experiences where id=b.experience_id;
   if coalesce(v_exp.details->>'modality','virtual') <> 'virtual'
      and security_private.reserve_city_text(b.details->>'city') = security_private.reserve_city_text(v_exp.details->>'city') then
     v_details := v_details || jsonb_build_object('country',v_exp.details->>'country','region',v_exp.details->>'region');
   end if;
 end if;
 if security_private.reserve_location_key(v_details) is null then raise exception 'El creador debe aclarar el país y la ciudad de esta reserva antes de cobrarla.'; end if;
 if security_private.reserve_location_key(v_details->'attendance') is distinct from security_private.reserve_location_key(v_details)
    or coalesce(v_details->'attendance'->>'confirmedAt','') = '' then
   select settings->'reserveAttendance' into v_location from public.profiles where id=b.fan_id;
   if security_private.reserve_location_key(v_location) is distinct from security_private.reserve_location_key(v_details)
      or coalesce(v_location->>'confirmedAt','') = '' then
     raise exception 'Selecciona y confirma la ciudad de esta reserva antes de pagar.';
   end if;
 end if;
 v_details := v_details || jsonb_build_object('attendance',jsonb_build_object('country',v_details->>'country',
   'region',v_details->>'region','city',v_details->>'city','confirmedAt',now()));
 update public.vip_bookings set details=v_details where id=b.id;
end;
$$;

-- Capture rechecks the owned, stored order; caller-supplied kind/booking cannot
-- bypass this check. A blocked old order is left intact for supervised review.
create or replace function public.reserve_assert_order_attendance(p_order_id text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare o public.paypal_orders; b public.vip_bookings;
begin
 select * into o from public.paypal_orders where id=p_order_id and user_id=auth.uid();
 if auth.uid() is null or o.id is null then raise exception 'Pedido no encontrado'; end if;
 if o.kind <> 'booking' then return; end if;
 select * into b from public.vip_bookings where id=(o.params->>'bookingId')::uuid and fan_id=auth.uid();
 if b.id is null then raise exception 'Reserva no encontrada'; end if;
 perform security_private.reserve_assert_attendance(b.details);
end;
$$;

revoke all on function security_private.reserve_city_text(text), security_private.reserve_location_key(jsonb), security_private.reserve_assert_attendance(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.reserve_check_experience_city(), public.reserve_check_booking_city() from public, anon, authenticated, service_role;
revoke all on function public.reserve_select_attendance_city(text,text,text), public.reserve_confirm_booking_attendance(uuid), public.reserve_assert_order_attendance(text) from public, anon, authenticated, service_role;
grant execute on function public.reserve_select_attendance_city(text,text,text), public.reserve_confirm_booking_attendance(uuid), public.reserve_assert_order_attendance(text) to authenticated;

create or replace function public.paypal_quote(p_kind text, p_params jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_creator text := p_params->>'creatorProfileId';
  v_amount numeric;
  v_desc text;
  v_pack public.coin_packs;
  v_today numeric;
  b public.vip_bookings;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;

  if p_kind = 'coins' then
    select * into v_pack from public.coin_packs where id = p_params->>'packId';
    if v_pack.id is null then
      raise exception 'Paquete no encontrado';
    end if;
    if not v_me.is_verified then
      select coalesce(sum(price), 0) into v_today from public.coin_purchases
        where user_id = v_me.id and created_at > now() - interval '1 day';
      if v_today + v_pack.price > 300 then
        raise exception 'Sin verificar tu identidad puedes comprar hasta $300 al día. Verifícate en Configuración para comprar más.';
      end if;
    end if;
    v_amount := v_pack.price;
    v_desc := 'Créditos: ' || v_pack.name;

  elsif p_kind = 'tip' then
    if public.creator_price(v_creator) is null then
      raise exception 'Creador no encontrado';
    end if;
    perform public.assert_creator_accepts_payments(v_creator);
    if v_me.creator_profile_id = v_creator then
      raise exception 'No puedes enviarte una propina a ti mismo';
    end if;
    if public.is_cut_off(v_me.id, v_creator) then
      raise exception 'No puedes enviar propinas a este perfil';
    end if;
    v_amount := round((p_params->>'amount')::numeric, 2);
    if v_amount is null or v_amount < 3 or v_amount > 500 then
      raise exception 'La propina debe estar entre $3 y $500';
    end if;
    v_desc := 'Propina para ' || public.creator_display_name(v_creator);

  elsif p_kind = 'booking' then
    select * into b from public.vip_bookings where id = (p_params->>'bookingId')::uuid;
    if b.id is null or b.fan_id is distinct from v_me.id then
      raise exception 'Reserva no encontrada';
    end if;
    if b.status <> 'accepted' then
      raise exception 'Solo puedes pagar una reserva aceptada por el creador';
    end if;
    perform security_private.reserve_assert_attendance(b.details);
    v_amount := b.price;
    v_desc := 'Reserve: ' || b.title;

  else
    raise exception 'Este pago todavía no se hace con PayPal';
  end if;

  return jsonb_build_object('amount', round(v_amount, 2), 'description', left(v_desc, 120));
end;
$$;

