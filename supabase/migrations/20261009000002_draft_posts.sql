-- Creators who haven't verified their identity yet can upload content: it is saved
-- as a draft only they (and admins) see, and goes public by itself the moment the
-- account gets "Verificado" (Didit or an admin's review). Until then nobody can pay
-- them: subscriptions, tips, gifts and reservations are refused.
--
-- Additive: no data is deleted; posts that are already public stay public.

alter table public.creator_posts add column if not exists is_draft boolean not null default false;

-- The server decides, never the browser: a post is a draft while its author is an
-- unverified creator. Only verification turns a draft public.
create or replace function public.creator_post_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live boolean;
begin
  select p.is_verified or p.role = 'admin' into v_live from public.profiles p where p.id = new.creator_id;
  if tg_op = 'INSERT' then
    new.is_draft := not coalesce(v_live, false);
  else
    new.is_draft := old.is_draft and not coalesce(v_live, false);
  end if;
  return new;
end;
$$;
revoke execute on function public.creator_post_draft() from public, anon, authenticated;

drop trigger if exists creator_post_draft on public.creator_posts;
create trigger creator_post_draft
  before insert or update on public.creator_posts
  for each row execute function public.creator_post_draft();

-- Drafts: only the author and admins read them.
drop policy if exists "creator_posts: anyone reads" on public.creator_posts;
drop policy if exists "creator_posts: author and admins read drafts" on public.creator_posts;
create policy "creator_posts: anyone reads" on public.creator_posts
  for select to anon, authenticated
  using (not is_draft);
create policy "creator_posts: author and admins read drafts" on public.creator_posts
  for select to authenticated
  using (creator_id = (select auth.uid()) or (select public.is_admin()));

-- Same rule for likes, comments and the post's photo or video.
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
  if auth.uid() is not null and public.is_cut_off(auth.uid(), p.creator_profile_id) then
    return false;
  end if;
  if not p.is_locked then
    return true;
  end if;
  return public.has_subscription(auth.uid(), p.creator_profile_id);
end;
$$;

-- The public post count leaves drafts out.
create or replace function public.sync_post_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid := coalesce(new.creator_id, old.creator_id);
begin
  update public.profiles
    set posts = (select count(*) from public.creator_posts where creator_id = v_creator and not is_draft)
    where id = v_creator;
  return null;
end;
$$;
revoke execute on function public.sync_post_count() from public, anon, authenticated;

drop trigger if exists sync_post_count on public.creator_posts;
create trigger sync_post_count
  after insert or delete or update of is_draft on public.creator_posts
  for each row execute function public.sync_post_count();

-- Verified: the drafts go public, dated now so they show up as new.
create or replace function public.publish_drafts_on_verify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.creator_posts set is_draft = false, created_at = now()
    where creator_id = new.id and is_draft;
  return null;
end;
$$;
revoke execute on function public.publish_drafts_on_verify() from public, anon, authenticated;

drop trigger if exists publish_drafts_on_verify on public.profiles;
create trigger publish_drafts_on_verify
  after update of is_verified on public.profiles
  for each row when (new.is_verified and not old.is_verified)
  execute function public.publish_drafts_on_verify();

-- No money to a creator who hasn't verified yet (platform-run profiles keep working).
create or replace function public.creator_accepts_payments(p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                  where p.creator_profile_id = p_creator_profile_id and p.role = 'creator' and p.is_verified)
      or exists (select 1 from public.managed_profiles m
                  where m.id = p_creator_profile_id and not m.hidden);
$$;
revoke execute on function public.creator_accepts_payments(text) from public;
grant execute on function public.creator_accepts_payments(text) to anon, authenticated;

create or replace function public.assert_creator_accepts_payments(p_creator_profile_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_creator_profile_id is not null and not public.creator_accepts_payments(p_creator_profile_id) then
    if exists (select 1 from public.profiles p where p.creator_profile_id = p_creator_profile_id and p.role = 'creator') then
      raise exception 'Este creador todavía está verificando su identidad: aún no acepta pagos ni reservas.';
    end if;
    raise exception 'Este perfil es de demostración: todavía no acepta pagos ni reservas.';
  end if;
end;
$$;
revoke execute on function public.assert_creator_accepts_payments(text) from public, anon, authenticated;
