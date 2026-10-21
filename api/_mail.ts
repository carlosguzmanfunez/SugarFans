// Shared by the Vercel functions (the leading "_" keeps Vercel from serving this
// file as its own endpoint): sending the emails the database queues in
// email_outbox, and recording server errors for the admin's "Errores" tab.
// See supabase/migrations/20261015000002_email_delivery_and_errors.sql.
//
// Needs in the Vercel project settings: RESEND_API_KEY (Resend → API Keys,
// "Sending access" for fansreserve.com) and SUPABASE_SERVICE_ROLE_KEY.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const FROM = 'Fans Reserve <noreply@fansreserve.com>';
const REPLY_TO = 'support@fansreserve.com';
const MAX_ATTEMPTS = 5;

const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
export const resendKey = () => clean(process.env.RESEND_API_KEY);

// New secret keys (sb_secret_…) go in apikey only; the legacy service_role key is a JWT.
const asServer = (key: string): Record<string, string> => (key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key });

const rest = (serviceKey: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  fetch(`${SUPABASE_URL}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { ...asServer(serviceKey), 'content-type': 'application/json', prefer: 'return=minimal' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

// Never throws: a broken log must not break the request that failed.
export const logServerError = async (serviceKey: string | undefined, source: 'api' | 'email', message: string, detail = '', url = '') => {
  if (!serviceKey) return;
  try {
    await rest(serviceKey, '/rest/v1/rpc/log_app_error', {
      body: { p_source: source, p_message: message.slice(0, 500), p_detail: detail.slice(0, 4000), p_url: url.slice(0, 500), p_user_agent: '' },
    });
  } catch {
    /* nothing else to do */
  }
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// The outbox body is plain text; the HTML version only adds the brand frame.
export const emailHtml = (subject: string, body: string) => `<!doctype html>
<html lang="es"><body style="margin:0;background:#f6f4fb;font-family:Arial,Helvetica,sans-serif;color:#1d1830">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="font-size:20px;font-weight:bold;margin:0 0 20px;color:#c2185b">Fans Reserve</p>
<div style="background:#ffffff;border-radius:14px;padding:24px">
<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(subject)}</h1>
<p style="font-size:15px;line-height:1.55;margin:0">${escapeHtml(body).replace(/\n/g, '<br>')}</p>
</div>
<p style="font-size:12px;color:#6b6480;margin:20px 0 0">¿Dudas? Responde a este correo o escríbenos a ${REPLY_TO}.<br><a href="https://fansreserve.com" style="color:#6b6480">fansreserve.com</a></p>
</div></body></html>`;

type OutboxRow = { id: string; to_email: string; subject: string; body: string; attempts: number };

const sendOne = async (key: string, row: OutboxRow) => {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'idempotency-key': `outbox-${row.id}` },
    body: JSON.stringify({ from: FROM, to: [row.to_email], reply_to: REPLY_TO, subject: row.subject, text: row.body, html: emailHtml(row.subject, row.body) }),
    signal: AbortSignal.timeout(10000),
  });
  if (r.ok) return '';
  const data = (await r.json().catch(() => ({}))) as { message?: string };
  return `Resend ${r.status}: ${data.message ?? 'sin detalle'}`.slice(0, 300);
};

// One email straight to Resend (not through the outbox): for alerts to the team.
// Returns '' when it went out, or the reason it didn't.
export const sendEmail = async (to: string, subject: string, body: string, idempotencyKey: string) => {
  const key = resendKey();
  if (!key) return 'Falta RESEND_API_KEY';
  return sendOne(key, { id: idempotencyKey, to_email: to, subject, body, attempts: 0 }).catch((e) => String(e).slice(0, 300));
};

// Sends what is waiting in email_outbox (oldest first). Never throws; returns how
// many went out. Without RESEND_API_KEY nothing is touched, so the emails wait
// until the key is set.
export const deliverOutbox = async (serviceKey: string | undefined, limit = 10): Promise<number> => {
  const key = resendKey();
  if (!serviceKey || !key) return 0;
  let sent = 0;
  try {
    const r = await rest(
      serviceKey,
      `/rest/v1/email_outbox?delivered_at=is.null&attempts=lt.${MAX_ATTEMPTS}&select=id,to_email,subject,body,attempts&order=sent_at.asc&limit=${limit}`,
    );
    const rows = r.ok ? ((await r.json()) as OutboxRow[]) : [];
    for (const row of rows) {
      const error = row.to_email.includes('@') ? await sendOne(key, row).catch((e) => String(e).slice(0, 300)) : 'Sin correo de destino';
      await rest(serviceKey, `/rest/v1/email_outbox?id=eq.${row.id}`, {
        method: 'PATCH',
        body: error
          ? { attempts: row.attempts + 1, last_error: error }
          : { attempts: row.attempts + 1, last_error: '', delivered_at: new Date().toISOString() },
      });
      if (error) await logServerError(serviceKey, 'email', `No se pudo enviar "${row.subject}"`, error);
      else sent += 1;
    }
  } catch (e) {
    await logServerError(serviceKey, 'email', 'Fallo al revisar los correos pendientes', String(e));
  }
  return sent;
};
