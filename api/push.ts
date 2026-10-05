// Vercel function: phone alerts (Web Push) for the notifications in the bell.
// - GET /api/push → { publicKey }: what a browser needs to subscribe.
// - POST /api/push { id }: the database calls this (trigger push_notification,
//   via pg_net) for each new notification; it is read here with the service role
//   and delivered to every device of its owner. Each notification goes out once
//   and only while fresh, so calling it again or with a made-up id does nothing.
// - POST /api/push { test: true } with the person's session: a test alert to
//   their own devices ("Probar aviso").
// Tables and triggers: supabase/migrations/20261005000001_reserve_alerts.sql.
//
// Needs SUPABASE_SERVICE_ROLE_KEY (already set for PayPal). The push keys (VAPID)
// are created on first use and kept in public.app_secrets; VAPID_PUBLIC_KEY and
// VAPID_PRIVATE_KEY in the Vercel settings override them if ever set.
import webpush from 'web-push';

// Public values (same as .env.production); the anon key is meant to be public.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';
const SUBJECT = 'https://fansreserve.com';
// A notification older than this is never pushed (a late retry would only confuse).
const FRESH_MINUTES = 10;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// A value pasted with spaces, a newline or quotes around it breaks the request.
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;

// New secret keys (sb_secret_…) go in apikey only; the legacy service_role key is a JWT.
const serverHeaders = (): Record<string, string> | null => {
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) return null;
  return key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key };
};

const rest = async (method: string, path: string, body?: unknown, prefer?: string) => {
  const headers = serverHeaders();
  if (!headers) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...headers, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

// --- Push keys --------------------------------------------------------------------

let keys: { publicKey: string; privateKey: string } | null = null;
const pushKeys = async () => {
  if (keys) return keys;
  const envPublic = clean(process.env.VAPID_PUBLIC_KEY);
  const envPrivate = clean(process.env.VAPID_PRIVATE_KEY);
  if (envPublic && envPrivate) return (keys = { publicKey: envPublic, privateKey: envPrivate });
  const read = async () => {
    const rows = (await rest('GET', 'app_secrets?select=name,value&name=in.(vapid_public,vapid_private)')) as { name: string; value: string }[];
    const get = (n: string) => rows.find((r) => r.name === n)?.value;
    return get('vapid_public') && get('vapid_private') ? { publicKey: get('vapid_public')!, privateKey: get('vapid_private')! } : null;
  };
  let found = await read();
  if (!found) {
    // First use: create the pair. If two requests race, the first one written wins.
    const fresh = webpush.generateVAPIDKeys();
    await rest(
      'POST',
      'app_secrets?on_conflict=name',
      [
        { name: 'vapid_public', value: fresh.publicKey },
        { name: 'vapid_private', value: fresh.privateKey },
      ],
      'resolution=ignore-duplicates'
    );
    found = await read();
  }
  if (!found) throw new Error('No se pudieron crear las claves de avisos');
  return (keys = found);
};

// --- Delivery -----------------------------------------------------------------------

interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const sendTo = async (userId: string, payload: { title: string; body: string; link: string; tag?: string }) => {
  const k = await pushKeys();
  const subs = (await rest('GET', `push_subscriptions?select=endpoint,p256dh,auth&user_id=eq.${encodeURIComponent(userId)}`)) as Subscription[];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          TTL: 24 * 3600,
          urgency: 'high',
          vapidDetails: { subject: SUBJECT, publicKey: k.publicKey, privateKey: k.privateKey },
        });
        sent++;
      } catch (err) {
        // The device unsubscribed or the browser dropped it: forget it.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await rest('DELETE', `push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`).catch(() => null);
      }
    })
  );
  return { devices: subs.length, sent };
};

const deliver = async (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'id no válido' });
  const since = new Date(Date.now() - FRESH_MINUTES * 60_000).toISOString();
  // Claim it: only the first call for a fresh, unsent notification gets the row back.
  const rows = (await rest(
    'PATCH',
    `notifications?id=eq.${id}&pushed_at=is.null&created_at=gte.${encodeURIComponent(since)}&select=id,user_id,title,body,link`,
    { pushed_at: new Date().toISOString() },
    'return=representation'
  )) as { id: string; user_id: string; title: string; body: string; link: string }[];
  const n = rows?.[0];
  if (!n) return json(200, { sent: 0 });
  return json(200, await sendTo(n.user_id, { title: n.title, body: n.body, link: n.link || '/', tag: n.id }));
};

// The signed-in person behind a session token, asked to Supabase Auth.
const userFromToken = async (token: string) => {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = (await r.json()) as { id?: string };
  return u.id ?? null;
};

export async function GET(): Promise<Response> {
  try {
    return json(200, { publicKey: (await pushKeys()).publicKey });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : 'Error' });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: unknown; test?: unknown };
    if (body.test) {
      const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      const userId = token ? await userFromToken(token) : null;
      if (!userId) return json(401, { error: 'Inicia sesión para probar los avisos.' });
      const r = await sendTo(userId, { title: 'Avisos activados', body: 'Así te avisaremos en este dispositivo.', link: '/', tag: 'test' });
      return json(200, r);
    }
    if (typeof body.id !== 'string') return json(400, { error: 'Falta id' });
    return await deliver(body.id);
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : 'Error' });
  }
}
