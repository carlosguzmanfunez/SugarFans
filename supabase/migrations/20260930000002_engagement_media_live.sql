-- Post engagement (likes, comments, tips), photo/video uploads for creator
-- posts, and live video rooms for confirmed VIP bookings.

-- ---------------------------------------------------------------------
-- Creator posts become public (fans see them on the creator's profile)
-- and can carry one photo or video stored in the "post-media" bucket.
-- ---------------------------------------------------------------------
alter table public.creator_posts
  add column creator_profile_id text,
  add column media_path text,
  add column media_type text check (media_type in ('image', 'video')),
  add constraint creator_posts_media_pair check ((media_path is null) = (media_type is null));

-- A post needs text, a file, or both.
alter table public.creator_posts drop constraint creator_posts_content_check;
alter table public.creator_posts add constraint creator_posts_content_check check (char_length(trim(content)) > 0 or media_path is not null);

update public.creator_posts cp
  set creator_profile_id = p.creator_profile_id
  from public.profiles p
  where p.id = cp.creator_id;

create index creator_posts_profile_idx on public.creator_posts (creator_profile_id, created_at desc);

-- The public profile id and the media folder always come from the author.
create or replace function public.fill_creator_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(creator_profile_id, id::text) into new.creator_profile_id from public.profiles where id = new.creator_id;
  if new.media_path is not null and split_part(new.media_path, '/', 1) <> new.creator_id::text then
    raise exception 'Archivo no válido';
  end if;
  return new;
end;
$$;

create trigger fill_creator_post
  before insert on public.creator_posts
  for each row execute function public.fill_creator_post();

create policy "creator_posts: anyone reads" on public.creator_posts
  for select to anon, authenticated using (true);

-- Posts that are not uuids are the demo catalogue shipped with the app.
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
  if auth.uid() is not null and public.is_cut_off(auth.uid(), p.creator_profile_id) then
    return false;
  end if;
  if not p.is_locked then
    return true;
  end if;
  return exists (select 1 from public.subscriptions s where s.fan_id = auth.uid() and s.creator_id = p.creator_profile_id);
end;
$$;

-- Creator of a post by id (demo catalogue ids resolve through the client).
create or replace function public.post_creator_profile(p_post_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select creator_profile_id from public.creator_posts
  where p_post_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and id = p_post_id::uuid;
$$;

-- Public card of a creator who signed up (demo creators live in the app catalogue).
create or replace function public.public_creator(p_creator_profile_id text)
returns table (id text, name text, avatar text, bio text, is_verified boolean, subscription_price numeric, posts integer, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.creator_profile_id, p.name, p.avatar, p.bio, p.is_verified, p.subscription_price, p.posts, p.created_at
  from public.profiles p
  where p.creator_profile_id = p_creator_profile_id and p.role = 'creator';
$$;

-- ---------------------------------------------------------------------
-- Storage: photos (10 MB) and videos (50 MB). Files live under
-- <author uid>/...; locked posts' files are only readable by the author,
-- admins and subscribers (the app requests short-lived signed URLs).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;

create or replace function public.can_view_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.creator_posts p
    where p.media_path = p_name and public.can_view_post(p.id::text)
  );
$$;

create policy "post-media: author uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('creator', 'admin'))
  );
create policy "post-media: author deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "post-media: viewers read" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'post-media'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.can_view_media(name))
  );

-- ---------------------------------------------------------------------
-- Likes and comments
-- ---------------------------------------------------------------------
create table public.post_likes (
  post_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.post_likes enable row level security;

create policy "post_likes: own rows read" on public.post_likes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "post_likes: like what I can see" on public.post_likes
  for insert to authenticated with check (user_id = (select auth.uid()) and public.can_view_post(post_id));
create policy "post_likes: unlike" on public.post_likes
  for delete to authenticated using (user_id = (select auth.uid()));

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id text not null,
  -- Creator who owns the post (moderates its comments).
  creator_profile_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  user_name text not null default '',
  user_avatar text not null default '',
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index post_comments_post_idx on public.post_comments (post_id, created_at);

-- Name and avatar come from the author's profile, never from the client.
create or replace function public.fill_post_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select name, avatar into new.user_name, new.user_avatar from public.profiles where id = new.user_id;
  -- Real posts know their creator; demo catalogue posts send it from the app.
  new.creator_profile_id := coalesce(public.post_creator_profile(new.post_id), new.creator_profile_id);
  new.body := trim(new.body);
  new.created_at := now();
  return new;
end;
$$;

create trigger fill_post_comment
  before insert on public.post_comments
  for each row execute function public.fill_post_comment();

alter table public.post_comments enable row level security;

create policy "post_comments: read where the post is visible" on public.post_comments
  for select to anon, authenticated using (public.can_view_post(post_id));
create policy "post_comments: comment what I can see" on public.post_comments
  for insert to authenticated with check (user_id = (select auth.uid()) and public.can_view_post(post_id));
-- Authors delete their comments; creators moderate comments on their posts.
create policy "post_comments: author, creator or admin deletes" on public.post_comments
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin())
    or creator_profile_id = (select public.my_creator_profile_id())
  );

-- Like and comment totals plus whether I liked each post.
create or replace function public.post_engagement(p_post_ids text[])
returns table (post_id text, likes integer, comments integer, liked_by_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id,
    (select count(*)::int from public.post_likes l where l.post_id = i.id),
    (select count(*)::int from public.post_comments c where c.post_id = i.id),
    exists (select 1 from public.post_likes l where l.post_id = i.id and l.user_id = auth.uid())
  from unnest(p_post_ids) as i(id);
$$;

-- ---------------------------------------------------------------------
-- Tips: a charge that goes to the creator's balance like any other sale.
-- INTEGRATION: a real gateway would capture the payment before this runs.
-- ---------------------------------------------------------------------
alter table public.transactions drop constraint transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check check (kind in ('subscription', 'renewal', 'tip'));
alter table public.transactions add column note text;

create or replace function public.send_tip(p_creator_profile_id text, p_creator_name text, p_amount numeric, p_method_id uuid, p_post_id text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_method public.payment_methods;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if v_me.creator_profile_id = p_creator_profile_id then
    raise exception 'No puedes enviarte una propina a ti mismo';
  end if;
  select * into v_method from public.payment_methods where id = p_method_id and user_id = v_me.id;
  if v_method.id is null then
    raise exception 'Elige un método de pago';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 500 then
    raise exception 'La propina debe estar entre $1 y $500';
  end if;
  if public.is_cut_off(v_me.id, p_creator_profile_id) then
    raise exception 'No puedes enviar propinas a este perfil';
  end if;
  insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, note)
  values ('tip:' || v_me.id || ':' || gen_random_uuid(), v_me.id, v_me.name, p_creator_profile_id, p_creator_name, 'tip',
          round(p_amount, 2), v_method.label, 'paid',
          nullif(left(trim(coalesce(p_message, '')), 200), '') );
end;
$$;

-- ---------------------------------------------------------------------
-- Live rooms: a private Realtime channel "live:<booking id>" relays the
-- WebRTC handshake. Only the fan and the creator of a confirmed booking
-- can join it.
-- ---------------------------------------------------------------------
create or replace function public.can_join_live(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vip_bookings b
    where 'live:' || b.id::text = p_topic
      and b.status = 'confirmed'
      and (b.fan_id = auth.uid() or b.creator_profile_id = public.my_creator_profile_id())
  );
$$;

create policy "live rooms: participants receive" on realtime.messages
  for select to authenticated
  using (realtime.topic() like 'live:%' and public.can_join_live(realtime.topic()));
create policy "live rooms: participants send" on realtime.messages
  for insert to authenticated
  with check (realtime.topic() like 'live:%' and public.can_join_live(realtime.topic()));

-- ---------------------------------------------------------------------
-- Function permissions
-- ---------------------------------------------------------------------
revoke execute on function public.fill_creator_post() from public, anon, authenticated;
revoke execute on function public.fill_post_comment() from public, anon, authenticated;
revoke execute on function public.send_tip(text, text, numeric, uuid, text, text) from public, anon;
revoke execute on function public.can_join_live(text) from public, anon;
grant execute on function public.send_tip(text, text, numeric, uuid, text, text) to authenticated;
grant execute on function public.can_join_live(text) to authenticated;
grant execute on function public.can_view_post(text) to anon, authenticated;
grant execute on function public.can_view_media(text) to anon, authenticated;
grant execute on function public.post_creator_profile(text) to anon, authenticated;
grant execute on function public.public_creator(text) to anon, authenticated;
grant execute on function public.post_engagement(text[]) to anon, authenticated;
