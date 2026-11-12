// Post videos are played from Bunny Stream instead of Supabase Storage (Carlos,
// 2026-11-12): each GB a fan watches costs $0.005 there instead of $0.09, and Bunny
// converts every video to 360p/720p/1080p so each fan gets what their connection can
// take.
//
// Supabase stays the source of truth: the creator uploads there, the file is
// moderated there and Storage still decides who may see it. Bunny only keeps a copy:
//   1. A viewer asks for access (POST /api/moderate {action:'video-access', paths}).
//      We ask Storage, WITH THE VIEWER'S OWN SESSION, to sign those files. Only the
//      files it signs (published, and subscribed when locked) get a Bunny link, which
//      is signed here and expires in an hour.
//   2. A video that isn't in Bunny yet keeps playing from Supabase as before, and the
//      browser asks once for it to be copied ({action:'video-ingest', path}). Only an
//      approved video (or one from before moderation existed) is copied.
//   3. When the creator deletes the file ({action:'video-forget', path}) the copy is
//      deleted from Bunny too.
// Without the Bunny settings everything keeps working from Supabase as before.
//
// Vercel settings: BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY (library API key)
// and BUNNY_STREAM_TOKEN_KEY (Security > "Token authentication key").
// Table media_cdn: supabase/migrations/20261112030000_media_cdn_bunny.sql.
import { createHash } from 'node:crypto';

const BUNNY_API = process.env.BUNNY_STREAM_API_BASE || 'https://video.bunnycdn.com';
const PLAYER = 'https://player.mediadelivery.net/embed';
export const BUNNY_LINK_TTL = 60 * 60;
// A copy that started but never finished (function stopped mid-way) is retried after this.
const STUCK_MS = 10 * 60 * 1000;
// How often Bunny is asked whether a copy finished converting.
const RECHECK_MS = 20 * 1000;
const MAX_PATHS = 40;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const BUCKET = 'post-media';

const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
export const bunnyEnv = () => ({
  library: clean(process.env.BUNNY_STREAM_LIBRARY_ID),
  apiKey: clean(process.env.BUNNY_STREAM_API_KEY),
  tokenKey: clean(process.env.BUNNY_STREAM_TOKEN_KEY),
});
export const bunnyChecks = () => {
  const e = bunnyEnv();
  return {
    enabled: !!(e.library && e.apiKey && e.tokenKey),
    libraryId: e.library ? 'OK' : 'FALTA',
    apiKey: e.apiKey ? 'OK' : 'FALTA',
    tokenKey: e.tokenKey ? 'OK' : 'FALTA',
  };
};

/** Bunny "embed view token": SHA256_HEX(token key + video id + expiration in seconds). */
export const bunnyEmbedUrl = (library: string, tokenKey: string, videoId: string, nowMs: number, ratio?: string) => {
  const expires = Math.floor(nowMs / 1000) + BUNNY_LINK_TTL;
  const token = createHash('sha256').update(tokenKey + videoId + expires).digest('hex');
  // The fragment never reaches Bunny: it tells our player the video's shape.
  return `${PLAYER}/${encodeURIComponent(library)}/${encodeURIComponent(videoId)}?token=${token}&expires=${expires}${ratio ? `#r=${ratio}` : ''}`;
};

type Call = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; data: any }>;
interface Ctx {
  call: Call;
  supabaseUrl: string;
  asUser: (token: string) => Record<string, string>;
  server: Record<string, string>;
  userId: string;
  token: string;
  now?: number;
}
interface CdnRow {
  path: string;
  video_id: string | null;
  status: 'uploading' | 'encoding' | 'ready' | 'failed';
  width: number | null;
  height: number | null;
  attempts: number;
  updated_at: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const inList = (paths: string[]) => `(${paths.map((p) => `"${p.replace(/["\\]/g, '')}"`).join(',')})`;
const validPath = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && p.length <= 300 && VIDEO_EXT.test(p) && !p.includes('..');

// Storage signs, with the viewer's own session, only the files this viewer may see.
const allowedForViewer = async (ctx: Ctx, paths: string[]): Promise<Set<string>> => {
  const r = await ctx.call(`${ctx.supabaseUrl}/storage/v1/object/sign/${BUCKET}`, {
    method: 'POST',
    headers: { ...ctx.asUser(ctx.token), 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60, paths }),
  });
  const out = new Set<string>();
  if (!r.ok || !Array.isArray(r.data)) return out;
  for (const x of r.data) if (x && !x.error && typeof x.path === 'string' && (x.signedURL || x.signedUrl)) out.add(x.path);
  return out;
};

const rowsFor = async (ctx: Ctx, paths: string[]): Promise<Map<string, CdnRow>> => {
  const r = await ctx.call(`${ctx.supabaseUrl}/rest/v1/media_cdn?path=in.${encodeURIComponent(inList(paths))}&select=*`, { headers: ctx.server });
  return new Map(((Array.isArray(r.data) ? r.data : []) as CdnRow[]).map((x) => [x.path, x]));
};

const patchRow = (ctx: Ctx, path: string, body: Record<string, unknown>, extraFilter = '') =>
  ctx.call(`${ctx.supabaseUrl}/rest/v1/media_cdn?path=eq.${encodeURIComponent(path)}${extraFilter}`, {
    method: 'PATCH',
    headers: { ...ctx.server, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ ...body, updated_at: new Date(ctx.now ?? Date.now()).toISOString() }),
  });

const bunny = (ctx: Ctx, e: ReturnType<typeof bunnyEnv>, path: string, init: RequestInit = {}) =>
  ctx.call(`${BUNNY_API}/library/${encodeURIComponent(e.library!)}${path}`, {
    ...init,
    headers: { AccessKey: e.apiKey!, accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });

// Converting in Bunny: ask how it's going (not more than every 20 s per video).
const refresh = async (ctx: Ctx, e: ReturnType<typeof bunnyEnv>, row: CdnRow): Promise<CdnRow> => {
  const now = ctx.now ?? Date.now();
  if (row.status !== 'encoding' || !row.video_id || now - Date.parse(row.updated_at) < RECHECK_MS) return row;
  const v = await bunny(ctx, e, `/videos/${encodeURIComponent(row.video_id)}`);
  if (!v.ok) return row;
  const status = Number(v.data?.status);
  const next: Partial<CdnRow> =
    status === 4 || (Number(v.data?.encodeProgress) >= 100 && status !== 5)
      ? { status: 'ready', width: Number(v.data?.width) || null, height: Number(v.data?.height) || null }
      : status === 5 || status === 6
        ? { status: 'failed' }
        : {};
  await patchRow(ctx, row.path, next);
  return { ...row, ...next, updated_at: new Date(now).toISOString() };
};

/** {paths} → {urls: {path: Bunny link}, pending: [paths to copy]} for the files this viewer may see. */
export async function videoAccess(ctx: Ctx, body: { paths?: unknown }): Promise<Response> {
  const e = bunnyEnv();
  if (!(e.library && e.apiKey && e.tokenKey)) return json(200, { enabled: false, urls: {}, pending: [] });
  const paths = [...new Set(Array.isArray(body.paths) ? body.paths.filter(validPath) : [])].slice(0, MAX_PATHS);
  if (!paths.length) return json(200, { enabled: true, urls: {}, pending: [] });
  const allowed = [...(await allowedForViewer(ctx, paths))];
  if (!allowed.length) return json(200, { enabled: true, urls: {}, pending: [] });
  const rows = await rowsFor(ctx, allowed);
  const urls: Record<string, string> = {};
  const pending: string[] = [];
  const now = ctx.now ?? Date.now();
  for (const path of allowed) {
    let row = rows.get(path);
    if (row) row = await refresh(ctx, e, row);
    if (row?.status === 'ready' && row.video_id) {
      const ratio = row.width && row.height ? `${row.width}x${row.height}` : undefined;
      urls[path] = bunnyEmbedUrl(e.library, e.tokenKey, row.video_id, now, ratio);
    } else if (!row || (row.status === 'uploading' && now - Date.parse(row.updated_at) > STUCK_MS) || (row.status === 'failed' && row.attempts < 3)) {
      pending.push(path);
    }
  }
  return json(200, { enabled: true, urls, pending });
}

// Only approved videos (or old ones without a moderation row) are copied to Bunny.
const approved = async (ctx: Ctx, path: string) => {
  const r = await ctx.call(
    `${ctx.supabaseUrl}/rest/v1/media_moderation?bucket=eq.${BUCKET}&path=eq.${encodeURIComponent(path)}&select=status,media_type`,
    { headers: ctx.server }
  );
  if (!r.ok || !Array.isArray(r.data)) return false;
  const row = r.data[0] as { status?: string; media_type?: string } | undefined;
  return !row || (row.status === 'approved' && row.media_type === 'video');
};

/** {path}: copies one video to Bunny (once; concurrent calls do nothing). */
export async function videoIngest(ctx: Ctx, body: { path?: unknown }): Promise<Response> {
  const e = bunnyEnv();
  if (!(e.library && e.apiKey && e.tokenKey)) return json(200, { status: 'off' });
  const path = validPath(body.path) ? body.path : null;
  if (!path) return json(400, { error: 'Archivo no válido.' });
  // Same rule as playing it: only someone who may see the video can trigger the copy.
  if (!(await allowedForViewer(ctx, [path])).has(path)) return json(404, { error: 'No encontramos el video.' });
  if (!(await approved(ctx, path))) return json(200, { status: 'waiting' });

  const now = ctx.now ?? Date.now();
  // Claim the copy: a new row, or a stuck/failed one. Whoever gets the row does the work.
  const created = await ctx.call(`${ctx.supabaseUrl}/rest/v1/media_cdn?on_conflict=path`, {
    method: 'POST',
    headers: { ...ctx.server, 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ path, provider: 'bunny', status: 'uploading', attempts: 1 }),
  });
  let claimed = created.ok && Array.isArray(created.data) && created.data.length > 0;
  if (!claimed) {
    const existing = (await rowsFor(ctx, [path])).get(path);
    if (!existing) return json(200, { status: 'busy' });
    const stuck = existing.status === 'uploading' && now - Date.parse(existing.updated_at) > STUCK_MS;
    const retry = existing.status === 'failed' && existing.attempts < 3;
    if (!stuck && !retry) return json(200, { status: existing.status });
    const taken = await patchRow(ctx, path, { status: 'uploading', attempts: existing.attempts + 1 }, `&updated_at=eq.${encodeURIComponent(existing.updated_at)}`);
    claimed = taken.ok && Array.isArray(taken.data) && taken.data.length > 0;
    if (!claimed) return json(200, { status: 'busy' });
    // A half-made copy from the earlier try is removed so it isn't stored twice.
    if (existing.video_id) await bunny(ctx, e, `/videos/${encodeURIComponent(existing.video_id)}`, { method: 'DELETE' });
  }

  const fail = async (why: string) => {
    await patchRow(ctx, path, { status: 'failed' });
    return json(200, { status: 'failed', reason: why });
  };
  const made = await bunny(ctx, e, '/videos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The title is only an internal reference: the creator's account id and file id.
    body: JSON.stringify({ title: path }),
  });
  const videoId = made.ok && typeof made.data?.guid === 'string' ? made.data.guid : null;
  if (!videoId) return fail(`Bunny no creó el video (${made.status})`);
  await patchRow(ctx, path, { video_id: videoId });

  // The file goes from Supabase straight to Bunny (streamed, never kept here).
  const signed = await ctx.call(`${ctx.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${enc(path)}`, {
    method: 'POST',
    headers: { ...ctx.server, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  const signedPath = signed.data?.signedURL ?? signed.data?.signedUrl;
  if (!signed.ok || typeof signedPath !== 'string') return fail('No se pudo leer el video');
  let source: Response;
  try {
    source = await fetch(`${ctx.supabaseUrl}/storage/v1${signedPath.startsWith('/') ? '' : '/'}${signedPath}`);
  } catch {
    return fail('No se pudo leer el video');
  }
  if (!source.ok || !source.body) return fail('No se pudo leer el video');
  let put: Response;
  try {
    put = await fetch(`${BUNNY_API}/library/${encodeURIComponent(e.library)}/videos/${encodeURIComponent(videoId)}`, {
      method: 'PUT',
      headers: { AccessKey: e.apiKey, 'content-type': 'application/octet-stream', ...(source.headers.get('content-length') ? { 'content-length': source.headers.get('content-length')! } : {}) },
      body: source.body,
      // Node needs this to send a streamed body.
      duplex: 'half',
    } as RequestInit);
  } catch {
    return fail('Bunny no recibió el video');
  }
  if (!put.ok) return fail(`Bunny no recibió el video (${put.status})`);
  await patchRow(ctx, path, { status: 'encoding' });
  return json(200, { status: 'encoding' });
}

/** {path}: the creator deleted the file, so its copy in Bunny is deleted too. */
export async function videoForget(ctx: Ctx, body: { path?: unknown }): Promise<Response> {
  const e = bunnyEnv();
  const path = validPath(body.path) ? body.path : null;
  if (!path) return json(400, { error: 'Archivo no válido.' });
  // Files live under <owner id>/: only their owner removes them here.
  if (!path.startsWith(`${ctx.userId}/`)) return json(403, { error: 'Esta acción no está permitida' });
  const row = (await rowsFor(ctx, [path])).get(path);
  if (!row) return json(200, { status: 'none' });
  if (row.video_id && e.library && e.apiKey) {
    const del = await bunny(ctx, e, `/videos/${encodeURIComponent(row.video_id)}`, { method: 'DELETE' });
    if (!del.ok && del.status !== 404) return json(502, { error: 'No se pudo borrar la copia del video.' });
  }
  await ctx.call(`${ctx.supabaseUrl}/rest/v1/media_cdn?path=eq.${encodeURIComponent(path)}`, { method: 'DELETE', headers: ctx.server });
  return json(200, { status: 'deleted' });
}
