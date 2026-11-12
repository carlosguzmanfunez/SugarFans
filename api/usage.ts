// Vercel function: the daily check of what Fans Reserve uses of each provider's
// plan, so nothing gets paused for reaching a limit unnoticed.
// - Vercel Cron calls GET /api/usage every day (vercel.json) with
//   "Authorization: Bearer <CRON_SECRET>": it reads public.infra_usage() with the
//   service role and, when something passed 70% or 90% of its plan, emails
//   ALERT_EMAIL (carlos@fansreserve.com by default) once per level and month.
// - GET /api/usage without that header only says whether it is set up.
// Limits and plans: src/lib/infraUsage.ts. Tables: 20261018000001_infra_usage.sql.
// - GET /api/usage?report=1 emails the pending "Mano derecha" reports (20261107210000_monitor_mano_derecha.sql).
//
// Needs in the Vercel project settings: CRON_SECRET (any long random text),
// SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY (both already set).
import { deliverOutbox, logServerError, resendKey, sendEmail, sendHtmlEmail } from './_mail.js';
import { monitorReportEmail, type MonitorReportRow } from '../src/lib/monitorReportEmail.js';
import { alertEmail, fromRpc, pendingAlerts } from '../src/lib/infraUsage.js';
import { sitemapResponse } from './_sitemap.js';
import { bunnyUsage } from './_bunny.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;

const env = () => ({
  cronSecret: clean(process.env.CRON_SECRET),
  serviceKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  alertEmail: clean(process.env.ALERT_EMAIL) ?? 'carlos@fansreserve.com',
});

// New secret keys (sb_secret_…) go in apikey only; the legacy service_role key is a JWT.
const asServer = (key: string): Record<string, string> => (key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key });

const rest = async (key: string, path: string, body?: unknown, prefer = 'return=minimal') => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...asServer(key), 'content-type': 'application/json', prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

const patch = (key: string, path: string, body: unknown) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...asServer(key), 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });

const sendMonitorReports = async (serviceKey: string | undefined, to: string) => {
  if (!serviceKey || !resendKey()) return json(200, { ok: false, sent: 0 });
  let sent = 0;
  try {
    const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const rows = (await rest(
      serviceKey,
      `monitor_reports?select=id,kind,title,body,window_from,window_to,data&emailed_at=is.null&created_at=gte.${since}&order=created_at.asc&limit=3`,
    )) as MonitorReportRow[];
    for (const row of rows) {
      const mail = monitorReportEmail(row);
      const error = await sendHtmlEmail(to, mail.subject, mail.text, mail.html, `monitor-report-${row.id}`);
      await patch(serviceKey, `monitor_reports?id=eq.${row.id}`, error ? { email_error: error } : { emailed_at: new Date().toISOString(), email_error: null });
      if (error) await logServerError(serviceKey, 'email', 'No se pudo enviar el reporte de Mano derecha', error, '/api/usage');
      else sent += 1;
    }
  } catch (err) {
    await logServerError(serviceKey, 'api', 'Falló el envío del reporte de Mano derecha', String(err), '/api/usage');
  }
  return json(200, { ok: true, sent });
};

export async function GET(request: Request): Promise<Response> {
  // /sitemap.xml (public, read-only): see api/_sitemap.ts.
  const params = new URL(request.url).searchParams;
  if (params.get('sitemap') === '1') return sitemapResponse();
  const e = env();
  // ?report=1 (public, returns only a count): the database asks for the "Mano derecha"
  // reports (12 AM / 12 PM Honduras) that were not emailed yet to go out now. It only
  // sends reports already written, only to ALERT_EMAIL, each one once.
  if (params.get('report') === '1') return sendMonitorReports(e.serviceKey, e.alertEmail);
  // ?outbox=1 (public, returns only a count): the database asks for the app emails it
  // just queued in email_outbox (e.g. the Reserve reminders to a creator) to go out
  // now. It only sends rows already written, each one once (Resend idempotency key).
  if (params.get('outbox') === '1') return json(200, { ok: true, sent: await deliverOutbox(e.serviceKey, 20) });
  const auth = request.headers.get('authorization') ?? '';
  if (!e.cronSecret || auth !== `Bearer ${e.cronSecret}`) {
    return json(e.cronSecret && auth ? 401 : 200, {
      enabled: !!(e.cronSecret && e.serviceKey && resendKey()),
      checks: {
        cronSecret: e.cronSecret ? 'OK' : 'FALTA',
        serviceRoleKey: e.serviceKey ? 'OK' : 'FALTA',
        resend: resendKey() ? 'OK' : 'FALTA',
        bunnyAccount: clean(process.env.BUNNY_ACCOUNT_API_KEY) ? 'OK' : 'FALTA',
      },
    });
  }
  if (!e.serviceKey) return json(503, { error: 'Falta SUPABASE_SERVICE_ROLE_KEY' });

  try {
    // Daily safety net for app emails still waiting to be sent.
    await deliverOutbox(e.serviceKey, 20);
    const usage = fromRpc(await rest(e.serviceKey, 'rpc/infra_usage', {}, 'return=representation'));
    const today = new Date().toISOString().slice(0, 10);
    const sentRows = (await rest(e.serviceKey, `usage_alerts?select=month,metric,level&month=in.(${usage.month},${today})`)) as { month: string; metric: string; level: number }[];
    const sent = new Set(sentRows.map((r) => `${r.month}|${r.metric}|${r.level}`));
    const due = pendingAlerts(usage, sent, today);
    if (!due.length) return json(200, { ok: true, alerts: 0 });

    const { subject, body } = alertEmail(due.map((d) => d.row));
    const key = `usage-${due.map((d) => `${d.period}-${d.row.metric}-${d.row.level}`).join('-')}`.slice(0, 250);
    const error = await sendEmail(e.alertEmail, subject, body, key);
    if (error) {
      await logServerError(e.serviceKey, 'email', 'No se pudo enviar el aviso de consumo', error, '/api/usage');
      return json(502, { error });
    }
    await rest(
      e.serviceKey,
      'usage_alerts?on_conflict=month,metric,level',
      due.map((d) => ({ month: d.period, metric: d.row.metric, level: d.row.level, pct: d.row.pct })),
      'resolution=ignore-duplicates,return=minimal'
    );
    return json(200, { ok: true, alerts: due.length });
  } catch (err) {
    await logServerError(e.serviceKey, 'api', 'Falló la revisión diaria de consumo', String(err), '/api/usage');
    return json(500, { error: 'No se pudo revisar el consumo' });
  }
}

// POST {action:'bunny-usage'} (admins only, with their session): Bunny Stream numbers for
// the admin "Consumo" tab. Read-only; the keys never leave the server.
const isAdmin = async (authorization: string) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, authorization, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 401 || r.status === 403) return false;
  return r.ok && (await r.json()) === true;
};

const getJson = async (url: string, init?: RequestInit) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  if (body.action !== 'bunny-usage') return json(400, { error: 'Acción desconocida' });
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !(await isAdmin(auth).catch(() => false))) return json(403, { error: 'Solo para administradores' });
  return json(200, await bunnyUsage(getJson));
}
