-- Audit fixes (2026-09-30): subscriptions only through checkout, and prices
-- decided by the server instead of the browser.

-- 1. A fan could insert or edit their own subscription row through the API and
--    unlock paid posts without paying. Rows now come only from subscribe_and_pay;
--    the fan can still read and cancel (delete) their own.
drop policy if exists "subscriptions: own rows" on public.subscriptions;
create policy "subscriptions: own rows read" on public.subscriptions
  for select to authenticated using (fan_id = (select auth.uid()));
create policy "subscriptions: fan cancels" on public.subscriptions
  for delete to authenticated using (fan_id = (select auth.uid()));

-- 2. Monthly price of a creator, or null when the profile does not exist:
--    a creator account's own price, then a visible managed profile, then the
--    demo catalogue (src/data/mockData.ts `creators`).
create or replace function public.creator_price(p_creator_profile_id text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.subscription_price from public.profiles p
      where p.creator_profile_id = p_creator_profile_id and p.role = 'creator'),
    (select m.subscription_price from public.managed_profiles m
      where m.id = p_creator_profile_id and not m.hidden),
    (select d.price from (values ('1', 9.99), ('2', 14.99), ('3', 7.99), ('4', 12.99), ('5', 5.99), ('6', 8.99))
      as d(id, price) where d.id = p_creator_profile_id)
  );
$$;
revoke execute on function public.creator_price(text) from public, anon, authenticated;

-- p_price is kept for API compatibility and ignored.
create or replace function public.subscribe_and_pay(p_creator_profile_id text, p_creator_name text, p_price numeric, p_method_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_method public.payment_methods;
  v_price numeric := public.creator_price(p_creator_profile_id);
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if v_price is null then
    raise exception 'Creador no encontrado';
  end if;
  if v_me.creator_profile_id = p_creator_profile_id then
    raise exception 'No puedes suscribirte a tu propio perfil';
  end if;
  select * into v_method from public.payment_methods where id = p_method_id and user_id = v_me.id;
  if v_method.id is null then
    raise exception 'Elige un método de pago';
  end if;
  if public.is_cut_off(v_me.id, p_creator_profile_id) then
    raise exception 'No puedes suscribirte a este perfil';
  end if;
  insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status)
  values ('sub:' || v_me.id || ':' || p_creator_profile_id || ':' || now(), v_me.id, v_me.name, p_creator_profile_id,
          p_creator_name, 'subscription', round(v_price, 2), v_method.label, 'paid');
  insert into public.subscriptions (fan_id, creator_id, price, since)
  values (v_me.id, p_creator_profile_id, round(v_price, 2), now())
  on conflict (fan_id, creator_id) do update set price = excluded.price, since = excluded.since;
end;
$$;

-- 3. VIP bookings take the experience's creator, title and price from the
--    catalogue (src/data/mockData.ts `vipExperiences`), not from the browser.
create or replace function public.vip_create_booking(
  p_experience_id text, p_creator_profile_id text, p_title text, p_creator_name text,
  p_price numeric, p_date date, p_time text, p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fan public.profiles;
  v_av public.vip_availability;
  v_exp record;
  v_id uuid;
begin
  select * into v_fan from public.profiles where id = auth.uid();
  if v_fan.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into v_exp from (values
    ('1', '1', 'Video Llamada VIP Personalizada', 'Valentina Rose', 99.99),
    ('2', '2', 'Plan de Entrenamiento 1:1', 'Diego Torres', 149.99),
    ('3', '3', 'Tutorial de Arte Personalizado', 'Sofía Luna', 79.99),
    ('4', '4', 'Behind the Scenes Exclusivo', 'Mariana Silva', 49.99),
    ('5', '6', 'Clase de Cocina Privada', 'Camila Reyes', 119.99)
  ) as e(id, creator_profile_id, title, creator_name, price)
  where e.id = p_experience_id;
  if v_exp.id is null or v_exp.creator_profile_id <> p_creator_profile_id then
    raise exception 'Experiencia no encontrada';
  end if;
  if v_fan.creator_profile_id = p_creator_profile_id then
    raise exception 'No puedes reservar tu propia experiencia';
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
  insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email, date, time, message)
  values (v_exp.id, v_exp.creator_profile_id, v_exp.title, v_exp.creator_name, v_exp.price, v_fan.id, v_fan.name, v_fan.email,
          p_date, p_time, coalesce(trim(p_message), ''))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
end;
$$;

-- 4. Tips and gifts only go to creators that exist.
create or replace function public.send_tip(p_creator_profile_id text, p_creator_name text, p_amount numeric, p_method_id uuid, p_post_id text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_method public.payment_methods;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if public.creator_price(p_creator_profile_id) is null then
    raise exception 'Creador no encontrado';
  end if;
  if v_me.creator_profile_id = p_creator_profile_id then
    raise exception 'No puedes enviarte una propina a ti mismo';
  end if;
  select * into v_method from public.payment_methods where id = p_method_id and user_id = v_me.id;
  if v_method.id is null then
    raise exception 'Elige un método de pago';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 500 then
    raise exception 'La propina debe estar entre $1 y $500';
  end if;
  if public.is_cut_off(v_me.id, p_creator_profile_id) then
    raise exception 'No puedes enviar propinas a este perfil';
  end if;
  insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, note)
  values ('tip:' || v_me.id || ':' || gen_random_uuid(), v_me.id, v_me.name, p_creator_profile_id, p_creator_name, 'tip',
          round(p_amount, 2), v_method.label, 'paid',
          nullif(left(trim(coalesce(p_message, '')), 200), '') );
end;
$$;

create or replace function public.send_gift(
  p_creator_profile_id text, p_creator_name text, p_gift_id text, p_post_id text, p_message text, p_request text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_gift public.gift_catalog;
  v_value numeric;
  v_tx uuid;
  v_message text := left(trim(coalesce(p_message, '')), 200);
  v_video boolean := false;
  v_call boolean := false;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if public.creator_price(p_creator_profile_id) is null then
    raise exception 'Creador no encontrado';
  end if;
  select * into v_gift from public.gift_catalog where id = p_gift_id;
  if v_gift.id is null then
    raise exception 'Regalo no encontrado';
  end if;
  if v_me.creator_profile_id = p_creator_profile_id then
    raise exception 'No puedes enviarte un regalo a ti mismo';
  end if;
  if public.is_cut_off(v_me.id, p_creator_profile_id) then
    raise exception 'No puedes enviar regalos a este perfil';
  end if;
  -- One spend at a time per fan, so two gifts cannot use the same coins.
  perform pg_advisory_xact_lock(hashtext('coins:' || v_me.id::text));
  if public.coin_balance(v_me.id) < v_gift.coins then
    raise exception 'No tienes suficientes terrones';
  end if;
  v_value := v_gift.coins / 100.0;
  insert into public.transactions
    (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, note, creator_share, gift_id)
  values
    ('gift:' || v_me.id || ':' || gen_random_uuid(), v_me.id, v_me.name, p_creator_profile_id, p_creator_name, 'gift',
     v_value, 'Terrones', 'paid',
     case when v_message = '' then v_gift.name else v_gift.name || ' · “' || v_message || '”' end,
     0.60, v_gift.id)
  returning id into v_tx;

  select s.offers_video, s.offers_call into v_video, v_call
    from public.creator_gift_settings s where s.creator_profile_id = p_creator_profile_id;
  if v_value >= 500 and coalesce(v_video, false) then
    insert into public.perk_requests (transaction_id, fan_id, fan_name, creator_profile_id, creator_name, kind, request, due_at)
    values (v_tx, v_me.id, v_me.name, p_creator_profile_id, p_creator_name, 'video',
            left(trim(coalesce(p_request, '')), 500), now() + interval '7 days');
  end if;
  if v_value >= 1000 and coalesce(v_call, false) then
    insert into public.perk_requests (transaction_id, fan_id, fan_name, creator_profile_id, creator_name, kind, due_at)
    values (v_tx, v_me.id, v_me.name, p_creator_profile_id, p_creator_name, 'call', now() + interval '30 days');
  end if;
  return v_tx;
end;
$$;
