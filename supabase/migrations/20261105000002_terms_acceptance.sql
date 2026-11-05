-- Terms acceptance record (Carlos, 2026-11-05): store WHEN each person accepted
-- the Terms and WHICH version, as evidence for PayPal, disputes and the lawyer.
--
-- Additive only: two nullable columns on profiles, one history table, two small
-- triggers and one RPC. handle_new_user() and complete_social_signup() are not
-- touched.
--   * Email sign-up: the app sends terms_version in the sign-up metadata (the
--     checkbox is required); a BEFORE INSERT trigger on profiles stamps now().
--   * Google/Microsoft sign-up: the app calls accept_terms(version) right after
--     complete_social_signup(), once the checkbox is ticked.
-- The time always comes from the server (now()), never from the browser, and a
-- guard keeps users from editing these columns directly.
-- Existing accounts keep null (we can't know when they accepted).

alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists terms_version text;

create table if not exists public.terms_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null check (length(version) between 1 and 20),
  method text not null check (method in ('signup', 'social', 'reaccept')),
  accepted_at timestamptz not null default now()
);
create index if not exists terms_acceptances_user_idx on public.terms_acceptances(user_id, accepted_at desc);

alter table public.terms_acceptances enable row level security;
drop policy if exists terms_acceptances_read on public.terms_acceptances;
create policy terms_acceptances_read on public.terms_acceptances for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
revoke all on public.terms_acceptances from public, anon, authenticated;
grant select on public.terms_acceptances to authenticated;

-- Email sign-up: copy the accepted version from the sign-up metadata.
create or replace function public.profile_terms_from_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text;
begin
  select u.raw_user_meta_data->>'terms_version' into v from auth.users u where u.id = new.id;
  if v is not null and length(v) between 1 and 20 then
    new.terms_accepted_at := now();
    new.terms_version := v;
    insert into public.terms_acceptances(user_id, version, method) values (new.id, v, 'signup');
  else
    new.terms_accepted_at := null;
    new.terms_version := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.profile_terms_from_signup() from public, anon, authenticated;

drop trigger if exists profile_terms_from_signup on public.profiles;
create trigger profile_terms_from_signup
  before insert on public.profiles
  for each row execute function public.profile_terms_from_signup();

-- Nobody edits the record by hand: only accept_terms() may change it.
create or replace function public.profile_terms_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('fansreserve.accept_terms', true), '') <> 'on' then
    new.terms_accepted_at := old.terms_accepted_at;
    new.terms_version := old.terms_version;
  end if;
  return new;
end;
$$;
revoke execute on function public.profile_terms_guard() from public, anon, authenticated;

drop trigger if exists profile_terms_guard on public.profiles;
create trigger profile_terms_guard
  before update on public.profiles
  for each row execute function public.profile_terms_guard();

-- Social sign-up (and a future re-acceptance of a new version).
create or replace function public.accept_terms(p_version text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := now();
  v_prev text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para aceptar los Términos'; end if;
  if p_version is null or length(p_version) not between 1 and 20 then raise exception 'Versión de Términos no válida'; end if;
  select terms_version into v_prev from public.profiles where id = auth.uid();
  if not found then raise exception 'Cuenta no encontrada'; end if;
  perform set_config('fansreserve.accept_terms', 'on', true);
  update public.profiles set terms_accepted_at = v_at, terms_version = p_version where id = auth.uid();
  perform set_config('fansreserve.accept_terms', 'off', true);
  insert into public.terms_acceptances(user_id, version, method)
    values (auth.uid(), p_version, case when v_prev is null then 'social' else 'reaccept' end);
  return v_at;
end;
$$;
revoke execute on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;
