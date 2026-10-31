// Vercel function: real payments with PayPal (Créditos, tips, Reserve bookings
// and monthly subscriptions) and creator withdrawals with PayPal Payouts. The browser shows PayPal's buttons; this function
// creates the order or subscription for the amount the database quotes and,
// after the fan approves it, confirms it with PayPal and fulfills it. PayPal's
// webhook (POST /api/paypal?webhook) reports each subscription renewal,
// cancellation and failed payment, and every refund, chargeback and dispute.
// Nobody pays their own creator account. See the migrations
// 20261003000005_paypal_payments.sql, 20261003000006_paypal_subscriptions.sql,
// 20261003000007_paypal_payouts.sql and 20261010000001_refunds_disputes_self_pay.sql.
//
// Needs in the Vercel project settings: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_ENV ('sandbox' or 'live'), SUPABASE_SERVICE_ROLE_KEY and, for the
// webhook, PAYPAL_WEBHOOK_ID. RESEND_API_KEY sends the booking confirmation
// email right after a Reserve payment (see api/_mail.ts).

import { deliverOutbox, logServerError, resendKey } from './_mail.js';
import type {PayoutProviderControl} from './_payout-provider.js';
import {createIncomeProcessor,incomingType} from './_income-events.js';

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

const supabase = async (path: string, headers: Record<string, string>, body?: unknown, method?: 'PATCH',timeoutMs?:number) => {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: timeoutMs?AbortSignal.timeout(timeoutMs):undefined,
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

const paypalAccess = async (e: ReturnType<typeof env>&{payoutControl?:PayoutProviderControl},timeoutMs?:number) => {
  await e.payoutControl?.before();
  let r:Response;
  try{r = await fetch(`${e.api}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${e.clientId}:${e.secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: e.payoutControl||timeoutMs?AbortSignal.timeout(timeoutMs??10000):undefined,
  });}catch(error){e.payoutControl?.unavailable();throw error;}
  e.payoutControl?.observe(r);
  const data = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string;expires_in?:number };
  if (!r.ok || !data.access_token) throw new Error(data.error_description || `PayPal rechazó las credenciales (${r.status})`);
  const ttl=typeof data.expires_in==='number'&&Number.isFinite(data.expires_in)&&data.expires_in>0?data.expires_in:60;
  return {token:data.access_token,until:(e.payoutControl?.clock.now()??Date.now())+Math.max(0,ttl*1000-5000)};
};
const paypalToken=async(e:ReturnType<typeof env>)=>(await paypalAccess(e)).token;

// Cost-only historical lookup: fixed GETs, no checkout fulfillment or payment action.
export async function queryCollectionCost(kind:unknown,source:unknown,key:unknown,userToken:string){
 if(!['coins','sale'].includes(String(kind))||typeof source!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).test(source)||typeof key!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).test(key))throw Error('Elige un cobro válido');
 const e=env();if(!e.serviceKey||!e.clientId||!e.secret)throw Error('Falta configurar la consulta de PayPal');
 const context=await supabase('/rest/v1/rpc/finance_collection_context',asUser(userToken),{p_kind:kind,p_id:source},undefined,10000);
 if(!context.ok)throw Error(context.error);const c=context.data;
 if(c.issue)return c;
 const id=(v:unknown)=>{if(typeof v!=='string'||!/^[A-Za-z0-9-]{1,255}$/.test(v))throw Error('Falta una referencia original válida');return v;};
 const token=(await paypalAccess(e,10000)).token,get=async(path:string)=>{const r=await paypal(e,token,path,undefined,undefined,10000);if(r.status!==200)throw Error('No pudimos consultar el comprobante original de PayPal');return r.data;};
 const proof:any={resource:await get(c.receipt_kind==='sale'?`/v1/payments/sale/${id(c.reference)}`:`/v2/payments/captures/${id(c.reference)}`)};
 if(c.receipt_kind==='capture')proof.order=await get(`/v2/checkout/orders/${id(c.order)}`);
 else{
  proof.subscription=await get(`/v1/billing/subscriptions/${id(c.subscription)}`);
  if(!proof.resource.billing_agreement_id||!proof.resource.transaction_fee){const at=Date.parse(proof.resource.create_time);if(!Number.isFinite(at))throw Error('El cobro no tiene una fecha comprobable');
   proof.subscription_transactions=await get(`/v1/billing/subscriptions/${id(c.subscription)}/transactions?start_time=${new Date(at-86400000).toISOString()}&end_time=${new Date(at+86400000).toISOString()}`);}
 }
 const saved=await supabase('/rest/v1/rpc/paypal_collection_cost_store',asServer(e.serviceKey),{p_kind:kind,p_id:source,p_key:key,p_expected:c.hash,p_environment:e.mode,p_sender:e.clientId,p_proof:proof},undefined,12000);
 if(!saved.ok)throw Error(saved.error);return saved.data;
}

const paypal = async (e: ReturnType<typeof env>&{payoutControl?:PayoutProviderControl}, token: string, path: string, body?: unknown, requestId?: string, timeoutMs?: number) => {
  await e.payoutControl?.before();
  let r:Response;
  try{r = await fetch(`${e.api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
    },
    // A string is sent as is (the webhook check must carry PayPal's exact event).
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });}catch(error){e.payoutControl?.unavailable();throw error;}
  e.payoutControl?.observe(r);
  return { status: r.status, data: (await r.json().catch(() => ({}))) as any };
};

// The completed capture of an order, if any.
// The canonical capture and its cost are queried and checked after this lookup.
const captureOf = (order: any): { id: string } | null => {
  const c = order?.purchase_units?.[0]?.payments?.captures?.find((x: any) => x?.status === 'COMPLETED');
  return c && typeof c.id==='string' && /^[A-Za-z0-9-]{1,255}$/.test(c.id) ? {id:c.id} : null;
};

// --- Subscriptions --------------------------------------------------------------

type Env = ReturnType<typeof env> & { serviceKey: string;payoutControl?:PayoutProviderControl };
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

// The database's refusal for a demo profile without an owner or a creator an admin
// suspended (assert_creator_accepts_payments).
const DEMO_REFUSAL = /perfil es de demostración|creador no está disponible/;
// Paying one's own creator account from a fan account (guard_self_payment).
const SELF_PAY = 'No puedes pagarte a ti mismo: esta cuenta y la del creador son de la misma persona.';
const SELF_REFUSAL = /No puedes pagarte a ti mismo/;
// Valentina ('1') is the demo creator@ account and shows "Perfil de ejemplo": it has an
// owner, so the database accepts payments to it (Preview tests pay it in sandbox), but
// with real money (PAYPAL_ENV=live) nobody can pay it.
const EXAMPLE_PROFILES = new Set(['1']);
const EXAMPLE_PAY = 'Este es un perfil de ejemplo: no acepta pagos.';
const examplePaid = async (e: Env, userToken: string, kind: string, params: Record<string, unknown>) => {
  if (e.mode !== 'live') return false;
  let creator = typeof params.creatorProfileId === 'string' ? params.creatorProfileId : '';
  if (kind === 'booking' && typeof params.bookingId === 'string') {
    const r = await supabase(`/rest/v1/vip_bookings?id=eq.${encodeURIComponent(params.bookingId)}&select=creator_profile_id`, asUser(userToken));
    creator = Array.isArray(r.data) ? String((r.data[0] as { creator_profile_id?: string } | undefined)?.creator_profile_id ?? '') : '';
  }
  return EXAMPLE_PROFILES.has(creator);
};

const rpc = (e: Env, name: string, body: unknown) => supabase(`/rest/v1/rpc/${name}`, asServer(e.serviceKey), body,undefined,e.payoutControl?12000:undefined);

// True when this fan account and the creator being paid are the same person (paypal_self_pay):
// the same account, phone or verified identity, or a PayPal email the creator signs in or withdraws with.
const paysSelf = async (e: Env, userId: string, kind: string, params: unknown, payerEmail?: unknown) => {
  const r = await rpc(e, 'paypal_self_pay', {
    p_user: userId,
    p_kind: kind,
    p_params: params ?? {},
    p_payer_email: typeof payerEmail === 'string' ? payerEmail : null,
  });
  return r.ok && r.data === true;
};

// Durable incoming reconciliation, independent of the outgoing payout worker.
const incomeProcessor=(e:Env,token:string)=>createIncomeProcessor({mode:e.mode,sender:e.clientId!,
  rpc:async(name,args)=>{const r=await rpc(e,name,args);if(!r.ok)throw Error(r.error);return r.data;},
  get:path=>paypal(e,token,path,undefined,undefined,8000),post:(path,body,key)=>paypal(e,token,path,body,key,8000),refund:(event,deadline)=>refundWebhook(e,token,event,deadline)});
export async function recoverIncomingEvents(){
  const e=env();if(!e.clientId||!e.secret||!e.serviceKey)throw Error('Falta la conexión de PayPal');
  return incomeProcessor(e as Env,await paypalToken(e)).recover();
}

// Refund amounts come from a canonical provider query, never from an event link.
// Save the signed notification before HTTP/SQL application so a failed attempt
// can be repeated without losing the notification or applying the refund twice.
const refundWebhook = async (e: Env, token: string, event: any, deadline=Date.now()+45000): Promise<Response> => {
  const query=(path:string,body?:unknown)=>{const remaining=deadline-Date.now();if(remaining<=0)throw Error('REFUND_QUERY_BUDGET_REACHED');return paypal(e,token,path,body,undefined,Math.min(8000,remaining));};
  const saved = await rpc(e, 'paypal_refund_receive', { p_environment: e.mode, p_sender: e.clientId, p_event: event });
  if (!saved.ok) throw new Error(saved.error);
  const receipt = saved.data;
  if (receipt.state === 'review') return json(200, { ok: true, review: true });
  let result = receipt.result;
  if (receipt.state !== 'applied') {
    const capture = event.event_type === 'PAYMENT.CAPTURE.REFUNDED';
    const id = String(event.resource?.id ?? '');
    if (!/^[A-Za-z0-9-]{1,255}$/.test(id)) return json(503, { error: 'Aviso guardado; referencia de devolución por revisar' });
    const refund = await query(capture ? `/v2/payments/refunds/${encodeURIComponent(id)}` : `/v1/payments/refund/${encodeURIComponent(id)}`);
    if (refund.status !== 200) return json(503, { error: 'Aviso guardado; comprobante de devolución pendiente' });
    let ref = capture ? '' : String(refund.data?.sale_id ?? '');
    if (capture) {
      const up = (refund.data?.links ?? []).find((link: any) => link.rel === 'up')?.href;
      try {
        const url = new URL(up);
        const hosts = e.mode === 'live' ? ['api-m.paypal.com', 'api.paypal.com'] : ['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com'];
        if (url.protocol === 'https:' && hosts.includes(url.hostname) && !url.port && !url.search && !url.hash)
          ref = url.pathname.match(/^\/v2\/payments\/captures\/([A-Za-z0-9-]+)$/)?.[1] ?? '';
      } catch { /* The saved event remains pending; no untrusted URL is fetched. */ }
    }
    if (!/^[A-Za-z0-9-]{1,255}$/.test(ref)) return json(503, { error: 'Aviso guardado; falta vincular el cobro original' });
    const payment = await query(capture ? `/v2/payments/captures/${encodeURIComponent(ref)}` : `/v1/payments/sale/${encodeURIComponent(ref)}`);
    if (payment.status !== 200) return json(503, { error: 'Aviso guardado; consulta del cobro pendiente' });
    const applied = await rpc(e, 'paypal_refund_apply', { p_id: receipt.id, p_ref: ref, p_refund: refund.data, p_payment: payment.data });
    if (!applied.ok) throw new Error(applied.error);
    result = applied.data;
    if (result.state === 'pending') return json(503, { error: 'Aviso guardado; conciliación pendiente' });
    if (result.state === 'review') return json(200, { ok: true, review: true });
  }
  // A partial subscription refund leaves access intact. On a full refund, a lost
  // cancellation acknowledgement is safely retried even after SQL was committed.
  if (typeof result?.subscription === 'string' && result.subscription){
    const path=`/v1/billing/subscriptions/${encodeURIComponent(result.subscription)}`;
    let stopped=await query(path);
    if(stopped.status!==200)return json(503,{error:'Devolución registrada; consulta de suscripción pendiente'});
    if(!['CANCELLED','EXPIRED'].includes(stopped.data?.status)){
      await query(path+'/cancel',{reason:'Pago reembolsado en PayPal'});
      stopped=await query(path);
    }
    if(stopped.status!==200||!['CANCELLED','EXPIRED'].includes(stopped.data?.status))return json(503,{error:'Devolución registrada; cancelación de suscripción pendiente'});
    const confirmed=await rpc(e,'paypal_refund_followup',{p_id:receipt.id,p_resource:stopped.data});if(!confirmed.ok)throw Error(confirmed.error);
  }
  return json(200, { ok: true });
};

// Records every completed payment of a subscription (idempotent). Returns how many it saw.
const syncPayments = async (e: Env, token: string, subscriptionId: string) => {
  const from = new Date(Date.now() - 400 * 864e5).toISOString();
  const to = new Date(Date.now() + 864e5).toISOString();
  const r = await paypal(e, token, `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/transactions?start_time=${from}&end_time=${to}`);
  if(r.status!==200)throw Error('PayPal todavía no confirmó el historial de cobros de la suscripción');
  const done = ((r.data?.transactions ?? []) as any[]).filter((t) => t?.status === 'COMPLETED' && t?.id);
  for (const t of done) {
    const recorded=await incomeProcessor(e,token).query({id:`provider-query/sale/${String(t.id)}`,event_type:'PAYMENT.SALE.COMPLETED',resource:{id:String(t.id),billing_agreement_id:subscriptionId}});
    if(recorded.state!=='applied')throw Error('El cobro quedó guardado y falta comprobar su resultado o lo que descontó PayPal. No repitas el pago.');
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

type PayoutClaim = {
  operation: 'submit' | 'check' | 'wait' | 'review' | 'done';
  token?: string;
  batch?: string;
  payload?: { sender_batch_header: { sender_batch_id: string }; items: { receiver: string; amount: { value: string; currency: string }; sender_item_id: string }[] };
  net?: number;
  fee?: number;
  status?: 'sending' | 'paid' | 'failed';
};
const validBatchId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const pendingPayout = (paypalStatus = 'SUBMISSION_UNCERTAIN') => ({ status: 'sending' as const, paypalStatus });
const PAYOUT_TIMEOUT_MS = 10000;

// Never follow arbitrary URLs from an error body with a bearer token. Extract
// only a batch ID from this environment's own resource path. PayPal responses
// may name api.* even when the request used api-m.*; all queries still use e.api.
const duplicateBatch = (e: Env, data: any): string | null => {
  const duplicate = data?.name === 'DUPLICATE_BATCH_ID';
  const details = (Array.isArray(data?.details) ? data.details : []).filter((detail: any) =>
    duplicate || detail?.issue === 'DUPLICATE_BATCH_ID'
    // Payouts v1 also returns this issue with its original-batch link nested
    // under details[].link. A generic USER_BUSINESS_ERROR is not enough.
    || (data?.name === 'USER_BUSINESS_ERROR' && detail?.field === 'SENDER_BATCH_ID'
      && detail?.issue === 'Batch with given sender_batch_id already exists'));
  if (!duplicate && details.length === 0) return null;
  const origins = e.mode === 'live'
    ? ['https://api-m.paypal.com', 'https://api.paypal.com']
    : ['https://api-m.sandbox.paypal.com', 'https://api.sandbox.paypal.com'];
  const links = [
    ...(Array.isArray(data?.links) ? data.links : []),
    ...details.flatMap((detail: any) => Array.isArray(detail?.link) ? detail.link : []),
  ];
  const batches = new Set<string>();
  for (const link of links) {
    if (typeof link?.href !== 'string' || (link.method !== undefined && link.method !== 'GET')) continue;
    try {
      const url = new URL(link.href);
      const match = url.pathname.match(/^\/v1\/payments\/payouts\/([A-Za-z0-9_-]{1,128})$/);
      if (origins.includes(url.origin) && !url.username && !url.password && match) batches.add(match[1]);
    } catch { /* an invalid recovery link cannot authorize a new payment */ }
  }
  // Conflicting original-batch references require review; never pick one by order.
  return batches.size === 1 ? [...batches][0] : null;
};

const batchMatches = (batch: any, id: string, batchId: string) =>
  batch?.batch_header?.sender_batch_header?.sender_batch_id === id
  && batch?.batch_header?.payout_batch_id === batchId;

// Persist the query before HTTP, then commit its complete evidence and the
// guarded state transition together. A newer query fences any late response.
const reconcilePayout = async (e: Env, token: string, id: string, userId: string | null,
  eventId: string | null = null, source: 'poll' | 'webhook' | 'cancel' = 'poll', cancelItem?: string) => {
  const begun = await rpc(e, 'paypal_payout_reconcile_begin', {
    p_id: id, p_user: userId, p_environment: e.mode, p_sender: e.clientId, p_event: eventId, p_source: source,
  });
  if (!begun.ok) throw new Error(begun.error);
  const c = begun.data as { operation: string; query?: string; batch?: string; status: string; reason?: string };
  if (c.operation !== 'query') {
    if (c.operation === 'review') await logServerError(e.serviceKey,'api','Retiro PayPal requiere revisión',`${id}: ${c.reason ?? 'MANUAL_REVIEW'}`);
    return { status: c.status, paypalStatus: c.operation === 'review' ? 'MANUAL_REVIEW' : 'RECONCILED', retry: false };
  }
  if (!c.query || !validBatchId(c.batch)) throw new Error('Referencia de conciliación no válida');
  let cancellation: unknown;
  if (cancelItem) {
    try { cancellation = await paypal(e, token, `/v1/payments/payouts-item/${encodeURIComponent(cancelItem)}/cancel`, {}, undefined, PAYOUT_TIMEOUT_MS); }
    catch { cancellation = { error: 'CANCEL_RESPONSE_UNCERTAIN' }; }
  }
  let response;
  try {
    const r = await paypal(e, token, `/v1/payments/payouts/${encodeURIComponent(c.batch)}`, undefined, undefined, PAYOUT_TIMEOUT_MS);
    response = { http: r.status, data: r.data, ...(cancellation ? { cancellation } : {}) };
  } catch { response = { http: 0, error: 'PROVIDER_UNAVAILABLE', ...(cancellation ? { cancellation } : {}) }; }
  const saved = await rpc(e, 'paypal_payout_reconcile_finish', { p_query: c.query, p_response: response });
  if (!saved.ok) throw new Error(saved.error);
  const r = saved.data as { status: string; paypalStatus?: string; outcome: string; reason?: string };
  const proof=response as {data?:{items?:{payout_item?:{sender_item_id?:string};errors?:{name?:string}}[]}};
  if(r.outcome==='applied'&&r.status==='failed'&&proof.data?.items?.some(item=>item.payout_item?.sender_item_id===id&&item.errors?.name==='INSUFFICIENT_FUNDS'))e.payoutControl?.fundsUnavailable();
  if (r.outcome === 'review') await logServerError(e.serviceKey,'api','Retiro PayPal requiere revisión',`${id}: ${r.reason ?? 'MANUAL_REVIEW'}`);
  return { status: r.status, paypalStatus: r.outcome === 'review' ? 'MANUAL_REVIEW' : r.paypalStatus ?? 'RECOVERY_PENDING',
    retry: r.outcome === 'retry' || r.outcome === 'stale' };
};

const processPayout = async (e: Env, token: string, userId: string, id: string, waitForDelivery = false, allowSubmit?: () => Promise<boolean>) => {
  const claimed = await rpc(e, 'paypal_payout_claim', { p_user: userId, p_id: id, p_environment: e.mode, p_sender: e.clientId });
  if (!claimed.ok) throw new Error(claimed.error);
  const c = claimed.data as PayoutClaim;
  if (c.operation === 'done') return { status: c.status ?? 'sending', paypalStatus: 'RECONCILED' };
  if (c.operation === 'review') return pendingPayout('MANUAL_REVIEW');
  if (c.operation === 'wait') return pendingPayout('RECOVERY_PENDING');
  if (!['submit','check'].includes(c.operation)) throw new Error('Respuesta de recuperación no válida');
  const save = async (outcome: 'accepted' | 'uncertain' | 'rejected', batch: string | null, error: string | null) => {
    const saved = await rpc(e, 'paypal_payout_submission_result', {
      p_user: userId, p_id: id, p_token: c.token, p_outcome: outcome, p_batch: batch, p_error: error,
    });
    if (!saved.ok) throw new Error(saved.error);
    return saved.data as { applied: boolean; status: 'sending' | 'paid' | 'failed' };
  };
  let batchId = c.batch;
  let recoveredBatch: Awaited<ReturnType<typeof paypal>> | undefined;
  if (c.operation === 'submit') {
    if (!c.token || c.payload?.sender_batch_header?.sender_batch_id !== id) throw new Error('Falta la referencia original del retiro');
    if (allowSubmit && !await allowSubmit()) return pendingPayout('AUTOMATION_BLOCKED');
    let sent;
    try { sent = await paypal(e, token, '/v1/payments/payouts', c.payload, undefined, PAYOUT_TIMEOUT_MS); }
    catch {
      await save('uncertain', null, 'Respuesta de envío no recibida');
      return pendingPayout();
    }
    if (sent.status >= 200 && sent.status < 300 && validBatchId(sent.data?.batch_header?.payout_batch_id)) {
      batchId = sent.data.batch_header.payout_batch_id;
    } else {
      const duplicate = duplicateBatch(e, sent.data);
      if (duplicate) {
        // A duplicate is evidence of an existing batch, never a failed payout.
        let original;
        try { original = await paypal(e, token, `/v1/payments/payouts/${encodeURIComponent(duplicate)}`, undefined, undefined, PAYOUT_TIMEOUT_MS); }
        catch { /* keep the reservation and recover later with the same key */ }
        if (original && original.status === 200 && batchMatches(original.data,id,duplicate)) {
          batchId = duplicate;
          recoveredBatch = original;
        }
      }
      if (!batchId) {
        const rejected = sent.status === 422 && sent.data?.name === 'INSUFFICIENT_FUNDS';
        // Stop this round even if the database committed but its acknowledgement is lost.
        if(rejected)e.payoutControl?.fundsUnavailable();
        const saved = await save(rejected ? 'rejected' : 'uncertain', null, String(sent.data?.name ?? `HTTP_${sent.status}`));
        return saved.status === 'failed' ? { status: 'failed' as const, paypalStatus: 'REJECTED' } : pendingPayout();
      }
    }
    // Persist acceptance BEFORE the first delivery query. Lost DB acknowledgments
    // recover via the same key after lease expiry; stale workers cannot overwrite.
    const saved = await save('accepted', batchId!, null);
    if (!saved.applied) return pendingPayout();
    if (saved.status === 'paid') return { status: 'paid' as const, paypalStatus: 'SUCCESS' };
  }
  if (!validBatchId(batchId)) return pendingPayout('MANUAL_REVIEW');
  if (waitForDelivery && !recoveredBatch) await pause(1500);
  return reconcilePayout(e,token,id,userId);
};

// Internal server contracts; these exports are not HTTP handlers. The scheduled
// worker rechecks its durable permission immediately before any provider POST.
export const payoutServerIdentity = () => {
  const e=env();
  if(!e.clientId||!e.secret||!e.serviceKey)throw new Error('Falta la configuración de PayPal');
  return {mode:e.mode,clientId:e.clientId};
};
export const runStoredPayout = async (userId:string,id:string,allowSubmit:()=>Promise<boolean>) => {
  const e=env();if(!e.clientId||!e.secret||!e.serviceKey)throw new Error('Falta la configuración de PayPal');
  return processPayout(e as Env,await paypalToken(e),userId,id,false,allowSubmit);
};
export const reconcileStoredPayoutEvent = async (id:string,eventId:string) => {
  const e=env();if(!e.clientId||!e.secret||!e.serviceKey)throw new Error('Falta la configuración de PayPal');
  return reconcilePayout(e as Env,await paypalToken(e),id,null,eventId,'webhook');
};

// One authorization per round, reused only until PayPal's expiry. Never serialized.
export const createStoredPayoutSession=(control:PayoutProviderControl)=>{
 const config=env();if(!config.clientId||!config.secret||!config.serviceKey)throw new Error('Falta la configuración de PayPal');
 const e={...config,payoutControl:control} as Env;let authorization:Awaited<ReturnType<typeof paypalAccess>>|null=null;
 const token=async()=>{if(!authorization||authorization.until<=control.clock.now())authorization=await paypalAccess(e);return authorization.token;};
 return {identity:{mode:e.mode,clientId:e.clientId!},run:async(userId:string,id:string,allow:()=>Promise<boolean>)=>processPayout(e,await token(),userId,id,false,allow),event:async(id:string,eventId:string)=>reconcilePayout(e,await token(),id,null,eventId,'webhook')};
};

// Reservation and immutable request snapshot are created together, before HTTP.
const sendPayout = async (e: Env, token: string, userId: string): Promise<Response> => {
  const started = await rpc(e, 'paypal_payout_begin', { p_user: userId, p_environment: e.mode, p_sender: e.clientId });
  if (!started.ok) return json(400, { error: started.error });
  const { id, net, fee } = started.data as { id: string; net: number; fee: number };
  const result = await processPayout(e,token,userId,id,true);
  if (result.status === 'failed') return json(502, { error: 'PayPal no pudo entregar el retiro. Tu saldo sigue disponible; revisa tu cuenta PayPal.' });
  return json(200, { ok: true, status: result.status, net, fee });
};

// Asks PayPal again about the creator's withdrawals still 'sending' (in case a webhook
// never arrived) and returns PayPal's own state of each one.
const checkPayouts = async (e: Env, token: string, userId: string): Promise<Response> => {
  const mine = await supabase(
    `/rest/v1/payouts?user_id=eq.${encodeURIComponent(userId)}&status=eq.sending&select=id`,
    asServer(e.serviceKey)
  );
  if (!mine.ok) throw new Error(mine.error);
  const rows = Array.isArray(mine.data) ? (mine.data as { id: string }[]) : [];
  const items: { id: string; status: string; paypalStatus: string }[] = [];
  for (const row of rows) {
    const result = await processPayout(e,token,userId,row.id);
    items.push({ id: row.id, ...result });
  }
  const pending = await rpc(e, 'paypal_payout_event_pending', { p_user: userId });
  if (!pending.ok) throw new Error(pending.error);
  for (const event of pending.data as { id: string; payout: string }[]) {
    const result = await reconcilePayout(e,token,event.payout,userId,event.id,'webhook');
    const index = items.findIndex(x => x.id === event.payout);
    if (index >= 0) items[index] = { id: event.payout, ...result };
    else items.push({ id: event.payout, ...result });
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
  if (!mine.ok) throw new Error(mine.error);
  const row = Array.isArray(mine.data) ? (mine.data[0] as { id: string; paypal_batch_id: string | null; paypal_item_id: string | null } | undefined) : undefined;
  if (!row?.paypal_item_id) return json(404, { error: 'Este retiro ya no se puede cancelar.' });
  const result = await reconcilePayout(e,token,row.id,userId,null,'cancel',row.paypal_item_id);
  if (result.status !== 'failed') return json(409, { error: 'La devolución aún no está confirmada por PayPal. El saldo sigue apartado; vuelve a consultar el retiro.' });
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
  if (check.status !== 200 || check.data?.verification_status !== 'SUCCESS') return json(401, { error: 'Firma no válida' });

  const type = String(event?.event_type ?? '');
  const res = event?.resource ?? {};
  // A failed write answers 500 so PayPal retries the notification later.
  const must = <T extends { ok: boolean; error: string }>(r: T) => {
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  if (type.startsWith('PAYMENT.PAYOUTS-ITEM.') || type.startsWith('PAYMENT.PAYOUTSBATCH.')) {
    const saved = must(await rpc(e, 'paypal_payout_event_receive', { p_environment: e.mode, p_sender: e.clientId, p_event: event }));
    const receipt = saved.data as { id: string; payout: string | null; state: string };
    if (receipt.state !== 'pending' || !receipt.payout) {
      if (receipt.state === 'review') await logServerError(e.serviceKey,'api','Evento de retiro PayPal requiere revisión',receipt.id);
      return json(200, { ok: true });
    }
    const result = await reconcilePayout(e,token,receipt.payout,null,receipt.id,'webhook');
    // Durable pending record + non-2xx asks PayPal to retry a transient failure.
    // Opening earnings can also retry it after PayPal's delivery retries end.
    return result.retry ? json(503, { error: 'Evento guardado; conciliación pendiente' }) : json(200, { ok: true });
  }

  if (type === 'PAYMENT.SALE.REFUNDED' || type === 'PAYMENT.CAPTURE.REFUNDED') {
    return refundWebhook(e, token, event);
  } else if (incomingType(type)) {
    const result=await incomeProcessor(e,token).receive(event);
    return json(result.state==='pending'?503:200,{ok:result.state!=='pending',review:result.state==='review'});
  }
  return json(200, { ok: true });
};

// --- Handlers -----------------------------------------------------------------

// Browser configuration only. The PayPal client ID is intentionally public;
// no secret metadata, key lengths or OAuth diagnostic errors are exposed here.
// An enabled response indicates configuration is present, not PayPal approval.
export async function GET(): Promise<Response> {
  const e = env();
  const enabled = !!(e.clientId && e.secret && e.serviceKey);
  return json(200, { enabled, clientId: enabled ? e.clientId : null, env: e.mode });
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
      await logServerError(e.serviceKey, 'api', `PayPal webhook: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack ?? '' : '');
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
      if (await paysSelf(e, userId, kind, params)) return json(403, { error: SELF_PAY });
      if (await examplePaid(e, token, kind, params)) return json(403, { error: EXAMPLE_PAY });

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

      const attendance = await supabase('/rest/v1/rpc/reserve_assert_order_attendance', asUser(token, { p_order_id: orderId }));
      if (!attendance.ok) return json(409, {
        error: attendance.data?.message || 'No se pudo comprobar la ciudad de esta reserva. No repitas el pago; revisa la reserva antes de continuar.',
        orderId,
      });

      let result = await paypal(e, ppToken, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `capture-${orderId}`);
      // Captured already (a repeated call): read the order instead.
      if (result.status === 422) result = await paypal(e, ppToken, `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
      const capture = captureOf(result.data);
      if (!capture) {
        const declined = result.data?.details?.[0]?.issue === 'INSTRUMENT_DECLINED';
        return json(402, { error: declined ? 'PayPal rechazó el método de pago. Prueba con otro.' : 'PayPal no completó el pago.' });
      }

      // Save a recoverable server-query notice, then query and reconcile the
      // canonical capture and its collection cost through the same path as webhooks.
      // A missing fee or SQL failure must never cause a refund POST or a second charge.
      const done=await incomeProcessor(e,ppToken).query({id:`provider-query/capture/${capture.id}`,event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:capture.id,supplementary_data:{related_ids:{order_id:orderId}}}});
      if (done.state==='applied') {
        // A Reserve payment queues its confirmation email: send it now.
        await deliverOutbox(e.serviceKey);
        return json(200, { ok: true, captureId: capture.id });
      }

      return json(409,{error:'El cobro quedó guardado y falta comprobar su resultado o lo que descontó PayPal. No repitas el pago; su referencia se conserva para revisión.',captureId:capture.id,pending:true});
    }

    if (body.action === 'subscribe') {
      const creator = typeof body.creatorProfileId === 'string' ? body.creatorProfileId.slice(0, 64) : '';
      if (!creator) return json(400, { error: 'Falta el perfil.' });
      const quote = await supabase('/rest/v1/rpc/paypal_subscription_quote', asUser(token), { p_creator_profile_id: creator });
      if (!quote.ok) return json(400, { error: quote.error });
      const amount = Number(quote.data?.amount);
      if (!(amount > 0)) return json(400, { error: 'No se pudo calcular el monto.' });
      if (await paysSelf(e, userId, 'subscription', { creatorProfileId: creator })) return json(403, { error: SELF_PAY });
      if (await examplePaid(e, token, 'subscription', { creatorProfileId: creator })) return json(403, { error: EXAMPLE_PAY });
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
      // Subscribed with the PayPal account of the creator: stop it before the first payment counts.
      if (await paysSelf(e, userId, 'subscription', { creatorProfileId: row.creator_id }, sub.data?.subscriber?.email_address)) {
        await cancelAtPaypal(e, ppToken, subId, 'No se puede suscribir a su propia cuenta');
        await rpc(e, 'paypal_subscription_ended', { p_id: subId, p_now: true });
        return json(409, { error: `${SELF_PAY} Cancelamos la suscripción en PayPal.` });
      }

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
    await logServerError(e.serviceKey, 'api', `PayPal ${String(body.action)}: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack ?? '' : '');
    return json(502, { error: err instanceof Error ? err.message : 'No se pudo conectar con PayPal.' });
  }
}
