-- The Círculo privado (group chat) and the Bóveda (exclusive content) are
-- removed from Fans Reserve (Carlos, 2026-10-02: they commit the creator too
-- much). Nothing is dropped, so history stays intact: no one can write to them
-- any more, and only the creator (or an admin) can still read or delete what
-- is there.
drop policy if exists "circle_messages: members write" on public.circle_messages;
drop policy if exists "vault_items: creators add" on public.vault_items;

create or replace function public.in_circle(p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.owns_creator_profile(p_creator_profile_id);
$$;

create or replace function public.in_vault(p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.owns_creator_profile(p_creator_profile_id);
$$;
