-- Security review 2026-11-03, item M1.
--
-- A subscriber-only post could be read in full (its text) by anyone through the API,
-- and the page showed the text under the lock. Now a locked post's row is only
-- readable by its subscribers (the author and admins keep their own policies).
-- Everyone else gets a preview without text or file: enough to draw the locked card.

-- Whether the signed-in person subscribes to this profile.
create or replace function public.subscribed_to(p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and public.has_subscription(auth.uid(), p_creator_profile_id);
$$;
revoke all on function public.subscribed_to(text) from public;
grant execute on function public.subscribed_to(text) to anon, authenticated;

drop policy if exists "creator_posts: anyone reads" on public.creator_posts;
create policy "creator_posts: anyone reads" on public.creator_posts
  for select to anon, authenticated
  using (
    not is_draft
    and (media_path is null or public.media_approved('post-media', media_path))
    and (not is_locked or public.subscribed_to(creator_profile_id))
  );

-- Locked posts of a profile that this viewer can't open: no text, no file.
create or replace function public.locked_post_previews(p_creator_profile_id text)
returns table (id uuid, creator_id uuid, creator_profile_id text, is_locked boolean, created_at timestamptz, media_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.creator_id, p.creator_profile_id, true, p.created_at, p.media_type
  from public.creator_posts p
  where p.creator_profile_id = p_creator_profile_id
    and p.is_locked
    and not p.is_draft
    and (p.media_path is null or public.media_approved('post-media', p.media_path))
    and p.creator_id is distinct from auth.uid()
    and not public.is_admin()
    and not public.subscribed_to(p.creator_profile_id)
  order by p.created_at desc
  limit 500;
$$;
revoke all on function public.locked_post_previews(text) from public;
grant execute on function public.locked_post_previews(text) to anon, authenticated;

-- Activity for "En tendencia": counts every published post, locked or not.
create or replace function public.recent_post_counts(p_since timestamptz)
returns table (creator_profile_id text, posts integer, last_post timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.creator_profile_id, count(*)::integer, max(p.created_at)
  from public.creator_posts p
  where p.created_at >= greatest(p_since, now() - interval '90 days')
    and not p.is_draft
    and (p.media_path is null or public.media_approved('post-media', p.media_path))
  group by p.creator_profile_id;
$$;
revoke all on function public.recent_post_counts(timestamptz) from public;
grant execute on function public.recent_post_counts(timestamptz) to anon, authenticated;

-- Never used by the app.
revoke truncate, references, trigger on public.creator_posts from anon, authenticated;
