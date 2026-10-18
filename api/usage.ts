// Vercel function: the daily check of what Fans Reserve uses of each provider's
// plan, so nothing gets paused for reaching a limit unnoticed.
// - Vercel Cron calls GET /api/usage every day (vercel.json) with
//   "Authorization: Bearer <CRON_SECRET>": it reads public.infra_usage() with the
//   service role and, when something passed 70% or 90% of its plan, emails
//   ALERT_EMAIL (carlos@fansreserve.com by default) once per level and month.
// - GET /api/usage without that header only says whether it is set up.
// Limits and plans: src/lib/infraUsage.ts. Tables: 20261018000001_infra_usage.sql.
//
// Needs in the Vercel project settings: CRON_SECRET (any long random text),
// SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY (both already set).
import { logServerError, resendKey, sendEmail } from './_mail.js';
import { alertEmail, fromRpc, pendingAlerts } from '../src/lib/infraUsage.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';

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

export async function GET(request: Request): Promise<Response> {
  const e = env();
  const auth = request.headers.get('authorization') ?? '';
  if (!e.cronSecret || auth !== `Bearer ${e.cronSecret}`) {
    return json(e.cronSecret && auth ? 401 : 200, {
      enabled: !!(e.cronSecret && e.serviceKey && resendKey()),
      checks: {
        cronSecret: e.cronSecret ? 'OK' : 'FALTA',
        serviceRoleKey: e.serviceKey ? 'OK' : 'FALTA',
        resend: resendKey() ? 'OK' : 'FALTA',
      },
    });
  }
  if (!e.serviceKey) return json(503, { error: 'Falta SUPABASE_SERVICE_ROLE_KEY' });

  try {
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
