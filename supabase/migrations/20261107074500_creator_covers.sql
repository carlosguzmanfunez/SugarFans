-- Explorar shows every creator's cover photo on their card. One call returns the
-- covers of all public creators (the same ones public_creators lists), instead of
-- one creator_cover call per card. Only links already public on the profile page.
--
-- Additive and safe to re-run.

create or replace function public.creator_covers()
returns table (id text, cover text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.creator_profile_id, p.cover
  from public.profiles p
  where p.role = 'creator' and p.creator_profile_id is not null and p.cover <> ''
    and not public.is_suspended(p.id);
$$;
revoke execute on function public.creator_covers() from public;
grant execute on function public.creator_covers() to anon, authenticated;
