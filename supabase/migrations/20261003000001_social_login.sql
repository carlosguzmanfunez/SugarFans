-- Sign in with Google or Microsoft.
-- A social sign-up arrives without a role or the 18+ / terms confirmation, so
-- its profile starts as a pending fan (signup_completed = false). The user then
-- picks fan or creator and accepts the terms once, through
-- complete_social_signup(). A creator still goes through KYC like any other.

alter table public.profiles add column if not exists signup_completed boolean not null default true;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_social boolean := coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email';
  v_role text := case when v_social then 'fan' else coalesce(new.raw_user_meta_data ->> 'role', 'fan') end;
  v_name text := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(new.email, '@', 1)
  );
  v_avatar text := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'picture', ''),
    'https://api.dicebear.com/7.0/adventurer/svg?seed=' || replace(v_name, ' ', '%20')
  );
begin
  if v_role not in ('fan', 'creator') then
    v_role := 'fan';
  end if;
  insert into public.profiles (id, name, email, role, avatar, age_verified, subscription_price, creator_profile_id, bio, signup_completed)
  values (
    new.id,
    v_name,
    lower(new.email),
    v_role,
    v_avatar,
    case when v_social then false else coalesce((new.raw_user_meta_data ->> 'age_verified')::boolean, false) end,
    case when v_role = 'creator' then 9.99 end,
    case when v_role = 'creator' then new.id::text end,
    case when v_role = 'creator' then '' end,
    not v_social
  );
  return new;
end;
$$;

-- Users can't change their own role or signup state, except through
-- complete_social_signup(), which lifts the guard for its own update.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and coalesce(current_setting('fansreserve.completing_signup', true), '') <> 'on' then
    new.id := old.id;
    new.role := old.role;
    new.email := old.email;
    new.is_verified := old.is_verified;
    new.followers := old.followers;
    new.following := old.following;
    new.creator_profile_id := old.creator_profile_id;
    new.created_at := old.created_at;
    new.signup_completed := old.signup_completed;
  end if;
  return new;
end;
$$;

-- Finishes a social sign-up: role, 18+ / terms, and the referral link if any
-- (same rules as record_referral for email sign-ups). Works only once.
create or replace function public.complete_social_signup(p_role text, p_ref text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ref text := nullif(trim(p_ref), '');
begin
  if v_uid is null then
    raise exception 'No has iniciado sesión';
  end if;
  if p_role not in ('fan', 'creator') then
    raise exception 'Tipo de cuenta no válido';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and signup_completed = false) then
    raise exception 'Tu cuenta ya está completa';
  end if;

  perform set_config('fansreserve.completing_signup', 'on', true);
  update public.profiles set
    role = p_role,
    signup_completed = true,
    age_verified = true,
    subscription_price = case when p_role = 'creator' then 9.99 end,
    creator_profile_id = case when p_role = 'creator' then v_uid::text end,
    bio = case when p_role = 'creator' then coalesce(bio, '') else bio end
  where id = v_uid;
  perform set_config('fansreserve.completing_signup', 'off', true);

  if v_ref is not null
     and exists (select 1 from public.profiles where creator_profile_id = v_ref and role in ('creator', 'admin') and id <> v_uid) then
    if p_role = 'creator' then
      insert into public.creator_invites (creator_id, creator_profile_id, referrer_profile_id)
      select p.id, p.creator_profile_id, v_ref from public.profiles p
      where p.id = v_uid and p.creator_profile_id is not null and p.creator_profile_id <> v_ref
      on conflict do nothing;
    else
      insert into public.referrals (fan_id, creator_profile_id) values (v_uid, v_ref) on conflict do nothing;
    end if;
  end if;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.protect_profile_columns() from public, anon, authenticated;
revoke execute on function public.complete_social_signup(text, text) from public, anon;
grant execute on function public.complete_social_signup(text, text) to authenticated;
