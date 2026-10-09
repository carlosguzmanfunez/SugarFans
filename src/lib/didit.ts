// Identity verification with Didit: api/didit.ts opens a Didit session for the
// signed-in user and Didit's webhook records the result. Without that function
// (local store, offline tests, missing settings) Settings keeps the manual form.
import { backend } from './backend';

let configPromise: Promise<boolean> | null = null;

export const diditEnabled = (): Promise<boolean> => {
  if (backend.mode !== 'supabase') return Promise.resolve(false);
  configPromise ??= fetch('/api/didit', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .then((c: { enabled?: boolean }) => c.enabled === true)
    .catch(() => false);
  return configPromise;
};

// Sends the browser to Didit's verification page; Didit brings it back to Settings.
export const startDidit = async () => {
  const token = await backend.accessToken();
  if (!token) throw new Error('Inicia sesión para verificar tu identidad.');
  const r = await fetch('/api/didit', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' });
  const data = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!r.ok || !data.url) throw new Error(data.error || 'No se pudo abrir la verificación.');
  window.location.assign(data.url);
};
