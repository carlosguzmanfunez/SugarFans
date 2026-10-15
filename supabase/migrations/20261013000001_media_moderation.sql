-- Automatic moderation of the photos and videos people upload (posts, the video a
-- creator delivers for a gift, profile photo and cover). Nothing new is visible to
-- anyone else until it is approved: by the automatic scan (api/moderate.ts, with
-- Sightengine) or by an admin in the dashboard's "Moderación" tab.
--
--   pending  → uploaded, not scanned yet (or the scan service isn't configured)
--   review   → the scan found something doubtful: an admin decides
--   approved → visible as usual
--   rejected → never shown (the file is kept as evidence; an admin can reverse it)
--
-- The author and admins always see their own files, so a creator can tell what is
-- waiting. Files uploaded before this migration are marked approved ("anterior").
--
-- Additive and safe to re-run.

create table if not exists public.media_moderation (
  bucket text not null check (bucket in ('post-media', 'profile-images')),
  path text not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('post', 'perk_video', 'avatar', 'cover')),
  media_type text not null check (media_type in ('image', 'video')),
  status text not null default 'pending' check (status in ('pending', 'review', 'approved', 'rejected')),
  reason text not null default '',
  scores jsonb,
  provider text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  -- Profile photos: the public link the profile shows once approved.
  public_url text not null default '',
  primary key (bucket, path)
);

alter table public.media_moderation enable row level security;

drop policy if exists "media_moderation: owner reads" on public.media_moderation;
drop policy if exists "media_moderation: admins read" on public.media_moderation;
create policy "media_moderation: owner reads" on public.media_moderation
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "media_moderation: admins read" on public.media_moderation
  for select to authenticated using ((select public.is_admin()));
-- No insert/update/delete for clients: submit_media(), the scan (service role)
-- and moderation_review() are the only writers.
grant select, insert, update, delete on public.media_moderation to service_role;

create index if not exists media_moderation_open on public.media_moderation (created_at desc)
  where status in ('pending', 'review', 'rejected');

-- ---------------------------------------------------------------------
-- Is this file approved?
-- ---------------------------------------------------------------------
create or replace function public.media_approved(p_bucket text, p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.media_moderation m
                  where m.bucket = p_bucket and m.path = p_path and m.status = 'approved');
$$;
revoke execute on function public.media_approved(text, text) from public;
grant execute on function public.media_approved(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- The uploader puts their file in the queue right after uploading it. Only their
-- own files, only files that exist, and always as "pending": the decision is the
-- scan's or an admin's.
-- ---------------------------------------------------------------------
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
     and (p_public_url not like 'https://%/storage/v1/object/public/profile-images/' || p_path or length(p_public_url) > 600) then
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
revoke execute on function public.submit_media(text, text, text, text, text) from public, anon;
grant execute on function public.submit_media(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- An admin approves or rejects. Approving a profile photo puts it on the profile.
-- ---------------------------------------------------------------------
create or replace function public.moderation_review(p_bucket text, p_path text, p_approve boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.media_moderation;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar archivos.';
  end if;
  update public.media_moderation
     set status = case when p_approve then 'approved' else 'rejected' end,
         reason = case when p_approve then reason else coalesce(nullif(trim(p_reason), ''), 'Rechazado por un administrador') end,
         reviewed_by = auth.uid(),
         decided_at = now()
   where bucket = p_bucket and path = p_path
   returning * into m;
  if m.path is null then
    raise exception 'No encontramos ese archivo.';
  end if;
  if p_approve and m.kind = 'avatar' and m.public_url <> '' then
    update public.profiles set avatar = m.public_url where id = m.owner_id;
  elsif p_approve and m.kind = 'cover' and m.public_url <> '' then
    update public.profiles set cover = m.public_url where id = m.owner_id;
  end if;
end;
$$;
revoke execute on function public.moderation_review(text, text, boolean, text) from public, anon;
grant execute on function public.moderation_review(text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Profile photo and cover: a signed-in person can only put an approved photo of
-- their own (or none). Admins and the server (scan, review) are not limited.
-- ---------------------------------------------------------------------
create or replace function public.profile_image_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker constant text := '/storage/v1/object/public/profile-images/';
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.avatar is distinct from old.avatar and new.avatar <> '' then
    if position(v_marker in new.avatar) = 0
       or not public.media_approved('profile-images', split_part(substring(new.avatar from position(v_marker in new.avatar) + length(v_marker)), '?', 1)) then
      raise exception 'Tu foto está en revisión: aparecerá cuando se apruebe.';
    end if;
  end if;
  if new.cover is distinct from old.cover and new.cover <> '' then
    if position(v_marker in new.cover) = 0
       or not public.media_approved('profile-images', split_part(substring(new.cover from position(v_marker in new.cover) + length(v_marker)), '?', 1)) then
      raise exception 'Tu portada está en revisión: aparecerá cuando se apruebe.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.profile_image_guard() from public, anon, authenticated;

drop trigger if exists profile_image_guard on public.profiles;
create trigger profile_image_guard
  before update of avatar, cover on public.profiles
  for each row execute function public.profile_image_guard();

-- ---------------------------------------------------------------------
-- Posts: a post with a photo or video only shows to others once it's approved.
-- ---------------------------------------------------------------------
create or replace function public.can_view_post(p_post_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.creator_posts;
begin
  if exists (select 1 from public.removed_posts where post_id = p_post_id) then
    return false;
  end if;
  if p_post_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return true;
  end if;
  select * into p from public.creator_posts where id = p_post_id::uuid;
  if p.id is null then
    return false;
  end if;
  if p.creator_id = auth.uid() or public.is_admin() then
    return true;
  end if;
  if p.is_draft then
    return false;
  end if;
  if p.media_path is not null and not public.media_approved('post-media', p.media_path) then
    return false;
  end if;
  if auth.uid() is not null and public.is_cut_off(auth.uid(), p.creator_profile_id) then
    return false;
  end if;
  if not p.is_locked then
    return true;
  end if;
  return public.has_subscription(auth.uid(), p.creator_profile_id);
end;
$$;

drop policy if exists "creator_posts: anyone reads" on public.creator_posts;
create policy "creator_posts: anyone reads" on public.creator_posts
  for select to anon, authenticated
  using (not is_draft and (media_path is null or public.media_approved('post-media', media_path)));

-- Storage: others only get approved files (the uploader reads their own folder,
-- admins read everything to review it).
create or replace function public.can_view_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.media_approved('post-media', p_name)
          and (exists (select 1 from public.creator_posts p where p.media_path = p_name and public.can_view_post(p.id::text))
               or exists (select 1 from public.vault_items v where v.media_path = p_name and public.in_vault(v.creator_profile_id))
               or exists (select 1 from public.perk_requests r where r.media_path = p_name
                          and (r.fan_id = auth.uid() or public.owns_creator_profile(r.creator_profile_id)))));
$$;

-- ---------------------------------------------------------------------
-- Everything uploaded before this moderation existed stays visible. Only while
-- the queue has never been used, so a re-run never approves a newer upload.
-- ---------------------------------------------------------------------
insert into public.media_moderation (bucket, path, owner_id, kind, media_type, status, provider, decided_at, public_url)
select o.bucket_id,
       o.name,
       pr.id,
       case when o.bucket_id = 'profile-images' then (case when split_part(o.name, '/', 2) like 'cover-%' then 'cover' else 'avatar' end)
            when exists (select 1 from public.perk_requests r where r.media_path = o.name) then 'perk_video'
            else 'post' end,
       case when coalesce(o.metadata ->> 'mimetype', '') like 'video/%' then 'video' else 'image' end,
       'approved',
       'anterior',
       now(),
       ''
  from storage.objects o
  join public.profiles pr on pr.id::text = split_part(o.name, '/', 1)
 where o.bucket_id in ('post-media', 'profile-images')
   and not exists (select 1 from public.media_moderation m where m.provider <> 'anterior')
on conflict (bucket, path) do nothing;
