-- Optional gender (Carlos, 2026-11-05): Mujer / Hombre / Prefiero no decirlo.
-- Asked at sign-up and editable in Ajustes. It only picks the colour palette:
-- 'male' gets the blue gradient, everyone else keeps the pink one.
-- Private like country and phone: profiles is readable only by its owner and
-- admins, and no public function exposes it.
--
-- Additive: one nullable column and one small trigger. handle_new_user() is not
-- touched: a BEFORE INSERT trigger on profiles copies the answer from the sign-up
-- metadata (auth.users.raw_user_meta_data->>'gender'), so email sign-ups keep it.
-- Google/Microsoft sign-ups save it from the app after complete_social_signup().

alter table public.profiles add column if not exists gender text;

alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check
  check (gender is null or gender in ('female', 'male', 'unspecified'));

create or replace function public.profile_gender_from_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if new.gender is null then
    select u.raw_user_meta_data->>'gender' into v from auth.users u where u.id = new.id;
    if v in ('female', 'male', 'unspecified') then
      new.gender := v;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.profile_gender_from_signup() from public, anon, authenticated;

drop trigger if exists profile_gender_from_signup on public.profiles;
create trigger profile_gender_from_signup
  before insert on public.profiles
  for each row execute function public.profile_gender_from_signup();
