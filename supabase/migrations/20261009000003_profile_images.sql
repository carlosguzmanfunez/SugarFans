-- Profile photo and cover photo uploaded by the user (like Facebook): a camera
-- button on the profile picture and on the cover. Files live in the public bucket
-- "profile-images" under the owner's folder (<user id>/...); the profile keeps the URL.
--
-- Additive and safe to re-run.

alter table public.profiles add column if not exists cover text not null default '';

-- Only a link (or nothing): never markup or a data: URL.
alter table public.profiles drop constraint if exists profiles_cover_url;
alter table public.profiles add constraint profiles_cover_url
  check (cover = '' or (cover like 'https://%' and length(cover) <= 600));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-images', 'profile-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile-images: owner reads" on storage.objects;
drop policy if exists "profile-images: owner uploads" on storage.objects;
drop policy if exists "profile-images: owner updates" on storage.objects;
drop policy if exists "profile-images: owner deletes" on storage.objects;
create policy "profile-images: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "profile-images: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "profile-images: owner updates" on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "profile-images: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The cover of a creator's public profile (the avatar already comes with public_creator).
create or replace function public.creator_cover(p_creator_profile_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.cover from public.profiles p
                    where p.creator_profile_id = p_creator_profile_id and p.role = 'creator' limit 1), '');
$$;
revoke execute on function public.creator_cover(text) from public;
grant execute on function public.creator_cover(text) to anon, authenticated;
