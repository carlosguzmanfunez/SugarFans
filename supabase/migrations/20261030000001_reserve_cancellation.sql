-- Reserve cancellation: one rule for every experience (Carlos, 2026-10-29).
-- Replaces the per-experience Flexible / Moderada / Estricta policies.
--
--   Fan cancels 24 h or more before the start ... 100% back in Créditos.
--   Fan cancels less than 24 h before ........... 50% back in Créditos; the
--                                                 creator keeps half of what
--                                                 they would have earned.
--   Fan does not show up ........................ nothing back (no action here).
--   Creator cancels a paid booking .............. 100% back in Créditos, the
--                                                 creator earns nothing and it
--                                                 counts against their record.
--   One free date change per 1:1 booking, asked 24 h or more before the start;
--   the creator accepts or declines it.
--
-- Refunds are Créditos, never cash: the money stays in Fans Reserve (the PayPal
-- fee is not returned by PayPal) and the fan can spend it on another Reserve or
-- on gifts. The original sale is never rewritten: only creator_refund_loss
-- changes, the same column partial refunds already use, so the ledger, the
-- statement and the payouts follow on their own.
--
-- Same numbers as src/lib/reserveCancellation.ts: change both.
--
-- Additive: two new tables, new functions, and coin_balance / reward_reliable /
-- ticket_booking_sync replaced with the same signatures.

create or replace function public.reserve_cancel_hours()
returns int language sql immutable set search_path = '' as $$ select 24 $$;

create or replace function public.reserve_late_refund_percent()
returns int language sql immutable set search_path = '' as $$ select 50 $$;

-- When a booking starts: its date and hour in the creator's time zone
-- (Honduras for bookings saved before time zones existed).
create or replace function public.reserve_booking_start(b public.vip_bookings)
returns timestamptz language sql stable set search_path = '' as $$
  select (b.date + coalesce(nullif(b.time, ''), '00:00')::time) at time zone coalesce(b.time_zone, 'America/Tegucigalpa');
$$;
revoke execute on function public.reserve_booking_start(public.vip_bookings) from public, anon, authenticated;

-- 1. Créditos the platform gives back (not bought) and Créditos spent on Reserve.

create table if not exists public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  coins bigint not null check (coins > 0),
  reason text not null check (reason in ('reserve_cancel')),
  booking_id uuid references public.vip_bookings(id) on delete set null,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create unique index if not exists credit_grants_one_per_booking on public.credit_grants (booking_id, reason) where booking_id is not null;
create index if not exists credit_grants_user on public.credit_grants (user_id, created_at);
alter table public.credit_grants enable row level security;
drop policy if exists "credit_grants: owner or admin reads" on public.credit_grants;
create policy "credit_grants: owner or admin reads" on public.credit_grants
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke all on public.credit_grants from public, anon, authenticated;
grant select on public.credit_grants to authenticated;

create table if not exists public.credit_spends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  coins bigint not null check (coins > 0),
  booking_id uuid not null references public.vip_bookings(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (booking_id)
);
create index if not exists credit_spends_user on public.credit_spends (user_id, created_at);
alter table public.credit_spends enable row level security;
drop policy if exists "credit_spends: owner or admin reads" on public.credit_spends;
create policy "credit_spends: owner or admin reads" on public.credit_spends
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke all on public.credit_spends from public, anon, authenticated;
grant select on public.credit_spends to authenticated;

-- Wallet = bought − gifts (as before) + given back − spent on Reserve.
create or replace function public.coin_balance(p_user uuid) returns bigint
 language sql stable security definer set search_path='' as $$
 select coalesce((select sum(c.coins-c.refunded_coins) from public.coin_purchases c where c.user_id=p_user and c.status='paid'),0)
 - coalesce((select sum(round(t.amount*100)-t.refunded_coins) from public.transactions t
 where t.payer_id=p_user and t.kind='gift' and t.status='paid'),0)::bigint
 + coalesce((select sum(g.coins) from public.credit_grants g where g.user_id=p_user),0)::bigint
 - coalesce((select sum(s.coins) from public.credit_spends s where s.user_id=p_user),0)::bigint;
$$;

-- 2. Pay an accepted Reserve with Créditos (all of it; no mixing with PayPal).
-- The creator is credited exactly like a PayPal sale.
create or replace function public.reserve_pay_with_credits(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.vip_bookings;
  v_coins bigint;
  v_tx uuid;
begin
  perform finance_private.lock_book();
  select * into b from public.vip_bookings where id = p_booking_id for update;
  if b.id is null or b.fan_id is distinct from auth.uid() then
    raise exception 'Reserva no encontrada';
  end if;
  if b.status <> 'accepted' then
    raise exception 'Solo puedes pagar una reserva aceptada por el creador';
  end if;
  if coalesce(b.details, '{}'::jsonb) ? 'ticketId' then
    raise exception 'Esta reserva usa un ticket de Meta de experiencia';
  end if;
  if public.reserve_booking_start(b) <= now() then
    raise exception 'Esta reserva ya empezó';
  end if;
  v_coins := round(b.price * 100);
  -- One spend at a time per fan, so two payments cannot use the same Créditos.
  perform pg_advisory_xact_lock(hashtext('coins:' || b.fan_id::text));
  if public.coin_balance(b.fan_id) < v_coins then
    raise exception 'No tienes suficientes créditos para pagar esta reserva';
  end if;
  insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, note)
  values ('vip:' || b.id, b.fan_id, b.fan_name, b.creator_profile_id, b.creator_name, 'vip', b.price, 'Créditos', 'paid', b.title)
  returning id into v_tx;
  insert into public.credit_spends (user_id, coins, booking_id, transaction_id) values (b.fan_id, v_coins, b.id, v_tx);
  update public.vip_bookings
    set status = 'confirmed', paid_at = now(), email_sent_at = now(), updated_at = now()
    where id = b.id;
  insert into public.email_outbox (user_id, booking_id, to_email, subject, body)
  values (
    b.fan_id, b.id, b.fan_email,
    'Confirmación: ' || b.title,
    'Hola ' || b.fan_name || ', tu experiencia "' || b.title || '" con ' || b.creator_name ||
    ' está confirmada para el ' || to_char(b.date, 'DD/MM/YYYY') || ' a las ' || b.time ||
    '. Pagaste con ' || v_coins || ' créditos.'
  );
end;
$$;
revoke execute on function public.reserve_pay_with_credits(uuid) from public, anon;
grant execute on function public.reserve_pay_with_credits(uuid) to authenticated;

-- 3. Cancel. Before payment nothing moves; after payment the rule above applies.
create or replace function public.reserve_cancel(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.vip_bookings;
  t public.transactions;
  v_is_fan boolean;
  v_is_creator boolean;
  v_by text;
  v_start timestamptz;
  v_hours numeric;
  v_percent int;
  v_coins bigint := 0;
  v_ticket boolean;
  v_ticket_back boolean := false;
  v_fan_first text;
  v_creator_first text;
  v_when text;
  v_result jsonb;
begin
  perform finance_private.lock_book();
  select * into b from public.vip_bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'Reserva no encontrada';
  end if;
  v_is_fan := coalesce(b.fan_id = auth.uid(), false);
  v_is_creator := coalesce(b.creator_profile_id = public.my_creator_profile_id(), false);
  if not (v_is_fan or v_is_creator) then
    raise exception 'Reserva no encontrada';
  end if;

  -- Not paid yet: the fan withdraws the request, nothing is charged.
  if v_is_fan and b.status in ('pending', 'accepted', 'countered') then
    update public.vip_bookings
      set status = 'cancelled', updated_at = now(),
          details = coalesce(details, '{}'::jsonb) || jsonb_build_object('cancellation', jsonb_build_object('by', 'fan', 'at', now(), 'paid', false))
      where id = b.id;
    return jsonb_build_object('paid', false, 'by', 'fan', 'refundCoins', 0, 'refundPercent', 0);
  end if;

  if b.status <> 'confirmed' then
    raise exception 'Esta reserva ya no se puede cancelar';
  end if;
  v_start := public.reserve_booking_start(b);
  if v_start <= now() then
    raise exception 'La experiencia ya empezó: ya no se puede cancelar. Si hubo un problema, repórtalo.';
  end if;
  v_by := case when v_is_creator and not v_is_fan then 'creator' else 'fan' end;
  v_hours := extract(epoch from (v_start - now())) / 3600;
  v_percent := case when v_by = 'creator' or v_hours >= public.reserve_cancel_hours() then 100 else public.reserve_late_refund_percent() end;
  v_ticket := coalesce(b.details, '{}'::jsonb) ? 'ticketId';

  if v_ticket then
    -- Paid with a Meta de experiencia ticket: it comes back on a full refund.
    v_ticket_back := v_percent = 100;
  else
    select * into t from public.transactions where key = 'vip:' || b.id and kind = 'vip' for update;
    if t.id is null then
      raise exception 'No encontramos el pago de esta reserva. Escríbenos a soporte.';
    end if;
    if t.status <> 'paid' or t.refunded_amount <> 0 or t.creator_refund_loss <> 0 then
      raise exception 'Este pago tiene una devolución o disputa en curso. Escríbenos a soporte.';
    end if;
    v_coins := round(t.amount * v_percent);
    -- The creator loses what the fan gets back: all of it, or half on a late cancellation.
    update public.transactions
      set creator_refund_loss = t.amount * t.creator_share * v_percent / 100
      where id = t.id;
    insert into public.credit_grants (user_id, coins, reason, booking_id, note)
    values (b.fan_id, v_coins, 'reserve_cancel', b.id,
            left(case when v_by = 'creator' then 'Cancelada por el creador: ' else 'Cancelaste: ' end || b.title, 200));
  end if;

  v_result := jsonb_build_object('by', v_by, 'at', now(), 'paid', true, 'refundPercent', v_percent, 'refundCoins', v_coins,
                                 'hoursBefore', round(v_hours, 1), 'ticketBack', v_ticket_back);
  update public.vip_bookings
    set status = 'cancelled', updated_at = now(),
        details = (coalesce(details, '{}'::jsonb) - 'reschedule') || jsonb_build_object('cancellation', v_result)
    where id = b.id;

  -- Tell the other side (reserve_alert only covers cancellations before payment).
  v_fan_first := split_part(coalesce(nullif(trim(b.fan_name), ''), 'Un fan'), ' ', 1);
  v_creator_first := split_part(coalesce(nullif(trim(b.creator_name), ''), 'El creador'), ' ', 1);
  v_when := to_char(b.date, 'DD/MM') || ' · ' || b.time;
  if v_by = 'fan' then
    insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
    select p.id, 'reserve_request', b.creator_profile_id, left(v_fan_first || ' canceló su reserva', 160),
           left(b.title || ' · ' || v_when || case when v_percent < 100 then '. Conservas la mitad de tu ganancia.' else '. El horario quedó libre.' end, 200),
           '/creator/dashboard?tab=vip'
    from public.profiles p where p.creator_profile_id = b.creator_profile_id and p.role = 'creator';
  else
    insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
    values (b.fan_id, 'reserve_update', b.creator_profile_id, left(v_creator_first || ' canceló tu reserva', 160),
            left(b.title || ' · ' || v_when || case when v_ticket then '. Tu ticket volvió a estar activo.' else '. Te devolvimos ' || v_coins || ' créditos.' end, 200),
            '/profile#mis-reservas');
  end if;
  insert into public.email_outbox (user_id, booking_id, to_email, subject, body)
  values (
    b.fan_id, b.id, b.fan_email,
    'Reserva cancelada: ' || b.title,
    'Hola ' || b.fan_name || ', tu experiencia "' || b.title || '" con ' || b.creator_name ||
    ' del ' || to_char(b.date, 'DD/MM/YYYY') || ' a las ' || b.time || ' quedó cancelada' ||
    case when v_by = 'creator' then ' por el creador' else '' end || '. ' ||
    case when v_ticket then case when v_ticket_back then 'Tu ticket volvió a estar activo.' else 'El ticket se usó porque cancelaste con menos de 24 horas.' end
         else 'Te devolvimos ' || v_coins || ' créditos (' || v_percent || '%) a tu billetera de Fans Reserve.' end
  );
  return v_result;
end;
$$;
revoke execute on function public.reserve_cancel(uuid) from public, anon;
grant execute on function public.reserve_cancel(uuid) to authenticated;

-- A ticket only comes back on a full refund (it was already reactivated on any
-- cancellation before).
create or replace function public.ticket_booking_sync()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_ticket uuid;
begin
  if not (coalesce(new.details, '{}'::jsonb) ? 'ticketId') or new.status is not distinct from old.status then
    return null;
  end if;
  v_ticket := (new.details->>'ticketId')::uuid;
  if new.status = 'confirmed' then
    update public.experience_tickets set status = 'used' where id = v_ticket;
  elsif new.status in ('rejected', 'cancelled', 'expired')
        and not (new.status = 'cancelled' and new.details->'cancellation'->>'ticketBack' = 'false') then
    update public.experience_tickets set status = 'active', booking_id = null where id = v_ticket and booking_id = new.id;
  end if;
  return null;
end;
$function$;

-- A creator who cancels a paid booking counts as unreliable, like letting
-- requests expire.
create or replace function public.reward_reliable(p_creator text, p_at timestamptz)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select count(*) < 5 or count(*) filter (where b.status in ('expired', 'disputed') or b.status = 'cancelled') <= count(*) * 0.05
  from public.vip_bookings b
  where b.creator_profile_id = p_creator and b.created_at > p_at - interval '90 days' and b.created_at <= p_at
    and (b.status in ('accepted', 'confirmed', 'completed', 'rejected', 'expired', 'disputed')
         or (b.status = 'cancelled' and b.details->'cancellation'->>'by' = 'creator'));
$function$;

-- 4. One free date change (1:1 only, asked 24 h or more before the start).
-- The booking stays confirmed at its original time until the creator accepts.
create or replace function public.reserve_request_reschedule(p_booking_id uuid, p_date date, p_time text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.vip_bookings;
  v_new timestamptz;
  v_fan_first text;
begin
  select * into b from public.vip_bookings where id = p_booking_id for update;
  if b.id is null or b.fan_id is distinct from auth.uid() then
    raise exception 'Reserva no encontrada';
  end if;
  if b.status <> 'confirmed' then
    raise exception 'Solo puedes cambiar la fecha de una reserva confirmada';
  end if;
  if coalesce(b.details->>'kind', '') = 'event' then
    raise exception 'La fecha de un Reserve Event no se cambia por participante';
  end if;
  if coalesce((b.details->>'rescheduled')::boolean, false) then
    raise exception 'Ya usaste tu cambio de fecha gratis en esta reserva';
  end if;
  if b.details ? 'reschedule' then
    raise exception 'Ya pediste un cambio de fecha: espera la respuesta del creador';
  end if;
  if public.reserve_booking_start(b) < now() + make_interval(hours => public.reserve_cancel_hours()) then
    raise exception 'El cambio de fecha se pide con al menos 24 horas de anticipación';
  end if;
  if p_date is null or coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Elige la nueva fecha y hora';
  end if;
  v_new := (p_date + p_time::time) at time zone coalesce(b.time_zone, 'America/Tegucigalpa');
  if v_new < now() + make_interval(hours => public.reserve_cancel_hours()) then
    raise exception 'La nueva fecha debe ser al menos 24 horas después de ahora';
  end if;
  if v_new > now() + interval '180 days' then
    raise exception 'Elige una fecha dentro de los próximos 6 meses';
  end if;
  if p_date = b.date and p_time = b.time then
    raise exception 'Elige una fecha u hora distinta';
  end if;
  update public.vip_bookings
    set updated_at = now(),
        details = coalesce(details, '{}'::jsonb) || jsonb_build_object('reschedule',
          jsonb_build_object('date', to_char(p_date, 'YYYY-MM-DD'), 'time', p_time, 'note', left(trim(coalesce(p_note, '')), 300), 'at', now()))
    where id = b.id;
  v_fan_first := split_part(coalesce(nullif(trim(b.fan_name), ''), 'Un fan'), ' ', 1);
  insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
  select p.id, 'reserve_request', b.creator_profile_id, left(v_fan_first || ' pide cambiar la fecha', 160),
         left(b.title || ' · ' || to_char(b.date, 'DD/MM') || ' ' || b.time || ' → ' || to_char(p_date, 'DD/MM') || ' ' || p_time, 200),
         '/creator/dashboard?tab=vip'
  from public.profiles p where p.creator_profile_id = b.creator_profile_id and p.role = 'creator';
end;
$$;
revoke execute on function public.reserve_request_reschedule(uuid, date, text, text) from public, anon;
grant execute on function public.reserve_request_reschedule(uuid, date, text, text) to authenticated;

create or replace function public.reserve_respond_reschedule(p_booking_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.vip_bookings;
  r jsonb;
  v_creator_first text;
begin
  select * into b from public.vip_bookings where id = p_booking_id for update;
  if b.id is null or b.creator_profile_id is distinct from public.my_creator_profile_id() then
    raise exception 'Reserva no encontrada';
  end if;
  r := b.details->'reschedule';
  if b.status <> 'confirmed' or r is null then
    raise exception 'Esta reserva no tiene un cambio de fecha pendiente';
  end if;
  v_creator_first := split_part(coalesce(nullif(trim(b.creator_name), ''), 'El creador'), ' ', 1);
  if p_accept then
    if ((r->>'date')::date + (r->>'time')::time) at time zone coalesce(b.time_zone, 'America/Tegucigalpa') <= now() then
      raise exception 'La nueva fecha ya pasó: pide al fan otra';
    end if;
    begin
      update public.vip_bookings
        set date = (r->>'date')::date, time = r->>'time', updated_at = now(),
            details = (details - 'reschedule') || jsonb_build_object('rescheduled', true,
              'rescheduledFrom', jsonb_build_object('date', to_char(b.date, 'YYYY-MM-DD'), 'time', b.time))
        where id = b.id;
    exception when unique_violation then
      raise exception 'Ya tienes otra reserva a esa hora: rechaza el cambio o libera ese horario';
    end;
  else
    update public.vip_bookings set details = details - 'reschedule', updated_at = now() where id = b.id;
  end if;
  insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
  values (b.fan_id, 'reserve_update', b.creator_profile_id,
          left(v_creator_first || case when p_accept then ' aceptó el cambio de fecha' else ' no puede en la nueva fecha' end, 160),
          left(b.title || ' · ' || case when p_accept then to_char((r->>'date')::date, 'DD/MM') || ' · ' || (r->>'time')
                                      else 'Sigue en pie el ' || to_char(b.date, 'DD/MM') || ' · ' || b.time || '. Puedes pedir otra fecha.' end, 200),
          '/profile#mis-reservas');
end;
$$;
revoke execute on function public.reserve_respond_reschedule(uuid, boolean) from public, anon;
grant execute on function public.reserve_respond_reschedule(uuid, boolean) to authenticated;
