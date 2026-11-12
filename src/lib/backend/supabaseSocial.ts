// Supabase implementation of likes, comments, uploads and live rooms. Tables,
// the "post-media" bucket and the Realtime policies live in
// supabase/migrations/20260930000002_engagement_media_live.sql.
import { cleanSocials } from '../creatorLinks';
import { avatarOrEmpty } from './shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { newId } from '../storage';
import { signPostMedia } from './signedMedia';
import { bunnyVideoLinks, forgetBunnyVideo } from './bunnyVideo';
import { extensionOf, validateMedia } from '../media';
import { shrinkPostImage } from '../postImage';
import type { AuthResult } from './types';
import { REJECTED_MESSAGE, moderateUpload, moderationOf } from './supabaseModeration';
import type { FeedPost, PostComment, PublicCreator, SocialBackend } from './socialTypes';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const BUCKET = 'post-media';

const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });

const toComment = (r: Row): PostComment => ({
  id: r.id,
  postId: r.post_id,
  creatorProfileId: r.creator_profile_id,
  userId: r.user_id,
  userName: r.user_name,
  userAvatar: avatarOrEmpty(r.user_avatar),
  body: r.body,
  createdAt: r.created_at,
});

const toPublicCreator = (r: Row): PublicCreator => ({
  id: r.id,
  name: r.name,
  avatar: avatarOrEmpty(r.avatar),
  bio: r.bio ?? '',
  isVerified: r.is_verified,
  subscriptionPrice: Number(r.subscription_price ?? 9.99),
  posts: r.posts,
  createdAt: r.created_at,
});

export const createSupabaseSocial = (sb: SupabaseClient): SocialBackend => ({
  async postsByCreator(creatorProfileId) {
    const { data } = await sb
      .from('creator_posts')
      .select('id, creator_id, creator_profile_id, content, is_locked, created_at, media_path, media_type, is_draft')
      .eq('creator_profile_id', creatorProfileId)
      .order('created_at', { ascending: false });
    // Locked posts this viewer can't open come without text or file: shown as locked cards.
    const { data: previews } = await sb.rpc('locked_post_previews', { p_creator_profile_id: creatorProfileId });
    const seen = new Set((data ?? []).map((r) => r.id));
    const rows: Row[] = [
      ...((data ?? []) as Row[]),
      ...((previews ?? []) as Row[])
        .filter((r) => !seen.has(r.id))
        .map((r): Row => ({ ...r, content: '', media_path: null, is_draft: false })),
    ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const paths = rows.map((r) => r.media_path).filter(Boolean) as string[];
    // Storage only signs files this viewer may see (locked posts need a subscription),
    // with links that expire in minutes (signedMedia.ts).
    const signed = await signPostMedia(sb, BUCKET, rows.filter((r) => r.media_path).map((r) => ({ path: r.media_path as string, video: r.media_type === 'video' })));
    // Videos with a copy in Bunny Stream play from there (cheaper, adaptive quality);
    // the rest keep their Supabase link. Only files Storage just signed are asked for.
    const bunny = await bunnyVideoLinks(sb, rows.filter((r) => r.media_type === 'video' && r.media_path && signed.has(r.media_path)).map((r) => r.media_path as string));
    // Only the author and admins get rows here: their files still waiting for moderation.
    const moderation = await moderationOf(sb, BUCKET, paths);
    return rows.map(
      (r): FeedPost => ({
        id: r.id,
        creatorProfileId: r.creator_profile_id,
        authorId: r.creator_id,
        content: r.content,
        isLocked: r.is_locked,
        createdAt: r.created_at,
        mediaType: r.media_type ?? undefined,
        mediaPath: r.media_path ?? undefined,
        mediaUrl: r.media_path ? bunny.get(r.media_path) ?? signed.get(r.media_path) : undefined,
        isDraft: !!r.is_draft,
        ...(r.media_path && moderation.get(r.media_path) && moderation.get(r.media_path) !== 'approved'
          ? { moderation: moderation.get(r.media_path) }
          : {}),
      })
    );
  },

  async recentPosts(sinceIso) {
    // Published posts only (no drafts or media waiting for moderation), locked ones included.
    const { data } = await sb.rpc('recent_post_counts', { p_since: sinceIso });
    const out: Record<string, { count: number; last: string }> = {};
    for (const r of (data ?? []) as Row[]) out[r.creator_profile_id] = { count: r.posts, last: r.last_post };
    return out;
  },

  async engagement(postIds) {
    if (!postIds.length) return {};
    const { data } = await sb.rpc('post_engagement', { p_post_ids: postIds });
    return Object.fromEntries(
      ((data ?? []) as Row[]).map((r) => [r.post_id, { likes: r.likes, comments: r.comments, likedByMe: r.liked_by_me }])
    );
  },

  async setLike(user, postId, liked) {
    const { error } = liked
      ? await sb.from('post_likes').upsert({ post_id: postId, user_id: user.id }, { ignoreDuplicates: true })
      : await sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', user.id);
    return error ? fail('No se pudo guardar tu me gusta') : ok;
  },

  async comments(postId) {
    const { data } = await sb.from('post_comments').select('*').eq('post_id', postId).order('created_at', { ascending: true });
    return (data ?? []).map(toComment);
  },

  async addComment(user, postId, creatorProfileId, body) {
    const text = body.trim();
    if (!text) return fail('Escribe un comentario');
    if (text.length > 500) return fail('El comentario no puede superar 500 caracteres');
    const { error } = await sb
      .from('post_comments')
      .insert({ post_id: postId, creator_profile_id: creatorProfileId, user_id: user.id, body: text });
    return error ? fail('No se pudo publicar el comentario') : ok;
  },

  async deleteComment(_user, commentId) {
    const { data, error } = await sb.from('post_comments').delete().eq('id', commentId).select('id');
    if (error || !data?.length) return fail('No se pudo eliminar el comentario');
    return ok;
  },

  async uploadMedia(user, original, kind = 'post') {
    const check = validateMedia(original);
    if (!check.type) return fail(check.error!);
    // Photos go up already shrunk (see postImage.ts); videos as they are.
    const file = check.type === 'image' ? await shrinkPostImage(original) : original;
    const path = `${user.id}/${newId()}.${extensionOf(file)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      const tooBig = /size|large|payload/i.test(error.message);
      return fail(tooBig ? 'El archivo es demasiado grande' : 'No se pudo subir el archivo. Inténtalo de nuevo.');
    }
    // Scanned before anyone else can see it. A rejected file is kept (hidden) as evidence.
    const moderation = await moderateUpload(sb, BUCKET, path, kind, check.type);
    if (moderation === 'rejected') return fail(REJECTED_MESSAGE);
    return { ok: true, media: { path, type: check.type, moderation } };
  },

  async removeMedia(_user, path) {
    await sb.storage.from(BUCKET).remove([path]);
    if (/\.(mp4|webm|mov)$/i.test(path)) await forgetBunnyVideo(sb, path);
  },

  async publicCreator(creatorProfileId) {
    const [{ data }, category, cover] = await Promise.all([
      sb.rpc('public_creator', { p_creator_profile_id: creatorProfileId }),
      sb.rpc('creator_category', { p_creator_profile_id: creatorProfileId }),
      // Empty until migration 20261009000003_profile_images is applied.
      sb.rpc('creator_cover', { p_creator_profile_id: creatorProfileId }),
    ]);
    const r = (data as Row[] | null)?.[0];
    return r
      ? {
          ...toPublicCreator(r),
          category: typeof category.data === 'string' ? category.data : '',
          cover: typeof cover.data === 'string' ? cover.data : '',
        }
      : null;
  },

  async logSubscriberAccess(creatorProfileId, postId) {
    // The server only records it for an active, unpaused subscription.
    await sb.rpc('subscription_log_access', { p_creator_profile_id: creatorProfileId, ...(postId ? { p_post_id: postId } : {}) }).then(() => undefined, () => undefined);
  },

  async followState(creatorProfileId, viewer) {
    const [count, mine] = await Promise.all([
      sb.rpc('follower_count', { p_creator_profile_id: creatorProfileId }),
      viewer
        ? sb.from('follows').select('creator_profile_id').eq('user_id', viewer.id).eq('creator_profile_id', creatorProfileId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    return { following: !!mine.data, count: Number(count.data ?? 0) };
  },

  async setFollow(user, creatorProfileId, follow) {
    if (user.creatorProfileId === creatorProfileId) return fail('No puedes seguir tu propio perfil');
    const { error } = follow
      ? await sb.from('follows').upsert({ user_id: user.id, creator_profile_id: creatorProfileId }, { onConflict: 'user_id,creator_profile_id', ignoreDuplicates: true })
      : await sb.from('follows').delete().eq('user_id', user.id).eq('creator_profile_id', creatorProfileId);
    return error ? fail('No se pudo actualizar. Inténtalo de nuevo.') : ok;
  },

  async publicCreators() {
    // Usernames stay empty until migration 20261010000004_creator_username_socials is applied.
    // Covers stay empty (generated art) until migration 20261107074500_creator_covers is applied.
    const [{ data }, names, covers] = await Promise.all([sb.rpc('public_creators'), sb.rpc('creator_usernames'), sb.rpc('creator_covers')]);
    const handles = new Map(((names.data as Row[] | null) ?? []).map((r) => [r.id as string, r.username as string]));
    const coverOf = new Map(((covers.data as Row[] | null) ?? []).map((r) => [r.id as string, r.cover as string]));
    return ((data as Row[] | null) ?? []).map((r) => ({ ...toPublicCreator(r), username: handles.get(r.id), cover: coverOf.get(r.id) || '' }));
  },

  async creatorLinks(creatorProfileId) {
    const { data } = await sb.rpc('creator_links', { p_creator_profile_id: creatorProfileId });
    const r = (data ?? {}) as Row;
    return { username: typeof r.username === 'string' ? r.username : undefined, socials: cleanSocials(r.socials) };
  },

  async creatorCountries() {
    // Empty until migration 20261006000003_country_phone is applied.
    const { data } = await sb.rpc('creator_countries');
    return Object.fromEntries(((data as Row[] | null) ?? []).map((r) => [r.id as string, r.country as string]));
  },
});
