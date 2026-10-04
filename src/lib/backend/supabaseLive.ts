// Supabase implementation of free Live alerts. Tables and RPCs live in
// supabase/migrations/20261003000001_live_alerts.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthResult } from './types';
import { LIVE_MAX_HOURS, type AppNotification, type LiveBackend } from './liveTypes';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });
// RPC errors raised on purpose are already in Spanish; anything else gets a generic message.
const rpcError = (message: string | undefined) =>
  message && /Live|creators|título/.test(message) ? message : 'No se pudo actualizar. Inténtalo de nuevo.';

const toNotification = (r: Row): AppNotification => ({
  id: r.id,
  kind: r.kind,
  creatorProfileId: r.creator_profile_id ?? undefined,
  title: r.title,
  body: r.body,
  link: r.link,
  createdAt: r.created_at,
  read: !!r.read_at,
});

// Vercel function in api/live-token.ts (it holds the LiveKit secret).
const liveToken = async (sb: SupabaseClient, payload: Record<string, string>, failMsg: string) => {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return fail('Inicia sesión para entrar.');
  try {
    const r = await fetch('/api/live-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = (await r.json().catch(() => ({}))) as Row;
    // The status code helps tell a missing function (404) from a server error (500).
    if (!r.ok || !body.token) return fail(typeof body.error === 'string' ? body.error : `${failMsg} (código ${r.status}).`);
    return { ok: true, access: { url: body.url as string, token: body.token as string, host: !!body.host } };
  } catch (err) {
    return fail(`No se pudo conectar al video. Revisa tu conexión. (${err instanceof Error ? err.message : 'sin detalle'})`);
  }
};

export const createSupabaseLive = (sb: SupabaseClient, url: string, anonKey: string): LiveBackend => {
  // A closing tab can't wait for getSession(), so keep the latest session token at hand.
  let accessToken: string | null = null;
  sb.auth.getSession().then(({ data }) => (accessToken = data.session?.access_token ?? null));
  sb.auth.onAuthStateChange((_event, session) => (accessToken = session?.access_token ?? null));

  return {
    async currentLive(creatorProfileId) {
      const since = new Date(Date.now() - LIVE_MAX_HOURS * 3600_000).toISOString();
      const { data } = await sb
        .from('live_broadcasts')
        .select('id, creator_profile_id, title, started_at')
        .eq('creator_profile_id', creatorProfileId)
        .is('ended_at', null)
        .gt('started_at', since)
        .maybeSingle();
      return data ? { id: data.id, creatorProfileId: data.creator_profile_id, title: data.title, startedAt: data.started_at } : null;
    },

    async startLive(_user, title) {
      const { data, error } = await sb.rpc('start_live', { p_title: title });
      if (error) return fail(rpcError(error.message));
      return { ok: true, notified: Number((data as Row | null)?.notified ?? 0) };
    },

    async endLive() {
      const { error } = await sb.rpc('end_live');
      return error ? fail(rpcError(error.message)) : ok;
    },

    async liveHeartbeat() {
      const { data, error } = await sb.rpc('live_heartbeat');
      return error ? null : data === true;
    },

    endLiveOnExit() {
      if (!accessToken) return;
      // keepalive lets the request finish after the tab is gone.
      fetch(`${url}/rest/v1/rpc/end_live`, {
        method: 'POST',
        keepalive: true,
        headers: { apikey: anonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: '{}',
      }).catch(() => undefined);
    },

    async liveAlerts(creatorProfileId, user) {
      const { data } = await sb
        .from('follows')
        .select('live_alerts')
        .eq('user_id', user.id)
        .eq('creator_profile_id', creatorProfileId)
        .maybeSingle();
      return data ? !!data.live_alerts : true;
    },

    async setLiveAlerts(user, creatorProfileId, on) {
      const { error } = await sb
        .from('follows')
        .update({ live_alerts: on })
        .eq('user_id', user.id)
        .eq('creator_profile_id', creatorProfileId);
      return error ? fail('No se pudo actualizar. Inténtalo de nuevo.') : ok;
    },

    async notifications(user) {
      const { data } = await sb
        .from('notifications')
        .select('id, kind, creator_profile_id, title, body, link, created_at, read_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      return (data ?? []).map(toNotification);
    },

    async markNotificationsRead() {
      await sb.rpc('mark_notifications_read');
    },

    broadcastAccess(creatorProfileId) {
      return liveToken(sb, { creatorProfileId }, 'No se pudo obtener el acceso al Live');
    },

    callAccess(bookingId) {
      return liveToken(sb, { bookingId }, 'No se pudo obtener el acceso a la sala');
    },

    watchNotifications(userId, cb) {
      const channel = sb
        .channel(`notifications:${userId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => cb())
        .subscribe();
      return () => {
        sb.removeChannel(channel);
      };
    },
  };
};
