-- Reserve sin respuesta: el creador recibe recordatorios hasta que acepte o
-- rechace una solicitud, y queda constancia de cada envío.
--
-- Cadencia (plazo normal de 48 h, reserve_response_hours()):
--   inicio  al llegar la solicitud   correo (la campana y el celular ya los manda reserve_alert)
--   r3h     3 h después              campana + celular
--   h24     24 h antes del plazo     campana + celular
--   h6      6 h antes del plazo      campana + celular
--   h1      1 h antes del plazo      campana + celular + correo ("última hora")
-- Con plazos cortos (reservas para hoy) se omiten los pasos que no caben: ninguno
-- sale en los primeros 30 min ni a menos de 1 h de otro; se prefieren los últimos.
-- Si el job se atrasa y vencen varios pasos a la vez, sale solo el más reciente y
-- los demás quedan marcados como omitidos. Máximo: 5 avisos, 2 de ellos por correo (al llegar y última hora; Resend gratis = 100/día).
--
-- Se detiene sola: solo se recuerdan solicitudes en estado 'pending' y con plazo
-- vigente. Al aceptar, rechazar o contraofertar (o al vencer) deja de enviar y los
-- recordatorios que siguen sin leer en la campana se marcan como leídos. Una
-- solicitud aceptada sigue con los avisos de antes de la sesión (10 y 1 min).
--
-- Constancia por envío (reserve_response_reminders): campana (notificación y si se
-- leyó), celular (dispositivos y envíos aceptados, lo escribe /api/push), correo
-- (email_outbox: entregado a Resend o error) y si el creador abrió el enlace.
-- El admin lo ve en Asistencia de Reserve > Recordatorios al creador.
--
-- Los correos salen al momento: el job pide a /api/usage?outbox=1 (pg_net) que
-- entregue la cola de email_outbox (no es una función nueva de Vercel).
--
-- Solo agrega; se puede volver a ejecutar.

create table if not exists public.reserve_response_reminders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.vip_bookings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  respond_by timestamptz not null, -- plazo vigente cuando salió
  step text not null check (step in ('inicio', 'r3h', 'h24', 'h6', 'h1')),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  skipped boolean not null default false,
  notification_id uuid references public.notifications (id) on delete set null,
  email_id uuid references public.email_outbox (id) on delete set null,
  push_attempted_at timestamptz,
  push_devices integer,
  push_sent integer,
  opened_at timestamptz,
  bell_cleared_at timestamptz,
  unique (booking_id, user_id, step)
);
create index if not exists reserve_response_reminders_booking_idx on public.reserve_response_reminders (booking_id);
create index if not exists reserve_response_reminders_created_idx on public.reserve_response_reminders (created_at desc);
alter table public.reserve_response_reminders enable row level security;
revoke all on public.reserve_response_reminders from public, anon, authenticated;
grant select, update on public.reserve_response_reminders to service_role;

-- Pasos que tocan para un plazo: (paso, cuándo, campana+celular, correo).
create or replace function public.reserve_response_plan(p_from timestamptz, p_respond_by timestamptz)
returns table (step text, due_at timestamptz, bell boolean, email boolean)
language plpgsql
immutable
set search_path = ''
as $$
declare
  c record;
  v_last timestamptz := null;
begin
  step := 'inicio'; due_at := p_from; bell := false; email := true;
  return next;
  -- De la más tardía a la más temprana: las cercanas al plazo tienen prioridad.
  for c in
    select * from (values
      ('h1', p_respond_by - interval '1 hour', true),
      ('h6', p_respond_by - interval '6 hours', false),
      ('h24', p_respond_by - interval '24 hours', false),
      ('r3h', p_from + interval '3 hours', false)
    ) v (s, d, m)
  loop
    if c.d >= p_from + interval '30 minutes' and c.d < p_respond_by
       and (v_last is null or c.d <= v_last - interval '1 hour') then
      step := c.s; due_at := c.d; bell := true; email := c.m;
      v_last := c.d;
      return next;
    end if;
  end loop;
end;
$$;
revoke execute on function public.reserve_response_plan(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.reserve_dispatch_response_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
  p record;
  u record;
  v_due record;
  v_from timestamptz;
  v_rid uuid;
  v_nid uuid;
  v_eid uuid;
  v_zone text;
  v_fan text;
  v_when text;
  v_deadline text;
  v_link text;
  v_title text;
  v_body text;
  v_subject text;
  v_text text;
  v_sent integer := 0;
  v_emails integer := 0;
begin
  perform pg_advisory_xact_lock(64572145);

  for b in
    select * from public.vip_bookings v
    where v.status = 'pending' and v.respond_by is not null and v.respond_by > now()
    order by v.respond_by
    limit 1000
  loop
    -- El plazo cuenta desde que la solicitud empezó a esperar.
    v_from := greatest(b.created_at, b.respond_by - make_interval(hours => public.reserve_response_hours()));
    v_zone := coalesce(nullif(b.time_zone, ''), 'America/Tegucigalpa');
    v_fan := split_part(coalesce(nullif(trim(b.fan_name), ''), 'Un fan'), ' ', 1);
    v_when := to_char(b.date, 'DD/MM') || ' · ' || coalesce(b.time, '');
    v_deadline := to_char(b.respond_by at time zone v_zone, 'DD/MM "a las" HH24:MI');

    for u in
      select pr.id, pr.email from public.profiles pr
      where pr.creator_profile_id = b.creator_profile_id and pr.role = 'creator'
    loop
      -- El paso vencido más reciente que aún no se registró.
      select * into v_due from public.reserve_response_plan(v_from, b.respond_by) x
      where x.due_at <= now()
        and not exists (select 1 from public.reserve_response_reminders r
                        where r.booking_id = b.id and r.user_id = u.id and r.step = x.step)
      order by x.due_at desc
      limit 1;
      if v_due.step is null then continue; end if;

      -- Pasos anteriores que nunca salieron (job atrasado): constan como omitidos.
      insert into public.reserve_response_reminders (booking_id, user_id, respond_by, step, due_at, skipped)
      select b.id, u.id, b.respond_by, x.step, x.due_at, true
      from public.reserve_response_plan(v_from, b.respond_by) x
      where x.due_at < v_due.due_at
      on conflict do nothing;

      insert into public.reserve_response_reminders (booking_id, user_id, respond_by, step, due_at)
      values (b.id, u.id, b.respond_by, v_due.step, v_due.due_at)
      on conflict do nothing
      returning id into v_rid;
      if v_rid is null then continue; end if;

      v_link := '/creator/dashboard?tab=vip&reserveNudge=' || v_rid::text;
      v_title := case v_due.step
        when 'inicio' then 'Nueva solicitud de Reserve de ' || v_fan
        when 'r3h' then v_fan || ' sigue esperando tu respuesta'
        when 'h24' then 'Queda 1 día para responder a ' || v_fan
        when 'h6' then 'Quedan 6 horas para responder a ' || v_fan
        else 'Última hora para responder a ' || v_fan
      end;
      v_body := b.title || ' · ' || v_when || '. Acepta o rechaza antes del ' || v_deadline || '.';

      v_nid := null;
      if v_due.bell then
        insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
        values (u.id, 'reserve_request', b.creator_profile_id, left(v_title, 160), left(v_body, 200), v_link)
        returning id into v_nid;
      end if;

      v_eid := null;
      if v_due.email and coalesce(u.email, '') like '%@%' then
        v_subject := case v_due.step
          when 'inicio' then v_fan || ' quiere reservar contigo'
          when 'h1' then 'Última hora: ' || v_fan || ' espera tu respuesta'
          else v_fan || ' espera tu respuesta en Fans Reserve'
        end;
        v_text := v_fan || ' te pidió «' || b.title || '» para el ' || v_when || '.' || chr(10) || chr(10)
          || 'Tienes hasta el ' || v_deadline || ' para aceptarla o rechazarla. '
          || 'Si no respondes, la solicitud se cierra sola y ' || v_fan || ' se queda sin respuesta.' || chr(10) || chr(10)
          || 'Responder ahora: ' || public.app_base_url() || v_link;
        insert into public.email_outbox (user_id, booking_id, to_email, subject, body)
        values (u.id, b.id, u.email, left(v_subject, 200), v_text)
        returning id into v_eid;
        v_emails := v_emails + 1;
      end if;

      update public.reserve_response_reminders set notification_id = v_nid, email_id = v_eid where id = v_rid;
      v_sent := v_sent + 1;
    end loop;
  end loop;

  -- Respondida, contraofertada o vencida: los recordatorios sin leer dejan la campana
  -- (bell_cleared_at distingue esa limpieza de una lectura real del creador).
  with cleared as (
    update public.notifications n set read_at = now()
    from public.reserve_response_reminders r
    join public.vip_bookings v on v.id = r.booking_id
    where n.id = r.notification_id and n.read_at is null
      and (v.status <> 'pending' or v.respond_by <= now())
    returning n.id
  )
  update public.reserve_response_reminders r set bell_cleared_at = now()
  from cleared c where r.notification_id = c.id;

  if v_emails > 0 then
    begin
      perform net.http_get(url := public.app_base_url() || '/api/usage?outbox=1');
    exception when others then null;
    end;
  end if;
  return v_sent;
end;
$$;
revoke execute on function public.reserve_dispatch_response_reminders() from public, anon, authenticated;

-- El creador abrió el recordatorio (desde la campana, el celular o el correo).
create or replace function public.reserve_open_response_reminder(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.reserve_response_reminders
     set opened_at = coalesce(opened_at, now())
   where id = p_id and user_id = auth.uid();
$$;
revoke execute on function public.reserve_open_response_reminder(uuid) from public, anon;
grant execute on function public.reserve_open_response_reminder(uuid) to authenticated;

-- Admin: solicitudes con recordatorios (las que esperan primero) y qué pasó con cada envío.
create or replace function public.admin_reserve_response_log(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Solo administración puede ver los recordatorios.';
  end if;
  if p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'Revisa el número de días (1 a 60).';
  end if;
  return jsonb_build_object('as_of', now(), 'items', coalesce((
    select jsonb_agg(item order by (item->>'waiting')::boolean desc, item->>'respond_by')
    from (
      select jsonb_build_object(
        'booking_id', v.id,
        'title', v.title,
        'creator_name', v.creator_name,
        'fan_name', v.fan_name,
        'status', v.status,
        'waiting', v.status = 'pending' and v.respond_by > now(),
        'respond_by', v.respond_by,
        'seen_at', v.seen_at,
        'requested_at', v.created_at,
        'reminders', (
          select jsonb_agg(jsonb_build_object(
            'step', r.step, 'due_at', r.due_at, 'sent_at', r.created_at, 'skipped', r.skipped,
            'bell', r.notification_id is not null,
            'bell_read_at', case when r.bell_cleared_at is null then n.read_at end,
            'push_attempted_at', r.push_attempted_at, 'push_devices', r.push_devices, 'push_sent', r.push_sent,
            'email', r.email_id is not null, 'email_delivered_at', e.delivered_at,
            'email_error', nullif(e.last_error, ''), 'opened_at', r.opened_at
          ) order by r.due_at)
          from public.reserve_response_reminders r
          left join public.notifications n on n.id = r.notification_id
          left join public.email_outbox e on e.id = r.email_id
          where r.booking_id = v.id
        )
      ) as item
      from public.vip_bookings v
      where exists (select 1 from public.reserve_response_reminders r
                    where r.booking_id = v.id and r.created_at >= now() - make_interval(days => p_days))
      limit 200
    ) x
  ), '[]'::jsonb));
end;
$$;
revoke execute on function public.admin_reserve_response_log(integer) from public, anon;
grant execute on function public.admin_reserve_response_log(integer) to authenticated;

select cron.schedule('reserve-response-reminders', '*/5 * * * *', 'select public.reserve_dispatch_response_reminders()');
