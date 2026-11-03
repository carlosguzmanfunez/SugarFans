-- Security review 2026-11-03, items B3 and B4.
--
-- B3: a person could edit their own post counter and their "18+" mark through the API.
--     The counter is now only written by the post triggers; "18+" can only be confirmed,
--     never taken back by the person (admins keep full control).
-- B4: a fan could delete their subscription row directly, while PayPal kept charging.
--     Cancelling now always goes through cancel_subscription / PayPal.

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
    new.age_verified := old.age_verified or new.age_verified;
    -- Only sync_post_count (a trigger on creator_posts) may change it.
    if pg_trigger_depth() = 1 then
      new.posts := old.posts;
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "subscriptions: fan cancels" on public.subscriptions;
revoke delete, truncate, references, trigger on public.subscriptions from anon, authenticated;
