-- Cupos en vivo (Carlos, 2026-11-08): while live on TikTok or Instagram the creator
-- opens N video-call slots of X minutes for today, shares fansreserve.com/@usuario/ahora
-- and fans grab one on the spot. Each slot is an ordinary Reserve 1:1 booking with
-- automatic approval: same 15-minute payment window, same payment, call room,
-- cancellation rules and earnings. Unpaid holds are released by the existing
-- reserve_expire_payments(). Nothing here moves money. Safe to run more than once
-- only before it succeeds once (it creates a table); never re-run after it is applied.
begin;

create table public.reserve_live_drops (
  id uuid primary key default gen_random_uuid(),
  creator_profile_id text not null,
  -- Hidden (inactive) 1:1 experience the slots are booked on; never listed in the catalogue.
  experience_id text not null unique references public.vip_experiences(id) on delete cascade,
  slots integer not null check (slots between 1 and 20),
  slot_minutes integer not null check (slot_minutes in (10, 15, 20, 30)),
  price numeric(10, 2) not null check (price between 5 and 5000),
  opens_at timestamptz not null,
  first_start_at timestamptz not null,
  time_zone text not null check (public.valid_time_zone(time_zone)),
  closed_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (first_start_at > opens_at),
  check (slots * slot_minutes <= 600)
);
create index reserve_live_drops_creator on public.reserve_live_drops(creator_profile_id, created_at desc);
alter table public.reserve_live_drops enable row level security;
create policy reserve_live_drops_owner_reads on public.reserve_live_drops for select to authenticated
  using (creator_profile_id = (select public.my_creator_profile_id()));
revoke all on public.reserve_live_drops from public, anon, authenticated;
grant select on public.reserve_live_drops to authenticated;

-- Start of slot n (0-based).
create or replace function public.reserve_live_slot_start(d public.reserve_live_drops, n integer)
returns timestamptz language sql immutable set search_path = ''
as $$ select d.first_start_at + make_interval(mins => n * d.slot_minutes) $$;
revoke execute on function public.reserve_live_slot_start(public.reserve_live_drops, integer) from public, anon, authenticated;

-- A slot is held while its booking is paid, or unpaid but still inside its payment window.
create or replace function public.reserve_live_held(d public.reserve_live_drops)
returns table(slot integer, booking_id uuid, fan_id uuid, status text)
language sql stable security definer set search_path = ''
as $$
  select (b.details->>'liveSlot')::integer, b.id, b.fan_id, b.status
  from public.vip_bookings b
  where b.experience_id = d.experience_id
    and (b.status in ('confirmed', 'completed', 'disputed', 'reschedule_requested')
      or (b.status = 'accepted' and (b.payment_due_at is null or b.payment_due_at > now() or b.payment_checking)))
$$;
revoke execute on function public.reserve_live_held(public.reserve_live_drops) from public, anon, authenticated;

-- Creator: open today's slots. p_opens_in = minutes until fans can grab them (0 = now);
-- p_gap = minutes from the opening to the first call. Closes any earlier open drop.
create or replace function public.reserve_live_open(
  p_slots integer, p_minutes integer, p_price numeric, p_opens_in integer default 0, p_gap integer default 15
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  v_zone text;
  v_opens timestamptz;
  v_first timestamptz;
  v_exp text;
  v_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Debes iniciar sesión'; end if;
  if me.role <> 'creator' or me.creator_profile_id is null then raise exception 'Solo los creadores abren cupos en vivo'; end if;
  if not me.is_verified then raise exception 'Verifica tu identidad para cobrar cupos en vivo'; end if;
  if p_slots is null or p_slots not between 1 and 20 then raise exception 'Elige entre 1 y 20 cupos'; end if;
  if p_minutes is null or p_minutes not in (10, 15, 20, 30) then raise exception 'Elige 10, 15, 20 o 30 minutos por cupo'; end if;
  if p_price is null or p_price < 5 or p_price > 5000 then raise exception 'El precio va de $5 a $5,000'; end if;
  if coalesce(p_opens_in, -1) not in (0, 5, 10, 15, 30, 60) then raise exception 'Elige cuándo se abren los cupos'; end if;
  if coalesce(p_gap, -1) not in (5, 10, 15, 30, 60) then raise exception 'Elige cuándo empieza la primera llamada'; end if;
  if p_slots * p_minutes > 600 then raise exception 'Los cupos no pueden pasar de 10 horas seguidas'; end if;

  perform pg_advisory_xact_lock(hashtextextended('reserve-live:' || me.creator_profile_id, 0));
  update public.reserve_live_drops set closed_at = now()
   where creator_profile_id = me.creator_profile_id and closed_at is null;

  select time_zone into v_zone from public.vip_availability where creator_profile_id = me.creator_profile_id;
  v_zone := coalesce(v_zone, 'America/Tegucigalpa');
  v_opens := date_trunc('minute', now()) + make_interval(mins => p_opens_in);
  -- First call on a round 5-minute mark, so the times read easily on the live.
  v_first := v_opens + make_interval(mins => p_gap);
  v_first := date_trunc('hour', v_first) + make_interval(mins => (ceil(extract(minute from v_first) / 5.0) * 5)::integer);

  insert into public.vip_experiences (creator_profile_id, creator_name, title, description, type, price, duration_minutes, image, active, time_zone, details)
  values (me.creator_profile_id, me.name, 'Cupo en vivo · ' || p_minutes || ' min',
          'Videollamada 1:1 abierta durante un en vivo.', 'video-call', round(p_price, 2), p_minutes, '', false, v_zone,
          jsonb_build_object('modality', 'virtual', 'locationTypes', jsonb_build_array('online'), 'maxParticipants', 1,
                             'minNoticeHours', 0, 'approval', 'automatic', 'cancellationPolicy', 'moderate', 'liveDrop', true))
  returning id into v_exp;

  insert into public.reserve_live_drops (creator_profile_id, experience_id, slots, slot_minutes, price, opens_at, first_start_at, time_zone, created_by)
  values (me.creator_profile_id, v_exp, p_slots, p_minutes, round(p_price, 2), v_opens, v_first, v_zone, me.id)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.reserve_live_open(integer, integer, numeric, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_live_open(integer, integer, numeric, integer, integer) to authenticated;

-- Creator: stop selling. Slots already held or paid stay as they are.
create or replace function public.reserve_live_close(p_drop uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.reserve_live_drops set closed_at = coalesce(closed_at, now())
   where id = p_drop and creator_profile_id = public.my_creator_profile_id();
  if not found then raise exception 'Cupos no encontrados'; end if;
end;
$$;
revoke execute on function public.reserve_live_close(uuid) from public, anon, authenticated;
grant execute on function public.reserve_live_close(uuid) to authenticated;

-- What the page fansreserve.com/@usuario/ahora shows (visitors too): the creator's
-- current drop, how many slots are left and, for a signed-in fan, the slot they hold.
-- No other fan's identity is returned.
create or replace function public.reserve_live_status(p_username text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  c public.profiles;
  d public.reserve_live_drops;
  v_left integer;
  v_mine jsonb;
  v_next timestamptz;
begin
  select * into c from public.profiles
   where username = lower(trim(p_username)) and role = 'creator' and creator_profile_id is not null;
  if c.id is null then return null; end if;
  select * into d from public.reserve_live_drops x
   where x.creator_profile_id = c.creator_profile_id
     and public.reserve_live_slot_start(x, x.slots - 1) > now()
   order by x.created_at desc limit 1;
  if d.id is null then
    return jsonb_build_object('creatorId', c.creator_profile_id, 'creatorName', c.name, 'now', now());
  end if;
  select count(*), min(public.reserve_live_slot_start(d, n)) into v_left, v_next
  from generate_series(0, d.slots - 1) n
  where public.reserve_live_slot_start(d, n) > now() + interval '1 minute'
    and not exists (select 1 from public.reserve_live_held(d) h where h.slot = n + 1);
  if auth.uid() is not null then
    select jsonb_build_object('bookingId', b.id, 'status', b.status, 'slot', (b.details->>'liveSlot')::integer,
                              'date', b.date, 'time', b.time, 'paymentDueAt', b.payment_due_at, 'price', b.price)
      into v_mine
    from public.vip_bookings b
    where b.experience_id = d.experience_id and b.fan_id = auth.uid()
      and (b.status in ('confirmed', 'completed', 'reschedule_requested')
        or (b.status = 'accepted' and (b.payment_due_at is null or b.payment_due_at > now() or b.payment_checking)))
    order by b.created_at desc limit 1;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'creatorId', c.creator_profile_id, 'creatorName', c.name, 'now', now(),
    'drop', jsonb_build_object('id', d.id, 'slots', d.slots, 'minutes', d.slot_minutes, 'price', d.price,
      'opensAt', d.opens_at, 'firstStartAt', d.first_start_at, 'timeZone', d.time_zone,
      'closed', d.closed_at is not null, 'left', v_left, 'nextStart', v_next),
    'mine', v_mine));
end;
$$;
revoke execute on function public.reserve_live_status(text) from public, anon, authenticated;
grant execute on function public.reserve_live_status(text) to anon, authenticated;

-- Fan: take the next free slot. Returns the booking to pay (15 minutes, or until the
-- call starts if sooner). Asking again returns the slot already held.
create or replace function public.reserve_live_claim(p_drop uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  d public.reserve_live_drops;
  e public.vip_experiences;
  v_start timestamptz;
  v_local timestamp;
  v_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Debes iniciar sesión'; end if;
  select * into d from public.reserve_live_drops where id = p_drop for update;
  if d.id is null then raise exception 'Cupos no encontrados'; end if;
  if me.creator_profile_id = d.creator_profile_id then raise exception 'No puedes reservar tu propio cupo'; end if;
  if public.is_cut_off(me.id, d.creator_profile_id) then raise exception 'No puedes reservar con este perfil'; end if;
  select h.booking_id into v_id from public.reserve_live_held(d) h where h.fan_id = me.id limit 1;
  if v_id is not null then return v_id; end if;
  if d.closed_at is not null then raise exception 'El creador cerró los cupos'; end if;
  if d.opens_at > now() then raise exception 'Los cupos todavía no se abren'; end if;
  select * into e from public.vip_experiences where id = d.experience_id;
  -- Free the holds whose payment window ended, so their slots can be taken again.
  perform public.reserve_expire_payments(null);
  for n in 0 .. d.slots - 1 loop
    v_start := public.reserve_live_slot_start(d, n);
    continue when v_start <= now() + interval '1 minute';
    continue when exists (select 1 from public.reserve_live_held(d) h where h.slot = n + 1);
    v_local := v_start at time zone d.time_zone;
    begin
      insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email,
                                       date, time, message, duration_minutes, status, time_zone, details)
      values (e.id, d.creator_profile_id, e.title, e.creator_name, d.price, me.id, me.name, me.email,
              v_local::date, to_char(v_local, 'HH24:MI'), '', d.slot_minutes, 'accepted', d.time_zone,
              jsonb_build_object('kind', 'experience', 'typeId', 'video-call', 'modality', 'virtual', 'participants', 1,
                                 'liveDropId', d.id, 'liveSlot', n + 1))
      returning id into v_id;
      return v_id;
    exception when unique_violation then
      null; -- someone else's booking at that time: try the next slot
    when raise_exception then
      if sqlerrm like 'Ese horario ya no está disponible%' then null; else raise; end if;
    end;
  end loop;
  raise exception 'Ya no quedan cupos. Sigue el en vivo: el creador puede abrir más.';
end;
$$;
revoke execute on function public.reserve_live_claim(uuid) from public, anon, authenticated;
grant execute on function public.reserve_live_claim(uuid) to authenticated;

-- Creator alerts: a hold is not news (it may never be paid); a paid slot is, with its number.
do $$
declare definition text; changed text;
begin
  definition := pg_get_functiondef('public.reserve_alert()'::regprocedure);
  if position('liveDropId' in definition) > 0 then return; end if;
  changed := replace(definition, E'if tg_op = ''INSERT'' then',
    E'if tg_op = ''INSERT'' and coalesce(new.details, ''{}''::jsonb) ? ''liveDropId'' then\n    return null;\n  elsif tg_op = ''INSERT'' then');
  changed := replace(changed, E'v_title := ''Reserva confirmada y pagada'';',
    E'v_title := case when coalesce(new.details, ''{}''::jsonb) ? ''liveDropId'' then ''Cupo en vivo pagado · #'' || (new.details->>''liveSlot'') else ''Reserva confirmada y pagada'' end;');
  if position('Cupo en vivo pagado' in changed) = 0 or position(E'''liveDropId'' then\n    return null;' in changed) = 0 then
    raise exception 'Unexpected reserve_alert source';
  end if;
  execute changed;
end $$;

commit;
