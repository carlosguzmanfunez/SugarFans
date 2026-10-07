// Vercel function: real payments with PayPal (Créditos, tips, Reserve bookings
// and monthly subscriptions) and creator withdrawals with PayPal Payouts. The browser shows PayPal's buttons; this function
// creates the order or subscription for the amount the database quotes and,
// after the fan approves it, confirms it with PayPal and fulfills it. PayPal's
// webhook (POST /api/paypal?webhook) reports each subscription renewal,
// cancellation and failed payment. See the migrations
// 20261003000005_paypal_payments.sql, 20261003000006_paypal_subscriptions.sql
// and 20261003000007_paypal_payouts.sql.
//
// Needs in the Vercel project settings: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_ENV ('sandbox' or 'live'), SUPABASE_SERVICE_ROLE_KEY and, for the
// webhook, PAYPAL_WEBHOOK_ID.

// Public values (same as .env.production); the anon key is meant to be public.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';

const KINDS = ['coins', 'tip', 'booking'] as const;
type Kind = (typeof KINDS)[number];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// A value pasted with spaces, a newline or quotes around it breaks the request.
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
const env = () => {
  const mode = clean(process.env.PAYPAL_ENV)?.toLowerCase() === 'live' ? 'live' : 'sandbox';
  return {
    mode,
    clientId: clean(process.env.PAYPAL_CLIENT_ID),
    secret: clean(process.env.PAYPAL_CLIENT_SECRET),
    serviceKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    webhookId: clean(process.env.PAYPAL_WEBHOOK_ID),
    api: mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
  };
};

// --- Supabase -----------------------------------------------------------------

const asUser = (token: string) => ({ apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` });
// New secret keys (sb_secret_…) go in apikey only; the legacy service_role key is a JWT.
const asServer = (key: string): Record<string, string> => (key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key });

const supabase = async (path: string, headers: Record<string, string>, body?: unknown, method?: 'PATCH') => {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
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
  // PostgREST puts a raised exception's text in `message`.
  return { ok: r.ok, data, error: r.ok ? '' : String(data?.message || data?.msg || data?.error || `Error ${r.status}`) };
};

// --- PayPal -------------------------------------------------------------------

const paypalToken = async (e: ReturnType<typeof env>) => {
  const r = await fetch(`${e.api}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${e.clientId}:${e.secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!r.ok || !data.access_token) throw new Error(data.error_description || `PayPal rechazó las credenciales (${r.status})`);
  return data.access_token;
};

const paypal = async (e: ReturnType<typeof env>, token: string, path: string, body?: unknown, requestId?: string) => {
  const r = await fetch(`${e.api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
    },
    // A string is sent as is (the webhook check must carry PayPal's exact event).
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: r.status, data: (await r.json().catch(() => ({}))) as any };
};

// The completed capture of an order, if any.
// `fee` is what PayPal kept for it, when PayPal says so (special accounts deduct it).
const captureOf = (order: any): { id: string; value: number; currency: string; fee: number | null } | null => {
  const c = order?.purchase_units?.[0]?.payments?.captures?.find((x: any) => x?.status === 'COMPLETED');
  const fee = c?.seller_receivable_breakdown?.paypal_fee;
  return c
    ? {
        id: String(c.id),
        value: Number(c.amount?.value),
        currency: String(c.amount?.currency_code),
        fee: fee?.currency_code === 'USD' && Number.isFinite(Number(fee.value)) ? Number(fee.value) : null,
      }
    : null;
};

// --- Subscriptions --------------------------------------------------------------

type Env = ReturnType<typeof env> & { serviceKey: string };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Product and plan ids live in paypal_catalog, per environment.
const catalogGet = async (e: Env, key: string) => {
  const r = await supabase(`/rest/v1/paypal_catalog?key=eq.${encodeURIComponent(key)}&select=paypal_id`, asServer(e.serviceKey));
  return Array.isArray(r.data) && r.data[0]?.paypal_id ? String(r.data[0].paypal_id) : null;
};
// Two checkouts at once may both create one; the first saved wins.
const catalogSave = async (e: Env, key: string, paypalId: string) => {
  await supabase('/rest/v1/paypal_catalog', { ...asServer(e.serviceKey), prefer: 'resolution=ignore-duplicates,return=minimal' }, { key, paypal_id: paypalId });
  return (await catalogGet(e, key)) ?? paypalId;
};

// The monthly plan for a price (one per price, shared by every creator).
const planFor = async (e: Env, token: string, amount: number) => {
  const planKey = `${e.mode}:plan:${amount.toFixed(2)}`;
  const known = await catalogGet(e, planKey);
  if (known) return known;
  let productId = await catalogGet(e, `${e.mode}:product`);
  if (!productId) {
    const product = await paypal(e, token, '/v1/catalogs/products', { name: 'Suscripciones Fans Reserve', type: 'SERVICE', category: 'SOFTWARE' });
    if (product.status >= 300 || !product.data?.id) throw new Error('PayPal no pudo preparar la suscripción. Intenta de nuevo.');
    productId = await catalogSave(e, `${e.mode}:product`, product.data.id);
  }
  const plan = await paypal(e, token, '/v1/billing/plans', {
    product_id: productId,
    name: `Suscripción mensual ${amount.toFixed(2)} USD`,
    billing_cycles: [
      {
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: amount.toFixed(2), currency_code: 'USD' } },
      },
    ],
    // One failed payment suspends it (the fan loses access; no debt builds up).
    payment_preferences: { auto_bill_outstanding: false, payment_failure_threshold: 1 },
  });
  if (plan.status >= 300 || !plan.data?.id) throw new Error('PayPal no pudo preparar la suscripción. Intenta de nuevo.');
  return catalogSave(e, planKey, plan.data.id);
};

const rpc = (e: Env, name: string, body: unknown) => supabase(`/rest/v1/rpc/${name}`, asServer(e.serviceKey), body);

// Records every completed payment of a subscription (idempotent). Returns how many it saw.
const syncPayments = async (e: Env, token: string, subscriptionId: string) => {
  const from = new Date(Date.now() - 400 * 864e5).toISOString();
  const to = new Date(Date.now() + 864e5).toISOString();
  const r = await paypal(e, token, `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/transactions?start_time=${from}&end_time=${to}`);
  const done = ((r.data?.transactions ?? []) as any[]).filter((t) => t?.status === 'COMPLETED' && t?.id);
  for (const t of done) {
    await rpc(e, 'paypal_subscription_payment', { p_id: subscriptionId, p_sale_id: String(t.id), p_amount: Number(t.amount_with_breakdown?.gross_amount?.value) });
  }
  return done.length;
};

// Cancels at PayPal; true when it is cancelled (or already ended) there.
const cancelAtPaypal = async (e: Env, token: string, subscriptionId: string, reason: string) => {
  const r = await paypal(e, token, `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { reason });
  if (r.status < 300) return true;
  const now = await paypal(e, token, `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
  return ['CANCELLED', 'EXPIRED'].includes(now.data?.status);
};

// --- Withdrawals (PayPal Payouts) -------------------------------------------------

// PayPal's state of one payout item → ours ('sending' while PayPal still works on it).
const PAYOUT_DONE = ['SUCCESS'];
const PAYOUT_FAILED = ['FAILED', 'RETURNED', 'BLOCKED', 'DENIED', 'REFUNDED', 'REVERSED', 'CANCELED'];
const payoutStatus = (paypalStatus: string) =>
  PAYOUT_DONE.includes(paypalStatus) ? 'paid' : PAYOUT_FAILED.includes(paypalStatus) ? 'failed' : 'sending';

const markPayout = (e: Env, id: string, status: string, batchId: string | null, itemId: string | null, error: string | null) =>
  rpc(e, 'paypal_payout_mark', { p_id: id, p_status: status, p_batch_id: batchId, p_item_id: itemId, p_error: error });

// Withdraws the creator's whole credited balance to their PayPal account.
const sendPayout = async (e: Env, token: string, userId: string): Promise<Response> => {
  const started = await rpc(e, 'paypal_payout_start', { p_user: userId });
  if (!started.ok) return json(400, { error: started.error });
  const { id, net, fee, email } = started.data as { id: string; net: number; fee: number; email: string };

  const sent = await paypal(e, token, '/v1/payments/payouts', {
    // The withdrawal id as PayPal's batch id: a repeated call can't pay twice.
    sender_batch_header: { sender_batch_id: id, email_subject: 'Recibiste tu retiro de Fans Reserve', email_message: 'Tus ganancias en Fans Reserve ya están en tu cuenta PayPal.' },
    items: [
      {
        recipient_type: 'EMAIL',
        receiver: email,
        amount: { value: Number(net).toFixed(2), currency: 'USD' },
        sender_item_id: id,
        note: 'Retiro de tus ganancias en Fans Reserve',
      },
    ],
  });
  const batchId = sent.data?.batch_header?.payout_batch_id ? String(sent.data.batch_header.payout_batch_id) : null;
  if (sent.status >= 300 || !batchId) {
    const reason = String(sent.data?.name ?? sent.data?.message ?? `Error ${sent.status}`);
    await markPayout(e, id, 'failed', null, null, reason);
    const noFunds = /INSUFFICIENT_FUNDS/.test(reason);
    return json(502, {
      error: noFunds
        ? 'PayPal no pudo enviar el retiro en este momento. Tu saldo sigue disponible; intenta más tarde.'
        : 'PayPal no pudo enviar el retiro. Tu saldo sigue disponible; revisa el email de tu cuenta PayPal e intenta de nuevo.',
    });
  }

  // PayPal usually settles it within seconds; the webhook reports it otherwise.
  let status = 'sending';
  let itemId: string | null = null;
  let error: string | null = null;
  for (let i = 0; i < 3 && status === 'sending'; i++) {
    await pause(1500);
    const batch = await paypal(e, token, `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
    const item = batch.data?.items?.[0];
    if (!item) continue;
    itemId = item.payout_item_id ? String(item.payout_item_id) : null;
    status = payoutStatus(String(item.transaction_status ?? ''));
    error = item.errors?.name ? String(item.errors.name) : null;
    if (String(item.transaction_status) === 'UNCLAIMED') break; // waits for the creator to open a PayPal account
  }
  await markPayout(e, id, status, batchId, itemId, error);
  if (status === 'failed') {
    return json(502, { error: 'PayPal no pudo entregar el retiro. Tu saldo sigue disponible; revisa el email de tu cuenta PayPal.' });
  }
  return json(200, { ok: true, status, net, fee });
};

// Asks PayPal again about the creator's withdrawals still 'sending' (in case a webhook
// never arrived) and returns PayPal's own state of each one.
const checkPayouts = async (e: Env, token: string, userId: string): Promise<Response> => {
  const mine = await supabase(
    `/rest/v1/payouts?user_id=eq.${encodeURIComponent(userId)}&status=eq.sending&paypal_batch_id=not.is.null&select=id,paypal_batch_id`,
    asServer(e.serviceKey)
  );
  const rows = Array.isArray(mine.data) ? (mine.data as { id: string; paypal_batch_id: string }[]) : [];
  const items: { id: string; status: string; paypalStatus: string }[] = [];
  for (const row of rows) {
    const batch = await paypal(e, token, `/v1/payments/payouts/${encodeURIComponent(row.paypal_batch_id)}`);
    const item = batch.data?.items?.[0];
    const paypalStatus = String(item?.transaction_status ?? batch.data?.batch_header?.batch_status ?? 'UNKNOWN');
    const status = item ? payoutStatus(paypalStatus) : 'sending';
    await markPayout(e, row.id, status, row.paypal_batch_id, item?.payout_item_id ? String(item.payout_item_id) : null,
      item?.errors?.name ? String(item.errors.name) : status === 'failed' ? paypalStatus : null);
    items.push({ id: row.id, status, paypalStatus });
  }
  return json(200, { items });
};

// Cancels a withdrawal PayPal holds as UNCLAIMED (no PayPal account has that email, or it can't receive):
// PayPal takes the money back and it returns to the creator's balance.
const cancelPayout = async (e: Env, token: string, userId: string, payoutId: string): Promise<Response> => {
  const mine = await supabase(
    `/rest/v1/payouts?id=eq.${encodeURIComponent(payoutId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.sending&select=id,paypal_batch_id,paypal_item_id`,
    asServer(e.serviceKey)
  );
  const row = Array.isArray(mine.data) ? (mine.data[0] as { id: string; paypal_batch_id: string | null; paypal_item_id: string | null } | undefined) : undefined;
  if (!row?.paypal_item_id) return json(404, { error: 'Este retiro ya no se puede cancelar.' });
  const r = await paypal(e, token, `/v1/payments/payouts-item/${encodeURIComponent(row.paypal_item_id)}/cancel`, {});
  const state = String(r.data?.transaction_status ?? '');
  if (r.status >= 300 || payoutStatus(state) !== 'failed') {
    return json(409, { error: 'PayPal ya no permite cancelar este retiro (solo se cancelan los que nadie ha recibido).' });
  }
  await markPayout(e, row.id, 'failed', row.paypal_batch_id, row.paypal_item_id, 'Cancelado por el creador: PayPal no pudo entregarlo');
  return json(200, { ok: true });
};

// POST /api/paypal?webhook: PayPal's notifications, checked with PayPal itself.
const webhook = async (request: Request, e: Env): Promise<Response> => {
  if (!e.webhookId) return json(503, { error: 'Falta PAYPAL_WEBHOOK_ID' });
  const raw = await request.text();
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Evento no válido' });
  }
  const h = (name: string) => JSON.stringify(request.headers.get(name) ?? '');
  const token = await paypalToken(e);
  const check = await paypal(
    e,
    token,
    '/v1/notifications/verify-webhook-signature',
    `{"auth_algo":${h('paypal-auth-algo')},"cert_url":${h('paypal-cert-url')},"transmission_id":${h('paypal-transmission-id')},` +
      `"transmission_sig":${h('paypal-transmission-sig')},"transmission_time":${h('paypal-transmission-time')},` +
      `"webhook_id":${JSON.stringify(e.webhookId)},"webhook_event":${raw}}`,
  );
  if (check.data?.verification_status !== 'SUCCESS') return json(401, { error: 'Firma no válida' });

  const type = String(event?.event_type ?? '');
  const res = event?.resource ?? {};
  // A failed write answers 500 so PayPal retries the notification later.
  const must = <T extends { ok: boolean; error: string }>(r: T) => {
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  if (type === 'PAYMENT.SALE.COMPLETED' && res.billing_agreement_id) {
    const subId = String(res.billing_agreement_id);
    // The payment can arrive before the fan's browser confirmed the subscription.
    await rpc(e, 'paypal_subscription_activate', { p_id: subId });
    const payment = await rpc(e, 'paypal_subscription_payment', { p_id: subId, p_sale_id: String(res.id), p_amount: Number(res.amount?.total) });
    // A demo profile nobody owns takes no money (it can't serve the fan or withdraw):
    // treated like a subscription that no longer exists.
    const saved = !payment.ok && /de demostración/.test(payment.error) ? { ...payment, data: 'orphan' } : must(payment);
    if (saved.data === 'orphan') {
      // It no longer gives access here (deleted account or subscription): stop it and give the money back.
      await cancelAtPaypal(e, token, subId, 'La suscripción ya no existe en Fans Reserve');
      await paypal(e, token, `/v1/payments/sale/${encodeURIComponent(String(res.id))}/refund`, {}, `refund-${res.id}`);
    }
  } else if (type === 'BILLING.SUBSCRIPTION.ACTIVATED' && res.id) {
    await rpc(e, 'paypal_subscription_activate', { p_id: String(res.id) });
  } else if ((type === 'BILLING.SUBSCRIPTION.CANCELLED' || type === 'BILLING.SUBSCRIPTION.EXPIRED') && res.id) {
    must(await rpc(e, 'paypal_subscription_ended', { p_id: String(res.id), p_now: false }));
  } else if (type === 'BILLING.SUBSCRIPTION.SUSPENDED' && res.id) {
    must(await rpc(e, 'paypal_subscription_ended', { p_id: String(res.id), p_now: true }));
  } else if (type.startsWith('PAYMENT.PAYOUTS-ITEM.') && res.payout_item?.sender_item_id) {
    const status = payoutStatus(String(res.transaction_status ?? ''));
    if (status !== 'sending') {
      must(await markPayout(e, String(res.payout_item.sender_item_id), status, res.payout_batch_id ? String(res.payout_batch_id) : null,
        res.payout_item_id ? String(res.payout_item_id) : null, res.errors?.name ? String(res.errors.name) : status === 'failed' ? type : null));
    }
  }
  return json(200, { ok: true });
};

// --- Handlers -----------------------------------------------------------------

// GET /api/paypal: what the browser needs to show the buttons (the client id is
// public), plus a check of the settings that never reveals a secret.
export async function GET(): Promise<Response> {
  const e = env();
  const enabled = !!(e.clientId && e.secret && e.serviceKey);
  let paypalCheck = 'sin comprobar';
  if (e.clientId && e.secret) {
    try {
      await paypalToken(e);
      paypalCheck = 'OK: PayPal acepta el Client ID y el Secret';
    } catch (err) {
      paypalCheck = `RECHAZADO: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200);
    }
  }
  return json(200, {
    enabled,
    clientId: enabled ? e.clientId : null,
    env: e.mode,
    checks: {
      clientId: e.clientId ? `${e.clientId.slice(0, 4)}…${e.clientId.slice(-4)} (${e.clientId.length} caracteres)` : 'FALTA',
      secret: e.secret ? `${e.secret.length} caracteres` : 'FALTA',
      serviceRoleKey: e.serviceKey ? `${e.serviceKey.length} caracteres` : 'FALTA',
      paypal: paypalCheck,
    },
  });
}

// POST /api/paypal {action: 'create', kind, params} → {orderId}
// POST /api/paypal {action: 'capture', orderId}     → {ok: true, captureId}
// POST /api/paypal {action: 'subscribe', creatorProfileId}  → {subscriptionId}
// POST /api/paypal {action: 'activate', subscriptionId}     → {ok: true}
// POST /api/paypal {action: 'cancel-subscription', creatorProfileId} → {ok: true, until}
// POST /api/paypal {action: 'payout'} → {ok: true, status, net, fee} (creator withdrawal)
// POST /api/paypal {action: 'payout-check'} → {items: [{id, status, paypalStatus}]}
// POST /api/paypal {action: 'payout-cancel', payoutId} → {ok: true} (only UNCLAIMED withdrawals)
// POST /api/paypal?webhook (from PayPal)
export async function POST(request: Request): Promise<Response> {
  const base = env();
  if (!base.clientId || !base.secret || !base.serviceKey) return json(503, { error: 'Los pagos con PayPal aún no están configurados.' });
  const e = base as Env;

  if (new URL(request.url).searchParams.has('webhook')) {
    try {
      return await webhook(request, e);
    } catch (err) {
      return json(500, { error: err instanceof Error ? err.message : 'Error' });
    }
  }

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Inicia sesión para pagar.' });
  const user = await supabase('/auth/v1/user', asUser(token));
  const userId = user.ok ? (user.data?.id as string | undefined) : undefined;
  if (!userId) return json(401, { error: 'Tu sesión caducó. Vuelve a iniciar sesión.' });

  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    kind?: unknown;
    params?: unknown;
    orderId?: unknown;
    subscriptionId?: unknown;
    creatorProfileId?: unknown;
    payoutId?: unknown;
  };
  try {
    const ppToken = await paypalToken(e);

    if (body.action === 'create') {
      const kind = body.kind as Kind;
      if (!KINDS.includes(kind)) return json(400, { error: 'Este pago todavía no se hace con PayPal.' });
      const params = body.params && typeof body.params === 'object' ? (body.params as Record<string, unknown>) : {};
      // The database decides the amount, with the same rules as the purchase itself.
      const quote = await supabase('/rest/v1/rpc/paypal_quote', asUser(token), { p_kind: kind, p_params: params });
      if (!quote.ok) return json(400, { error: quote.error });
      const amount = Number(quote.data?.amount);
      if (!(amount > 0)) return json(400, { error: 'No se pudo calcular el monto.' });

      const order = await paypal(e, ppToken, '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: amount.toFixed(2) },
            description: String(quote.data?.description ?? 'Fans Reserve').slice(0, 127),
            custom_id: `${kind}:${userId}`.slice(0, 127),
          },
        ],
        // Not payment_source: that would hide the card button of the JS SDK.
        application_context: { brand_name: 'Fans Reserve', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
      });
      if (order.status >= 300 || !order.data?.id) return json(502, { error: 'PayPal no pudo crear el pedido. Intenta de nuevo.' });

      const saved = await supabase('/rest/v1/rpc/paypal_register', asServer(e.serviceKey), {
        p_order_id: order.data.id,
        p_user: userId,
        p_kind: kind,
        p_params: params,
        p_amount: amount,
      });
      if (!saved.ok) return json(500, { error: 'No se pudo registrar el pedido. Intenta de nuevo.' });
      return json(200, { orderId: order.data.id });
    }

    if (body.action === 'capture') {
      const orderId = typeof body.orderId === 'string' ? body.orderId.slice(0, 64) : '';
      if (!orderId) return json(400, { error: 'Falta el pedido.' });
      const mine = await supabase(`/rest/v1/paypal_orders?id=eq.${encodeURIComponent(orderId)}&select=status,amount,capture_id`, asUser(token));
      const row = Array.isArray(mine.data) ? (mine.data[0] as { status: string; amount: number; capture_id: string | null } | undefined) : undefined;
      if (!row) return json(404, { error: 'Pedido no encontrado.' });
      if (row.status === 'completed') return json(200, { ok: true, captureId: row.capture_id });
      if (row.status !== 'created') return json(409, { error: 'Este pedido ya no está pendiente.' });

      let result = await paypal(e, ppToken, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `capture-${orderId}`);
      // Captured already (a repeated call): read the order instead.
      if (result.status === 422) result = await paypal(e, ppToken, `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
      const capture = captureOf(result.data);
      if (!capture) {
        const declined = result.data?.details?.[0]?.issue === 'INSTRUMENT_DECLINED';
        return json(402, { error: declined ? 'PayPal rechazó el método de pago. Prueba con otro.' : 'PayPal no completó el pago.' });
      }

      // Saved first: a special account's Reserve payment deducts it (see set_special_share).
      if (capture.fee !== null) {
        await supabase(`/rest/v1/paypal_orders?id=eq.${encodeURIComponent(orderId)}&status=eq.created`, asServer(e.serviceKey), { fee: capture.fee }, 'PATCH');
      }
      const done = await supabase('/rest/v1/rpc/paypal_fulfill', asServer(e.serviceKey), {
        p_order_id: orderId,
        p_user: userId,
        p_capture_id: capture.id,
        p_amount: capture.currency === 'USD' ? capture.value : -1,
      });
      if (done.ok) return json(200, { ok: true, captureId: capture.id });

      // Charged but not fulfilled (e.g. the booking was cancelled meanwhile): give the money back.
      const refund = await paypal(e, ppToken, `/v2/payments/captures/${encodeURIComponent(capture.id)}/refund`, {}, `refund-${capture.id}`);
      const refunded = refund.status < 300;
      await supabase('/rest/v1/rpc/paypal_mark', asServer(e.serviceKey), {
        p_order_id: orderId,
        p_status: refunded ? 'refunded' : 'failed',
        p_capture_id: capture.id,
        p_error: done.error,
      });
      return json(409, {
        error: refunded
          ? `${done.error}. Te devolvimos el pago en PayPal.`
          : `${done.error}. No pudimos devolver el pago automáticamente; escríbenos y lo resolvemos.`,
      });
    }

    if (body.action === 'subscribe') {
      const creator = typeof body.creatorProfileId === 'string' ? body.creatorProfileId.slice(0, 64) : '';
      if (!creator) return json(400, { error: 'Falta el perfil.' });
      const quote = await supabase('/rest/v1/rpc/paypal_subscription_quote', asUser(token), { p_creator_profile_id: creator });
      if (!quote.ok) return json(400, { error: quote.error });
      const amount = Number(quote.data?.amount);
      if (!(amount > 0)) return json(400, { error: 'No se pudo calcular el monto.' });
      const startTime = typeof quote.data?.startTime === 'string' ? new Date(quote.data.startTime).toISOString() : null;
      const planId = await planFor(e, ppToken, amount);

      const sub = await paypal(e, ppToken, '/v1/billing/subscriptions', {
        plan_id: planId,
        custom_id: `${userId}:${creator}`.slice(0, 127),
        ...(startTime ? { start_time: startTime } : {}),
        application_context: { brand_name: 'Fans Reserve', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW' },
      });
      if (sub.status >= 300 || !sub.data?.id) return json(502, { error: 'PayPal no pudo crear la suscripción. Intenta de nuevo.' });
      const saved = await rpc(e, 'paypal_subscription_register', {
        p_id: sub.data.id,
        p_user: userId,
        p_creator_profile_id: creator,
        p_amount: amount,
        p_starts_at: startTime,
      });
      if (!saved.ok) return json(500, { error: 'No se pudo registrar la suscripción. Intenta de nuevo.' });
      return json(200, { subscriptionId: sub.data.id });
    }

    if (body.action === 'activate') {
      const subId = typeof body.subscriptionId === 'string' ? body.subscriptionId.slice(0, 64) : '';
      if (!subId) return json(400, { error: 'Falta la suscripción.' });
      const mine = await supabase(`/rest/v1/paypal_subscriptions?id=eq.${encodeURIComponent(subId)}&select=status,creator_id,starts_at`, asUser(token));
      const row = Array.isArray(mine.data) ? (mine.data[0] as { status: string; creator_id: string; starts_at: string | null } | undefined) : undefined;
      if (!row) return json(404, { error: 'Suscripción no encontrada.' });
      if (row.status === 'ended') return json(409, { error: 'Esta suscripción ya terminó.' });

      // Right after approval PayPal may still be switching it to ACTIVE.
      let sub = await paypal(e, ppToken, `/v1/billing/subscriptions/${encodeURIComponent(subId)}`);
      for (let i = 0; i < 3 && ['APPROVAL_PENDING', 'APPROVED'].includes(sub.data?.status); i++) {
        await pause(1500);
        sub = await paypal(e, ppToken, `/v1/billing/subscriptions/${encodeURIComponent(subId)}`);
      }
      if (sub.data?.status !== 'ACTIVE') return json(402, { error: 'PayPal no activó la suscripción. No se te cobró nada.' });
      if (sub.data?.custom_id !== `${userId}:${row.creator_id}`) return json(409, { error: 'La suscripción no corresponde a esta cuenta.' });

      const active = await rpc(e, 'paypal_subscription_activate', { p_id: subId });
      if (!active.ok) return json(500, { error: 'PayPal activó la suscripción, pero no pudimos guardarla. Escríbenos y lo resolvemos.' });
      // The first payment usually completes within seconds; the webhook records it otherwise.
      if (!row.starts_at) {
        for (let i = 0; i < 3 && (await syncPayments(e, ppToken, subId)) === 0; i++) await pause(1500);
      }
      return json(200, { ok: true, subscriptionId: subId });
    }

    if (body.action === 'cancel-subscription') {
      const creator = typeof body.creatorProfileId === 'string' ? body.creatorProfileId.slice(0, 64) : '';
      const mine = await supabase(`/rest/v1/subscriptions?creator_id=eq.${encodeURIComponent(creator)}&select=paypal_subscription_id`, asUser(token));
      const subId = Array.isArray(mine.data) ? (mine.data[0]?.paypal_subscription_id as string | null | undefined) : undefined;
      if (!subId) return json(404, { error: 'No tienes una suscripción con PayPal a este perfil.' });
      // PayPal first: the fan must never be charged for a subscription shown as cancelled.
      if (!(await cancelAtPaypal(e, ppToken, subId, 'Cancelada por el fan en Fans Reserve'))) {
        return json(502, { error: 'PayPal no pudo cancelar la suscripción. Intenta de nuevo.' });
      }
      const ended = await rpc(e, 'paypal_subscription_ended', { p_id: subId, p_now: false });
      if (!ended.ok) return json(500, { error: 'Se canceló en PayPal, pero no pudimos actualizarla aquí. Recarga la página.' });
      return json(200, { ok: true, until: ended.data });
    }

    if (body.action === 'payout') return await sendPayout(e, ppToken, userId);
    if (body.action === 'payout-check') return await checkPayouts(e, ppToken, userId);
    if (body.action === 'payout-cancel') {
      const payoutId = typeof body.payoutId === 'string' ? body.payoutId.slice(0, 64) : '';
      return await cancelPayout(e, ppToken, userId, payoutId);
    }

    return json(400, { error: 'Acción no válida.' });
  } catch (err) {
    return json(502, { error: err instanceof Error ? err.message : 'No se pudo conectar con PayPal.' });
  }
}
