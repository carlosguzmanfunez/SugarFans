-- Account management from the admin panel (Carlos, 2026-10-10): suspend an
-- account (for some days or indefinitely), freeze a creator's withdrawals, take
-- away "Verificado" and delete an account. Every action needs a reason and is
-- logged. A suspension bans the login in Supabase Auth (banned_until), hides the
-- creator from Explore and stops payments to them; frozen withdrawals stop
-- payout_checks. Admin accounts can't be acted on. Additive and safe to re-run.

create table if not exists public.account_restrictions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  suspended_until timestamptz, -- null = not suspended
  suspension_reason text,
  payouts_frozen boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.account_restrictions enable row level security;
drop policy if exists "account_restrictions: admin reads" on public.account_restrictions;
create policy "account_restrictions: admin reads" on public.account_restrictions
  for select to authenticated using (public.is_admin());

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid,
  admin_name text not null,
  user_id uuid, -- kept after the account is deleted
  user_name text not null,
  action text not null check (action in ('suspend', 'unsuspend', 'freeze_payouts', 'unfreeze_payouts', 'unverify', 'delete')),
  reason text not null default '',
  until timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_actions_user_idx on public.admin_actions (user_id, created_at desc);
alter table public.admin_actions enable row level security;
drop policy if exists "admin_actions: admin reads" on public.admin_actions;
create policy "admin_actions: admin reads" on public.admin_actions
  for select to authenticated using (public.is_admin());

create or replace function public.is_suspended(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.account_restrictions r where r.user_id = p_user and r.suspended_until > now());
$$;
revoke execute on function public.is_suspended(uuid) from public, anon, authenticated;

-- p_action: suspend (p_days null = indefinitely), unsuspend, freeze_payouts,
-- unfreeze_payouts, unverify, delete.
create or replace function public.admin_account_action(p_user uuid, p_action text, p_reason text, p_days integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles;
  v_target public.profiles;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_until timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Esta acción no está permitida';
  end if;
  select * into v_admin from public.profiles where id = auth.uid();
  select * into v_target from public.profiles where id = p_user;
  if v_target.id is null then
    raise exception 'Cuenta no encontrada';
  end if;
  if v_target.role = 'admin' then
    raise exception 'Las cuentas de administrador no se gestionan desde aquí';
  end if;
  if p_action not in ('suspend', 'unsuspend', 'freeze_payouts', 'unfreeze_payouts', 'unverify', 'delete') then
    raise exception 'Acción no válida';
  end if;
  if p_action in ('suspend', 'freeze_payouts', 'unverify', 'delete') and v_reason = '' then
    raise exception 'Escribe el motivo';
  end if;
  if p_action = 'suspend' and p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'Elige entre 1 y 3650 días';
  end if;

  if p_action = 'suspend' then
    -- "Indefinitely" = 100 years (Supabase Auth needs a real date).
    v_until := now() + coalesce(make_interval(days => p_days), interval '100 years');
  end if;

  insert into public.admin_actions (admin_id, admin_name, user_id, user_name, action, reason, until)
  values (v_admin.id, coalesce(v_admin.name, 'Admin'), v_target.id, v_target.name, p_action, v_reason, v_until);

  if p_action = 'delete' then
    delete from auth.users where id = v_target.id;
    return;
  end if;
  if p_action = 'unverify' then
    update public.profiles set is_verified = false where id = v_target.id;
    return;
  end if;

  insert into public.account_restrictions (user_id) values (v_target.id) on conflict (user_id) do nothing;
  if p_action = 'suspend' then
    update public.account_restrictions set suspended_until = v_until, suspension_reason = v_reason, updated_at = now() where user_id = v_target.id;
    update auth.users set banned_until = v_until where id = v_target.id;
  elsif p_action = 'unsuspend' then
    update public.account_restrictions set suspended_until = null, suspension_reason = null, updated_at = now() where user_id = v_target.id;
    update auth.users set banned_until = null where id = v_target.id;
  else
    update public.account_restrictions set payouts_frozen = (p_action = 'freeze_payouts'), updated_at = now() where user_id = v_target.id;
  end if;
end;
$$;
revoke execute on function public.admin_account_action(uuid, text, text, integer) from public, anon;
grant execute on function public.admin_account_action(uuid, text, text, integer) to authenticated;

-- Same as 20261009000002, plus: a suspended creator takes no money.
create or replace function public.creator_accepts_payments(p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                  where p.creator_profile_id = p_creator_profile_id and p.role = 'creator' and p.is_verified
                    and not public.is_suspended(p.id))
      or exists (select 1 from public.managed_profiles m
                  where m.id = p_creator_profile_id and not m.hidden);
$$;
revoke execute on function public.creator_accepts_payments(text) from public;
grant execute on function public.creator_accepts_payments(text) to anon, authenticated;

create or replace function public.assert_creator_accepts_payments(p_creator_profile_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if p_creator_profile_id is not null and not public.creator_accepts_payments(p_creator_profile_id) then
    select p.id into v_owner from public.profiles p where p.creator_profile_id = p_creator_profile_id and p.role = 'creator' limit 1;
    if v_owner is not null and public.is_suspended(v_owner) then
      raise exception 'Este creador no está disponible en este momento: no acepta pagos ni reservas.';
    end if;
    if v_owner is not null then
      raise exception 'Este creador todavía está verificando su identidad: aún no acepta pagos ni reservas.';
    end if;
    raise exception 'Este perfil es de demostración: todavía no acepta pagos ni reservas.';
  end if;
end;
$$;
revoke execute on function public.assert_creator_accepts_payments(text) from public, anon, authenticated;

-- Same as 20261004000002, without suspended creators.
create or replace function public.public_creators()
returns table (id text, name text, avatar text, bio text, is_verified boolean, subscription_price numeric, posts integer, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.creator_profile_id, p.name, p.avatar, p.bio, p.is_verified, p.subscription_price, p.posts, p.created_at
  from public.profiles p
  where p.role = 'creator' and p.creator_profile_id is not null
    and p.creator_profile_id not in ('1', '2', '3', '4', '5', '6', '7', '8', '9')
    and not public.is_suspended(p.id)
  order by p.created_at desc;
$$;
grant execute on function public.public_creators() to anon, authenticated;

-- Same as 20261006000001, plus frozen withdrawals and suspended accounts.
create or replace function public.payout_checks(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_email text;
  v_available numeric;
  v_min numeric;
begin
  select * into v_me from public.profiles where id = p_user for update;
  if v_me.id is null or v_me.role <> 'creator' then
    raise exception 'Solo los creadores pueden retirar';
  end if;
  if not v_me.is_verified then
    raise exception 'Verifica tu identidad antes de solicitar un retiro';
  end if;
  if public.is_suspended(v_me.id)
     or exists (select 1 from public.account_restrictions r where r.user_id = v_me.id and r.payouts_frozen) then
    raise exception 'Tus retiros están en revisión. Escríbenos a support@fansreserve.com';
  end if;
  select paypal_email into v_email from public.payout_accounts where user_id = v_me.id;
  if v_email is null then
    raise exception 'Añade el email de tu cuenta PayPal para retiros';
  end if;
  if exists (select 1 from public.payouts where user_id = v_me.id and status = 'sending') then
    raise exception 'Tienes un retiro en camino; espera a que PayPal lo confirme';
  end if;
  v_available := public.creator_available_balance(v_me.id);
  v_min := public.payout_min(v_me.id);
  if v_available < v_min then
    raise exception 'Necesitas al menos $% USD acreditados para retirar; tu saldo disponible es $%',
      to_char(v_min, 'FM999,990.00'), to_char(v_available, 'FM999,999,990.00');
  end if;
  return v_email;
end;
$$;
revoke execute on function public.payout_checks(uuid) from public, anon, authenticated;
