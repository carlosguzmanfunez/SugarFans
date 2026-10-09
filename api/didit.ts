// Vercel function: identity verification with Didit (document check, liveness
// and face match). The browser asks for a Didit session here and is sent to
// Didit's page; when Didit decides, its webhook (POST /api/didit?webhook) lands
// here, we ask Didit again for the decision and record it with didit_record()
// (migration 20261009000001_didit_kyc.sql): approved and 18+ gives "Verificado".
//
// Needs in the Vercel project settings: DIDIT_API_KEY, DIDIT_WORKFLOW_ID,
// DIDIT_WEBHOOK_SECRET and SUPABASE_SERVICE_ROLE_KEY.
import { createHmac, timingSafeEqual } from 'node:crypto';

// Public values (same as .env.production); the anon key is meant to be public.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';
const DIDIT_API = 'https://verification.didit.me';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// A value pasted with spaces, a newline or quotes around it breaks the request.
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
const env = () => ({
  apiKey: clean(process.env.DIDIT_API_KEY),
  workflowId: clean(process.env.DIDIT_WORKFLOW_ID),
  webhookSecret: clean(process.env.DIDIT_WEBHOOK_SECRET),
  serviceKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
});
type Env = { apiKey: string; workflowId: string; webhookSecret: string; serviceKey: string };

const asUser = (token: string) => ({ apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` });
// New secret keys (sb_secret_…) go in apikey only; the legacy service_role key is a JWT.
const asServer = (key: string): Record<string, string> => (key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key });

const call = async (url: string, headers: Record<string, string>, body?: unknown) => {
  const r = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: r.ok, status: r.status, data, error: r.ok ? '' : String(data?.message || data?.detail || data?.msg || data?.error || `Error ${r.status}`) };
};

// --- Webhook signature ------------------------------------------------------------

const sameHex = (a: string, b: string) => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};
const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data, 'utf8').digest('hex');

// Didit's X-Signature-V2 signs the JSON re-serialized with sorted keys.
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]))
      : v;

const validSignature = (raw: string, headers: Headers, secret: string, now = Date.now()) => {
  const ts = Number(headers.get('x-timestamp'));
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const v1 = headers.get('x-signature');
  if (v1 && sameHex(v1, hmac(secret, raw))) return true;
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return false;
  }
  const v2 = headers.get('x-signature-v2');
  if (v2 && sameHex(v2, hmac(secret, JSON.stringify(sorted(body))))) return true;
  const simple = headers.get('x-signature-simple');
  return !!simple && sameHex(simple, hmac(secret, `${body?.timestamp ?? ''}:${body?.session_id ?? ''}:${body?.status ?? ''}:${body?.webhook_type ?? ''}`));
};

// --- Decision → database ------------------------------------------------------------

const docType = (t: unknown) => {
  const s = String(t ?? '').toLowerCase();
  if (s.includes('passport')) return 'passport';
  if (s.includes('driv') || s.includes('licen')) return 'license';
  return 'dni';
};

// Didit's decision for one session: the status plus what it read from the document.
const record = async (e: Env, sessionId: string) => {
  const d = await call(`${DIDIT_API}/v3/session/${encodeURIComponent(sessionId)}/decision/`, { 'x-api-key': e.apiKey });
  if (!d.ok) throw new Error(`Didit no devolvió la decisión (${d.status})`);
  const userId = String(d.data?.vendor_data ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return 'ignored: no user';
  const id = (Array.isArray(d.data?.id_verifications) ? d.data.id_verifications[0] : d.data?.id_verification) ?? {};
  const legalName = String(id.full_name || [id.first_name, id.last_name].filter(Boolean).join(' ') || '');
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(String(id.date_of_birth ?? '')) ? String(id.date_of_birth) : null;
  const saved = await call(`${SUPABASE_URL}/rest/v1/rpc/didit_record`, asServer(e.serviceKey), {
    p_user: userId,
    p_session: sessionId,
    p_status: String(d.data?.status ?? ''),
    p_legal_name: legalName,
    p_birth_date: birth,
    p_country: String(id.issuing_state_name || id.issuing_state || ''),
    p_doc_type: docType(id.document_type),
    p_doc_number: String(id.document_number ?? ''),
    p_reason: null,
  });
  if (!saved.ok) throw new Error(saved.error);
  return String(saved.data);
};

// POST /api/didit?webhook: Didit's notifications, signed with DIDIT_WEBHOOK_SECRET.
const webhook = async (request: Request, e: Env): Promise<Response> => {
  const raw = await request.text();
  if (!validSignature(raw, request.headers, e.webhookSecret)) return json(401, { error: 'Firma no válida' });
  const event = JSON.parse(raw) as { session_id?: unknown; webhook_type?: unknown };
  if (event.webhook_type && event.webhook_type !== 'status.updated') return json(200, { ok: true, result: 'ignored' });
  const sessionId = String(event.session_id ?? '');
  if (!sessionId) return json(200, { ok: true, result: 'ignored: no session' });
  return json(200, { ok: true, result: await record(e, sessionId) });
};

// GET /api/didit: whether Didit is set up (never reveals a secret).
export async function GET(): Promise<Response> {
  const e = env();
  return json(200, {
    enabled: !!(e.apiKey && e.workflowId && e.webhookSecret && e.serviceKey),
    checks: {
      apiKey: e.apiKey ? `${e.apiKey.length} caracteres` : 'FALTA',
      workflowId: e.workflowId ? 'OK' : 'FALTA',
      webhookSecret: e.webhookSecret ? `${e.webhookSecret.length} caracteres` : 'FALTA',
      serviceRoleKey: e.serviceKey ? `${e.serviceKey.length} caracteres` : 'FALTA',
    },
  });
}

// POST /api/didit {} (signed-in user) → {url} of their Didit verification page
// POST /api/didit?webhook (from Didit)
export async function POST(request: Request): Promise<Response> {
  const base = env();
  if (!base.apiKey || !base.workflowId || !base.webhookSecret || !base.serviceKey) {
    return json(503, { error: 'La verificación con Didit aún no está configurada.' });
  }
  const e = base as Env;
  const url = new URL(request.url);

  if (url.searchParams.has('webhook')) {
    try {
      return await webhook(request, e);
    } catch (err) {
      return json(500, { error: err instanceof Error ? err.message : 'Error' });
    }
  }

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Inicia sesión para verificar tu identidad.' });
  const user = await call(`${SUPABASE_URL}/auth/v1/user`, asUser(token));
  const userId = user.ok ? (user.data?.id as string | undefined) : undefined;
  if (!userId) return json(401, { error: 'Tu sesión caducó. Vuelve a iniciar sesión.' });

  const session = await call(`${DIDIT_API}/v3/session/`, { 'x-api-key': e.apiKey }, {
    workflow_id: e.workflowId,
    vendor_data: userId,
    callback: `${url.origin}/settings?section=verification&didit=1`,
  });
  const link = session.data?.url ?? session.data?.verification_url;
  if (!session.ok || typeof link !== 'string') return json(502, { error: 'Didit no pudo abrir la verificación. Inténtalo de nuevo en unos minutos.' });
  return json(200, { url: link });
}
