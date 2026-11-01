// Vercel function: public numbers of professional Instagram accounts for the admin's
// "Captar creadores" tab, through the official Instagram Graph API ("Business
// Discovery"). Nothing is scraped: Meta answers only for business and creator
// accounts, with what they show publicly (name, bio, website, followers, posts and
// the likes and comments of their latest posts). The browser saves the result with
// prospects_import() (supabase/migrations/20261101000001_creator_prospects.sql).
// - GET /api/prospects: whether it is set up (OK/FALTA), without secrets.
// - POST /api/prospects {handles: string[]} with the admin's session: up to 25
//   usernames per call. Meta allows about 200 calls per hour for one account.
// - POST /api/prospects {action: 'email', emails, followUp, base} with the admin's
//   session: sends up to 5 invitation emails from the team's Zoho mailbox (SMTP),
//   skips who opted out, was discarded or has no email, keeps to the daily limit,
//   adds the unsubscribe link when the text doesn't have it, and records what went
//   out with prospects_email_sent() (20261101000002_prospect_invites.sql).
//
// Needs in the Vercel project settings: INSTAGRAM_BUSINESS_ID (the id of Fans
// Reserve's own professional Instagram account) and INSTAGRAM_ACCESS_TOKEN (a
// long-lived token of the Meta app with instagram_basic, instagram_manage_insights,
// pages_show_list, pages_read_engagement, business_management and ads_read; it
// lasts 60 days). Optional: INSTAGRAM_GRAPH_VERSION.
// For email: ZOHO_SMTP_USER (the mailbox, e.g. carlos@fansreserve.com) and
// ZOHO_SMTP_PASSWORD (a Zoho app password). Optional: ZOHO_SMTP_HOST
// (smtppro.zoho.com), ZOHO_SMTP_PORT (465), ZOHO_FROM_NAME, ZOHO_DAILY_LIMIT (30).
import nodemailer from 'nodemailer';
import type { InstagramLookup } from '../src/lib/backend/prospectTypes.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';
const GRAPH = process.env.INSTAGRAM_GRAPH_BASE || 'https://graph.facebook.com';
const MAX_HANDLES = 25;
const HANDLE = /^[a-z0-9._]{1,30}$/;
// Same as emailIn() in src/lib/prospects.ts (not imported: it pulls the country list).
const emailIn = (text?: string) => text?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// A value pasted with spaces, a newline or quotes around it breaks the request.
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
const env = () => ({
  igId: clean(process.env.INSTAGRAM_BUSINESS_ID),
  token: clean(process.env.INSTAGRAM_ACCESS_TOKEN),
  version: clean(process.env.INSTAGRAM_GRAPH_VERSION) ?? 'v26.0',
});

// A new mailbox that writes to strangers gets flagged fast: few a day, raised slowly.
const DEFAULT_DAILY = 30;
const zoho = () => {
  const port = Number(clean(process.env.ZOHO_SMTP_PORT) ?? 465);
  const limit = Number(clean(process.env.ZOHO_DAILY_LIMIT) ?? DEFAULT_DAILY);
  return {
    user: clean(process.env.ZOHO_SMTP_USER)?.toLowerCase(),
    password: clean(process.env.ZOHO_SMTP_PASSWORD)?.replace(/\s+/g, ''), // Zoho shows app passwords in groups; the spaces are not part of it
    host: clean(process.env.ZOHO_SMTP_HOST) ?? 'smtppro.zoho.com',
    port: Number.isInteger(port) && port > 0 ? port : 465,
    name: clean(process.env.ZOHO_FROM_NAME) ?? 'Carlos de Fans Reserve',
    limit: Number.isFinite(limit) ? Math.min(300, Math.max(1, Math.floor(limit))) : DEFAULT_DAILY,
  };
};

export async function GET(): Promise<Response> {
  const e = env();
  const z = zoho();
  const mail = !!(z.user && z.password);
  return json(200, {
    enabled: !!(e.igId && e.token),
    checks: {
      instagram: e.igId && e.token ? 'OK' : 'FALTA', businessId: e.igId ? 'OK' : 'FALTA', accessToken: e.token ? 'OK' : 'FALTA',
      email: mail ? 'OK' : 'FALTA',
    },
    emailLimit: mail ? z.limit : 0,
    emailFrom: mail ? z.user : undefined,
  });
}

const isAdmin = async (authorization: string) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, authorization, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 401 || r.status === 403) return 'expired';
  if (!r.ok) throw Error('auth unavailable');
  return (await r.json()) === true ? 'admin' : 'denied';
};

interface Media { timestamp?: string; like_count?: number; comments_count?: number }
interface Discovery {
  username?: string; name?: string; biography?: string; website?: string;
  followers_count?: number; media_count?: number; media?: { data?: Media[] };
}

// Average likes and comments of the latest posts over followers, in %.
export const engagementOf = (followers: number | undefined, media: Media[]) => {
  const counted = media.filter((m) => typeof m.like_count === 'number');
  if (!followers || !counted.length) return undefined;
  const avg = counted.reduce((s, m) => s + (m.like_count ?? 0) + (m.comments_count ?? 0), 0) / counted.length;
  return Math.round((avg / followers) * 10000) / 100;
};

export const toLookup = (handle: string, d: Discovery): InstagramLookup => {
  const media = d.media?.data ?? [];
  const last = media.map((m) => m.timestamp).filter((t): t is string => !!t).sort().pop();
  return {
    handle, ok: true,
    data: {
      display_name: d.name?.slice(0, 120) || undefined,
      followers: d.followers_count,
      posts: d.media_count,
      engagement: engagementOf(d.followers_count, media),
      last_post_at: last,
      email: emailIn(d.biography),
      bio: d.biography?.slice(0, 600) || undefined,
      website: d.website?.slice(0, 300) || undefined,
    },
  };
};

type Fatal = { fatal: string };

const lookup = async (handle: string, e: ReturnType<typeof env>): Promise<InstagramLookup | Fatal> => {
  const fields = `business_discovery.username(${handle}){username,name,biography,website,followers_count,media_count,media.limit(12){timestamp,like_count,comments_count}}`;
  const url = `${GRAPH}/${e.version}/${encodeURIComponent(e.igId!)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(e.token!)}`;
  let r: Response;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch {
    return { handle, ok: false, note: 'Instagram no respondió a tiempo' };
  }
  const body = (await r.json().catch(() => ({}))) as { business_discovery?: Discovery; error?: { code?: number; error_subcode?: number } };
  if (r.ok && body.business_discovery) return toLookup(handle, body.business_discovery);
  const code = body.error?.code;
  if (code === 190) return { fatal: 'El permiso de Instagram venció. Genera un token nuevo en Meta y cámbialo en Vercel (INSTAGRAM_ACCESS_TOKEN).' };
  if (code === 4 || code === 17 || code === 32 || code === 613) return { fatal: 'Instagram pide esperar: se llegó al límite de consultas por hora. Sigue en un rato.' };
  if (code === 10 || code === 200) return { fatal: 'La app de Meta no tiene permiso para consultar perfiles. Revisa los permisos del token.' };
  return { handle, ok: false, note: 'Cuenta personal, privada o que no existe' };
};

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s]+$/.test(authorization)) return json(401, { error: 'Inicia sesión con tu cuenta administrativa.' });
  try {
    const who = await isAdmin(authorization);
    if (who === 'expired') return json(401, { error: 'Tu sesión venció. Vuelve a iniciar sesión.' });
    if (who !== 'admin') return json(403, { error: 'Solo un administrador puede hacer esto.' });
  } catch {
    return json(503, { error: 'No pudimos confirmar tu sesión. Intenta de nuevo.' });
  }

  let body: { handles?: unknown; action?: unknown; emails?: unknown; followUp?: unknown; base?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Solicitud no válida.' });
  }
  if (body.action === 'email') return sendEmails(authorization, body);

  const e = env();
  if (!e.igId || !e.token) return json(503, { error: 'Falta conectar la API de Instagram (INSTAGRAM_BUSINESS_ID e INSTAGRAM_ACCESS_TOKEN en Vercel).' });
  const handles = Array.isArray(body.handles)
    ? [...new Set(body.handles.filter((h): h is string => typeof h === 'string').map((h) => h.trim().replace(/^@/, '').toLowerCase()))]
    : [];
  if (!handles.length || handles.length > MAX_HANDLES) return json(400, { error: `Envía entre 1 y ${MAX_HANDLES} usuarios.` });

  const results: InstagramLookup[] = [];
  // Five at a time keeps the call fast without bursting Meta's limit.
  for (let i = 0; i < handles.length; i += 5) {
    const batch = await Promise.all(handles.slice(i, i + 5).map((h) =>
      HANDLE.test(h) ? lookup(h, e) : Promise.resolve<InstagramLookup>({ handle: h, ok: false, note: 'No es un usuario de Instagram válido' })));
    const fatal = batch.find((b): b is Fatal => 'fatal' in b);
    results.push(...batch.filter((b): b is InstagramLookup => !('fatal' in b)));
    if (fatal) return json(results.length ? 207 : 502, { error: fatal.fatal, results });
  }
  return json(200, { results });
}

/* ---------- Email from Zoho ---------- */

const MAX_EMAILS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Where the invite and unsubscribe links point: the real site, a preview or local.
const BASE = /^(https:\/\/(www\.)?fansreserve\.com|https:\/\/[a-z0-9-]+\.vercel\.app|http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?)$/;
const SITE = 'https://fansreserve.com';

// Reads and calls the database as the signed-in admin (row security applies).
const asAdmin = async (authorization: string, path: string, body?: unknown) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, authorization, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw Error(`Supabase ${r.status}`);
  return r.json();
};

type Row = { id: string; email: string | null; status: string; invite_code: string };
type Item = { id: string; subject: string; body: string };

const sendEmails = async (authorization: string, body: { emails?: unknown; followUp?: unknown; base?: unknown }): Promise<Response> => {
  const z = zoho();
  if (!z.user || !z.password) return json(503, { error: 'Falta conectar el correo de Zoho (ZOHO_SMTP_USER y ZOHO_SMTP_PASSWORD en Vercel).' });
  const items: Item[] = Array.isArray(body.emails)
    ? body.emails.filter((x): x is Item => !!x && typeof x === 'object' && typeof (x as Item).id === 'string' && UUID.test((x as Item).id)
      && typeof (x as Item).subject === 'string' && typeof (x as Item).body === 'string')
      .map((x) => ({ id: x.id.toLowerCase(), subject: x.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 200), body: x.body.trim().slice(0, 10000) }))
      .filter((x) => x.subject && x.body)
    : [];
  if (!items.length || items.length > MAX_EMAILS || new Set(items.map((x) => x.id)).size !== items.length) {
    return json(400, { error: `Envía entre 1 y ${MAX_EMAILS} correos distintos por vez.` });
  }
  const followUp = body.followUp === true;
  const base = typeof body.base === 'string' && BASE.test(body.base) ? body.base : SITE;

  let rows: Row[];
  let sentToday: number;
  try {
    rows = await asAdmin(authorization, `creator_prospects?select=id,email,status,invite_code&id=in.(${items.map((x) => x.id).join(',')})`);
    sentToday = Number(await asAdmin(authorization, 'rpc/prospects_email_quota', {}));
  } catch {
    return json(503, { error: 'No pudimos leer la lista. Intenta de nuevo.' });
  }
  let remaining = Math.max(0, z.limit - sentToday);
  if (!remaining) return json(429, { error: `Ya salieron los ${z.limit} correos de hoy. Sigue mañana para que Zoho no marque la cuenta.`, sent: [], skipped: [], failed: [], remaining: 0 });

  const byId = new Map(rows.map((r) => [r.id, r]));
  const sent: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const failed: { id: string; error: string }[] = [];
  let warning: string | undefined;
  const transport = nodemailer.createTransport({
    host: z.host, port: z.port, secure: z.port === 465, auth: { user: z.user, pass: z.password },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });

  for (const item of items) {
    const row = byId.get(item.id);
    const reason = !row ? 'Ya no está en la lista'
      : row.status === 'no_contactar' ? 'Pidió que no le escribamos'
        : row.status === 'descartado' ? 'Está descartado'
          : !row.email ? 'No tiene correo'
            : followUp ? (row.status !== 'contactado' ? 'No está esperando seguimiento' : '')
              : row.status !== 'nuevo' ? 'Ya estaba contactado' : '';
    if (reason || !row?.email) { skipped.push({ id: item.id, reason: reason || 'No tiene correo' }); continue; }
    if (!remaining) { skipped.push({ id: item.id, reason: 'Se llegó al límite de hoy' }); continue; }
    const unsubscribe = `${base}/c/${row.invite_code}?baja=1`;
    const text = item.body.includes(unsubscribe) ? item.body : `${item.body}\n\n—\nSi prefieres que no te escribamos más, entra aquí: ${unsubscribe}`;
    try {
      await transport.sendMail({
        from: { name: z.name, address: z.user }, to: row.email, replyTo: z.user, subject: item.subject, text,
        headers: { 'List-Unsubscribe': `<${unsubscribe}>, <mailto:${z.user}?subject=baja>` },
      });
      sent.push(item.id);
      remaining--;
    } catch (err) {
      const e = err as { code?: string; responseCode?: number; message?: string };
      if (e.code === 'EAUTH' || e.responseCode === 535) {
        warning = 'Zoho no aceptó el usuario o la contraseña. Revisa ZOHO_SMTP_USER y ZOHO_SMTP_PASSWORD (usa una contraseña de aplicación).';
        break;
      }
      if (e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT' || e.code === 'ESOCKET' || e.code === 'EDNS') {
        warning = 'No pudimos conectar con Zoho. Intenta de nuevo en un rato.';
        break;
      }
      // 550/554: the address doesn't exist or Zoho refused this one.
      failed.push({ id: item.id, error: (e.responseCode ? `Zoho ${e.responseCode}` : 'No se pudo enviar').slice(0, 120) });
      if (e.responseCode === 554 || e.responseCode === 421) {
        warning = 'Zoho frenó los envíos por ahora. Espera unas horas antes de seguir.';
        break;
      }
    }
  }
  transport.close();

  if (sent.length) {
    try {
      await asAdmin(authorization, 'rpc/prospects_email_sent', { p_ids: sent, p_follow_up: followUp });
    } catch {
      warning = [warning, 'Los correos salieron, pero no pudimos marcarlos en la lista. Márcalos a mano para no repetirlos.'].filter(Boolean).join(' ');
    }
  }
  return json(warning && !sent.length ? 502 : 200, { sent, skipped, failed, remaining, ...(warning ? { error: warning } : {}) });
};
