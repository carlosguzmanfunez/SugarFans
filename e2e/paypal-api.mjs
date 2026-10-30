// Tests api/paypal.ts with PayPal and Supabase replaced by fakes (no network):
// the amount comes from the database quote, the purchase is fulfilled only
// after PayPal reports a completed capture for that amount, and a capture that
// can't be fulfilled is refunded. Subscriptions: one PayPal plan per price,
// access only once PayPal says ACTIVE, cancelling stops PayPal first, and the
// webhook is believed only after PayPal verifies its signature. Withdrawals:
// PayPal Payouts sends the net amount once, and a failure returns the balance.
// Run: node e2e/paypal-api.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'paypal-api-'));
await build({ entryPoints: ['api/paypal.ts'], outfile: join(dir, 'paypal.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });

Object.assign(process.env, { PAYPAL_CLIENT_ID: 'AXclient', PAYPAL_CLIENT_SECRET: 'PP-SECRET-VALUE', PAYPAL_ENV: 'sandbox', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test', PAYPAL_WEBHOOK_ID: 'WH-1' });
const api = await import(pathToFileURL(join(dir, 'paypal.mjs')).href);

// --- fakes ------------------------------------------------------------------
const db = { orders: new Map(), fulfilled: [], marks: [], fulfillError: '', catalog: new Map(), subs: new Map(), payments: new Map(), ended: [], access: new Map(), payouts: new Map(), payoutError: '', moneyBack: [] };
const pp = { orders: new Map(), refunds: [], captureStatus: 'COMPLETED', products: 0, plans: [], subs: new Map(), cancels: [], saleRefunds: [], payoutBatches: new Map(), payoutStatus: 'SUCCESS', payoutFail: '', payerEmail: 'fan@paypal.test' };
const calls = [];
// These fakes check API contracts. The real SQL, permissions and event races are
// exercised separately by payout-recovery.mjs + payout-event-cases.mjs.
const payoutEvents = new Map(), payoutQueries = new Map();
const incomeEvents=new Map(),incomeNative=new Map(),incomeActions=new Map();
const res = (status, body) =>
  status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
  const h = init.headers ?? {};
  calls.push({ u, body, h });
  // Wire-contract fakes only. Real incoming SQL, ordering, fees, leases and
  // uncertain external effects are covered by income-events.mjs on PostgreSQL.
  if(u.endsWith('/rest/v1/rpc/paypal_income_receive')){
    if(h.apikey!=='sb_secret_test')return res(401,{});
    const e=body.p_event,r=e.resource??{};incomeEvents.set(e.id,e);
    if(e.event_type==='PAYMENT.SALE.COMPLETED'){const sale=pp.subs.get(r.billing_agreement_id)?.sales?.find(x=>x.id===r.id);incomeNative.set('/v1/payments/sale/'+r.id,{...r,state:'completed',transaction_fee:{currency:'USD',value:'0.57'},billing_agreement_id:r.billing_agreement_id,amount:{total:r.amount?.total??sale?.amount_with_breakdown?.gross_amount?.value??'9.99',currency:'USD'}});}
    if(e.event_type.startsWith('CUSTOMER.DISPUTE.'))incomeNative.set('/v1/customer/disputes/'+r.dispute_id,{...r,status:e.event_type.endsWith('RESOLVED')?'RESOLVED':'OPEN',update_time:'2026-10-26T12:00:00Z'});
    if(e.event_type.startsWith('BILLING.SUBSCRIPTION.')){const sub=pp.subs.get(r.id);if(sub)sub.status=e.event_type.endsWith('SUSPENDED')?'SUSPENDED':e.event_type.endsWith('ACTIVATED')?'ACTIVE':'CANCELLED';}
    return res(200,{id:e.id,state:'pending'});
  }
  if(u.endsWith('/rest/v1/rpc/paypal_income_claim'))return res(200,{operation:'work',token:'QA-INCOME-TOKEN',body:incomeEvents.get(body.p_id)});
  if(u.endsWith('/rest/v1/rpc/paypal_income_context'))return res(200,{order:incomeEvents.get(body.p_id)?.resource?.supplementary_data?.related_ids?.order_id,orders:[]});
  if(u.endsWith('/rest/v1/rpc/paypal_income_retry'))return res(200,{state:'pending'});
  if(u.endsWith('/rest/v1/rpc/paypal_income_apply')){
    const event=incomeEvents.get(body.p_id),r=body.p_proof.resource,actions=[];
    if(event.event_type==='PAYMENT.CAPTURE.COMPLETED'){
      const order=body.p_proof.order,o=db.orders.get(order.id);
      if(db.fulfillError)return res(400,{message:db.fulfillError});
      if(Number(r.amount.value)!==o.amount||r.amount.currency_code!=='USD')return res(200,{state:'review'});
      if(order.payer?.email_address==='creator@paypal.test'){
        const key='refund_capture/'+r.id;incomeActions.set(key,{id:key,kind:'refund_capture',reference:r.id,state:'prepared',amount:Number(r.amount.value),key:'refund-'+r.id});actions.push(key);
      }else if(o.status==='created'){
        if(!r.seller_receivable_breakdown?.paypal_fee)return res(200,{state:'pending'});
        o.fee=Number(r.seller_receivable_breakdown.paypal_fee.value);o.status='completed';o.capture_id=r.id;
        db.fulfilled.push({p_order_id:order.id,p_user:o.user,p_capture_id:r.id,p_amount:Number(r.amount.value)});
      }
    }else if(event.event_type==='PAYMENT.SALE.COMPLETED'){
      const sub=body.p_proof.subscription,id=sub.id,o=db.subs.get(id);
      if(o?.status==='created'){o.status='active';db.access.set(o.user+':'+o.creator,id);}
      const refused=['self-2','demo-2','banned-2'].includes(o?.creator);
      if(!o||refused||db.access.get(o.user+':'+o.creator)!==id){
        for(const [kind,reference] of [['cancel_subscription',id],['refund_sale',r.id]]){const key=kind+'/'+reference;incomeActions.set(key,{id:key,kind,reference,state:'prepared',amount:Number(r.amount.total),key:'refund-'+reference});actions.push(key);}
        db.ended.push({p_id:id,p_now:true});
      }else db.payments.set(r.id,{p_id:id,p_sale_id:r.id,p_amount:Number(r.amount.total)});
    }else if(event.event_type.startsWith('CUSTOMER.DISPUTE.')){
      db.moneyBack.push({p_ref:r.disputed_transactions[0].seller_transaction_id,p_action:r.status==='RESOLVED'&&r.dispute_outcome?.outcome_code==='RESOLVED_SELLER_FAVOUR'?'release':'dispute'});
    }else if(event.event_type.endsWith('.REVERSED'))db.moneyBack.push({p_ref:r.id,p_action:'refund'});
    else if(event.event_type.startsWith('BILLING.SUBSCRIPTION.'))db.ended.push({p_id:r.id,p_now:r.status==='SUSPENDED'});
    return res(200,{state:actions.length?'pending':'applied',...(actions.length?{actions}:{})});
  }
  if(u.endsWith('/rest/v1/rpc/paypal_income_action_claim')){const a=incomeActions.get(body.p_id),operation=a.state==='confirmed'?'done':a.state==='prepared'&&body.p_allow_send?'send':'check';if(operation==='send')a.state='attempted';return res(200,{...a,operation});}
  if(u.endsWith('/rest/v1/rpc/paypal_income_action_confirm')){const a=incomeActions.get(body.p_id),r=body.p_proof.resource,confirmed=a.kind==='cancel_subscription'?['CANCELLED','EXPIRED'].includes(r.status):['REFUNDED','refunded'].includes(r.state??r.status);if(confirmed)a.state='confirmed';return res(200,{confirmed});}
  if(u.endsWith('/rest/v1/rpc/paypal_income_complete'))return res(200,{state:'applied'});
  if(u.endsWith('/rest/v1/rpc/paypal_refund_followup'))return res(204,null);
  if (u.endsWith('/auth/v1/user')) return h.authorization === 'Bearer fan-token' ? res(200, { id: 'fan-1' }) : res(401, { msg: 'bad jwt' });
  if (u.endsWith('/rest/v1/rpc/paypal_quote')) {
    if (body.p_kind === 'tip' && body.p_params.amount > 500) return res(400, { message: 'La propina debe estar entre $1 y $500' });
    return res(200, { amount: body.p_kind === 'coins' ? 4.99 : body.p_params.amount, description: 'Prueba' });
  }
  if (u.includes('/rest/v1/vip_bookings?id=eq.')) {
    if (h.authorization !== 'Bearer fan-token') return res(401, {});
    return res(200, [{ creator_profile_id: u.includes('b-ejemplo') ? '1' : '4' }]);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_register')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    db.orders.set(body.p_order_id, { status: 'created', amount: body.p_amount, user: body.p_user, kind: body.p_kind, params: body.p_params });
    return res(204, null);
  }
  // The creator 'self' is the fan's own creator account; so is the PayPal account creator@paypal.test.
  if (u.endsWith('/rest/v1/rpc/paypal_self_pay')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    return res(200, body.p_params?.creatorProfileId === 'self' || body.p_payer_email === 'creator@paypal.test');
  }
  if (u.endsWith('/rest/v1/rpc/paypal_money_back')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    db.moneyBack.push(body);
    return res(200, { matched: 1, subscription: body.p_action === 'refund' && body.p_ref === 'SALE-R2' ? 'I-SUB2' : null });
  }
  if (u.endsWith('/rest/v1/rpc/paypal_refund_receive')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    return res(200, { id: body.p_event.id, state: 'pending' });
  }
  if (u.endsWith('/rest/v1/rpc/paypal_refund_apply')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    db.moneyBack.push({ p_ref: body.p_ref, p_action: 'refund' });
    return res(200, { state: 'applied', full: true, subscription: body.p_ref === 'SALE-R2' ? 'I-SUB2' : null });
  }
  if (u.includes('/rest/v1/paypal_orders?id=eq.')) {
    const id = decodeURIComponent(u.split('id=eq.')[1].split('&')[0]);
    const o = db.orders.get(id);
    if (init.method === 'PATCH') {
      if (h.apikey !== 'sb_secret_test') return res(401, {});
      if (o.status === 'created') o.fee = body.fee;
      return res(204, null);
    }
    if (u.includes('select=kind,params')) return h.apikey === 'sb_secret_test' && o ? res(200, [{ kind: o.kind, params: o.params }]) : res(401, {});
    return res(200, o && o.user === 'fan-1' ? [{ status: o.status, amount: o.amount }] : []);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_fulfill')) {
    if (db.fulfillError) return res(400, { message: db.fulfillError });
    const o = db.orders.get(body.p_order_id);
    if (body.p_amount !== o.amount) return res(400, { message: 'El monto cobrado no coincide con el pedido' });
    o.status = 'completed';
    db.fulfilled.push(body);
    return res(204, null);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_mark')) {
    db.marks.push(body);
    db.orders.get(body.p_order_id).status = body.p_status;
    return res(204, null);
  }
  // Subscriptions: database side.
  if (u.endsWith('/rest/v1/rpc/paypal_subscription_quote')) {
    if (body.p_creator_profile_id === 'mine') return res(400, { message: 'No puedes suscribirte a tu propio perfil' });
    return res(200, { amount: 9.99, description: 'Suscripción mensual a Diego', startTime: null });
  }
  if (u.includes('/rest/v1/paypal_catalog')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    if (init.method === 'POST') {
      if (!db.catalog.has(body.key)) db.catalog.set(body.key, body.paypal_id);
      return res(201, null);
    }
    const key = decodeURIComponent(u.split('key=eq.')[1].split('&')[0]);
    return res(200, db.catalog.has(key) ? [{ paypal_id: db.catalog.get(key) }] : []);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_subscription_register')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    db.subs.set(body.p_id, { user: body.p_user, creator: body.p_creator_profile_id, status: 'created', starts: body.p_starts_at });
    return res(204, null);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_subscription_activate')) {
    const o = db.subs.get(body.p_id);
    if (!o) return res(400, { message: 'Suscripción de PayPal no encontrada' });
    if (o.status === 'created') {
      o.status = 'active';
      db.access.set(`${o.user}:${o.creator}`, body.p_id);
    }
    return res(204, null);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_subscription_payment')) {
    const o = db.subs.get(body.p_id);
    if (!o) return res(200, 'unknown');
    if (db.access.get(`${o.user}:${o.creator}`) !== body.p_id) return res(200, 'orphan');
    if (o.creator === 'self-2') return res(400, { message: 'No puedes pagarte a ti mismo: esta cuenta y la del creador son de la misma persona.' });
    if (o.creator === 'banned-2') return res(400, { message: 'Este creador no está disponible en este momento: no acepta pagos ni reservas.' });
    if (o.creator === 'demo-2') return res(400, { message: 'Este perfil es de demostración: todavía no acepta pagos ni reservas.' });
    db.payments.set(body.p_sale_id, body);
    return res(200, 'recorded');
  }
  if (u.endsWith('/rest/v1/rpc/paypal_subscription_ended')) {
    db.ended.push(body);
    return res(200, '2026-11-03T00:00:00+00:00');
  }
  if (u.includes('/rest/v1/paypal_subscriptions?id=eq.')) {
    const id = decodeURIComponent(u.split('id=eq.')[1].split('&')[0]);
    const o = db.subs.get(id);
    return res(200, o && o.user === 'fan-1' ? [{ status: o.status, creator_id: o.creator, starts_at: o.starts }] : []);
  }
  if (u.includes('/rest/v1/subscriptions?creator_id=eq.')) {
    const creator = decodeURIComponent(u.split('creator_id=eq.')[1].split('&')[0]);
    const id = db.access.get(`fan-1:${creator}`);
    return res(200, id ? [{ paypal_subscription_id: id }] : []);
  }
  // Withdrawals.
  if (u.endsWith('/rest/v1/rpc/paypal_payout_event_receive')) {
    const event = body.p_event, payout = event.resource?.payout_item?.sender_item_id;
    if (!payoutEvents.has(event.id)) payoutEvents.set(event.id, { id: event.id, payout, state: 'pending' });
    return res(200,payoutEvents.get(event.id));
  }
  if (u.endsWith('/rest/v1/rpc/paypal_payout_event_pending')) {
    return res(200,[...payoutEvents.values()].filter(e=>e.state==='pending' && db.payouts.get(e.payout)?.user===body.p_user));
  }
  if (u.endsWith('/rest/v1/rpc/paypal_payout_reconcile_begin')) {
    const x=db.payouts.get(body.p_id);
    if (!x || (body.p_user && x.user!==body.p_user)) return res(400,{message:'Retiro no encontrado'});
    const id=`QUERY-${payoutQueries.size+1}`;
    payoutQueries.set(id,{payout:body.p_id,event:body.p_event});
    return res(200,{operation:'query',query:id,batch:x.batch,status:x.status});
  }
  if (u.endsWith('/rest/v1/rpc/paypal_payout_reconcile_finish')) {
    const query=payoutQueries.get(body.p_query),x=db.payouts.get(query.payout);
    const item=body.p_response.data?.items?.find(i=>i.payout_item?.sender_item_id===query.payout);
    if (!item) return res(200,{status:x.status,outcome:'retry'});
    const status=item.transaction_status;
    if (status==='SUCCESS') x.status='paid';
    else if (['RETURNED','REFUNDED','REVERSED'].includes(status) || (status==='FAILED' && x.status!=='paid')) x.status='failed';
    x.itemId=item.payout_item_id;
    if (query.event) payoutEvents.get(query.event).state='reconciled';
    return res(200,{status:x.status,paypalStatus:status,outcome:'applied'});
  }
  if (u.endsWith('/rest/v1/rpc/paypal_payout_begin')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    if (db.payoutError) return res(400, { message: db.payoutError });
    if ([...db.payouts.values()].some((x) => x.status === 'sending')) return res(400, { message: 'Tienes un retiro en camino; espera a que PayPal lo confirme' });
    const id = `po-${db.payouts.size + 1}`;
    const payload = { sender_batch_header: { sender_batch_id: id, email_subject: 'Prueba', email_message: 'Prueba' },
      items: [{ recipient_type: 'EMAIL', receiver: 'vale@example.com', amount: { value: '156.80', currency: 'USD' }, sender_item_id: id }] };
    db.payouts.set(id, { user: body.p_user, status: 'sending', amount: 160, fee: 3.2, net: 156.8, payload });
    return res(200, { id, amount: 160, fee: 3.2, net: 156.8, email: 'vale@example.com' });
  }
  if (u.endsWith('/rest/v1/rpc/paypal_payout_claim')) {
    const x = db.payouts.get(body.p_id);
    if (!x || x.user !== body.p_user) return res(400, { message: 'Retiro no encontrado' });
    return res(200, { operation: x.batch ? 'check' : 'submit', token: `lease-${body.p_id}`, payload: x.payload, batch: x.batch, net: x.net, fee: x.fee });
  }
  if (u.endsWith('/rest/v1/rpc/paypal_payout_submission_result')) {
    const x = db.payouts.get(body.p_id);
    if (body.p_outcome === 'accepted') x.batch = body.p_batch;
    if (body.p_outcome === 'rejected') x.status = 'failed';
    return res(200, { applied: true, status: x.status });
  }
  if (u.includes('/rest/v1/payouts?') && u.includes('user_id=eq.')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    const user = decodeURIComponent(u.split('user_id=eq.')[1].split('&')[0]);
    const only = u.includes('id=eq.') ? decodeURIComponent(u.split('?id=eq.')[1]?.split('&')[0] ?? '') : '';
    return res(200, [...db.payouts].filter(([id, x]) => x.user === user && x.status === 'sending' && (!only || id === only)).map(([id,x]) => ({ id, paypal_batch_id: x.batch, paypal_item_id: x.itemId })));
  }
  if (u.endsWith('/rest/v1/rpc/paypal_payout_mark')) {
    throw new Error('Retired payout writer must never be called');
  }
  if (u.endsWith('/v1/payments/payouts') && init.method === 'POST') {
    if (pp.payoutFail) return res(422, { name: pp.payoutFail });
    const batchId = `BATCH-${body.sender_batch_header.sender_batch_id}`;
    pp.payoutBatches.set(batchId, body);
    return res(201, { batch_header: { payout_batch_id: batchId, batch_status: 'PENDING' } });
  }
  const itemCancel = u.match(/\/v1\/payments\/payouts-item\/([\w-]+)\/cancel$/);
  if (itemCancel) {
    if (pp.payoutStatus!=='UNCLAIMED') return res(400, { name: 'ITEM_CANCELLATION_FAILED' });
    pp.payoutStatus='RETURNED';
    return res(200, { payout_item_id: itemCancel[1], transaction_status: 'RETURNED' });
  }
  const batchGet = u.match(/\/v1\/payments\/payouts\/([\w-]+)$/);
  if (batchGet) {
    const batch = pp.payoutBatches.get(batchGet[1]);
    return res(200, { batch_header: { payout_batch_id: batchGet[1], sender_batch_header: batch?.sender_batch_header },
      items: [{ payout_item_id: `ITEM-${batchGet[1]}`, transaction_status: pp.payoutStatus, payout_item: batch?.items[0] }] });
  }
  // Subscriptions: PayPal side.
  if (u.endsWith('/v1/catalogs/products')) return res(201, { id: `PROD-${++pp.products}` });
  if (u.endsWith('/v1/billing/plans')) {
    pp.plans.push(body);
    return res(201, { id: `P-${pp.plans.length}`, status: 'ACTIVE' });
  }
  if (u.endsWith('/v1/billing/subscriptions') && init.method === 'POST') {
    const id = `I-SUB${pp.subs.size + 1}`;
    pp.subs.set(id, { ...body, status: 'ACTIVE', sales: [{ id: `SALE-${id}`, status: 'COMPLETED', amount_with_breakdown: { gross_amount: { value: '9.99' } } }] });
    return res(201, { id, status: 'APPROVAL_PENDING' });
  }
  const subCancel = u.match(/\/v1\/billing\/subscriptions\/([\w-]+)\/cancel$/);
  if (subCancel) {
    pp.cancels.push({ id: subCancel[1], at: calls.length });
    if (pp.subs.has(subCancel[1])) pp.subs.get(subCancel[1]).status = 'CANCELLED';
    return res(204, null);
  }
  const subTx = u.match(/\/v1\/billing\/subscriptions\/([\w-]+)\/transactions\?/);
  if (subTx) return res(200, { transactions: pp.subs.get(subTx[1])?.sales ?? [] });
  const subGet = u.match(/\/v1\/billing\/subscriptions\/([\w-]+)$/);
  if (subGet) {
    let sub = pp.subs.get(subGet[1]);
    if(!sub&&db.subs.has(subGet[1])){const o=db.subs.get(subGet[1]);sub={status:'ACTIVE',custom_id:o.user+':'+o.creator};pp.subs.set(subGet[1],sub);}
    return sub ? res(200, { id: subGet[1], status: sub.status, custom_id: sub.custom_id, plan_id: sub.plan_id, subscriber: { email_address: sub.payer ?? 'fan@paypal.test' } }) : res(404, {});
  }
  const incomingPath=new URL(u).pathname;
  if(incomeNative.has(incomingPath))return res(200,incomeNative.get(incomingPath));
  const incomingCapture=u.match(/\/v2\/payments\/captures\/([\w-]+)$/);
  if(incomingCapture){const order=pp.orders.get(incomingCapture[1].replace(/^CAP-/,''));return res(200,order?{id:incomingCapture[1],status:'COMPLETED',amount:order.amount,seller_receivable_breakdown:{paypal_fee:{currency_code:'USD',value:'0.57'}}}:{id:incomingCapture[1],status:'REFUNDED',amount:{value:'100.00',currency_code:'USD'}});}
  if (u.endsWith('/v1/notifications/verify-webhook-signature')) {
    const v = JSON.parse(init.body);
    return res(200, { verification_status: v.transmission_sig === 'good' && v.webhook_id === 'WH-1' && v.webhook_event?.id ? 'SUCCESS' : 'FAILURE' });
  }
  const saleRefund = u.match(/\/v1\/payments\/sale\/([\w-]+)\/refund$/);
  if (saleRefund) {
    pp.saleRefunds.push(saleRefund[1]);
    const native=incomeNative.get('/v1/payments/sale/'+saleRefund[1]);if(native)native.state='refunded';
    return res(201, { state: 'completed' });
  }
  if (u.endsWith('/v2/payments/refunds/REF-1')) return res(200, { id: 'REF-1', status: 'COMPLETED', amount: { value: '10.00', currency_code: 'USD' }, links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAP-ORDER2' }] });
  if (u.endsWith('/v2/payments/captures/CAP-ORDER2')) return res(200, { id: 'CAP-ORDER2', status: 'REFUNDED', amount: { value: '10.00', currency_code: 'USD' } });
  if (u.endsWith('/v1/payments/refund/RF-9')) return res(200, { id: 'RF-9', sale_id: 'SALE-R2', state: 'completed', amount: { total: '9.99', currency: 'USD' } });
  if (u.endsWith('/v1/payments/sale/SALE-R2')) return res(200, { id: 'SALE-R2', state: 'refunded', amount: { total: '9.99', currency: 'USD' } });
  if (u.endsWith('/v1/oauth2/token')) return res(200, { access_token: 'pp-token' });
  if (u.endsWith('/v2/checkout/orders') && init.method === 'POST') {
    const id = `ORDER${pp.orders.size + 1}`;
    pp.orders.set(id, { amount: body.purchase_units[0].amount, captured: false });
    return res(201, { id, status: 'CREATED' });
  }
  const cap = u.match(/\/v2\/checkout\/orders\/(\w+)\/capture$/);
  if (cap) {
    const o = pp.orders.get(cap[1]);
    if (o.captured) return res(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
    o.captured = true;
    o.payerEmail=pp.payerEmail;
    return res(201, { id: cap[1], status: pp.captureStatus, payer: { email_address: pp.payerEmail }, purchase_units: [{ payments: { captures: [{ id: `CAP-${cap[1]}`, status: pp.captureStatus, amount: o.amount, seller_receivable_breakdown: { paypal_fee: { currency_code: 'USD', value: '0.57' } } }] } }] });
  }
  const get = u.match(/\/v2\/checkout\/orders\/(\w+)$/);
  if (get) {
    const o = pp.orders.get(get[1]);
    return res(200, { id: get[1], status: 'COMPLETED', payer:{email_address:o.payerEmail},purchase_units: [{ payments: { captures: [{ id: `CAP-${get[1]}`, status: 'COMPLETED', amount: o.amount }] } }] });
  }
  const refund = u.match(/\/v2\/payments\/captures\/([\w-]+)\/refund$/);
  if (refund) {
    pp.refunds.push(refund[1]);
    return res(201, { status: 'COMPLETED' });
  }
  throw new Error(`unexpected fetch ${u}`);
};

const post = async (body, token = 'fan-token') => {
  const r = await api.POST(new Request('https://x/api/paypal', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: r.status, data: await r.json() };
};

const hook = async (event, sig = 'good') => {
  const r = await api.POST(
    new Request('https://x/api/paypal?webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'paypal-transmission-sig': sig, 'paypal-transmission-id': 't1', 'paypal-auth-algo': 'SHA256withRSA' },
      body: JSON.stringify({ id: `WH-EV-${Math.random()}`, ...event }),
    }),
  );
  return { status: r.status, data: await r.json() };
};

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

console.log('API de PayPal (con PayPal y Supabase simulados)');

await check('GET da el Client ID público y nunca el Secret', async () => {
  const callsBefore = calls.length;
  const r = await api.GET();
  const data = await r.json();
  expect(data.enabled && data.clientId === 'AXclient' && data.env === 'sandbox', JSON.stringify(data));
  expect(!JSON.stringify(data).includes('PP-SECRET-VALUE'), 'muestra el secret');
  expect(!JSON.stringify(data).includes('sb_secret_test'), 'muestra la service role');
  expect(!('checks' in data), 'el GET público revela diagnósticos internos');
  expect(Object.keys(data).sort().join(',') === 'clientId,enabled,env', 'se exponen campos de configuración no necesarios');
  expect(calls.length === callsBefore, 'la consulta pública contacta a PayPal o Supabase');
});

await check('Sin sesión no se puede pagar', async () => {
  const r = await post({ action: 'create', kind: 'coins', params: { packId: 'bolsita' } }, 'otro');
  expect(r.status === 401, `status ${r.status}`);
});

await check('El monto lo decide la base, no el navegador', async () => {
  const r = await post({ action: 'create', kind: 'coins', params: { packId: 'bolsita', amount: 0.01 } });
  expect(r.status === 200 && r.data.orderId, JSON.stringify(r.data));
  expect(pp.orders.get(r.data.orderId).amount.value === '4.99' && pp.orders.get(r.data.orderId).amount.currency_code === 'USD', 'monto o moneda incorrectos');
  expect(db.orders.get(r.data.orderId)?.amount === 4.99, 'pedido no registrado');
});

await check('Una propina inválida no llega a PayPal', async () => {
  const before = pp.orders.size;
  const r = await post({ action: 'create', kind: 'tip', params: { creatorProfileId: '2', amount: 900 } });
  expect(r.status === 400 && /500/.test(r.data.error) && pp.orders.size === before, JSON.stringify(r.data));
});

await check('Las suscripciones no se cobran como pago único', async () => {
  const r = await post({ action: 'create', kind: 'subscription', params: { creatorProfileId: '2' } });
  expect(r.status === 400, `status ${r.status}`);
});

await check('Capturar confirma la compra una sola vez', async () => {
  const { data } = await post({ action: 'create', kind: 'tip', params: { creatorProfileId: '2', amount: 12.5 } });
  const r = await post({ action: 'capture', orderId: data.orderId });
  expect(r.status === 200 && r.data.ok && r.data.captureId === `CAP-${data.orderId}`, JSON.stringify(r.data));
  const f = db.fulfilled.at(-1);
  expect(f.p_order_id === data.orderId && f.p_user === 'fan-1' && f.p_amount === 12.5 && f.p_capture_id === `CAP-${data.orderId}`, JSON.stringify(f));
  expect(db.orders.get(data.orderId).fee === 0.57, 'no guardó la comisión de PayPal antes de entregar');
  const n = db.fulfilled.length;
  const again = await post({ action: 'capture', orderId: data.orderId });
  expect(again.status === 200 && db.fulfilled.length === n, 'se cumplió dos veces');
});

await check('No se puede capturar el pedido de otra persona', async () => {
  const r = await post({ action: 'capture', orderId: 'NOEXISTE' });
  expect(r.status === 404, `status ${r.status}`);
});

await check('Si PayPal no completa el pago, no se entrega nada', async () => {
  const { data } = await post({ action: 'create', kind: 'coins', params: { packId: 'bolsita' } });
  pp.captureStatus = 'DECLINED';
  const n = db.fulfilled.length;
  const r = await post({ action: 'capture', orderId: data.orderId });
  pp.captureStatus = 'COMPLETED';
  expect(r.status === 402 && db.fulfilled.length === n, JSON.stringify(r.data));
});

await check('Si falla la entrega, el cobro conserva su referencia sin una devolución ciega', async () => {
  const { data } = await post({ action: 'create', kind: 'booking', params: { bookingId: 'b1', amount: 80 } });
  db.fulfillError = 'Solo puedes pagar una reserva aceptada por el creador';
  const r = await post({ action: 'capture', orderId: data.orderId });
  db.fulfillError = '';
  expect(r.status === 409 && r.data.pending && /No repitas/.test(r.data.error), JSON.stringify(r.data));
  expect(!pp.refunds.includes(`CAP-${data.orderId}`), 'devolvió sin comprobar el resultado');
  expect(db.orders.get(data.orderId).status === 'created'&&incomeEvents.has('provider-query/capture/CAP-'+data.orderId),'no conservó el aviso recuperable');
});

await check('Pagarle a su propia cuenta de creador no llega a PayPal', async () => {
  const before = pp.orders.size;
  const r = await post({ action: 'create', kind: 'tip', params: { creatorProfileId: 'self', amount: 5 } });
  expect(r.status === 403 && /pagarte a ti mismo/.test(r.data.error) && pp.orders.size === before, JSON.stringify(r.data));
});

await check('Con dinero real nadie le paga al perfil de ejemplo de Valentina; en sandbox sí', async () => {
  const before = pp.orders.size;
  process.env.PAYPAL_ENV = 'live';
  try {
    const tip = await post({ action: 'create', kind: 'tip', params: { creatorProfileId: '1', amount: 5 } });
    expect(tip.status === 403 && /perfil de ejemplo/.test(tip.data.error), JSON.stringify(tip.data));
    const booking = await post({ action: 'create', kind: 'booking', params: { bookingId: 'b-ejemplo', amount: 20 } });
    expect(booking.status === 403 && /perfil de ejemplo/.test(booking.data.error), JSON.stringify(booking.data));
    const sub = await post({ action: 'subscribe', creatorProfileId: '1' });
    expect(sub.status === 403 && /perfil de ejemplo/.test(sub.data.error), JSON.stringify(sub.data));
    expect(pp.orders.size === before, 'llegó a PayPal');
  } finally {
    process.env.PAYPAL_ENV = 'sandbox';
  }
  const sandbox = await post({ action: 'create', kind: 'tip', params: { creatorProfileId: '1', amount: 5 } });
  expect(sandbox.status === 200 && sandbox.data.orderId, JSON.stringify(sandbox.data));
});

await check('Pagar con el PayPal del creador conserva la revisión y no cuenta como ganancia', async () => {
  const { data } = await post({ action: 'create', kind: 'tip', params: { creatorProfileId: '4', amount: 5 } });
  const n = db.fulfilled.length;
  pp.payerEmail = 'creator@paypal.test';
  const r = await post({ action: 'capture', orderId: data.orderId });
  pp.payerEmail = 'fan@paypal.test';
  expect(r.status === 409 && r.data.pending, JSON.stringify(r.data));
  expect(db.fulfilled.length === n && !pp.refunds.includes(`CAP-${data.orderId}`), 'contó o devolvió desde una consulta');
  expect(incomeActions.has('refund_capture/CAP-'+data.orderId),'no conservó el seguimiento necesario');
});

await check('Suscribirse crea un solo plan por precio y la suscripción lleva al fan y al perfil', async () => {
  const a = await post({ action: 'subscribe', creatorProfileId: '2' });
  const b = await post({ action: 'subscribe', creatorProfileId: '3' });
  expect(a.status === 200 && b.status === 200 && a.data.subscriptionId && b.data.subscriptionId, JSON.stringify([a.data, b.data]));
  expect(pp.products === 1 && pp.plans.length === 1, `productos ${pp.products}, planes ${pp.plans.length}`);
  const plan = pp.plans[0];
  expect(plan.billing_cycles[0].pricing_scheme.fixed_price.value === '9.99' && plan.billing_cycles[0].frequency.interval_unit === 'MONTH', JSON.stringify(plan));
  expect(pp.subs.get(a.data.subscriptionId).custom_id === 'fan-1:2' && pp.subs.get(a.data.subscriptionId).plan_id === 'P-1', 'custom_id o plan');
  expect(db.subs.get(a.data.subscriptionId)?.status === 'created', 'no registrada');
});

await check('No se puede suscribir a su propio perfil', async () => {
  const before = pp.subs.size;
  const r = await post({ action: 'subscribe', creatorProfileId: 'mine' });
  expect(r.status === 400 && pp.subs.size === before, JSON.stringify(r.data));
});

await check('Activar da acceso y registra el primer pago una sola vez', async () => {
  const id = 'I-SUB1';
  const r = await post({ action: 'activate', subscriptionId: id });
  expect(r.status === 200 && r.data.ok, JSON.stringify(r.data));
  expect(db.access.get('fan-1:2') === id && db.payments.has(`SALE-${id}`), 'sin acceso o sin pago');
  const again = await post({ action: 'activate', subscriptionId: id });
  expect(again.status === 200 && db.payments.size === 1, 'pago doble');
});

await check('No se puede suscribir a su propia cuenta de creador', async () => {
  const before = pp.subs.size;
  const r = await post({ action: 'subscribe', creatorProfileId: 'self' });
  expect(r.status === 403 && /pagarte a ti mismo/.test(r.data.error) && pp.subs.size === before, JSON.stringify(r.data));
});

await check('Suscrita con el PayPal del creador: se cancela en PayPal antes del primer cobro', async () => {
  const { data } = await post({ action: 'subscribe', creatorProfileId: '5' });
  pp.subs.get(data.subscriptionId).payer = 'creator@paypal.test';
  const r = await post({ action: 'activate', subscriptionId: data.subscriptionId });
  expect(r.status === 409 && /pagarte a ti mismo/.test(r.data.error), JSON.stringify(r.data));
  expect(pp.cancels.some((c) => c.id === data.subscriptionId) && !db.access.has('fan-1:5'), 'sigue activa');
  expect(db.ended.at(-1).p_id === data.subscriptionId && db.ended.at(-1).p_now === true, JSON.stringify(db.ended.at(-1)));
});

await check('Sin ACTIVE en PayPal no hay acceso', async () => {
  pp.subs.get('I-SUB2').status = 'APPROVAL_PENDING';
  const r = await post({ action: 'activate', subscriptionId: 'I-SUB2' });
  expect(r.status === 402 && !db.access.has('fan-1:3'), JSON.stringify(r.data));
  pp.subs.get('I-SUB2').status = 'ACTIVE';
});

await check('No se puede activar la suscripción de otra persona', async () => {
  const r = await post({ action: 'activate', subscriptionId: 'I-SUB-NOEXISTE' });
  expect(r.status === 404, `status ${r.status}`);
});

await check('Cancelar detiene PayPal primero y deja el mes pagado', async () => {
  const before = calls.length;
  const r = await post({ action: 'cancel-subscription', creatorProfileId: '2' });
  expect(r.status === 200 && r.data.until, JSON.stringify(r.data));
  const cancelAt = calls.findIndex((c, i) => i >= before && /\/I-SUB1\/cancel$/.test(c.u));
  const endedAt = calls.findIndex((c, i) => i >= before && c.u.endsWith('paypal_subscription_ended'));
  expect(cancelAt >= 0 && endedAt > cancelAt, 'orden incorrecto');
  expect(db.ended.at(-1).p_id === 'I-SUB1' && db.ended.at(-1).p_now === false, JSON.stringify(db.ended.at(-1)));
});

await check('El webhook sin firma válida no cambia nada', async () => {
  const n = db.payments.size;
  const r = await hook({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-FAKE', billing_agreement_id: 'I-SUB1', amount: { total: '9.99' } } }, 'bad');
  expect(r.status === 401 && db.payments.size === n, JSON.stringify(r.data));
});

await check('El webhook registra cada renovación una vez', async () => {
  await post({ action: 'activate', subscriptionId: 'I-SUB2' });
  const ev = { event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-R2', billing_agreement_id: 'I-SUB2', amount: { total: '9.99', currency: 'USD' } } };
  const r = await hook(ev);
  await hook(ev);
  expect(r.status === 200 && db.payments.get('SALE-R2')?.p_amount === 9.99, JSON.stringify(r.data));
});

await check('Un cobro de una suscripción que ya no existe aquí se cancela y se devuelve', async () => {
  db.access.delete('fan-1:3'); // the fan deleted their account
  const r = await hook({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-R3', billing_agreement_id: 'I-SUB2', amount: { total: '9.99' } } });
  expect(r.status === 200 && pp.cancels.some((c) => c.id === 'I-SUB2') && pp.saleRefunds.includes('SALE-R3'), JSON.stringify(pp.saleRefunds));
});

await check('Un cobro de una suscripción a un perfil demo sin dueño se cancela y se devuelve (sin reintentos)', async () => {
  db.subs.set('I-DEMO', { user: 'fan-1', creator: 'demo-2', status: 'active' });
  db.access.set('fan-1:demo-2', 'I-DEMO');
  const r = await hook({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-DEMO', billing_agreement_id: 'I-DEMO', amount: { total: '6.99' } } });
  expect(r.status === 200 && pp.cancels.some((c) => c.id === 'I-DEMO') && pp.saleRefunds.includes('SALE-DEMO') && !db.payments.has('SALE-DEMO'), `status ${r.status}`);
});

await check('Un cobro a un creador suspendido se cancela, se devuelve y quita el acceso', async () => {
  db.subs.set('I-BAN', { user: 'fan-1', creator: 'banned-2', status: 'active' });
  db.access.set('fan-1:banned-2', 'I-BAN');
  const r = await hook({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-BAN', billing_agreement_id: 'I-BAN', amount: { total: '6.99' } } });
  expect(r.status === 200 && pp.cancels.some((c) => c.id === 'I-BAN') && pp.saleRefunds.includes('SALE-BAN'), `status ${r.status}`);
  expect(db.ended.at(-1).p_id === 'I-BAN' && db.ended.at(-1).p_now === true, 'sigue con acceso');
});

await check('Un cobro a la propia cuenta de creador se cancela, se devuelve y quita el acceso', async () => {
  db.subs.set('I-SELF', { user: 'fan-1', creator: 'self-2', status: 'active' });
  db.access.set('fan-1:self-2', 'I-SELF');
  const r = await hook({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-SELF', billing_agreement_id: 'I-SELF', amount: { total: '6.99' } } });
  expect(r.status === 200 && pp.cancels.some((c) => c.id === 'I-SELF') && pp.saleRefunds.includes('SALE-SELF'), `status ${r.status}`);
  expect(db.ended.at(-1).p_id === 'I-SELF' && db.ended.at(-1).p_now === true, 'sigue con acceso');
});

await check('Reembolso de un pago único: se descuenta de su cobro', async () => {
  const r = await hook({ event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'REF-1', links: [{ rel: 'self', href: 'https://api-m.paypal.com/v2/payments/refunds/REF-1' }, { rel: 'up', href: 'https://api-m.paypal.com/v2/payments/captures/CAP-ORDER2' }] } });
  expect(r.status === 200 && JSON.stringify(db.moneyBack.at(-1)) === JSON.stringify({ p_ref: 'CAP-ORDER2', p_action: 'refund' }), JSON.stringify(db.moneyBack.at(-1)));
  await hook({ event_type: 'PAYMENT.CAPTURE.REVERSED', resource: { id: 'CAP-ORDER3' } });
  expect(db.moneyBack.at(-1).p_ref === 'CAP-ORDER3' && db.moneyBack.at(-1).p_action === 'refund', 'contracargo');
});

await check('Reembolso de una mensualidad: se descuenta y la suscripción se cancela en PayPal', async () => {
  const r = await hook({ event_type: 'PAYMENT.SALE.REFUNDED', resource: { id: 'RF-9', sale_id: 'SALE-R2' } });
  expect(r.status === 200 && db.moneyBack.at(-1).p_ref === 'SALE-R2' && db.moneyBack.at(-1).p_action === 'refund', JSON.stringify(db.moneyBack.at(-1)));
  expect(pp.subs.get('I-SUB2').status === 'CANCELLED'&&calls.some(c=>c.u.endsWith('paypal_refund_followup')), 'no confirmó la cancelación');
});

await check('Disputa: se congela; según PayPal se devuelve al fan o se libera', async () => {
  const dispute = (type, outcome) =>
    hook({ event_type: type, resource: { dispute_id: 'PP-D-1', disputed_transactions: [{ seller_transaction_id: 'CAP-ORDER4' }], ...(outcome ? { dispute_outcome: { outcome_code: outcome } } : {}) } });
  await dispute('CUSTOMER.DISPUTE.CREATED');
  expect(db.moneyBack.at(-1).p_ref === 'CAP-ORDER4' && db.moneyBack.at(-1).p_action === 'dispute', 'no congeló');
  await dispute('CUSTOMER.DISPUTE.RESOLVED', 'RESOLVED_SELLER_FAVOUR');
  expect(db.moneyBack.at(-1).p_action === 'release', 'no liberó');
  await dispute('CUSTOMER.DISPUTE.RESOLVED', 'RESOLVED_BUYER_FAVOUR');
  expect(db.moneyBack.at(-1).p_action === 'dispute', 'debe conciliar los comprobantes, sin suponer una devolución total');
});

await check('Un pago fallido (suspendida) quita el acceso al momento', async () => {
  const r = await hook({ event_type: 'BILLING.SUBSCRIPTION.SUSPENDED', resource: { id: 'I-SUB2' } });
  expect(r.status === 200 && db.ended.at(-1).p_id === 'I-SUB2' && db.ended.at(-1).p_now === true, JSON.stringify(db.ended.at(-1)));
});

await check('Sin PAYPAL_WEBHOOK_ID el webhook no acepta nada', async () => {
  delete process.env.PAYPAL_WEBHOOK_ID;
  const r = await hook({ event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: 'I-SUB1' } });
  process.env.PAYPAL_WEBHOOK_ID = 'WH-1';
  expect(r.status === 503, `status ${r.status}`);
});

await check('Retirar envía a PayPal el neto (sin la comisión) una sola vez y queda pagado', async () => {
  const r = await post({ action: 'payout' });
  expect(r.status === 200 && r.data.status === 'paid' && r.data.net === 156.8 && r.data.fee === 3.2, JSON.stringify(r.data));
  const batch = pp.payoutBatches.get('BATCH-po-1');
  expect(batch.items[0].amount.value === '156.80' && batch.items[0].amount.currency === 'USD' && batch.items[0].receiver === 'vale@example.com', JSON.stringify(batch));
  expect(batch.sender_batch_header.sender_batch_id === 'po-1', 'sin id idempotente');
  expect(db.payouts.get('po-1').status === 'paid', 'no quedó pagado');
});

await check('Si PayPal rechaza el envío, el retiro falla y el saldo vuelve', async () => {
  pp.payoutFail = 'INSUFFICIENT_FUNDS';
  const r = await post({ action: 'payout' });
  pp.payoutFail = '';
  expect(r.status === 502 && /saldo sigue disponible/.test(r.data.error), JSON.stringify(r.data));
  expect(db.payouts.get('po-2').status === 'failed', 'no quedó fallido');
});

await check('Sin email de PayPal o sin saldo no se envía nada', async () => {
  db.payoutError = 'Añade el email de tu cuenta PayPal para retiros';
  const before = pp.payoutBatches.size;
  const r = await post({ action: 'payout' });
  db.payoutError = '';
  expect(r.status === 400 && /email de tu cuenta PayPal/.test(r.data.error) && pp.payoutBatches.size === before, JSON.stringify(r.data));
});

await check('Un retiro que PayPal aún procesa queda en camino y el webhook lo confirma', async () => {
  pp.payoutStatus = 'PENDING';
  const r = await post({ action: 'payout' });
  pp.payoutStatus = 'SUCCESS';
  expect(r.status === 200 && r.data.status === 'sending' && db.payouts.get('po-3').status === 'sending', JSON.stringify(r.data));
  const h = await hook({ event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { payout_item_id: 'ITEM-3', transaction_status: 'SUCCESS', payout_batch_id: 'BATCH-po-3', payout_item: { sender_item_id: 'po-3' } } });
  expect(h.status === 200 && db.payouts.get('po-3').status === 'paid', JSON.stringify(db.payouts.get('po-3')));
});

await check('Un retiro devuelto por PayPal (no reclamado) regresa al saldo', async () => {
  pp.payoutStatus = 'RETURNED';
  const h = await hook({ event_type: 'PAYMENT.PAYOUTS-ITEM.RETURNED', resource: { payout_item_id: 'ITEM-1', transaction_status: 'RETURNED', payout_item: { sender_item_id: 'po-1' } } });
  pp.payoutStatus = 'SUCCESS';
  expect(h.status === 200 && db.payouts.get('po-1').status === 'failed', JSON.stringify(db.payouts.get('po-1')));
});

await check('Si el aviso de PayPal no llega, al abrir Ingresos se le vuelve a preguntar', async () => {
  pp.payoutStatus = 'PENDING';
  const r = await post({ action: 'payout' });
  expect(r.status === 200 && db.payouts.get('po-4').status === 'sending', JSON.stringify(r.data));
  const pending = await post({ action: 'payout-check' });
  expect(pending.status === 200 && pending.data.items[0]?.paypalStatus === 'PENDING' && db.payouts.get('po-4').status === 'sending', JSON.stringify(pending.data));
  pp.payoutStatus = 'SUCCESS';
  const done = await post({ action: 'payout-check' });
  expect(done.data.items[0]?.status === 'paid' && db.payouts.get('po-4').status === 'paid', JSON.stringify(done.data));
});

await check('Un retiro a un email sin cuenta PayPal se puede cancelar y vuelve al saldo', async () => {
  pp.payoutStatus = 'UNCLAIMED';
  const r = await post({ action: 'payout' });
  expect(r.status === 200 && db.payouts.get('po-5').status === 'sending', JSON.stringify(r.data));
  const other = await post({ action: 'payout-cancel', payoutId: 'po-4' });
  expect(other.status === 404 && db.payouts.get('po-4').status === 'paid', JSON.stringify(other.data));
  const c = await post({ action: 'payout-cancel', payoutId: 'po-5' });
  pp.payoutStatus = 'SUCCESS';
  expect(c.status === 200 && db.payouts.get('po-5').status === 'failed', JSON.stringify(c.data));
});

await check('La service role solo se usa en llamadas del servidor', async () => {
  const leaked = calls.filter((c) => c.h.apikey === 'sb_secret_test' && !/paypal_(register|fulfill|mark|catalog|self_pay|money_back|income_(receive|claim|context|apply|retry|action_claim|action_confirm|complete)|refund_(receive|apply|followup)|subscription_(register|activate|payment|ended)|payout_(start|begin|claim|submission_result|event_receive|event_pending|reconcile_begin|reconcile_finish))|\/rest\/v1\/payouts\?|\/rest\/v1\/paypal_orders\?id=eq\.[^&]+&(status=eq\.created|select=kind,params)$/.test(c.u));
  expect(leaked.length === 0, leaked.map((c) => c.u).join(', '));
});

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} pruebas fallaron` : '\nTodas las pruebas de la API de PayPal pasaron');
process.exit(failures ? 1 : 0);
