// PayPal Checkout in the browser: the buttons come from PayPal's JS SDK and every
// order is created and captured by api/paypal.ts, which holds the secret and
// confirms the purchase in the database. Without that function (local store,
// offline tests, missing settings) the checkout keeps the simulated methods.
import { backend } from './backend';

export { PAID_WITH_PAYPAL } from './backend';

// What each purchase sends to the server; the server decides the amount.
export type PaypalPurchase =
  | { kind: 'coins'; params: { packId: string } }
  | { kind: 'tip'; params: { creatorProfileId: string; amount: number; postId?: string; message?: string } }
  | { kind: 'booking'; params: { bookingId: string } };

export interface PaypalConfig {
  enabled: boolean;
  clientId: string | null;
  env: 'sandbox' | 'live';
}

const DISABLED: PaypalConfig = { enabled: false, clientId: null, env: 'sandbox' };
let configPromise: Promise<PaypalConfig> | null = null;

export const paypalConfig = (): Promise<PaypalConfig> => {
  if (backend.mode !== 'supabase') return Promise.resolve(DISABLED);
  configPromise ??= fetch('/api/paypal', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : DISABLED))
    .then((c: Partial<PaypalConfig>) => (c.enabled && c.clientId ? { enabled: true, clientId: c.clientId, env: c.env === 'live' ? 'live' : 'sandbox' } : DISABLED) as PaypalConfig)
    .catch(() => DISABLED);
  return configPromise;
};

// Minimal typing of the parts of PayPal's SDK we use.
interface PaypalButtons {
  isEligible(): boolean;
  render(el: HTMLElement): Promise<void>;
  close(): Promise<void>;
}
interface PaypalNamespace {
  Buttons(options: {
    style?: Record<string, string | number>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }): PaypalButtons;
}
declare global {
  interface Window {
    paypal?: PaypalNamespace;
  }
}

let sdkPromise: Promise<PaypalNamespace> | null = null;
export const loadPaypalSdk = (clientId: string): Promise<PaypalNamespace> => {
  sdkPromise ??= new Promise<PaypalNamespace>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons&enable-funding=card`;
    s.async = true;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('PayPal no cargó')));
    s.onerror = () => reject(new Error('No se pudo cargar PayPal. Revisa tu conexión.'));
    document.head.appendChild(s);
  }).catch((err) => {
    sdkPromise = null; // let a later checkout try again
    throw err;
  });
  return sdkPromise;
};

const call = async <T>(body: unknown): Promise<T> => {
  const token = await backend.accessToken();
  if (!token) throw new Error('Inicia sesión para pagar.');
  const r = await fetch('/api/paypal', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || 'No se pudo completar el pago con PayPal.');
  return data;
};

export const createPaypalOrder = async (purchase: PaypalPurchase) =>
  (await call<{ orderId: string }>({ action: 'create', kind: purchase.kind, params: purchase.params })).orderId;

// Returns PayPal's operation number for the receipt.
export const capturePaypalOrder = async (orderId: string) =>
  (await call<{ ok: true; captureId?: string | null }>({ action: 'capture', orderId })).captureId || orderId;
