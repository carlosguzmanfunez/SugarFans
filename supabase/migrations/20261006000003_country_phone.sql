-- Country and phone at sign-up (Carlos, 2026-10-06).
-- Country (ISO code, 'ZZ' = other) is asked of everyone; the phone is optional and
-- stored in international format (+50499998888). Neither is public: profiles stays
-- readable only by its owner and admins. The only public piece is a creator's
-- country, through creator_countries(), for Explore's country filter and the Top
-- of the month by country. Admins already read every profile, so the admin panel
-- counts sign-ups per country itself.
--
-- Additive: two nullable columns, handle_new_user() and complete_social_signup()
-- replaced with the same behaviour plus these fields, three small new functions.

alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists phone text;

alter table public.profiles drop constraint if exists profiles_country_check;
alter table public.profiles add constraint profiles_country_check check (country is null or country ~ '^[A-Z]{2}$');
alter table public.profiles drop constraint if exists profiles_phone_check;
alter table public.profiles add constraint profiles_phone_check check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

-- A bad value from the sign-up form never blocks the account: it's just not saved.
create or replace function public.clean_country(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when upper(trim(p)) ~ '^[A-Z]{2}$' then upper(trim(p)) end;
$$;

create or replace function public.clean_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when trim(p) ~ '^\+[1-9][0-9]{7,14}$' then trim(p) end;
$$;

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
  insert into public.profiles (id, name, email, role, avatar, age_verified, subscription_price, creator_profile_id, bio, signup_completed, country, phone)
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
    not v_social,
    public.clean_country(new.raw_user_meta_data ->> 'country'),
    public.clean_phone(new.raw_user_meta_data ->> 'phone')
  );
  return new;
end;
$$;

-- Same as before, plus the country (required) and phone (optional) the social
-- sign-up form now asks for. The old two-argument version is replaced; calls with
-- only p_role/p_ref keep working.
drop function if exists public.complete_social_signup(text, text);
create or replace function public.complete_social_signup(p_role text, p_ref text default null, p_country text default null, p_phone text default null)
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
    bio = case when p_role = 'creator' then coalesce(bio, '') else bio end,
    country = coalesce(public.clean_country(p_country), country),
    phone = coalesce(public.clean_phone(p_phone), phone)
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

-- Each creator's country (public): Explore's country filter and Top by country.
-- Demo creators 1-9 have a test country unless the account that owns them set one.
create or replace function public.creator_countries()
returns table (id text, country text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.creator_profile_id, p.country
  from public.profiles p
  where p.role = 'creator' and p.creator_profile_id is not null and p.country is not null and p.country <> 'ZZ'
  union all
  select d.id, d.country
  from (values ('1', 'CO'), ('2', 'MX'), ('3', 'AR'), ('4', 'ES'), ('5', 'HN'), ('6', 'MX'),
    ('7', 'CO'), ('8', 'HN'), ('9', 'ES')) as d(id, country)
  where not exists (
    select 1 from public.profiles p
    where p.creator_profile_id = d.id and p.role = 'creator' and p.country is not null and p.country <> 'ZZ'
  );
$$;

revoke execute on function public.clean_country(text) from public, anon, authenticated;
revoke execute on function public.clean_phone(text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.complete_social_signup(text, text, text, text) from public, anon;
grant execute on function public.complete_social_signup(text, text, text, text) to authenticated;
grant execute on function public.creator_countries() to anon, authenticated;
