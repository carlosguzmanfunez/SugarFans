-- Mano derecha: monitoreo de la web (solo lectura).
-- - Cada hora (minuto 5) toma una foto del dinero y de los problemas: monitor_snapshots.
-- - Lleva el registro financiero del día (hora Honduras) en monitor_daily, al día cada hora.
-- - A las 12:00 p. m. y 12:00 a. m. de Honduras (18:00 y 06:00 UTC) escribe un reporte
--   en monitor_reports, avisa en la campana del dueño (llega al celular si tiene avisos
--   activos) y pide a /api/usage?report=1 que lo mande por correo (ALERT_EMAIL,
--   carlos@fansreserve.com). Si el correo no sale, cada hora se vuelve a pedir (12 h).
-- - Si aparece algo grave nuevo (disputa, retiro fallido, incidente de finanzas, tarea
--   automática caída) avisa en la campana en esa misma hora.
-- Nada de esto mueve dinero ni cambia cuentas: solo lee, resume y avisa.

-- 1) Tablas (solo administración puede leerlas; solo las funciones escriben).
create table if not exists public.monitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  kind text not null check (kind in ('hourly', 'manual', 'report')),
  data jsonb not null
);
create index if not exists monitor_snapshots_taken_idx on public.monitor_snapshots (taken_at desc);

create table if not exists public.monitor_daily (
  day date primary key,
  data jsonb not null,
  closed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.monitor_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('midday', 'midnight')),
  day date not null,
  window_from timestamptz not null,
  window_to timestamptz not null,
  title text not null,
  body text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  email_error text,
  unique (kind, day)
);
create index if not exists monitor_reports_created_idx on public.monitor_reports (created_at desc);

-- Último número visto de cada problema grave, para avisar solo cuando sube.
create table if not exists public.monitor_alert_state (
  code text primary key,
  last_count integer not null default 0,
  last_notified_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.monitor_snapshots enable row level security;
alter table public.monitor_daily enable row level security;
alter table public.monitor_reports enable row level security;
alter table public.monitor_alert_state enable row level security;
revoke all on public.monitor_snapshots, public.monitor_daily, public.monitor_reports, public.monitor_alert_state from anon, authenticated;
grant select on public.monitor_snapshots, public.monitor_daily, public.monitor_reports to authenticated;
drop policy if exists monitor_snapshots_admin on public.monitor_snapshots;
create policy monitor_snapshots_admin on public.monitor_snapshots for select to authenticated using (public.is_admin());
drop policy if exists monitor_daily_admin on public.monitor_daily;
create policy monitor_daily_admin on public.monitor_daily for select to authenticated using (public.is_admin());
drop policy if exists monitor_reports_admin on public.monitor_reports;
create policy monitor_reports_admin on public.monitor_reports for select to authenticated using (public.is_admin());

-- Aviso de la campana para el dueño.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('live_started','reserve_request','reserve_update','creator_goal','subscription_payment','subscription_update','admin_monitor'));

-- 2) Ayudas.
-- Medianoche de Honduras (UTC-6, sin horario de verano) del día dado.
create or replace function public.monitor_hn_midnight(p_day date)
returns timestamptz language sql stable set search_path = ''
as $$ select (p_day::timestamp at time zone 'America/Tegucigalpa') $$;

create or replace function public.monitor_usd(p numeric)
returns text language sql immutable set search_path = ''
as $$ select case when coalesce(p, 0) < 0 then '-$' else '$' end || trim(to_char(abs(coalesce(p, 0)), 'FM999G999G990D00')) $$;

-- "07/11 12:00 p. m." en hora de Honduras.
create or replace function public.monitor_hn_time(p timestamptz)
returns text language sql stable set search_path = ''
as $$ select to_char(p at time zone 'America/Tegucigalpa', 'DD/MM HH12:MI')
          || case when extract(hour from p at time zone 'America/Tegucigalpa') < 12 then ' a. m.' else ' p. m.' end $$;

-- 3) Dinero en un periodo. Mismas reglas que "Todos los movimientos" del panel:
--    cobrado = ventas pagadas con PayPal (suscripciones, Reserve, propinas) + Créditos comprados,
--    menos lo devuelto; comisión PayPal real o estimada (5.4% + $0.30);
--    creadores = su parte (70/30 actual, 80% en ventas anteriores, regalos 60%).
--    Fans Reserve "con ISV" = lo que queda; ISV 15% solo sobre la parte de Fans Reserve.
create or replace function public.monitor_money(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cash numeric; v_coins numeric; v_fees numeric; v_creators numeric; v_fr numeric; v_isv numeric;
  r jsonb;
begin
  select coalesce(sum(t.amount - coalesce(t.refunded_amount, 0)), 0) into v_cash
    from public.transactions t
   where t.created_at >= p_from and t.created_at < p_to
     and t.kind in ('subscription','renewal','tip','vip') and t.status = 'paid';
  select coalesce(sum(c.price - coalesce(c.refunded_amount, 0)), 0) into v_coins
    from public.coin_purchases c
   where c.created_at >= p_from and c.created_at < p_to and c.status = 'paid';
  select coalesce((select sum(coalesce(t.gateway_fee, round(t.amount * 0.054 + 0.3, 2)) - coalesce(t.refunded_gateway_fee, 0))
                     from public.transactions t
                    where t.created_at >= p_from and t.created_at < p_to
                      and t.kind in ('subscription','renewal','tip','vip') and t.status <> 'failed'), 0)
       + coalesce((select sum(coalesce(c.gateway_fee, round(c.price * 0.054 + 0.3, 2)))
                     from public.coin_purchases c
                    where c.created_at >= p_from and c.created_at < p_to), 0)
    into v_fees;
  select coalesce(sum(greatest(0,
           coalesce(t.creator_initial_amount,
                    t.amount * coalesce(t.creator_share, case t.kind when 'gift' then 0.60 when 'referral' then 1 else 0.80 end))
           - case when coalesce(t.platform_covers, false) then 0 else coalesce(t.creator_refund_loss, 0) end)), 0)
    into v_creators
    from public.transactions t
   where t.created_at >= p_from and t.created_at < p_to
     and (t.status = 'paid' or (coalesce(t.platform_covers, false) and t.status in ('refunded','disputed')));

  v_fr := round(v_cash + v_coins - v_fees - v_creators, 2);
  v_isv := case when v_fr > 0 then round(v_fr * 0.15, 2) else 0 end;

  select jsonb_build_object(
    'cobrado', round(v_cash + v_coins, 2),
    'comision_paypal', round(v_fees, 2),
    'creadores', round(v_creators, 2),
    'fr_con_isv', v_fr,
    'isv', v_isv,
    'fr_sin_isv', round(v_fr - v_isv, 2),
    'pagos', (select count(*) from public.transactions t where t.created_at >= p_from and t.created_at < p_to
                and t.kind in ('subscription','renewal','tip','vip') and t.status = 'paid')
             + (select count(*) from public.coin_purchases c where c.created_at >= p_from and c.created_at < p_to and c.status = 'paid'),
    'fans_que_pagaron', (select count(distinct x) from (
        select t.payer_id x from public.transactions t where t.created_at >= p_from and t.created_at < p_to
           and t.kind in ('subscription','renewal','tip','vip') and t.status = 'paid'
        union all
        select c.user_id from public.coin_purchases c where c.created_at >= p_from and c.created_at < p_to and c.status = 'paid') s),
    'devuelto', round(coalesce((select sum(case when t.status = 'refunded' then t.amount else coalesce(t.refunded_amount, 0) end)
                  from public.transactions t where t.created_at >= p_from and t.created_at < p_to and t.kind <> 'referral'), 0)
              + coalesce((select sum(c.refunded_amount) from public.coin_purchases c where c.created_at >= p_from and c.created_at < p_to), 0), 2),
    'en_disputa', round(coalesce((select sum(t.amount) from public.transactions t
                  where t.created_at >= p_from and t.created_at < p_to and t.status = 'disputed'), 0), 2),
    'por_tipo', jsonb_build_object(
       'reserve', (select jsonb_build_object('n', count(*), 'monto', round(coalesce(sum(t.amount - coalesce(t.refunded_amount,0)),0),2)) from public.transactions t
                    where t.created_at >= p_from and t.created_at < p_to and t.kind = 'vip' and t.status = 'paid'),
       'suscripciones', (select jsonb_build_object('n', count(*), 'monto', round(coalesce(sum(t.amount - coalesce(t.refunded_amount,0)),0),2)) from public.transactions t
                    where t.created_at >= p_from and t.created_at < p_to and t.kind in ('subscription','renewal') and t.status = 'paid'),
       'propinas', (select jsonb_build_object('n', count(*), 'monto', round(coalesce(sum(t.amount - coalesce(t.refunded_amount,0)),0),2)) from public.transactions t
                    where t.created_at >= p_from and t.created_at < p_to and t.kind = 'tip' and t.status = 'paid'),
       'creditos', (select jsonb_build_object('n', count(*), 'monto', round(coalesce(sum(c.price - coalesce(c.refunded_amount,0)),0),2)) from public.coin_purchases c
                    where c.created_at >= p_from and c.created_at < p_to and c.status = 'paid'),
       'regalos', (select jsonb_build_object('n', count(*), 'monto', round(coalesce(sum(t.amount),0),2)) from public.transactions t
                    where t.created_at >= p_from and t.created_at < p_to and t.kind = 'gift' and t.status = 'paid')),
    'retiros_pagados', (select jsonb_build_object('n', count(*), 'monto', round(coalesce(sum(p.amount),0),2)) from public.payouts p
                    where p.paid_at >= p_from and p.paid_at < p_to and p.status = 'paid'),
    'personas_nuevas', (select count(*) from public.profiles p where p.created_at >= p_from and p.created_at < p_to),
    'creadores_verificados', (select count(*) from public.identity_verifications v
                    where v.reviewed_at >= p_from and v.reviewed_at < p_to and v.status = 'approved' and v.role = 'creator'),
    'reservas_nuevas', (select count(*) from public.vip_bookings b where b.created_at >= p_from and b.created_at < p_to),
    'reservas_pagadas', (select count(*) from public.vip_bookings b where b.paid_at >= p_from and b.paid_at < p_to),
    'errores_pagina', (select coalesce(sum(e.count), 0) from public.app_errors e where e.last_seen >= p_from and e.last_seen < p_to)
  ) into r;
  return r;
end;
$$;
revoke execute on function public.monitor_money(timestamptz, timestamptz) from public, anon, authenticated;

-- 4) Problemas abiertos ahora mismo. nivel: alta (mirar hoy), media (revisar), baja (informativo).
create or replace function public.monitor_problems(p_from timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  items jsonb := '[]'::jsonb;
  n integer; m numeric; t text;
begin
  -- Disputas (contracargos o reclamos abiertos en PayPal)
  select count(*), coalesce(sum(amount), 0) into n, m from public.transactions where status = 'disputed';
  select n + count(*), m + coalesce(sum(price), 0) into n, m from public.coin_purchases where status = 'disputed';
  if n > 0 then items := items || jsonb_build_object('code','disputas','nivel','alta','n',n,
     'titulo', n || case when n = 1 then ' disputa abierta' else ' disputas abiertas' end || ' (' || public.monitor_usd(m) || ')',
     'donde','Dinero > Pagos a creadores'); end if;

  select count(*) into n from public.vip_bookings where status = 'disputed';
  if n > 0 then items := items || jsonb_build_object('code','reserve_disputa','nivel','alta','n',n,
     'titulo', n || ' Reserve en disputa',
     'donde','Asistencia de Reserve'); end if;

  select count(*) into n from public.finance_incidents where state = 'open';
  if n > 0 then
    select string_agg(title, ' · ' order by last_seen_at desc) into t from (select title, last_seen_at from public.finance_incidents where state = 'open' order by last_seen_at desc limit 3) s;
    items := items || jsonb_build_object('code','incidentes','nivel','alta','n',n,
     'titulo', n || case when n = 1 then ' incidente de finanzas abierto' else ' incidentes de finanzas abiertos' end,
     'detalle', left(coalesce(t, ''), 300), 'donde','Dinero > Pagos a creadores');
  end if;

  select count(*), coalesce(sum(amount), 0) into n, m from public.payouts where status = 'failed' and requested_at > now() - interval '30 days';
  if n > 0 then items := items || jsonb_build_object('code','retiros_fallidos','nivel','alta','n',n,
     'titulo', n || case when n = 1 then ' retiro a creador falló' else ' retiros a creadores fallaron' end || ' (' || public.monitor_usd(m) || ')',
     'donde','Dinero > Retiros y devoluciones'); end if;

  select count(*) into n from public.payouts where status = 'sending' and requested_at < now() - interval '2 hours';
  if n > 0 then items := items || jsonb_build_object('code','retiros_atascados','nivel','media','n',n,
     'titulo', n || case when n = 1 then ' retiro lleva más de 2 horas enviándose' else ' retiros llevan más de 2 horas enviándose' end,
     'donde','Dinero > Retiros y devoluciones'); end if;

  -- Cuenta tareas distintas (no ejecuciones), para avisar solo cuando otra empieza a fallar.
  select count(distinct d.jobid) into n from cron.job_run_details d where d.status = 'failed' and d.start_time >= p_from;
  if n > 0 then
    select string_agg(distinct j.jobname, ', ') into t from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where d.status = 'failed' and d.start_time >= p_from;
    items := items || jsonb_build_object('code','tareas_fallidas','nivel','alta','n',n,
     'titulo', 'Tareas automáticas con fallos: ' || coalesce(t, ''), 'donde','Supabase > Cron');
  end if;

  select count(*), coalesce(sum(amount), 0) into n, m from public.reserve_refund_requests where state in ('pending','approved');
  if n > 0 then items := items || jsonb_build_object('code','devoluciones','nivel','media','n',n,
     'titulo', n || case when n = 1 then ' devolución por terminar' else ' devoluciones por terminar' end || ' (' || public.monitor_usd(m) || ')',
     'donde','Dinero > Retiros y devoluciones'); end if;

  select count(*) into n from public.paypal_orders where status = 'failed' and created_at >= p_from;
  if n > 0 then items := items || jsonb_build_object('code','pagos_fallidos','nivel','media','n',n,
     'titulo', n || case when n = 1 then ' pago con PayPal falló' else ' pagos con PayPal fallaron' end,
     'donde','Estado del servicio > Problemas de la página'); end if;

  select count(*) into n from public.paypal_orders where status = 'created' and created_at >= p_from and created_at < now() - interval '30 minutes';
  if n > 0 then items := items || jsonb_build_object('code','pagos_sin_terminar','nivel','baja','n',n,
     'titulo', n || case when n = 1 then ' pago empezado y no terminado' else ' pagos empezados y no terminados' end,
     'detalle','Normal si la persona cerró PayPal; si se repite, revisar el cobro.'); end if;

  select count(*) into n from public.finance_alert_queue where state <> 'sent' and created_at < now() - interval '1 hour';
  if n > 0 then items := items || jsonb_build_object('code','avisos_finanzas','nivel','media','n',n,
     'titulo', n || ' avisos de finanzas sin enviar por correo', 'donde','Dinero > Pagos a creadores'); end if;

  select count(*) into n from public.email_outbox where delivered_at is null and attempts > 0;
  if n > 0 then items := items || jsonb_build_object('code','correos','nivel','media','n',n,
     'titulo', n || case when n = 1 then ' correo no se pudo enviar' else ' correos no se pudieron enviar' end,
     'donde','Estado del servicio > Problemas de la página'); end if;

  select count(*) into n from public.monitor_reports where emailed_at is null and email_error is not null and created_at > now() - interval '2 days';
  if n > 0 then items := items || jsonb_build_object('code','reporte_correo','nivel','media','n',n,
     'titulo', 'El reporte de las 12 no llegó a tu correo', 'detalle','Revisa RESEND_API_KEY en Vercel; el reporte sí está aquí en el panel.'); end if;

  select coalesce(sum(count), 0) into n from public.app_errors where source = 'api' and last_seen >= p_from;
  if n > 0 then items := items || jsonb_build_object('code','errores_servidor','nivel','media','n',n,
     'titulo', n || case when n = 1 then ' error del servidor' else ' errores del servidor' end,
     'donde','Estado del servicio > Problemas de la página'); end if;

  select coalesce(sum(count), 0) into n from public.app_errors where source = 'web' and last_seen >= p_from;
  if n > 0 then items := items || jsonb_build_object('code','errores_web','nivel','baja','n',n,
     'titulo', n || case when n = 1 then ' fallo al navegar' else ' fallos al navegar' end,
     'donde','Estado del servicio > Problemas de la página'); end if;

  select count(*) into n from public.reports where status = 'pending';
  if n > 0 then items := items || jsonb_build_object('code','denuncias','nivel','media','n',n,
     'titulo', n || case when n = 1 then ' denuncia o solicitud por revisar' else ' denuncias o solicitudes por revisar' end,
     'donde','Contenido > Denuncias y solicitudes'); end if;

  select count(*) into n from public.identity_verifications where status = 'pending';
  if n > 0 then items := items || jsonb_build_object('code','verificaciones','nivel','media','n',n,
     'titulo', n || case when n = 1 then ' identidad por verificar' else ' identidades por verificar' end,
     'donde','Personas > Verificar identidades'); end if;

  select count(*) into n from public.vip_bookings where status = 'pending' and respond_by is not null and respond_by < now() + interval '2 hours';
  if n > 0 then items := items || jsonb_build_object('code','reserve_sin_respuesta','nivel','baja','n',n,
     'titulo', n || ' Reserve por vencer sin respuesta del creador'); end if;

  return items;
end;
$$;
revoke execute on function public.monitor_problems(timestamptz) from public, anon, authenticated;

-- 5) Foto completa: última hora + hoy + mes + problemas.
create or replace function public.monitor_build()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Tegucigalpa')::date;
  v_day_start timestamptz := public.monitor_hn_midnight(v_today);
  v_month_start timestamptz := public.monitor_hn_midnight(date_trunc('month', v_today)::date);
begin
  return jsonb_build_object(
    'at', now(),
    'dia', v_today,
    'ultima_hora', public.monitor_money(now() - interval '1 hour', now()),
    'hoy', public.monitor_money(v_day_start, now()),
    'mes', public.monitor_money(v_month_start, now()),
    'problemas', public.monitor_problems(now() - interval '24 hours'),
    'pendiente', jsonb_build_object(
      'retiros_enviandose', (select count(*) from public.payouts where status = 'sending'),
      'reserve_por_responder', (select count(*) from public.vip_bookings where status = 'pending'),
      'reserve_confirmadas_proximas', (select count(*) from public.vip_bookings where status = 'confirmed' and date >= v_today))
  );
end;
$$;
revoke execute on function public.monitor_build() from public, anon, authenticated;

-- Aviso en la campana del dueño (y de los administradores del equipo).
create or replace function public.monitor_notify(p_title text, p_body text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select distinct u, 'admin_monitor', left(p_title, 160), left(p_body, 200), '/admin?section=monitor'
    from (select user_id u from security_private.owner_account
          union select p.id from public.profiles p where p.role = 'admin') s
   where u is not null;
$$;
revoke execute on function public.monitor_notify(text, text) from public, anon, authenticated;

-- Pide a la web que mande por correo los reportes que aún no salieron (no falla si no se puede).
create or replace function public.monitor_send_reports()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.monitor_reports where emailed_at is null and created_at > now() - interval '12 hours') then
    perform net.http_get(url := public.app_base_url() || '/api/usage?report=1');
  end if;
exception when others then null;
end;
$$;
revoke execute on function public.monitor_send_reports() from public, anon, authenticated;

-- 6) Cada hora: guarda la foto, actualiza el día y avisa si algo grave subió.
create or replace function public.monitor_hourly(p_kind text default 'hourly')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  d jsonb := public.monitor_build();
  it jsonb;
  prev integer;
  fresh text[] := '{}';
begin
  insert into public.monitor_snapshots (kind, data) values (p_kind, d);
  insert into public.monitor_daily (day, data, updated_at)
  values ((d->>'dia')::date, jsonb_build_object('dinero', d->'hoy', 'problemas', d->'problemas'), now())
  on conflict (day) do update set data = excluded.data, updated_at = now() where not public.monitor_daily.closed;

  for it in select * from jsonb_array_elements(d->'problemas') where value->>'nivel' = 'alta' loop
    select last_count into prev from public.monitor_alert_state where code = it->>'code';
    if (it->>'n')::int > coalesce(prev, 0) then fresh := fresh || (it->>'titulo'); end if;
  end loop;
  -- Guardar los números de ahora (los que ya no aparecen vuelven a 0).
  insert into public.monitor_alert_state (code, last_count, updated_at)
  select value->>'code', (value->>'n')::int, now() from jsonb_array_elements(d->'problemas') where value->>'nivel' = 'alta'
  on conflict (code) do update set last_count = excluded.last_count, updated_at = now();
  update public.monitor_alert_state s set last_count = 0, updated_at = now()
   where not exists (select 1 from jsonb_array_elements(d->'problemas') e where e.value->>'code' = s.code and e.value->>'nivel' = 'alta');

  if array_length(fresh, 1) > 0 then
    perform public.monitor_notify('Mano derecha: algo necesita tu atención', array_to_string(fresh, ' · '));
    update public.monitor_alert_state set last_notified_at = now() where code in
      (select value->>'code' from jsonb_array_elements(d->'problemas') where value->>'nivel' = 'alta');
  end if;

  delete from public.monitor_snapshots where taken_at < now() - interval '90 days';
  -- Reintento del correo de un reporte que no salió.
  if p_kind = 'hourly' then perform public.monitor_send_reports(); end if;
  return d;
end;
$$;
revoke execute on function public.monitor_hourly(text) from public, anon, authenticated;

-- 7) Texto del reporte (correo y panel).
create or replace function public.monitor_report_text(p_kind text, p_money jsonb, p_month jsonb, p_problems jsonb, p_from timestamptz, p_to timestamptz)
returns text
language plpgsql stable set search_path = ''
as $$
declare
  b text;
  it jsonb;
  pt jsonb := p_money->'por_tipo';
  lbl text;
  nlist int := jsonb_array_length(coalesce(p_problems, '[]'::jsonb));
begin
  b := 'Periodo: ' || public.monitor_hn_time(p_from) || ' a ' || public.monitor_hn_time(p_to) || ' (hora Honduras)' || E'\n\n';

  b := b || 'ATENCIÓN' || E'\n';
  if nlist = 0 then
    b := b || 'Todo en orden: sin disputas, retiros fallidos, incidentes ni errores del servidor.' || E'\n';
  else
    for it in select value from jsonb_array_elements(p_problems)
              order by case value->>'nivel' when 'alta' then 0 when 'media' then 1 else 2 end loop
      lbl := case it->>'nivel' when 'alta' then '[URGENTE] ' when 'media' then '[Revisar] ' else '[Info] ' end;
      b := b || '• ' || lbl || (it->>'titulo') || coalesce(' → ' || (it->>'donde'), '') || E'\n';
    end loop;
  end if;

  b := b || E'\n' || 'DINERO DEL PERIODO' || E'\n'
    || '• Cobrado: ' || public.monitor_usd((p_money->>'cobrado')::numeric) || ' en ' || (p_money->>'pagos') || ' pagos (' || (p_money->>'fans_que_pagaron') || ' fans)' || E'\n'
    || '• Comisión PayPal: ' || public.monitor_usd((p_money->>'comision_paypal')::numeric) || E'\n'
    || '• Para creadores: ' || public.monitor_usd((p_money->>'creadores')::numeric) || E'\n'
    || '• Fans Reserve: ' || public.monitor_usd((p_money->>'fr_con_isv')::numeric) || ' con ISV · '
       || public.monitor_usd((p_money->>'fr_sin_isv')::numeric) || ' sin ISV (ISV 15%: ' || public.monitor_usd((p_money->>'isv')::numeric) || ')' || E'\n'
    || '• Devuelto: ' || public.monitor_usd((p_money->>'devuelto')::numeric) || ' · En disputa: ' || public.monitor_usd((p_money->>'en_disputa')::numeric) || E'\n'
    || '• Retiros pagados a creadores: ' || public.monitor_usd((p_money->'retiros_pagados'->>'monto')::numeric) || ' (' || (p_money->'retiros_pagados'->>'n') || ')' || E'\n';

  b := b || E'\n' || 'POR TIPO' || E'\n'
    || '• Reserve: ' || public.monitor_usd((pt->'reserve'->>'monto')::numeric) || ' (' || (pt->'reserve'->>'n') || ')' || E'\n'
    || '• Suscripciones: ' || public.monitor_usd((pt->'suscripciones'->>'monto')::numeric) || ' (' || (pt->'suscripciones'->>'n') || ')' || E'\n'
    || '• Créditos comprados: ' || public.monitor_usd((pt->'creditos'->>'monto')::numeric) || ' (' || (pt->'creditos'->>'n') || ')' || E'\n'
    || '• Propinas: ' || public.monitor_usd((pt->'propinas'->>'monto')::numeric) || ' (' || (pt->'propinas'->>'n') || ')'
    || ' · Regalos: ' || public.monitor_usd((pt->'regalos'->>'monto')::numeric) || ' (' || (pt->'regalos'->>'n') || ')' || E'\n';

  b := b || E'\n' || 'MOVIMIENTO' || E'\n'
    || '• Personas nuevas: ' || (p_money->>'personas_nuevas') || ' · Creadores verificados: ' || (p_money->>'creadores_verificados') || E'\n'
    || '• Reserve nuevas: ' || (p_money->>'reservas_nuevas') || ' · Reserve pagadas: ' || (p_money->>'reservas_pagadas') || E'\n'
    || '• Errores registrados en la página: ' || (p_money->>'errores_pagina') || E'\n';

  if p_month is not null then
    b := b || E'\n' || 'MES HASTA AHORA' || E'\n'
      || '• Cobrado: ' || public.monitor_usd((p_month->>'cobrado')::numeric)
      || ' · Fans Reserve: ' || public.monitor_usd((p_month->>'fr_con_isv')::numeric) || ' con ISV · '
      || public.monitor_usd((p_month->>'fr_sin_isv')::numeric) || ' sin ISV' || E'\n';
  end if;

  b := b || E'\n' || 'Detalle y fotos de cada hora: https://fansreserve.com/admin?section=monitor' || E'\n'
    || 'Este reporte solo lee datos; ningún dinero se movió por él.';
  return b;
end;
$$;

-- 8) Reporte de las 12 (mediodía o medianoche, hora Honduras).
--    midday: de 12:00 a. m. a 12:00 p. m. de hoy. midnight: el día completo que terminó.
create or replace function public.monitor_report(p_kind text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_now_hn timestamp := now() at time zone 'America/Tegucigalpa';
  v_day date;
  v_from timestamptz; v_to timestamptz;
  v_money jsonb; v_month jsonb; v_problems jsonb;
  v_title text; v_body text; v_id uuid;
  v_urgent int; v_review int;
begin
  if p_kind not in ('midday','midnight') then raise exception 'Tipo de reporte no válido'; end if;
  perform public.monitor_hourly('report');

  if p_kind = 'midday' then
    v_day := v_now_hn::date;
    v_from := public.monitor_hn_midnight(v_day);
    v_to := v_from + interval '12 hours';
  else
    -- Corre a las 12:00 a. m.: el día que se cierra es el de ayer.
    v_day := (v_now_hn - interval '2 hours')::date;
    v_from := public.monitor_hn_midnight(v_day);
    v_to := v_from + interval '24 hours';
  end if;

  v_money := public.monitor_money(v_from, v_to);
  v_month := public.monitor_money(public.monitor_hn_midnight(date_trunc('month', v_day)::date), v_to);
  v_problems := public.monitor_problems(v_from);
  select count(*) filter (where value->>'nivel' = 'alta'), count(*) filter (where value->>'nivel' = 'media')
    into v_urgent, v_review from jsonb_array_elements(v_problems);

  v_title := case p_kind when 'midday' then 'Reporte de mediodía' else 'Cierre del día' end
    || ' · ' || to_char(v_day, 'DD/MM/YYYY');
  v_body := public.monitor_report_text(p_kind, v_money, v_month, v_problems, v_from, v_to);

  insert into public.monitor_reports (kind, day, window_from, window_to, title, body, data)
  values (p_kind, v_day, v_from, v_to, v_title, v_body,
          jsonb_build_object('dinero', v_money, 'mes', v_month, 'problemas', v_problems))
  on conflict (kind, day) do update set body = excluded.body, data = excluded.data, window_to = excluded.window_to,
    created_at = now(), emailed_at = null, email_error = null
  returning id into v_id;

  if p_kind = 'midnight' then
    insert into public.monitor_daily (day, data, closed, updated_at)
    values (v_day, jsonb_build_object('dinero', v_money, 'problemas', v_problems), true, now())
    on conflict (day) do update set data = excluded.data, closed = true, updated_at = now();
  end if;

  perform public.monitor_notify(v_title,
    'Cobrado ' || public.monitor_usd((v_money->>'cobrado')::numeric)
    || ' · Fans Reserve ' || public.monitor_usd((v_money->>'fr_con_isv')::numeric) || ' con ISV · '
    || case when v_urgent > 0 then v_urgent || ' urgente(s)' when v_review > 0 then v_review || ' por revisar' else 'Todo en orden' end);

  perform public.monitor_send_reports();
  return v_id;
end;
$$;
revoke execute on function public.monitor_report(text) from public, anon, authenticated;

-- 9) Botón "Actualizar ahora" del panel (solo administración).
create or replace function public.monitor_refresh()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Solo administración'; end if;
  -- Máximo una foto manual por minuto.
  if exists (select 1 from public.monitor_snapshots where kind = 'manual' and taken_at > now() - interval '1 minute') then
    return (select data from public.monitor_snapshots order by taken_at desc limit 1);
  end if;
  return public.monitor_hourly('manual');
end;
$$;
revoke execute on function public.monitor_refresh() from public, anon;
grant execute on function public.monitor_refresh() to authenticated;

-- 10) Horarios (UTC). Honduras = UTC-6 todo el año. Con el mismo nombre, pg_cron
--     reemplaza la tarea, así que volver a ejecutar esto no la duplica.
select cron.schedule('monitor-hourly', '5 * * * *', 'select public.monitor_hourly(''hourly'')');
select cron.schedule('monitor-midday', '0 18 * * *', 'select public.monitor_report(''midday'')');
select cron.schedule('monitor-midnight', '0 6 * * *', 'select public.monitor_report(''midnight'')');
