// Records errors that happen in visitors' browsers in production, so the admin
// sees them in the dashboard's "Errores" tab instead of never finding out. Calls
// log_app_error() straight through Supabase's REST API (no client library), so
// it still works when the app itself failed to load. The database groups repeats
// and caps the volume; this side sends at most 10 per page load.
// See supabase/migrations/20261015000002_email_delivery_and_errors.sql.

const MAX_PER_PAGE = 10;
let sent = 0;
const seen = new Set<string>();

// Noise that says nothing about our code: browser extensions, ResizeObserver
// warnings, cross-origin scripts that hide their message, aborted requests.
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /extension:\/\//i, /AbortError/i, /The user aborted a request/i];

export const reportError = (message: string, detail = '') => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!import.meta.env.PROD || !url || !key) return;
  const text = (message || 'Error sin mensaje').slice(0, 500);
  if (IGNORED.some((r) => r.test(text) || r.test(detail)) || seen.has(text) || sent >= MAX_PER_PAGE) return;
  seen.add(text);
  sent += 1;
  void fetch(`${url}/rest/v1/rpc/log_app_error`, {
    method: 'POST',
    keepalive: true,
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_source: 'web',
      p_message: text,
      p_detail: detail.slice(0, 4000),
      p_url: location.pathname.slice(0, 500),
      p_user_agent: navigator.userAgent.slice(0, 300),
    }),
  }).catch(() => {});
};

const describe = (reason: unknown): [string, string] => {
  if (reason instanceof Error) return [`${reason.name}: ${reason.message}`, reason.stack ?? ''];
  if (typeof reason === 'string') return [reason, ''];
  try {
    return [JSON.stringify(reason).slice(0, 500), ''];
  } catch {
    return [String(reason), ''];
  }
};

const install = () => {
  window.addEventListener('error', (event) => {
    const [message, stack] = event.error ? describe(event.error) : [event.message, ''];
    reportError(message, stack || `${event.filename}:${event.lineno}:${event.colno}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const [message, stack] = describe(event.reason);
    reportError(`Promesa sin manejar: ${message}`, stack);
  });
};

if (typeof window !== 'undefined') install();
