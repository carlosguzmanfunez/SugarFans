-- Visitors without a session couldn't read Reserve experiences or managed
-- profiles. The SELECT policies (for anon and authenticated) call
-- my_creator_profile_id() / is_admin(), which 20260929000002 revoked from anon,
-- so the whole query failed and profiles showed "aún no publica experiencias".
-- Fix without granting anything to anon: one policy for visitors that only
-- checks the row, and the owner/admin policy only for signed-in users.

-- vip_experiences
drop policy if exists "vip_experiences: anyone reads active, owner reads all" on public.vip_experiences;
drop policy if exists "vip_experiences: visitors read active" on public.vip_experiences;
drop policy if exists "vip_experiences: members read active, owner reads all" on public.vip_experiences;
create policy "vip_experiences: visitors read active" on public.vip_experiences
  for select to anon using (active);
create policy "vip_experiences: members read active, owner reads all" on public.vip_experiences
  for select to authenticated using (active or creator_profile_id = (select public.my_creator_profile_id()));

-- managed_profiles
drop policy if exists "managed_profiles: visible ones are public" on public.managed_profiles;
drop policy if exists "managed_profiles: visitors read visible" on public.managed_profiles;
drop policy if exists "managed_profiles: members read visible, admins all" on public.managed_profiles;
create policy "managed_profiles: visitors read visible" on public.managed_profiles
  for select to anon using (not hidden);
create policy "managed_profiles: members read visible, admins all" on public.managed_profiles
  for select to authenticated using (not hidden or (select public.is_admin()));
