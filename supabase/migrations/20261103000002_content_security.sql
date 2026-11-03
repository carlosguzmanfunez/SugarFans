-- Security review 2026-11-03, items C1 and A1.
--
-- C1. A post's file, author and profile could be changed after it was created:
--     fill_creator_post() only checked them on INSERT. A creator could point their
--     own free post at another creator's private (paid) file and make it visible to
--     everyone, or move a post onto another creator's profile. Now an edit keeps the
--     author and profile, and the file can only be one from the author's own folder.
--
-- A1. Moderation approves a file by its bucket and path, once. Three ways around it:
--     a) a profile photo could be overwritten in place after it was approved
--        (the "owner updates" storage policy);
--     b) a file could be deleted and uploaded again under the same name, and the
--        approval still applied to the new content;
--     c) a profile photo could point at another website, as long as the link
--        contained "/storage/v1/object/public/profile-images/".
--     Now: files can't be overwritten, a path that was already submitted can't be
--     uploaded again, and a profile photo must be our own storage link to a file in
--     the person's own folder.

-- --- C1: posts --------------------------------------------------------------------

create or replace function public.guard_creator_post_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The service role (no signed-in user) keeps full control.
  if auth.uid() is null then
    return new;
  end if;
  new.creator_id := old.creator_id;
  new.created_at := old.created_at;
  if not public.is_admin() then
    new.creator_profile_id := old.creator_profile_id;
  end if;
  if new.media_path is distinct from old.media_path
     and new.media_path is not null
     and split_part(new.media_path, '/', 1) <> old.creator_id::text then
    raise exception 'Archivo no válido';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_creator_post_update on public.creator_posts;
create trigger guard_creator_post_update
  before update on public.creator_posts
  for each row execute function public.guard_creator_post_update();

-- --- A1: uploads -------------------------------------------------------------------

-- The only valid start of a profile photo link (this project's public bucket).
create or replace function public.profile_image_base()
returns text
language sql
immutable
set search_path = ''
as $$ select 'https://odugxvqwuvewsvifwmwb.supabase.co/storage/v1/object/public/profile-images/'::text $$;

-- Whether a path was already sent to moderation (then it can never be uploaded again).
create or replace function public.media_path_used(p_bucket text, p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.media_moderation m where m.bucket = p_bucket and m.path = p_path);
$$;
revoke all on function public.media_path_used(text, text) from public, anon;
grant execute on function public.media_path_used(text, text) to authenticated;

-- a) No overwriting a stored photo.
drop policy if exists "profile-images: owner updates" on storage.objects;

-- b) No re-uploading a path that moderation already saw.
drop policy if exists "profile-images: owner uploads" on storage.objects;
create policy "profile-images: owner uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.media_path_used('profile-images', name)
  );

drop policy if exists "post-media: author uploads" on storage.objects;
create policy "post-media: author uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('creator', 'admin'))
    and not public.media_path_used('post-media', name)
  );

-- c) The queued link must be exactly ours.
create or replace function public.submit_media(p_bucket text, p_path text, p_kind text, p_media_type text, p_public_url text default '')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para subir archivos.';
  end if;
  if split_part(p_path, '/', 1) <> v_uid::text then
    raise exception 'Ese archivo no es tuyo.';
  end if;
  if not ((p_bucket = 'post-media' and p_kind in ('post', 'perk_video') and p_media_type in ('image', 'video'))
       or (p_bucket = 'profile-images' and p_kind in ('avatar', 'cover') and p_media_type = 'image')) then
    raise exception 'Tipo de archivo no válido.';
  end if;
  if p_bucket = 'profile-images'
     and (p_public_url is distinct from public.profile_image_base() || p_path or length(p_public_url) > 600) then
    raise exception 'Enlace de la foto no válido.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_path) then
    raise exception 'No encontramos el archivo subido.';
  end if;
  insert into public.media_moderation (bucket, path, owner_id, kind, media_type, public_url)
  values (p_bucket, p_path, v_uid, p_kind, p_media_type, case when p_bucket = 'profile-images' then p_public_url else '' end)
  on conflict (bucket, path) do nothing;
  select m.status into v_status from public.media_moderation m where m.bucket = p_bucket and m.path = p_path;
  return v_status;
end;
$$;

-- c) A profile photo or cover set by its owner: our storage link, their own folder, approved.
create or replace function public.profile_image_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base constant text := public.profile_image_base();
  v_path text;
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.avatar is distinct from old.avatar and new.avatar <> '' then
    v_path := split_part(substring(new.avatar from length(v_base) + 1), '?', 1);
    if left(new.avatar, length(v_base)) <> v_base
       or split_part(v_path, '/', 1) <> new.id::text
       or not public.media_approved('profile-images', v_path) then
      raise exception 'Tu foto está en revisión: aparecerá cuando se apruebe.';
    end if;
  end if;
  if new.cover is distinct from old.cover and new.cover <> '' then
    v_path := split_part(substring(new.cover from length(v_base) + 1), '?', 1);
    if left(new.cover, length(v_base)) <> v_base
       or split_part(v_path, '/', 1) <> new.id::text
       or not public.media_approved('profile-images', v_path) then
      raise exception 'Tu portada está en revisión: aparecerá cuando se apruebe.';
    end if;
  end if;
  return new;
end;
$$;
