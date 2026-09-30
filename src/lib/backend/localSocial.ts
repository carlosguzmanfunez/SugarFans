// Browser-only implementation of likes, comments, uploads and live rooms (dev
// and offline tests). Files go to IndexedDB (too big for localStorage); live
// rooms signal over a BroadcastChannel, so both people must use the same browser.
import { readJSON, writeJSONChecked, newId } from '../storage';
import { extensionOf, validateMedia } from '../media';
import type { AuthResult, User, VipBooking } from './types';
import type { FeedPost, LiveMessage, PostComment, SocialBackend } from './socialTypes';

interface Store {
  likes: Record<string, string[]>; // post id -> user ids
  comments: PostComment[];
}

interface Deps {
  listAccounts(): User[];
  listBookings(): VipBooking[];
  notify(): void;
}

const KEY = 'social';
const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });

// --- IndexedDB file store -------------------------------------------------
const DB_NAME = 'sugarfans_media';
const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction('files', mode).objectStore('files'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
const urls = new Map<string, string>();
export const fileUrl = async (path: string) => {
  if (urls.has(path)) return urls.get(path);
  const blob = await tx<Blob | undefined>('readonly', (s) => s.get(path) as IDBRequest<Blob | undefined>).catch(() => undefined);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urls.set(path, url);
  return url;
};

export const createLocalSocial = (deps: Deps): SocialBackend => {
  const load = (): Store => ({ likes: {}, comments: [], ...readJSON<Partial<Store>>(KEY, {}) });
  const commit = (fn: (s: Store) => Store): AuthResult => {
    if (!writeJSONChecked(KEY, fn(load()))) return fail('No se pudo guardar: el almacenamiento del navegador está lleno');
    deps.notify();
    return ok;
  };

  return {
    async postsByCreator(creatorProfileId) {
      // A post belongs to its author's profile, or to the managed profile an admin posted as.
      const posts: FeedPost[] = await Promise.all(
        deps.listAccounts().flatMap((a) =>
          a.createdPosts
            .filter((p) => (p.creatorProfileId ?? a.creatorProfileId) === creatorProfileId)
            .map(async (p) => ({
            id: p.id,
            creatorProfileId,
            authorId: a.id,
            content: p.content,
            isLocked: p.isLocked,
            createdAt: p.createdAt,
            mediaType: p.mediaType,
            mediaPath: p.mediaPath,
            mediaUrl: p.mediaPath ? await fileUrl(p.mediaPath) : undefined,
          }))
        )
      );
      return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async engagement(postIds, viewer) {
      const s = load();
      return Object.fromEntries(
        postIds.map((id) => [
          id,
          {
            likes: s.likes[id]?.length ?? 0,
            comments: s.comments.filter((c) => c.postId === id).length,
            likedByMe: !!viewer && !!s.likes[id]?.includes(viewer.id),
          },
        ])
      );
    },

    async setLike(user, postId, liked) {
      return commit((s) => {
        const others = (s.likes[postId] ?? []).filter((id) => id !== user.id);
        return { ...s, likes: { ...s.likes, [postId]: liked ? [...others, user.id] : others } };
      });
    },

    async comments(postId) {
      return load().comments.filter((c) => c.postId === postId);
    },

    async addComment(user, postId, creatorProfileId, body) {
      const text = body.trim();
      if (!text) return fail('Escribe un comentario');
      if (text.length > 500) return fail('El comentario no puede superar 500 caracteres');
      return commit((s) => ({
        ...s,
        comments: [
          ...s.comments,
          {
            id: newId(),
            postId,
            creatorProfileId,
            userId: user.id,
            userName: user.name,
            userAvatar: user.avatar,
            body: text,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    },

    async deleteComment(user, commentId) {
      const c = load().comments.find((x) => x.id === commentId);
      if (!c) return fail('Comentario no encontrado');
      const allowed = c.userId === user.id || user.role === 'admin' || (!!user.creatorProfileId && c.creatorProfileId === user.creatorProfileId);
      if (!allowed) return fail('Esta acción no está permitida');
      return commit((s) => ({ ...s, comments: s.comments.filter((x) => x.id !== commentId) }));
    },

    async uploadMedia(user, file) {
      const check = validateMedia(file);
      if (!check.type) return fail(check.error!);
      if (user.role !== 'creator' && user.role !== 'admin') return fail('Solo los creadores pueden subir contenido');
      const path = `${user.id}/${newId()}.${extensionOf(file)}`;
      try {
        await tx('readwrite', (s) => s.put(file, path));
      } catch {
        return fail('No se pudo guardar el archivo en este navegador');
      }
      return { ok: true, media: { path, type: check.type } };
    },

    async removeMedia(_user, path) {
      await tx('readwrite', (s) => s.delete(path)).catch(() => undefined);
      const url = urls.get(path);
      if (url) URL.revokeObjectURL(url);
      urls.delete(path);
    },

    async publicCreator(creatorProfileId) {
      const a = deps.listAccounts().find((x) => x.role === 'creator' && x.creatorProfileId === creatorProfileId);
      if (!a) return null;
      return {
        id: creatorProfileId,
        name: a.name,
        avatar: a.avatar,
        bio: a.bio ?? '',
        isVerified: !!a.isVerified,
        subscriptionPrice: a.subscriptionPrice ?? 9.99,
        posts: a.createdPosts.length,
        createdAt: a.createdAt,
      };
    },

    async joinLive(user, bookingId, onMessage) {
      const b = deps.listBookings().find((x) => x.id === bookingId);
      const isParticipant = !!b && (b.fanId === user.id || (!!user.creatorProfileId && b.creatorProfileId === user.creatorProfileId));
      if (!b || !isParticipant) return fail('No tienes acceso a esta sesión');
      if (b.status !== 'confirmed') return fail('La sesión se abre cuando la reserva está pagada y confirmada');
      const bc = new BroadcastChannel(`sugarfans_live_${bookingId}`);
      bc.onmessage = (e: MessageEvent<LiveMessage>) => {
        if (e.data?.from !== user.id) onMessage(e.data);
      };
      return {
        ok: true,
        channel: {
          send: (signal) => bc.postMessage({ ...signal, from: user.id }),
          close: () => bc.close(),
        },
      };
    },
  };
};
