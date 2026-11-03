-- Security review 2026-11-03, items A2 and A4.
--
-- A2. Changing the PayPal email that receives a creator's withdrawals sent no
--     notice and took effect at once: whoever got into the account could redirect
--     the money. Now every change emails the account's own address, and a
--     withdrawal can't start until 48 hours after a change of PayPal account.
--
-- A4. The admin account had no second factor. Now, once someone turns on the
--     authenticator-app code (Settings > Seguridad), a session that hasn't entered
--     the code (aal1) is not admin and can't change the payout account. People
--     without a code keep working as before, so turning it on is safe.

-- --- Second factor -------------------------------------------------------------------

-- Whether this person turned on the authenticator-app code. Read dynamically so the
-- function also loads where auth.mfa_factors doesn't exist (local test databases).
create or replace function security_private.has_verified_mfa(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v boolean := false;
begin
  if p_user is null or to_regclass('auth.mfa_factors') is null then
    return false;
  end if;
  execute 'select exists (select 1 from auth.mfa_factors f where f.user_id = $1 and f.status::text = ''verified'')'
    into v using p_user;
  return coalesce(v, false);
end;
$$;
revoke all on function security_private.has_verified_mfa(uuid) from public, anon, authenticated;

-- True when the signed-in session has the level its owner asked for: either no
-- code is turned on, or this session entered it.
create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not security_private.has_verified_mfa(auth.uid());
$$;
revoke all on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated;

-- Same rule as before, plus: an admin with the code turned on must have entered it.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
 -- The code check runs only for someone who is admin by the old rule (cheap for everyone else).
 select case when (case when exists(select 1 from security_private.owner_account where user_id=auth.uid())
 then security_private.owner_enabled()
 else exists(select 1 from public.profiles p join auth.users u on u.id=p.id
   where p.id=auth.uid() and p.role='admin' and u.deleted_at is null
     and (u.banned_until is null or u.banned_until<=now())
     and lower(u.email) not in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com')
     and not exists(select 1 from public.account_restrictions r where r.user_id=p.id and r.suspended_until>now()))
 end)
 then public.mfa_ok() else false end;
$$;

-- --- Payout account changes ----------------------------------------------------------

create or replace function finance_private.payout_account_change_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  -- The person changing it (not the server) must have entered their code if they use one.
  if auth.uid() is not null and not public.mfa_ok() then
    raise exception 'Ingresa el código de tu app de verificación para cambiar la cuenta de retiro';
  end if;
  if tg_op = 'INSERT' and new.from_email is not null
     and lower(trim(new.from_email)) is distinct from lower(trim(new.to_email)) then
    select u.email into v_email from auth.users u where u.id = new.user_id;
    if v_email is not null and position('@' in v_email) > 0 then
      insert into public.email_outbox (user_id, to_email, subject, body)
      values (new.user_id, v_email,
        'Cambiaste tu cuenta PayPal de retiro',
        'Hola. La cuenta PayPal donde recibes tus retiros en Fans Reserve cambió de '
          || public.payout_label(new.from_email) || ' a ' || public.payout_label(new.to_email) || '.'
          || E'\n\nPor seguridad, los retiros quedan en pausa 48 horas desde este cambio.'
          || E'\n\nSi no fuiste tú, cambia tu contraseña y escríbenos ya a support@fansreserve.com para bloquear la cuenta.');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payout_account_change_guard on finance_private.payout_account_changes;
create trigger payout_account_change_guard
  after insert on finance_private.payout_account_changes
  for each row execute function finance_private.payout_account_change_guard();

-- When the creator can withdraw again after changing their PayPal account (null = now).
create or replace function finance_private.payout_hold_until(p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(c.created_at) + interval '48 hours'
  from finance_private.payout_account_changes c
  where c.user_id = p_user
    and c.from_email is not null
    and lower(trim(c.from_email)) is distinct from lower(trim(c.to_email))
    and c.created_at > now() - interval '48 hours';
$$;
revoke all on function finance_private.payout_hold_until(uuid) from public, anon, authenticated;

create or replace function public.paypal_payout_begin(p_user uuid, p_environment text, p_sender text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_until timestamptz;
begin
 perform finance_private.lock_book();
 if finance_private.active_funding_stop(p_environment) is not null then raise exception 'Faltan fondos del pagador; documenta la reanudación antes de iniciar otro retiro';end if;
 v_until := finance_private.payout_hold_until(p_user);
 if v_until is not null then
   raise exception 'Cambiaste tu cuenta PayPal de retiro hace poco. Por seguridad, podrás retirar desde el % (hora de Fans Reserve).',
     to_char(v_until at time zone 'America/Tegucigalpa', 'DD/MM/YYYY HH24:MI');
 end if;
 return finance_private.payout_begin_before_funding(p_user,p_environment,p_sender);
end
$$;
revoke all on function public.paypal_payout_begin(uuid, text, text) from public, anon, authenticated;
grant execute on function public.paypal_payout_begin(uuid, text, text) to service_role;
