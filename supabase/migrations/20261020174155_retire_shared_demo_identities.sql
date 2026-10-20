-- F01: retire shared identities without deleting financial or moderation history.
-- Provision a confirmed personal administrator before retiring the only admin.
-- The owner identity is deliberately not selected from a name or user_metadata.
do $$
begin
 if exists(select 1 from public.profiles p join auth.users u on u.id=p.id
   where p.role='admin' and lower(u.email) in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com'))
 and not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
   where (p.role='admin' or exists(select 1 from security_private.owner_account o where o.user_id=p.id)) and lower(u.email) not in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com')
     and u.email_confirmed_at is not null and u.deleted_at is null
     and (u.banned_until is null or u.banned_until<=now())
     and not exists(select 1 from public.account_restrictions r where r.user_id=p.id and r.suspended_until>now())) then
   raise exception 'F01: identificar y verificar un administrador personal antes de retirar Demo Admin';
 end if;
end;
$$;

-- Evaluate live stored identity/role, including for an already-issued demo JWT.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from security_private.owner_account where user_id=auth.uid())
 then security_private.owner_enabled()
 else exists(select 1 from public.profiles p join auth.users u on u.id=p.id
   where p.id=auth.uid() and p.role='admin' and u.deleted_at is null
     and (u.banned_until is null or u.banned_until<=now())
     and lower(u.email) not in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com')
     and not exists(select 1 from public.account_restrictions r where r.user_id=p.id and r.suspended_until>now()))
 end;
$$;
revoke all on function public.is_admin() from public,anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.reject_demo_admin_role()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role='admin' and exists(select 1 from auth.users u where u.id=new.id
   and lower(u.email) in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com')) then
   raise exception 'Las identidades demo retiradas no pueden recibir privilegios administrativos';
 end if;
 return new;
end;
$$;
revoke all on function public.reject_demo_admin_role() from public,anon,authenticated,service_role;
drop trigger if exists reject_demo_admin_role on public.profiles;
create trigger reject_demo_admin_role before insert or update of role on public.profiles
 for each row execute function public.reject_demo_admin_role();

-- This is a new containment action, not a reconstruction of previous activity.
insert into public.admin_actions(admin_id,admin_name,user_id,user_name,action,reason,until)
select null,'Mantenimiento de seguridad F01',p.id,p.name,'suspend',
 'F01: identidad compartida de demostración retirada; historial conservado',now()+interval '100 years'
from public.profiles p join auth.users u on u.id=p.id
where lower(u.email) in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com')
 and not exists(select 1 from public.admin_actions a where a.user_id=p.id
   and a.action='suspend' and a.reason='F01: identidad compartida de demostración retirada; historial conservado');

-- Revoke refresh capability before disabling login and dropping the admin role.
-- Sessions cascade to linked refresh tokens; remove legacy unlinked tokens too.
delete from auth.refresh_tokens r using auth.users u
 where r.user_id=u.id::text and lower(u.email) in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com');
delete from auth.sessions s using auth.users u
 where s.user_id=u.id and lower(u.email) in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com');
update auth.users set banned_until=now()+interval '100 years',encrypted_password=null
 where lower(email) in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com');
insert into public.account_restrictions(user_id,suspended_until,suspension_reason,payouts_frozen,updated_at)
select p.id,now()+interval '100 years','F01: cuenta demo retirada de producción',true,now()
from public.profiles p join auth.users u on u.id=p.id
where lower(u.email) in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com')
on conflict(user_id) do update set suspended_until=excluded.suspended_until,
 suspension_reason=excluded.suspension_reason,payouts_frozen=true,updated_at=excluded.updated_at;
update public.profiles p set role='fan'
from auth.users u where u.id=p.id and p.role='admin'
 and lower(u.email) in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com');
