// Supabase implementation of likes, comments, uploads and live rooms. Tables,
// the "post-media" bucket and the Realtime policies live in
// supabase/migrations/20260930000002_engagement_media_live.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import { newId } from '../storage';
import { extensionOf, validateMedia } from '../media';
import type { AuthResult } from './types';
import type { FeedPost, PostComment, PublicCreator, SocialBackend } from './socialTypes';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const BUCKET = 'post-media';
const URL_TTL = 60 * 60; // signed URLs last an hour

const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });

const toComment = (r: Row): PostComment => ({
  id: r.id,
  postId: r.post_id,
  creatorProfileId: r.creator_profile_id,
  userId: r.user_id,
  userName: r.user_name,
  userAvatar: r.user_avatar,
  body: r.body,
  createdAt: r.created_at,
});

const toPublicCreator = (r: Row): PublicCreator => ({
  id: r.id,
  name: r.name,
  avatar: r.avatar,
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
      .select('id, creator_id, creator_profile_id, content, is_locked, created_at, media_path, media_type')
      .eq('creator_profile_id', creatorProfileId)
      .order('created_at', { ascending: false });
    const rows = data ?? [];
    const paths = rows.map((r) => r.media_path).filter(Boolean) as string[];
    // Storage only signs files this viewer may see (locked posts need a subscription).
    const signed = new Map<string, string>();
    if (paths.length) {
      const { data: urls } = await sb.storage.from(BUCKET).createSignedUrls(paths, URL_TTL);
      for (const u of urls ?? []) if (u.path && u.signedUrl && !u.error) signed.set(u.path, u.signedUrl);
    }
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
        mediaUrl: r.media_path ? signed.get(r.media_path) : undefined,
      })
    );
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

  async uploadMedia(user, file) {
    const check = validateMedia(file);
    if (!check.type) return fail(check.error!);
    const path = `${user.id}/${newId()}.${extensionOf(file)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      const tooBig = /size|large|payload/i.test(error.message);
      return fail(tooBig ? 'El archivo es demasiado grande' : 'No se pudo subir el archivo. Inténtalo de nuevo.');
    }
    return { ok: true, media: { path, type: check.type } };
  },

  async removeMedia(_user, path) {
    await sb.storage.from(BUCKET).remove([path]);
  },

  async publicCreator(creatorProfileId) {
    const [{ data }, category] = await Promise.all([
      sb.rpc('public_creator', { p_creator_profile_id: creatorProfileId }),
      sb.rpc('creator_category', { p_creator_profile_id: creatorProfileId }),
    ]);
    const r = (data as Row[] | null)?.[0];
    return r ? { ...toPublicCreator(r), category: typeof category.data === 'string' ? category.data : '' } : null;
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
    const { data } = await sb.rpc('public_creators');
    return ((data as Row[] | null) ?? []).map(toPublicCreator);
  },
});
