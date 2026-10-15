// Vercel function: automatic moderation of photos and videos people upload.
// The browser uploads the file, queues it with submit_media() (status "pending")
// and calls POST /api/moderate {bucket, path}. Here the file is sent to
// Sightengine's nudity model and the decision is recorded
// (migration 20261013000001_media_moderation.sql):
//   approved → visible (a profile photo is put on the profile right away)
//   review   → waits for an admin in the dashboard's "Moderación" tab
//   rejected → never shown
// Without the Sightengine keys, or if the service fails, the file stays
// "pending": nothing is published until an admin looks at it.
//
// Needs in the Vercel project settings: SIGHTENGINE_API_USER,
// SIGHTENGINE_API_SECRET and SUPABASE_SERVICE_ROLE_KEY.
import { judgeFrames, judgeNudity, type MediaJudgement } from '../src/lib/mediaModerationRules.js';

// Public values (same as .env.production); the anon key is meant to be public.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';
const SIGHTENGINE_API = process.env.SIGHTENGINE_API_BASE || 'https://api.sightengine.com/1.0';
const MODEL = 'nudity-2.1';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// A value pasted with spaces, a newline or quotes around it breaks the request.
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
const env = () => ({
  apiUser: clean(process.env.SIGHTENGINE_API_USER),
  apiSecret: clean(process.env.SIGHTENGINE_API_SECRET),
  serviceKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
});

const asUser = (token: string) => ({ apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` });
// New secret keys (sb_secret_…) go in apikey only; the legacy service_role key is a JWT.
const asServer = (key: string): Record<string, string> => (key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key });

const call = async (url: string, init: RequestInit = {}) => {
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { message: err instanceof Error ? err.message : 'Sin conexión' } };
  }
};

interface Row {
  bucket: 'post-media' | 'profile-images';
  path: string;
  owner_id: string;
  kind: 'post' | 'perk_video' | 'avatar' | 'cover';
  media_type: 'image' | 'video';
  status: 'pending' | 'review' | 'approved' | 'rejected';
  reason: string;
  public_url: string;
}

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');

// A short-lived link Sightengine can download (post media is private).
const mediaUrl = async (row: Row, serviceKey: string): Promise<string | null> => {
  if (row.bucket === 'profile-images') return row.public_url || null;
  const r = await call(`${SUPABASE_URL}/storage/v1/object/sign/${row.bucket}/${enc(row.path)}`, {
    method: 'POST',
    headers: { ...asServer(serviceKey), 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  const signed = r.data?.signedURL ?? r.data?.signedUrl;
  return r.ok && typeof signed === 'string' ? `${SUPABASE_URL}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}` : null;
};

type Scan = { judgement: MediaJudgement; scores: unknown } | { failed: string; tooLong?: boolean };

const scan = async (row: Row, url: string, e: { apiUser: string; apiSecret: string }): Promise<Scan> => {
  const auth = { api_user: e.apiUser, api_secret: e.apiSecret };
  const r =
    row.media_type === 'image'
      ? await call(`${SIGHTENGINE_API}/check.json?${new URLSearchParams({ url, models: MODEL, ...auth })}`)
      : await call(`${SIGHTENGINE_API}/video/check-sync.json`, {
          method: 'POST',
          body: new URLSearchParams({ stream_url: url, models: MODEL, ...auth }),
        });
  if (!r.ok || r.data?.status !== 'success') {
    const message = String(r.data?.error?.message ?? r.data?.message ?? `Error ${r.status}`);
    return { failed: message, tooLong: /duration|too long|longer|seconds/i.test(message) };
  }
  if (row.media_type === 'image') return { judgement: judgeNudity(r.data.nudity), scores: r.data.nudity ?? null };
  const frames = (r.data.data?.frames ?? []) as { info?: { position?: number }; nudity?: Record<string, unknown> }[];
  return {
    judgement: judgeFrames(frames),
    // Only what an admin needs: each frame's position and its explicit scores.
    scores: frames.map((f) => ({
      position: f.info?.position,
      sexual_activity: f.nudity?.sexual_activity,
      sexual_display: f.nudity?.sexual_display,
      erotica: f.nudity?.erotica,
      very_suggestive: f.nudity?.very_suggestive,
    })),
  };
};

// GET /api/moderate: whether the automatic scan is set up (never reveals a secret).
export async function GET(): Promise<Response> {
  const e = env();
  return json(200, {
    enabled: !!(e.apiUser && e.apiSecret && e.serviceKey),
    provider: 'sightengine',
    checks: {
      apiUser: e.apiUser ? 'OK' : 'FALTA',
      apiSecret: e.apiSecret ? `${e.apiSecret.length} caracteres` : 'FALTA',
      serviceRoleKey: e.serviceKey ? `${e.serviceKey.length} caracteres` : 'FALTA',
    },
  });
}

// POST /api/moderate {bucket, path} (the uploader, signed in) → {status, reason}
export async function POST(request: Request): Promise<Response> {
  const e = env();
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Inicia sesión para subir archivos.' });
  const body = (await request.json().catch(() => ({}))) as { bucket?: unknown; path?: unknown };
  const bucket = body.bucket === 'post-media' || body.bucket === 'profile-images' ? body.bucket : null;
  const path = typeof body.path === 'string' && body.path.length <= 300 ? body.path : null;
  if (!bucket || !path) return json(400, { error: 'Archivo no válido.' });

  const user = await call(`${SUPABASE_URL}/auth/v1/user`, { headers: asUser(token) });
  const userId = user.ok ? (user.data?.id as string | undefined) : undefined;
  if (!userId) return json(401, { error: 'Tu sesión caducó. Vuelve a iniciar sesión.' });

  // Without the service key the queue can't be updated: it waits for an admin.
  if (!e.serviceKey) return json(200, { status: 'pending', reason: '' });
  const server = asServer(e.serviceKey);
  const rows = await call(
    `${SUPABASE_URL}/rest/v1/media_moderation?bucket=eq.${encodeURIComponent(bucket)}&path=eq.${encodeURIComponent(path)}&select=*`,
    { headers: server }
  );
  const row = (Array.isArray(rows.data) ? rows.data[0] : null) as Row | null;
  if (!row || row.owner_id !== userId) return json(404, { error: 'No encontramos el archivo subido.' });
  if (row.status !== 'pending') return json(200, { status: row.status, reason: row.reason });
  if (!e.apiUser || !e.apiSecret) return json(200, { status: 'pending', reason: '' });

  const url = await mediaUrl(row, e.serviceKey);
  const result: Scan = url ? await scan(row, url, { apiUser: e.apiUser, apiSecret: e.apiSecret }) : { failed: 'No se pudo leer el archivo' };

  const patch =
    'judgement' in result
      ? { status: result.judgement.verdict, reason: result.judgement.reason, scores: result.scores }
      : result.tooLong
        ? { status: 'review', reason: 'Video largo: revisión manual', scores: null }
        : // A failed scan never publishes anything: it stays pending for an admin.
          { status: 'pending', reason: `El escaneo automático falló: ${result.failed}`.slice(0, 300), scores: null };
  await call(
    `${SUPABASE_URL}/rest/v1/media_moderation?bucket=eq.${encodeURIComponent(bucket)}&path=eq.${encodeURIComponent(path)}&status=eq.pending`,
    {
      method: 'PATCH',
      headers: { ...server, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({ ...patch, provider: 'sightengine', decided_at: patch.status === 'pending' ? null : new Date().toISOString() }),
    }
  );

  if (patch.status === 'approved' && (row.kind === 'avatar' || row.kind === 'cover') && row.public_url) {
    await call(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(row.owner_id)}`, {
      method: 'PATCH',
      headers: { ...server, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({ [row.kind]: row.public_url }),
    });
  }
  return json(200, { status: patch.status, reason: patch.reason });
}
