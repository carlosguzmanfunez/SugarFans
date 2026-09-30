-- Admins publish posts as a platform-run profile ("m-…"). Everyone else still
-- publishes as their own creator profile.
create or replace function public.fill_creator_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.creator_profile_id like 'm-%'
     and exists (select 1 from public.profiles where id = new.creator_id and role = 'admin')
     and exists (select 1 from public.managed_profiles where id = new.creator_profile_id) then
    null; -- keep the managed profile id
  else
    select coalesce(creator_profile_id, id::text) into new.creator_profile_id from public.profiles where id = new.creator_id;
  end if;
  if new.media_path is not null and split_part(new.media_path, '/', 1) <> new.creator_id::text then
    raise exception 'Archivo no válido';
  end if;
  return new;
end;
$$;

-- Any admin can remove a managed profile's post (not only the one who wrote it).
create policy "creator_posts: admins delete managed posts" on public.creator_posts
  for delete to authenticated
  using (creator_profile_id like 'm-%' and (select public.is_admin()));
create policy "post-media: admins delete managed media" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-media'
    and (select public.is_admin())
    and exists (select 1 from public.creator_posts p where p.media_path = name and p.creator_profile_id like 'm-%')
  );
