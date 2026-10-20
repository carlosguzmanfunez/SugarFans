-- Singleton owner identity, provisioned separately from a confirmed Auth user.
-- No personal email, password or generated identity is embedded in this migration.
create schema security_private;
revoke all on schema security_private from public,anon,authenticated,service_role;
create table security_private.owner_account(
 singleton boolean primary key default true check(singleton),
 user_id uuid not null unique references auth.users(id) on delete restrict,
 active_view text not null default 'admin' check(active_view in ('fan','creator','admin')),
 granted_at timestamptz not null default now(),
 reason text not null check(length(trim(reason))>=10)
);
create table security_private.owner_view_audit(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,
 previous_view text not null,new_view text not null,session_id uuid not null,
 recorded_at timestamptz not null default now()
);
alter table security_private.owner_account enable row level security;
alter table security_private.owner_view_audit enable row level security;
revoke all on all tables in schema security_private from public,anon,authenticated,service_role;
create function security_private.owner_enabled() returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from security_private.owner_account o
 join auth.users u on u.id=o.user_id join public.profiles p on p.id=u.id
 where o.user_id=auth.uid() and u.deleted_at is null and u.email_confirmed_at is not null
  and (u.banned_until is null or u.banned_until<=now())
  and lower(u.email) not in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com')
  and not exists(select 1 from public.account_restrictions r where r.user_id=u.id and r.suspended_until>now())
  and exists(select 1 from auth.sessions s where s.user_id=u.id and s.id=nullif(auth.jwt()->>'session_id','')::uuid));
$$;
create function security_private.immutable_owner_audit() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'El historial de cambios de vista del propietario es inmutable';end;
$$;
create trigger owner_view_audit_immutable before update or delete on security_private.owner_view_audit
for each row execute function security_private.immutable_owner_audit();
revoke all on all functions in schema security_private from public,anon,authenticated,service_role;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from security_private.owner_account where user_id=auth.uid())
 then security_private.owner_enabled()
 else exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=auth.uid() and p.role='admin' and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=now())
   and not exists(select 1 from public.account_restrictions r where r.user_id=p.id and r.suspended_until>now()))
 end;
$$;
revoke all on function public.is_admin() from public,anon;
grant execute on function public.is_admin() to authenticated;

create function public.owner_access() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not security_private.owner_enabled() then return jsonb_build_object('owner',false);end if;
 return jsonb_build_object('owner',true,'view',(select active_view from security_private.owner_account where user_id=auth.uid()),'account_role',(select role from public.profiles where id=auth.uid()),
  'roles',jsonb_build_array('fan','creator','admin'));
end;
$$;
create function public.owner_switch_view(p_view text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_previous text;
begin
 if not security_private.owner_enabled() then raise exception 'Esta opción solo está disponible para el propietario autenticado';end if;
 if p_view is null or p_view not in ('fan','creator','admin') then raise exception 'Selecciona una vista válida';end if;
 select active_view into v_previous from security_private.owner_account where user_id=auth.uid() for update;
 if v_previous=p_view then return jsonb_build_object('view',p_view);end if;
 update security_private.owner_account set active_view=p_view where user_id=auth.uid();
 insert into security_private.owner_view_audit(user_id,previous_view,new_view,session_id)
 values(auth.uid(),v_previous,p_view,(auth.jwt()->>'session_id')::uuid);
 return jsonb_build_object('view',p_view);
end;
$$;
revoke all on function public.owner_access(),public.owner_switch_view(text) from public,anon,authenticated,service_role;
grant execute on function public.owner_access(),public.owner_switch_view(text) to authenticated;

-- The owner remains protected in account management in every inspection view.
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
  if v_target.role = 'admin' or exists(select 1 from security_private.owner_account where user_id=v_target.id) then
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
revoke all on function public.admin_account_action(uuid,text,text,integer) from public,anon;
grant execute on function public.admin_account_action(uuid,text,text,integer) to authenticated;

-- Owner's administrative publishing keeps the existing media and draft checks.
create or replace function public.fill_creator_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.creator_profile_id like 'm-%'
     and (exists (select 1 from public.profiles where id = new.creator_id and role = 'admin')
       or (new.creator_id=auth.uid() and security_private.owner_enabled()))
     and exists (select 1 from public.managed_profiles where id = new.creator_profile_id) then
    null; -- keep the managed profile id
  else
    select coalesce(creator_profile_id, id::text) into new.creator_profile_id from public.profiles where id = new.creator_id;
  end if;
  if new.media_path is not null and split_part(new.media_path, '/', 1) <> new.creator_id::text then
    raise exception 'Archivo no válido';
  end if;
  return new;
end;
$$;
revoke all on function public.fill_creator_post() from public,anon,authenticated,service_role;
create or replace function public.creator_post_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live boolean;
begin
  select p.is_verified or p.role = 'admin' or (p.id=auth.uid() and security_private.owner_enabled()) into v_live from public.profiles p where p.id = new.creator_id;
  if tg_op = 'INSERT' then
    new.is_draft := not coalesce(v_live, false);
  else
    new.is_draft := old.is_draft and not coalesce(v_live, false);
  end if;
  return new;
end;
$$;
revoke all on function public.creator_post_draft() from public,anon,authenticated,service_role;
