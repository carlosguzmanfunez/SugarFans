-- Reserve (2026-10-02): structured, creator-controlled access to experiences.
-- "Fans Reserve permite reservar experiencias, no personas."
--
-- Additive and backward compatible. Nothing is renamed or deleted:
--  * vip_experiences: new `details` jsonb (modality, venue types, includes and
--    excludes, requirements, participants, notice, approval, cancellation policy,
--    subscriber discount, own days and hours). The type list grows; the five
--    original types stay valid. A new trigger validates details and text.
--  * vip_bookings: new `details` jsonb (what was booked or requested, the
--    creator's counter-offer) and four more statuses: countered (used now),
--    reschedule_requested, completed and disputed (reserved for the next phase).
--  * New RPCs: reserve_create_booking, reserve_request_custom,
--    reserve_counter_offer, reserve_respond_counter, creator_category,
--    follower_count. vip_create_booking / vip_update_booking / vip_pay_booking
--    are not changed: paying a Reserve is the same step as before (test mode).
--  * follows: the free "Seguir" relation (no access, no Reserve).
--  * The demo catalogue rows (created_by is null, original titles) are
--    aligned with the Reserve catalogue; three demo experiences are added.
--
-- The lists below mirror src/config/reserve.ts (e2e checks they match).
-- LEGAL: the blocked phrases and venue rules are product drafts. Requires
-- legal review before production launch.

-- ---------------------------------------------------------------------
-- Text and details checks (internal)
-- ---------------------------------------------------------------------

-- Phrases that are never acceptable in an experience or a request: sexual
-- services, escort or compensated dating, hotel rooms, moving the deal off the
-- platform; for requests also private homes. Phrases, not single words, and
-- negated mentions ("sin contenido sexual") are skipped. The app runs the fuller
-- rule set (src/lib/moderation.ts) and flags ambiguous mentions for review.
create or replace function public.reserve_text_blocked(p_text text, p_request boolean default false)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with t as (
    select regexp_replace(
      translate(lower(coalesce(p_text, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun'),
      '\m(sin|no|nunca|cero|nada de|prohibid[oa]s?|no se permiten?)\s+(\S+\s+){0,2}\S+', ' ', 'g') as v
  )
  select v ~ ('\m(escorts?|prostitu\w*|sexting|cibersexo|servicios? (sexual|sexuales|intimos?|eroticos?)'
              '|(actos?|actividad|relaciones|encuentros?) (sexual|sexuales|intimos?)'
              '|encuentros? (privados?|intimos?|a solas|discretos?)|citas? (romanticas?|pagadas?|a ciegas|intimas?)'
              '|pagar (por|para) (una )?cita|pagar para conocer\w*|pasar (la|una) noche|novi[oa] de alquiler'
              '|sugar (daddy|baby|dating)|compensated dating|girlfriend experience|happy ending|final feliz'
              '|masaje erotico|porno\w*|(habitacion|cuarto|suite) (de|del|en el|en un|de un) (hotel|motel)|motel'
              '|(seas|ser|sea) mi (novi[oa]|pareja|amante)|novi[oa] por (un|una) (dia|noche|hora)'
              '|whatsapp|telegram|snapchat|onlyfans)\M')
      or (p_request and v ~ '\m((mi|tu|su) (casa|depa|departamento|apartamento|cuarto|habitacion|recamara)|a domicilio)\M')
  from t;
$$;

-- Venue types Reserve may use. Private homes, hotel rooms and "private
-- meetings" are not in the list, so they can never be stored.
create or replace function public.reserve_location_ok(p_location text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_location in ('online', 'public-place', 'restaurant', 'event-venue', 'convention', 'studio', 'gym', 'salon',
                        'culinary-space', 'art-space', 'gaming-venue', 'commercial-space');
$$;

-- Null when an experience's details are valid, otherwise the error to show.
-- '{}' is an experience made before Reserve (virtual, online, manual approval).
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
  if d ? 'days' and exists (select 1 from jsonb_array_elements_text(d->'days') x where x::int not between 0 and 6) then
    return 'Días no válidos';
  end if;
  return null;
exception
  when others then
    return 'Datos de la experiencia no válidos';
end;
$$;
revoke execute on function public.reserve_text_blocked(text, boolean) from public, anon, authenticated;
revoke execute on function public.reserve_location_ok(text) from public, anon, authenticated;
revoke execute on function public.reserve_details_error(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Experiences
-- ---------------------------------------------------------------------
alter table public.vip_experiences drop constraint if exists vip_experiences_type_check;
alter table public.vip_experiences add constraint vip_experiences_type_check check (type in (
  'video-call', 'live-1-1', 'qa-session', 'personal-greeting', 'custom-content', 'early-access', 'themed-talk', 'coaching',
  'mentoring', 'creative-session', 'feedback', 'fashion-beauty-talk', 'behind-the-scenes', 'meet-greet', 'workshop', 'event',
  'appearance', 'fan-event', 'collaboration', 'production', 'photo-session', 'cooking-class', 'culinary-consulting', 'catering',
  'tasting', 'gastronomic-experience', 'training-1-1', 'custom-routine', 'assessment', 'clinic', 'music-class',
  'listening-session', 'studio-session', 'private-match', 'gaming-session', 'stream-1-1', 'tournament', 'art-class',
  'portfolio-review', 'art-session', 'beauty-consulting', 'styling', 'makeup-session', 'themed-experience'
));
alter table public.vip_experiences add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.vip_experiences add constraint vip_experiences_details_check
  check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8000);

-- Runs next to fill_vip_experience (which fixes the owner); validates what is offered.
create or replace function public.check_vip_experience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error text := public.reserve_details_error(new.details);
begin
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  -- What is offered (excludes and conditions say what is not offered).
  if public.reserve_text_blocked(concat_ws(' ', new.title, new.description, new.details->>'venue', new.details->>'city',
                                           new.details->'includes', new.details->'requirements'->>'notes')) then
    raise exception 'Fans Reserve no permite esta experiencia. Revisa la descripción: solo experiencias permitidas, en venues o lugares públicos y dentro de la plataforma.';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_vip_experience() from public, anon, authenticated;
create trigger check_vip_experience
  before insert or update on public.vip_experiences
  for each row execute function public.check_vip_experience();

-- ---------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------
alter table public.vip_bookings drop constraint if exists vip_bookings_status_check;
alter table public.vip_bookings add constraint vip_bookings_status_check check (status in (
  'pending', 'accepted', 'confirmed', 'rejected', 'cancelled',
  'countered', 'reschedule_requested', 'completed', 'disputed'
));
alter table public.vip_bookings add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.vip_bookings add constraint vip_bookings_details_check
  check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8000);

-- Book a defined experience: participants, the creator's requirements
-- (verified fans, subscribers only), minimum notice, the experience's own days
-- and hours, the explicit subscriber discount and automatic approval.
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
  if not (extract(dow from p_date)::smallint = any (v_av.days)) or not (p_time = any (v_av.hours))
     or (jsonb_array_length(coalesce(d->'days', '[]')) > 0 and not (d->'days') @> to_jsonb(extract(dow from p_date)::int))
     or (jsonb_array_length(coalesce(d->'hours', '[]')) > 0 and not (d->'hours') @> to_jsonb(p_time)) then
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

-- "Solicitar experiencia personalizada": a structured proposal (modality,
-- purpose, date, duration, participants, venue type, budget, message).
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
  v_av public.vip_availability;
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
  select * into v_av from public.vip_availability where creator_profile_id = p_creator_profile_id;
  if v_av.creator_profile_id is null then
    v_av.days := '{1,2,3,4,5}';
    v_av.hours := '{10:00,12:00,16:00,18:00}';
  end if;
  if not (extract(dow from p_date)::smallint = any (v_av.days)) or not (p_time = any (v_av.hours)) then
    raise exception 'Ese horario no está disponible';
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

-- The creator answers a pending request with other terms (or the same terms
-- and a note asking for changes). The fan accepts or declines.
create or replace function public.reserve_counter_offer(
  p_booking_id uuid, p_price numeric, p_date date, p_time text, p_duration integer, p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.vip_bookings;
begin
  select * into b from public.vip_bookings where id = p_booking_id for update;
  if b.id is null or b.creator_profile_id is distinct from public.my_creator_profile_id() then
    raise exception 'Reserva no encontrada';
  end if;
  if b.status <> 'pending' then
    raise exception 'Solo puedes responder a solicitudes pendientes';
  end if;
  if p_price is null or p_price < 5 or p_price > 5000 then
    raise exception 'El precio debe estar entre $5 y $5000';
  end if;
  if p_date < current_date + 1 or p_date > (current_date + interval '3 months')::date or p_time !~ '^\d{2}:\d{2}$' then
    raise exception 'La fecha debe estar dentro de los próximos 3 meses';
  end if;
  if p_duration is not null and p_duration not between 10 and 180 then
    raise exception 'La duración debe estar entre 10 y 180 minutos';
  end if;
  if char_length(coalesce(p_note, '')) > 300 or public.reserve_text_blocked(p_note, true) then
    raise exception 'Revisa el mensaje de la contraoferta';
  end if;
  update public.vip_bookings
    set status = 'countered', updated_at = now(),
        details = details || jsonb_build_object('counter', jsonb_strip_nulls(jsonb_build_object(
          'price', round(p_price, 2), 'date', p_date, 'time', p_time, 'durationMinutes', p_duration,
          'note', trim(coalesce(p_note, '')), 'at', now())))
    where id = b.id;
end;
$$;

create or replace function public.reserve_respond_counter(p_booking_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.vip_bookings;
  c jsonb;
begin
  select * into b from public.vip_bookings where id = p_booking_id for update;
  if b.id is null or b.fan_id is distinct from auth.uid() then
    raise exception 'Reserva no encontrada';
  end if;
  c := b.details->'counter';
  if b.status <> 'countered' or c is null then
    raise exception 'Esta reserva no tiene una contraoferta pendiente';
  end if;
  if p_accept then
    update public.vip_bookings
      set status = 'accepted', updated_at = now(),
          price = (c->>'price')::numeric, date = (c->>'date')::date, time = c->>'time',
          duration_minutes = coalesce((c->>'durationMinutes')::int, duration_minutes)
      where id = b.id;
  else
    update public.vip_bookings set status = 'cancelled', updated_at = now() where id = b.id;
  end if;
exception
  when unique_violation then
    raise exception 'Ese horario ya no está disponible. Pide al creator otra fecha.';
end;
$$;

revoke execute on function public.reserve_create_booking(text, date, text, text, integer) from public, anon;
revoke execute on function public.reserve_request_custom(text, date, text, integer, numeric, integer, text, text, jsonb) from public, anon;
revoke execute on function public.reserve_counter_offer(uuid, numeric, date, text, integer, text) from public, anon;
revoke execute on function public.reserve_respond_counter(uuid, boolean) from public, anon;
grant execute on function public.reserve_create_booking(text, date, text, text, integer) to authenticated;
grant execute on function public.reserve_request_custom(text, date, text, integer, numeric, integer, text, text, jsonb) to authenticated;
grant execute on function public.reserve_counter_offer(uuid, numeric, date, text, integer, text) to authenticated;
grant execute on function public.reserve_respond_counter(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Creator category (public, decides which experiences a creator offers)
-- ---------------------------------------------------------------------
create or replace function public.creator_category(p_creator_profile_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(p.settings->>'category', '') from public.profiles p
      where p.creator_profile_id = p_creator_profile_id and p.role = 'creator'),
    (select nullif(m.category, '') from public.managed_profiles m where m.id = p_creator_profile_id),
    (select d.category from (values ('1', 'Modelaje & Glamour'), ('2', 'Fitness'), ('3', 'Arte & Creatividad'),
      ('4', 'Lifestyle'), ('5', 'Música'), ('6', 'Cocina')) as d(id, category) where d.id = p_creator_profile_id),
    ''
  );
$$;
grant execute on function public.creator_category(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Follow (free; never grants content, Lives or Reserve)
-- ---------------------------------------------------------------------
create table if not exists public.follows (
  user_id uuid not null references public.profiles (id) on delete cascade,
  creator_profile_id text not null check (char_length(creator_profile_id) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (user_id, creator_profile_id)
);
create index if not exists follows_creator_idx on public.follows (creator_profile_id);

alter table public.follows enable row level security;

create policy "follows: user reads own" on public.follows
  for select to authenticated using (user_id = (select auth.uid()));
create policy "follows: user adds own" on public.follows
  for insert to authenticated
  with check (user_id = (select auth.uid()) and creator_profile_id is distinct from (select public.my_creator_profile_id()));
create policy "follows: user removes own" on public.follows
  for delete to authenticated using (user_id = (select auth.uid()));

-- How many people follow a profile, without exposing who.
create or replace function public.follower_count(p_creator_profile_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.follows where creator_profile_id = p_creator_profile_id;
$$;
grant execute on function public.follower_count(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Demo catalogue (same ids and content as src/data/mockData.ts)
-- Only rows still as seeded: never overwrites a creator's own edits.
-- ---------------------------------------------------------------------
update public.vip_experiences set type = 'video-call', title = 'Videollamada 1:1',
  description = 'Videollamada privada dentro de Fans Reserve para hablar de moda, estilo y backstage. Tú propones el tema y yo traigo consejos y respuestas.',
  image = '',
  details = '{"modality":"virtual","locationTypes":["online"],"includes":["Sala privada de Fans Reserve","Tema acordado de antemano","Consejos de estilo personalizados"],"excludes":["Grabación de la sesión","Contacto o pagos fuera de Fans Reserve"],"requirements":{"verifiedFans":false,"subscribersOnly":false},"minNoticeHours":24,"maxParticipants":1,"approval":"manual","cancellationPolicy":"moderate","subscriberDiscount":10}'
  where id = '1' and created_by is null and title = 'Video Llamada VIP Personalizada';
update public.vip_experiences set type = 'coaching', title = 'Coaching y plan de entrenamiento',
  description = 'Sesión de coaching por video en la que diseño un plan de entrenamiento específico para tus objetivos.',
  image = '',
  details = '{"modality":"virtual","locationTypes":["online"],"includes":["Evaluación de tu nivel","Plan de 4 semanas en PDF"],"excludes":["Grabación de la sesión"],"requirements":{"verifiedFans":false,"subscribersOnly":false},"minNoticeHours":24,"maxParticipants":1,"approval":"manual","cancellationPolicy":"flexible"}'
  where id = '2' and created_by is null and title = 'Plan de Entrenamiento 1:1';
update public.vip_experiences set type = 'art-class', title = 'Clase de arte digital',
  description = 'Clase privada en la que te enseño técnicas de arte digital según tu nivel y preferencias.',
  image = '',
  details = '{"modality":"virtual","locationTypes":["online"],"includes":["Archivo de pinceles","Ejercicio guiado"],"excludes":["Grabación de la sesión"],"requirements":{"verifiedFans":false,"subscribersOnly":false},"minNoticeHours":48,"maxParticipants":2,"approval":"manual","cancellationPolicy":"moderate"}'
  where id = '3' and created_by is null and title = 'Tutorial de Arte Personalizado';
update public.vip_experiences set type = 'early-access', title = 'Acceso anticipado a mi próximo proyecto',
  description = 'Acceso anticipado a mi próximo proyecto de baile y un video exclusivo del proceso creativo, entregado en la app.',
  image = '',
  details = '{"modality":"virtual","locationTypes":["online"],"includes":["Estreno 7 días antes","Video del proceso creativo"],"excludes":["Sesión en vivo"],"requirements":{"verifiedFans":false,"subscribersOnly":false},"minNoticeHours":24,"maxParticipants":1,"approval":"automatic","cancellationPolicy":"strict"}'
  where id = '4' and created_by is null and title = 'Behind the Scenes Exclusivo';
update public.vip_experiences set type = 'cooking-class', title = 'Clase de cocina en vivo',
  description = 'Clase por video en la que cocinamos juntos una receta exclusiva. Incluye lista de ingredientes y tips profesionales.',
  image = '',
  details = '{"modality":"virtual","locationTypes":["online"],"includes":["Lista de ingredientes previa","Receta en PDF"],"excludes":["Ingredientes","Grabación de la sesión"],"requirements":{"verifiedFans":false,"subscribersOnly":false},"minNoticeHours":48,"maxParticipants":4,"approval":"manual","cancellationPolicy":"moderate"}'
  where id = '5' and created_by is null and title = 'Clase de Cocina Privada';

insert into public.vip_experiences (id, creator_profile_id, creator_name, title, description, type, price, duration_minutes, image, details) values
  ('6', '1', 'Valentina Rose', 'Meet & Greet en Miami',
   'Saludo, foto y firma en un venue público de Miami, durante mi agenda de eventos. El lugar exacto se confirma con la reserva.',
   'meet-greet', 150, 30, '',
   '{"modality":"presencial","locationTypes":["public-place","event-venue"],"city":"Miami","includes":["Foto juntos","Firma personalizada"],"excludes":["Encuentros fuera del venue","Transporte"],"requirements":{"verifiedFans":true,"subscribersOnly":false},"minNoticeHours":72,"maxParticipants":2,"approval":"manual","cancellationPolicy":"moderate"}'),
  ('7', '1', 'Valentina Rose', 'Fashion & beauty talk',
   'Veinte minutos por video para revisar tu estilo, tu rutina de belleza y tus dudas de moda.',
   'fashion-beauty-talk', 75, 20, '',
   '{"modality":"virtual","locationTypes":["online"],"includes":["Sala privada de Fans Reserve","Lista de recomendaciones después de la llamada"],"excludes":["Grabación de la sesión","Contacto o pagos fuera de Fans Reserve"],"requirements":{"verifiedFans":true,"subscribersOnly":false},"minNoticeHours":48,"maxParticipants":1,"approval":"manual","cancellationPolicy":"moderate","days":[1,3]}'),
  ('8', '2', 'Diego Torres', 'Entrenamiento en gimnasio',
   'Entrenamiento 1:1 en un gimnasio de Ciudad de México: técnica, rutina y correcciones en directo.',
   'training-1-1', 120, 60, '',
   '{"modality":"presencial","locationTypes":["gym"],"city":"Ciudad de México","includes":["Acceso de un día al gimnasio","Rutina por escrito"],"excludes":["Suplementos","Transporte"],"requirements":{"verifiedFans":false,"subscribersOnly":false},"minNoticeHours":48,"maxParticipants":2,"approval":"automatic","cancellationPolicy":"flexible"}')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Gifts no longer earn a private video call (a gift never buys a conversation
-- or a meeting; calls are booked as Reserve experiences). Call perks already
-- earned keep working: only the setting that grants new ones is switched off.
-- ---------------------------------------------------------------------------
update public.creator_gift_settings set offers_call = false where offers_call;
alter table public.creator_gift_settings
  add constraint creator_gift_settings_no_new_calls check (offers_call = false);
