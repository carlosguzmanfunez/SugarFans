-- "Hazte creador" (Carlos, 2026-10-15): a fan account becomes a creator account
-- without losing anything (subscriptions, follows, Créditos, payments, bookings all
-- stay, since they are keyed by the user's id). The account gets the same things a
-- creator sign-up gets: its public profile (creator_profile_id = its own id), the
-- default subscription price and an @usuario from its name (check_username). Then
-- it goes through identity verification like any new creator: until verified its
-- posts are drafts and nobody can pay it (draft_posts, creator_accepts_payments).
--
-- One way only (fan → creator). Admins, demo accounts, suspended accounts and
-- unfinished Google/Microsoft sign-ups can't use it. Additive and safe to re-run.

create or replace function public.become_creator()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_username text;
begin
  if v_uid is null then
    raise exception 'No has iniciado sesión';
  end if;
  select * into v_me from public.profiles where id = v_uid;
  if v_me.id is null then
    raise exception 'No has iniciado sesión';
  end if;
  if v_me.role = 'creator' then
    raise exception 'Tu cuenta ya es de creador';
  end if;
  if v_me.role <> 'fan' then
    raise exception 'Esta cuenta no se puede convertir en creador';
  end if;
  if not coalesce(v_me.signup_completed, true) then
    raise exception 'Termina primero tu registro';
  end if;
  if v_me.email in ('fan@sugarfans.com', 'creator@sugarfans.com', 'admin@sugarfans.com') then
    raise exception 'Las cuentas demo no se pueden convertir en creador';
  end if;
  if public.is_suspended(v_uid) then
    raise exception 'Tu cuenta está suspendida. Escríbenos a support@fansreserve.com';
  end if;

  -- Same switch as complete_social_signup(): lets this one update change the role.
  perform set_config('fansreserve.completing_signup', 'on', true);
  update public.profiles set
    role = 'creator',
    creator_profile_id = v_uid::text,
    subscription_price = coalesce(subscription_price, 9.99),
    bio = coalesce(bio, ''),
    username = null -- check_username() gives a free one from the name
  where id = v_uid
  returning username into v_username;
  perform set_config('fansreserve.completing_signup', 'off', true);

  return v_username;
end;
$$;
revoke execute on function public.become_creator() from public, anon;
grant execute on function public.become_creator() to authenticated;
