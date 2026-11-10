-- Tablero de cupos en vivo (Carlos, 2026-11-10): the page fansreserve.com/@usuario/ahora
-- shows every slot with its time; the fan ticks the one they want and reserves it.
-- A paid slot shows as taken to everyone, a slot being paid shows as held, and the
-- page hears about each change within a second through a public Realtime broadcast
-- (no fan data travels in it; the page then asks reserve_live_status again).
-- Changes no table and moves no money. Safe to run more than once.
begin;

-- Same as before plus drop.board: one entry per slot, in order, with its state:
-- free, held (someone is inside the 15-minute payment window), taken (paid, or the
-- creator has another booking at that time) or past (its time arrived with nobody in it). No fan identity is returned.
create or replace function public.reserve_live_status(p_username text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  c public.profiles;
  d public.reserve_live_drops;
  v_left integer;
  v_mine jsonb;
  v_next timestamptz;
  v_board jsonb;
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
  select count(*) filter (where s.state = 'free'), min(s.starts) filter (where s.state = 'free'),
         jsonb_agg(jsonb_build_object('n', s.n, 'start', s.starts, 'state', s.state) order by s.n)
    into v_left, v_next, v_board
  from (
    select n + 1 as n, public.reserve_live_slot_start(d, n) as starts,
           case when h.status = 'accepted' then 'held'
                when h.status is not null then 'taken'
                -- Another booking of this creator (any experience) overlaps that time.
                when exists (
                  select 1 from public.vip_bookings b
                  where b.creator_profile_id = d.creator_profile_id and b.experience_id <> d.experience_id
                    and b.status in ('pending', 'accepted', 'confirmed', 'reschedule_requested') and b.time_zone is not null
                    and ((b.date + b.time::time) at time zone b.time_zone) < public.reserve_live_slot_start(d, n + 1)
                    and ((b.date + b.time::time) at time zone b.time_zone) + make_interval(mins => coalesce(b.duration_minutes, 60))
                        > public.reserve_live_slot_start(d, n)
                ) then 'taken'
                when public.reserve_live_slot_start(d, n) <= now() + interval '1 minute' then 'past'
                else 'free' end as state
    from generate_series(0, d.slots - 1) n
    left join lateral (
      select x.status from public.reserve_live_held(d) x where x.slot = n + 1
      order by (x.status = 'accepted') limit 1
    ) h on true
  ) s;
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
      'closed', d.closed_at is not null, 'left', v_left, 'nextStart', v_next, 'board', v_board),
    'mine', v_mine));
end;
$$;
revoke execute on function public.reserve_live_status(text) from public, anon, authenticated;
grant execute on function public.reserve_live_status(text) to anon, authenticated;

-- Fan: take the slot they ticked (p_slot, 1-based) or, without it, the next free one.
-- Returns the booking to pay (15 minutes, or until the call starts if sooner). A fan
-- who already holds a slot in this drop gets that one back.
drop function if exists public.reserve_live_claim(uuid);
create or replace function public.reserve_live_claim(p_drop uuid, p_slot integer default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  d public.reserve_live_drops;
  e public.vip_experiences;
  v_start timestamptz;
  v_local timestamp;
  v_id uuid;
  v_gone constant text := 'Ese cupo ya no está disponible. Recarga la página para ver los cupos disponibles.';
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
  if p_slot is not null and p_slot not between 1 and d.slots then raise exception '%', v_gone; end if;
  select * into e from public.vip_experiences where id = d.experience_id;
  -- Free the holds whose payment window ended, so their slots can be taken again.
  perform public.reserve_expire_payments(null);
  for n in coalesce(p_slot - 1, 0) .. coalesce(p_slot - 1, d.slots - 1) loop
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
  if p_slot is not null then raise exception '%', v_gone; end if;
  raise exception 'Ya no quedan cupos. Sigue el en vivo: el creador puede abrir más.';
end;
$$;
revoke execute on function public.reserve_live_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_live_claim(uuid, integer) to authenticated;

-- Tell the open pages that this creator's board changed. Public broadcast on the topic
-- cupos:<creator profile id> with an empty payload. Never blocks a booking or a
-- payment: without Realtime the pages still refresh on their own every few seconds.
create or replace function public.reserve_live_ping(p_creator_profile_id text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_creator_profile_id is null or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return; end if;
  execute 'select realtime.send($1, $2, $3, $4)' using '{}'::jsonb, 'cambio', 'cupos:' || p_creator_profile_id, false;
exception when others then
  null;
end;
$$;
revoke execute on function public.reserve_live_ping(text) from public, anon, authenticated;

create or replace function public.reserve_live_booking_ping()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare b public.vip_bookings;
begin
  if tg_op = 'DELETE' then b := old; else b := new; end if;
  if coalesce(b.details, '{}'::jsonb) ? 'liveDropId'
     and (tg_op <> 'UPDATE' or new.status is distinct from old.status or new.payment_due_at is distinct from old.payment_due_at) then
    perform public.reserve_live_ping(b.creator_profile_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.reserve_live_booking_ping() from public, anon, authenticated;
drop trigger if exists reserve_live_booking_ping on public.vip_bookings;
create trigger reserve_live_booking_ping after insert or update or delete on public.vip_bookings
  for each row execute function public.reserve_live_booking_ping();

create or replace function public.reserve_live_drop_ping()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.reserve_live_ping(new.creator_profile_id);
  return null;
end;
$$;
revoke execute on function public.reserve_live_drop_ping() from public, anon, authenticated;
drop trigger if exists reserve_live_drop_ping on public.reserve_live_drops;
create trigger reserve_live_drop_ping after insert or update on public.reserve_live_drops
  for each row execute function public.reserve_live_drop_ping();

commit;
