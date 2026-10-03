// Vercel function: real payments with PayPal Checkout (Créditos, tips and
// Reserve bookings). The browser shows PayPal's buttons; this function creates
// the order for the amount the database quotes and, after the fan approves it,
// captures it and fulfills the purchase. See
// supabase/migrations/20261003000005_paypal_payments.sql for the database side.
//
// Needs in the Vercel project settings: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_ENV ('sandbox' or 'live') and SUPABASE_SERVICE_ROLE_KEY.

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
    api: mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
  };
};

// --- Supabase -----------------------------------------------------------------

const asUser = (token: string) => ({ apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` });
// New secret keys (sb_secret_…) go in apikey only; the legacy service_role key is a JWT.
const asServer = (key: string): Record<string, string> => (key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key });

const supabase = async (path: string, headers: Record<string, string>, body?: unknown) => {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
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
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: (await r.json().catch(() => ({}))) as any };
};

// The completed capture of an order, if any.
const captureOf = (order: any): { id: string; value: number; currency: string } | null => {
  const c = order?.purchase_units?.[0]?.payments?.captures?.find((x: any) => x?.status === 'COMPLETED');
  return c ? { id: String(c.id), value: Number(c.amount?.value), currency: String(c.amount?.currency_code) } : null;
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
// POST /api/paypal {action: 'capture', orderId}     → {ok: true}
export async function POST(request: Request): Promise<Response> {
  const e = env();
  if (!e.clientId || !e.secret || !e.serviceKey) return json(503, { error: 'Los pagos con PayPal aún no están configurados.' });

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Inicia sesión para pagar.' });
  const user = await supabase('/auth/v1/user', asUser(token));
  const userId = user.ok ? (user.data?.id as string | undefined) : undefined;
  if (!userId) return json(401, { error: 'Tu sesión caducó. Vuelve a iniciar sesión.' });

  const body = (await request.json().catch(() => ({}))) as { action?: unknown; kind?: unknown; params?: unknown; orderId?: unknown };
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
      const mine = await supabase(`/rest/v1/paypal_orders?id=eq.${encodeURIComponent(orderId)}&select=status,amount`, asUser(token));
      const row = Array.isArray(mine.data) ? (mine.data[0] as { status: string; amount: number } | undefined) : undefined;
      if (!row) return json(404, { error: 'Pedido no encontrado.' });
      if (row.status === 'completed') return json(200, { ok: true });
      if (row.status !== 'created') return json(409, { error: 'Este pedido ya no está pendiente.' });

      let result = await paypal(e, ppToken, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `capture-${orderId}`);
      // Captured already (a repeated call): read the order instead.
      if (result.status === 422) result = await paypal(e, ppToken, `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
      const capture = captureOf(result.data);
      if (!capture) {
        const declined = result.data?.details?.[0]?.issue === 'INSTRUMENT_DECLINED';
        return json(402, { error: declined ? 'PayPal rechazó el método de pago. Prueba con otro.' : 'PayPal no completó el pago.' });
      }

      const done = await supabase('/rest/v1/rpc/paypal_fulfill', asServer(e.serviceKey), {
        p_order_id: orderId,
        p_user: userId,
        p_capture_id: capture.id,
        p_amount: capture.currency === 'USD' ? capture.value : -1,
      });
      if (done.ok) return json(200, { ok: true });

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

    return json(400, { error: 'Acción no válida.' });
  } catch (err) {
    return json(502, { error: err instanceof Error ? err.message : 'No se pudo conectar con PayPal.' });
  }
}
