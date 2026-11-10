-- Defensa de suscripciones ante disputas de PayPal (Carlos, 2026-11-10).
--
-- A. Aviso de renovación 3 días antes de cada cobro automático de PayPal:
--    campana + correo, en texto. Sin botón ni enlace para cancelar: el fan entra
--    a su cuenta y cancela desde Mi cuenta. Cada aviso queda registrado (cuándo,
--    si el correo salió) como prueba para una disputa.
-- B. Registro de accesos del suscriptor, ligero en privacidad: cuándo abre el
--    perfil del creador y qué publicaciones exclusivas abre. Sin IP ni huella
--    del dispositivo. Solo lo lee el expediente de administración.
-- C. Expediente de disputa de suscripción (solo administración, solo lectura):
--    se busca por ID de la suscripción de PayPal (I-…), ID de transacción del
--    cobro o ID de la disputa (PP-D-…).
-- D. Mientras una disputa de PayPal sobre un cobro de la suscripción está
--    abierta, el acceso al contenido exclusivo queda en pausa. Si ganamos, el
--    cobro vuelve a "paid" y el acceso se restaura solo; si la pierde el
--    vendedor, el reembolso ya termina la suscripción (lógica existente).
--
-- No cambia cobros, repartos ni saldos. No hay datos históricos que migrar.

-- ───────────── D. Pausa durante una disputa ─────────────
alter table public.subscriptions add column dispute_paused_at timestamptz;
comment on column public.subscriptions.dispute_paused_at is
 'Acceso en pausa desde esta fecha porque un cobro de esta suscripción está en disputa en PayPal. Null = sin pausa.';

create or replace function public.has_subscription(p_fan uuid, p_creator_profile_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
    where s.fan_id = p_fan and s.creator_id = p_creator_profile_id
      and (s.cancel_at is null or s.cancel_at > now())
      and s.dispute_paused_at is null
  );
$$;

-- El estado del cobro ya sigue a la disputa (money_back_before_cases):
-- paid → disputed al abrirse, disputed → paid si ganamos, → refunded si la perdemos.
create function notification_private.subscription_dispute_pause()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sub text; s public.subscriptions; v_creator text;
begin
  if new.key not like 'paypal-sub:%' or new.status is not distinct from old.status then return new; end if;
  if new.status <> 'disputed' and old.status <> 'disputed' then return new; end if;
  v_sub := split_part(new.key, ':', 2);
  select coalesce(nullif(trim(new.creator_name), ''), 'tu creador') into v_creator;
  if new.status = 'disputed' then
    update public.subscriptions set dispute_paused_at = now()
     where paypal_subscription_id = v_sub and dispute_paused_at is null
    returning * into s;
    if s.fan_id is not null then
      perform notification_private.subscription_notice('dispute-pause:' || new.id::text, s.fan_id, s.creator_id, 'subscription_update',
        'Acceso en pausa', 'Un pago de suscripción está en disputa',
        'Abriste una disputa en PayPal por tu suscripción a ' || v_creator || '. El acceso a su contenido exclusivo queda en pausa mientras se resuelve.',
        'Un fan abrió una disputa en PayPal por su suscripción. Su acceso a tu contenido exclusivo queda en pausa mientras se resuelve.');
    end if;
  elsif not exists (select 1 from public.transactions t
                     where t.key like 'paypal-sub:' || v_sub || ':%' and t.status = 'disputed' and t.id <> new.id) then
    update public.subscriptions set dispute_paused_at = null
     where paypal_subscription_id = v_sub and dispute_paused_at is not null
    returning * into s;
    -- Ganamos la disputa: el acceso vuelve. Si se reembolsó, la suscripción ya terminó.
    if s.fan_id is not null and new.status = 'paid' and (s.cancel_at is null or s.cancel_at > now()) then
      perform notification_private.subscription_notice('dispute-restore:' || new.id::text || ':' || gen_random_uuid()::text, s.fan_id, s.creator_id, 'subscription_update',
        'Acceso restaurado', 'Disputa resuelta a tu favor',
        'La disputa de PayPal por tu suscripción a ' || v_creator || ' se resolvió. Ya puedes ver de nuevo su contenido exclusivo.',
        'La disputa de PayPal por una suscripción se resolvió a tu favor. El fan recupera el acceso.');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function notification_private.subscription_dispute_pause() from public, anon, authenticated;
create trigger subscription_dispute_pause after update of status on public.transactions
  for each row execute function notification_private.subscription_dispute_pause();

-- ───────────── B. Registro de accesos ─────────────
create table public.subscription_access_log (
  id bigint generated always as identity primary key,
  fan_id uuid not null references public.profiles(id) on delete cascade,
  creator_id text not null,
  kind text not null check (kind in ('profile_view', 'post_open')),
  post_id uuid references public.creator_posts(id) on delete set null,
  -- Al abrir el perfil: cuántas publicaciones exclusivas tenía disponibles.
  locked_posts integer,
  at timestamptz not null default now()
);
create index subscription_access_log_fan_idx on public.subscription_access_log (fan_id, creator_id, at desc);
alter table public.subscription_access_log enable row level security;
revoke all on public.subscription_access_log from public, anon, authenticated, service_role;
comment on table public.subscription_access_log is
 'Cuándo un suscriptor abrió el perfil del creador y qué publicaciones exclusivas abrió. Sin IP ni datos del dispositivo. Prueba para disputas de PayPal.';

create function public.subscription_log_access(p_creator_profile_id text, p_post_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_fan uuid := auth.uid(); v_kind text := case when p_post_id is null then 'profile_view' else 'post_open' end;
begin
  if v_fan is null or p_creator_profile_id is null or not public.has_subscription(v_fan, p_creator_profile_id) then return; end if;
  if p_post_id is not null and not exists (select 1 from public.creator_posts p where p.id = p_post_id
      and p.creator_profile_id = p_creator_profile_id and p.is_locked and not p.is_draft) then return; end if;
  -- Una fila por perfil o publicación cada 30 minutos basta como prueba y evita ruido.
  if exists (select 1 from public.subscription_access_log l
              where l.fan_id = v_fan and l.creator_id = p_creator_profile_id and l.kind = v_kind
                and l.post_id is not distinct from p_post_id and l.at > now() - interval '30 minutes') then return; end if;
  insert into public.subscription_access_log (fan_id, creator_id, kind, post_id, locked_posts)
  values (v_fan, p_creator_profile_id, v_kind, p_post_id,
    case when p_post_id is null then (select count(*) from public.creator_posts p
      where p.creator_profile_id = p_creator_profile_id and p.is_locked and not p.is_draft) end);
end;
$$;
revoke all on function public.subscription_log_access(text, uuid) from public, anon;
grant execute on function public.subscription_log_access(text, uuid) to authenticated;

-- ───────────── A. Aviso de renovación ─────────────
create table notification_private.subscription_renewal_reminders (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references public.profiles(id) on delete cascade,
  creator_id text not null,
  paypal_subscription_id text not null,
  renews_at timestamptz not null,
  amount numeric(10,2) not null,
  notification_id uuid references public.notifications(id) on delete set null,
  email_id uuid references public.email_outbox(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (paypal_subscription_id, renews_at)
);
alter table notification_private.subscription_renewal_reminders enable row level security;
revoke all on notification_private.subscription_renewal_reminders from public, anon, authenticated;

create function public.subscription_dispatch_renewal_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare s record; v_rid uuid; v_nid uuid; v_eid uuid; v_creator text; v_day text; v_price text; v_sent integer := 0; v_emails integer := 0;
begin
  perform pg_advisory_xact_lock(64572146);
  for s in
    select x.*, p.name as fan_name, p.email as fan_email, public.next_renewal(x.since) as renews_at
      from public.subscriptions x
      join public.paypal_subscriptions ps on ps.id = x.paypal_subscription_id and ps.status = 'active'
      join public.profiles p on p.id = x.fan_id
     where x.cancel_at is null and x.dispute_paused_at is null
  loop
    if s.renews_at <= now() or s.renews_at > now() + interval '3 days' then continue; end if;
    insert into notification_private.subscription_renewal_reminders (fan_id, creator_id, paypal_subscription_id, renews_at, amount)
    values (s.fan_id, s.creator_id, s.paypal_subscription_id, s.renews_at, s.price)
    on conflict do nothing returning id into v_rid;
    if v_rid is null then continue; end if;

    v_creator := coalesce(public.creator_display_name(s.creator_id), 'tu creador');
    v_day := to_char(s.renews_at at time zone 'America/Tegucigalpa', 'DD/MM/YYYY');
    v_price := 'USD ' || to_char(s.price, 'FM999999990.00');
    insert into public.notifications (user_id, kind, creator_profile_id, title, body, link)
    values (s.fan_id, 'subscription_update', s.creator_id, 'Tu suscripción se renueva pronto',
      left('Tu suscripción a ' || v_creator || ' se renovará el ' || v_day || ' por ' || v_price || '. Si no deseas renovarla, puedes cancelarla desde Mi cuenta.', 200), '')
    returning id into v_nid;

    v_eid := null;
    if coalesce(s.fan_email, '') like '%@%' then
      insert into public.email_outbox (user_id, to_email, subject, body)
      values (s.fan_id, s.fan_email, left('Tu suscripción a ' || v_creator || ' se renueva el ' || v_day, 200),
        'Hola ' || coalesce(nullif(split_part(trim(coalesce(s.fan_name, '')), ' ', 1), ''), '') || ':' || chr(10) || chr(10)
        || 'Te recordamos que tu suscripción mensual a ' || v_creator || ' se renovará automáticamente el ' || v_day
        || ' y PayPal cobrará ' || v_price || '.' || chr(10) || chr(10)
        || 'Si quieres seguir viendo su contenido exclusivo, no tienes que hacer nada.' || chr(10) || chr(10)
        || 'Si no deseas renovarla, puedes cancelarla antes de esa fecha: inicia sesión en tu cuenta de Fans Reserve y entra en Mi cuenta, Mis suscripciones. Conservas el acceso hasta el final del mes que ya pagaste.'
        || chr(10) || chr(10) || 'El equipo de Fans Reserve')
      returning id into v_eid;
      v_emails := v_emails + 1;
    end if;
    update notification_private.subscription_renewal_reminders set notification_id = v_nid, email_id = v_eid where id = v_rid;
    v_sent := v_sent + 1;
  end loop;

  if v_emails > 0 then
    begin
      perform net.http_get(url := public.app_base_url() || '/api/usage?outbox=1');
    exception when others then null;
    end;
  end if;
  return v_sent;
end;
$$;
revoke execute on function public.subscription_dispatch_renewal_reminders() from public, anon, authenticated;

-- Todos los días a las 9:00 de Honduras (15:00 UTC): cada renovación recibe su
-- aviso entre 3 y 2 días antes; si el job se atrasa, sale en la siguiente vuelta.
select cron.schedule('subscription-renewal-reminders', '0 15 * * *', 'select public.subscription_dispatch_renewal_reminders()');

-- ───────────── C. Expediente de disputa ─────────────
create function public.subscription_admin_dispute_dossier(p_reference text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  ref text := upper(trim(coalesce(p_reference, '')));
  v_sub text; v_sale text; ps public.paypal_subscriptions; s public.subscriptions; fan public.profiles; v_from timestamptz;
begin
  if auth.uid() is null or not coalesce(public.is_admin(), false) then
    raise exception 'Solo administración puede preparar expedientes de disputa' using errcode = '42501';
  end if;
  if length(ref) not between 6 and 64 or ref !~ '^[A-Z0-9-]+$' then
    raise exception 'Escribe el ID de la suscripción, de la transacción o de la disputa de PayPal' using errcode = '22023';
  end if;
  select id into v_sub from public.paypal_subscriptions where upper(id) = ref;
  if v_sub is null then
    select split_part(t.key, ':', 2), split_part(t.key, ':', 3) into v_sub, v_sale from public.transactions t
     where t.key like 'paypal-sub:%' and upper(split_part(t.key, ':', 3)) = ref limit 1;
  end if;
  if v_sub is null then
    select split_part(t.key, ':', 2), split_part(t.key, ':', 3) into v_sub, v_sale
      from finance_private.income_disputes d
      join public.transactions t on t.key like 'paypal-sub:%' and split_part(t.key, ':', 3) = d.payment_ref
     where upper(d.dispute_id) = ref limit 1;
  end if;
  select * into ps from public.paypal_subscriptions where id = v_sub;
  if ps.id is null then
    raise exception 'No encontramos una suscripción con esa referencia de PayPal' using errcode = 'P0002';
  end if;
  select * into s from public.subscriptions where paypal_subscription_id = ps.id;
  select * into fan from public.profiles where id = ps.user_id;
  v_from := coalesce(ps.activated_at, ps.created_at);

  return jsonb_build_object(
    'generated_at', statement_timestamp(),
    'disputed_sale', v_sale,
    'subscription', jsonb_build_object(
      'paypal_subscription_id', ps.id, 'status', ps.status, 'amount', ps.amount,
      'created_at', ps.created_at, 'activated_at', ps.activated_at,
      'creator_profile_id', ps.creator_id, 'creator_name', public.creator_display_name(ps.creator_id),
      'since', s.since, 'cancel_at', s.cancel_at, 'access_paused_at', s.dispute_paused_at,
      'auto_renew', s.fan_id is not null and s.cancel_at is null),
    'fan', jsonb_build_object(
      'id', fan.id, 'name', fan.name, 'email', fan.email, 'account_created_at', fan.created_at,
      'terms_accepted_at', fan.terms_accepted_at, 'terms_version', fan.terms_version,
      'terms_history', coalesce((select jsonb_agg(jsonb_build_object('version', t.version, 'method', t.method, 'accepted_at', t.accepted_at)
         order by t.accepted_at) from public.terms_acceptances t where t.user_id = ps.user_id), '[]'::jsonb)),
    'charges', coalesce((select jsonb_agg(jsonb_build_object('sale_id', split_part(t.key, ':', 3), 'kind', t.kind, 'amount', t.amount,
       'fee', t.gateway_fee, 'status', t.status, 'refunded', t.refunded_amount, 'created_at', t.created_at) order by t.created_at)
       from public.transactions t where t.key like 'paypal-sub:' || ps.id || ':%'), '[]'::jsonb),
    'disputes', coalesce((select jsonb_agg(jsonb_build_object('dispute_id', d.dispute_id, 'payment_ref', d.payment_ref, 'status', d.status,
       'outcome', d.outcome, 'refunded', d.refunded, 'reason', d.proof->>'reason', 'opened_at', d.proof->>'create_time') order by d.dispute_id)
       from finance_private.income_disputes d
       where d.payment_ref in (select split_part(t.key, ':', 3) from public.transactions t where t.key like 'paypal-sub:' || ps.id || ':%')), '[]'::jsonb),
    'renewal_reminders', coalesce((select jsonb_agg(jsonb_build_object('renews_at', r.renews_at, 'amount', r.amount, 'sent_at', r.created_at,
       'bell', r.notification_id is not null, 'bell_read_at', n.read_at, 'email', r.email_id is not null,
       'email_delivered_at', e.delivered_at, 'email_error', nullif(e.last_error, '')) order by r.renews_at)
       from notification_private.subscription_renewal_reminders r
       left join public.notifications n on n.id = r.notification_id
       left join public.email_outbox e on e.id = r.email_id
       where r.paypal_subscription_id = ps.id), '[]'::jsonb),
    'access_log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'kind', l.kind, 'post_id', l.post_id,
       'post_created_at', p.created_at, 'media_type', p.media_type, 'locked_posts', l.locked_posts) order by l.at)
       from (select * from public.subscription_access_log l where l.fan_id = ps.user_id and l.creator_id = ps.creator_id
               and l.at >= v_from order by l.at desc limit 500) l
       left join public.creator_posts p on p.id = l.post_id), '[]'::jsonb),
    'content', jsonb_build_object(
      'locked_at_start', (select count(*) from public.creator_posts p where p.creator_profile_id = ps.creator_id
         and p.is_locked and not p.is_draft and p.created_at <= v_from),
      'locked_now', (select count(*) from public.creator_posts p where p.creator_profile_id = ps.creator_id and p.is_locked and not p.is_draft),
      'posts_since_start', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'created_at', p.created_at, 'locked', p.is_locked,
         'media_type', p.media_type) order by p.created_at)
         from (select * from public.creator_posts p where p.creator_profile_id = ps.creator_id and not p.is_draft
                 and p.created_at >= v_from order by p.created_at desc limit 200) p), '[]'::jsonb))
  );
end;
$$;
revoke all on function public.subscription_admin_dispute_dossier(text) from public, anon, authenticated, service_role;
grant execute on function public.subscription_admin_dispute_dossier(text) to authenticated;
comment on function public.subscription_admin_dispute_dossier(text) is
 'Read-only admin evidence bundle for a PayPal dispute on a subscription. Explicit auth.uid/is_admin check.';
