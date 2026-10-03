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
  | { kind: 'booking'; params: { bookingId: string } }
  // Monthly, renewed automatically by PayPal Subscriptions.
  | { kind: 'subscription'; params: { creatorProfileId: string } };

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
    createOrder?: () => Promise<string>;
    createSubscription?: () => Promise<string>;
    onApprove: (data: { orderID?: string; subscriptionID?: string | null }) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }): PaypalButtons;
}
// One-off payments and subscriptions need the SDK loaded with different
// options, so each gets its own copy under its own global name.
const SDK = {
  capture: { namespace: 'paypal', query: 'intent=capture&enable-funding=card' },
  subscription: { namespace: 'paypalSubscriptions', query: 'intent=subscription&vault=true' },
} as const;
export type PaypalSdkMode = keyof typeof SDK;

const sdkPromises: Partial<Record<PaypalSdkMode, Promise<PaypalNamespace>>> = {};
export const loadPaypalSdk = (clientId: string, mode: PaypalSdkMode = 'capture'): Promise<PaypalNamespace> => {
  const { namespace, query } = SDK[mode];
  sdkPromises[mode] ??= new Promise<PaypalNamespace>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&components=buttons&${query}`;
    s.async = true;
    s.dataset.namespace = namespace;
    s.onload = () => {
      const sdk = (window as unknown as Record<string, PaypalNamespace | undefined>)[namespace];
      if (sdk) resolve(sdk);
      else reject(new Error('PayPal no cargó'));
    };
    s.onerror = () => reject(new Error('No se pudo cargar PayPal. Revisa tu conexión.'));
    document.head.appendChild(s);
  }).catch((err) => {
    delete sdkPromises[mode]; // let a later checkout try again
    throw err;
  });
  return sdkPromises[mode]!;
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

export const createPaypalOrder = async (purchase: Exclude<PaypalPurchase, { kind: 'subscription' }>) =>
  (await call<{ orderId: string }>({ action: 'create', kind: purchase.kind, params: purchase.params })).orderId;

// Returns PayPal's operation number for the receipt.
export const capturePaypalOrder = async (orderId: string) =>
  (await call<{ ok: true; captureId?: string | null }>({ action: 'capture', orderId })).captureId || orderId;

export const createPaypalSubscription = async (creatorProfileId: string) =>
  (await call<{ subscriptionId: string }>({ action: 'subscribe', creatorProfileId })).subscriptionId;

// After the fan approves: the server checks PayPal says ACTIVE and gives access.
export const activatePaypalSubscription = async (subscriptionId: string) => {
  await call<{ ok: true }>({ action: 'activate', subscriptionId });
  return subscriptionId;
};
