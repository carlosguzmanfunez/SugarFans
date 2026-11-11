// PayPal dispute dossier for a subscription (monthly access to a creator's
// exclusive content). Same flow as the Reserve dossier (disputeDossier.ts): the
// admin downloads one English HTML file, prints it to PDF and uploads it in
// PayPal's Resolution Center. Only facts recorded by the server are stated;
// gaps are flagged for review instead of being claimed.
import { utc } from './disputeDossier';

export interface SubscriptionDossier {
  generated_at: string;
  disputed_sale: string | null;
  subscription: {
    paypal_subscription_id: string; status: string; amount: number | string; created_at: string; activated_at: string | null;
    creator_profile_id: string; creator_name: string | null; since: string | null; cancel_at: string | null;
    access_paused_at: string | null; auto_renew: boolean;
  };
  fan: { id: string | null; name: string | null; email: string | null; account_created_at: string | null; terms_accepted_at: string | null;
    terms_version: string | null; terms_history: Array<{ version: string; method: string; accepted_at: string }> };
  charges: Array<{ sale_id: string; kind: string; amount: number | string; fee: number | string | null; status: string; refunded: number | string; created_at: string }>;
  disputes: Array<{ dispute_id: string; payment_ref: string; status: string; outcome: string | null; refunded: number | string | null; reason: string | null; opened_at: string | null }>;
  renewal_reminders: Array<{ renews_at: string; amount: number | string; sent_at: string; bell: boolean; bell_read_at: string | null; email: boolean; email_delivered_at: string | null; email_error: string | null }>;
  access_log: Array<{ at: string; kind: 'profile_view' | 'post_open'; post_id: string | null; post_created_at: string | null; media_type: string | null; locked_posts: number | null }>;
  content: { locked_at_start: number; locked_now: number; posts_since_start: Array<{ id: string; created_at: string; locked: boolean; media_type: string | null }> };
}

export const SUBSCRIPTION_DOSSIER_REFERENCE = /^[A-Za-z0-9-]{6,64}$/;
// Shown in the checkout before the buyer approves the PayPal subscription
// (CreatorProfile → CheckoutDialog note) since 2026-11-03.
export const CHECKOUT_NOTE_SINCE = '2026-11-03T04:43:00Z';
const CHECKOUT_NOTE_ES = 'Mensual. Se renueva el día N de cada mes; cancela cuando quieras.';
const CHECKOUT_NOTE_EN = 'Monthly. Renews on day N of every month; cancel anytime.';
const TERMS_EN = [
  'Subscriptions renew every month on the date you subscribed.',
  'You can cancel at any time, with no minimum term; after cancelling you keep access until the end of the paid month and are not charged again.',
  'There are no refunds for partial periods.',
  'We notify you in the notification bell and by e-mail about 3 days before each automatic renewal, with the date and amount (from Terms version 1.7.0).',
  'If you open a dispute or chargeback with PayPal about a subscription charge, access to that creator\'s exclusive content is paused while it is resolved (from Terms version 1.7.0).',
];

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (v: unknown) => v === null || v === undefined || v === '' ? '—' : `USD ${Number(v).toFixed(2)}`;
const day = (at: string) => at.slice(0, 10);

// The charge the dispute is about and the period it paid for (one month).
export function disputedPeriod(d: SubscriptionDossier) {
  const charge = d.charges.find(c => c.sale_id === d.disputed_sale) ?? d.charges.find(c => c.status === 'disputed') ?? d.charges[d.charges.length - 1];
  if (!charge) return null;
  const start = new Date(charge.created_at), end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const inPeriod = (at: string) => Date.parse(at) >= start.getTime() && Date.parse(at) < end.getTime();
  const access = d.access_log.filter(l => inPeriod(l.at));
  // A reminder counts for this charge when it announced a renewal within a day of it.
  const reminder = d.renewal_reminders.find(r => Math.abs(Date.parse(r.renews_at) - start.getTime()) <= 36 * 3600 * 1000) ?? null;
  return {
    charge, start: start.toISOString(), end: end.toISOString(), access, reminder,
    profileViews: access.filter(l => l.kind === 'profile_view').length,
    postsOpened: new Set(access.filter(l => l.kind === 'post_open' && l.post_id).map(l => l.post_id)).size,
    newPosts: d.content.posts_since_start.filter(p => p.locked && inPeriod(p.created_at)).length,
  };
}

export function subscriptionDossierHtml(d: SubscriptionDossier): string {
  const s = d.subscription, f = d.fan, p = disputedPeriod(d);
  const creator = s.creator_name || 'the creator';
  const started = s.activated_at ?? s.created_at;
  const renewal = p?.charge.kind === 'renewal';
  const lastAccess = p?.access.length ? p.access[p.access.length - 1].at : null;
  const checkoutShown = Date.parse(started) >= Date.parse(CHECKOUT_NOTE_SINCE);
  const review: string[] = [];
  if (!p) review.push('no subscription charge is recorded for this reference.');
  else {
    if (!p.access.length) review.push('no access by the buyer was recorded during the disputed period.');
    if (renewal && !p.reminder) review.push('no renewal reminder is recorded for the disputed renewal.');
    if (renewal && p.reminder && !p.reminder.email_delivered_at) review.push('the renewal reminder e-mail has no delivery confirmation.');
  }

  const summary: string[] = [];
  summary.push(`The buyer purchased a monthly subscription to the exclusive digital content (photos, videos and posts) of the content creator “${creator}” on fansreserve.com, for ${money(s.amount)} per month, started on ${utc(started)}. The buyer approved the automatic monthly renewal in PayPal (PayPal subscription ${s.paypal_subscription_id}).`);
  if (f.terms_accepted_at && Date.parse(f.terms_accepted_at) <= Date.parse(started)) summary.push(`Before subscribing, the buyer accepted our Terms of Service (version ${f.terms_version}) on ${utc(f.terms_accepted_at)}. They state that subscriptions renew monthly, can be cancelled at any time and that partial periods are not refunded.`);
  if (checkoutShown) summary.push('The checkout showed, before payment, that the subscription is monthly, renews on the same day every month and can be cancelled anytime.');
  if (p && renewal && p.reminder) summary.push(`On ${utc(p.reminder.sent_at)} we reminded the buyer${p.reminder.email ? ' in the website notification bell and by e-mail' : ' in the website notification bell'} that the subscription would renew on ${day(p.reminder.renews_at)} for ${money(p.reminder.amount)}, and that it could be cancelled from their account.${p.reminder.email_delivered_at ? ` The e-mail was accepted for delivery at ${utc(p.reminder.email_delivered_at)}.` : ''} The buyer did not cancel before the renewal.`);
  if (p && p.access.length) summary.push(`During the disputed period (${day(p.start)} to ${day(p.end)}) the buyer opened the creator's profile ${p.profileViews} time(s) and opened ${p.postsOpened} exclusive post(s); the last recorded access was on ${utc(lastAccess)}. The content was available and used.`);
  if (p && (d.content.locked_at_start > 0 || p.newPosts > 0)) summary.push(`The creator had ${d.content.locked_at_start} exclusive post(s) available when the subscription started${p.newPosts ? ` and published ${p.newPosts} new exclusive post(s) during the disputed period` : ''}.`);
  if (s.access_paused_at) summary.push(`As soon as the dispute was opened we paused the buyer's access to the exclusive content (${utc(s.access_paused_at)}).`);
  summary.push('Access records contain only the time, the type of access and the post opened; we do not store IP addresses or device data.');

  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fans Reserve — Subscription dispute evidence ${esc(d.disputed_sale ?? s.paypal_subscription_id)}</title>
<style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;max-width:860px;margin:24px auto;padding:0 16px}
h1{font-size:22px;margin:0}h2{font-size:16px;margin:28px 0 8px;border-bottom:2px solid #111;padding-bottom:4px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #ddd}th{width:34%;font-weight:600;color:#333}
.muted{color:#555;font-size:12px}.box{border:1px solid #ccc;border-radius:6px;padding:12px;background:#fafafa}
.warn{border:2px solid #b45309;background:#fffbeb;padding:12px;border-radius:6px}
.howto{background:#eef2ff;border:1px solid #6366f1;padding:12px;border-radius:6px}@media print{.howto{display:none}body{margin:0}}</style></head><body>
<div class="howto"><b>Para subirlo a PayPal:</b> abre este archivo, pulsa Imprimir (Ctrl+P, o Compartir → Imprimir en el celular) y elige «Guardar como PDF». Sube ese PDF en el Centro de resoluciones y pega el texto de la sección 1 como respuesta. Este recuadro no sale en el PDF.</div>
<h1>Fans Reserve — Seller evidence for PayPal dispute (subscription)</h1>
<p class="muted">Seller: Fans Reserve (fansreserve.com) · support@fansreserve.com · Generated ${esc(utc(d.generated_at))}</p>
${review.length ? `<div class="warn"><b>Internal review needed before sending:</b> ${esc(review.join(' '))} Do not claim what the records do not show.</div>` : ''}

<h2>1. Summary for the PayPal case</h2>
<div class="box">${summary.map(x => `<p>${esc(x)}</p>`).join('')}</div>

<h2>2. Disputed charge</h2><table>
${row('PayPal transaction ID', esc(p?.charge.sale_id ?? '—'))}
${row('PayPal subscription ID', esc(s.paypal_subscription_id))}
${row('Amount charged', esc(money(p?.charge.amount ?? s.amount)))}
${row('PayPal fee', esc(money(p?.charge.fee)))}
${row('Charge date', esc(utc(p?.charge.created_at)))}
${row('Charge type', esc(p ? (renewal ? 'Automatic monthly renewal' : 'First month') : '—'))}
${row('Period paid', esc(p ? `${day(p.start)} to ${day(p.end)}` : '—'))}
${row('Status in our records', esc(p?.charge.status ?? '—'))}
</table>
${d.disputes.length ? `<p>Disputes recorded from PayPal: ${esc(d.disputes.map(x => `${x.dispute_id} on ${x.payment_ref} (${x.status}${x.reason ? `, ${x.reason}` : ''}${x.outcome ? `, ${x.outcome}` : ''})`).join('; '))}</p>` : ''}

<h2>3. Service purchased</h2><table>
${row('Description', esc(`Monthly subscription to the exclusive content of “${creator}” on fansreserve.com`))}
${row('Type', 'Intangible digital content delivered online through the Fans Reserve website (no physical shipment)')}
${row('Subscription started', esc(utc(started)))}
${row('Automatic renewal', esc(s.auto_renew ? 'On (not cancelled by the buyer)' : s.cancel_at ? `Cancelled by the buyer; access until ${utc(s.cancel_at)}` : 'Off'))}
${row('Access paused because of the dispute', esc(s.access_paused_at ? utc(s.access_paused_at) : 'No'))}
${row('Exclusive posts available at start', esc(d.content.locked_at_start))}
${row('Exclusive posts available now', esc(d.content.locked_now))}
</table>

<h2>4. Buyer</h2><table>
${row('Name on the platform', esc(f.name ?? '—'))}
${row('E-mail on the platform', esc(f.email ?? '—'))}
${row('Account created', esc(utc(f.account_created_at)))}
${row('Terms of Service accepted', f.terms_accepted_at ? esc(`Version ${f.terms_version}, ${utc(f.terms_accepted_at)}`) : 'Not stored (account created before acceptance records started on 2026-11-05; acceptance was a required checkbox at sign-up)')}
${f.terms_history.length ? row('Acceptance history', esc(f.terms_history.map(t => `${t.version} · ${t.method} · ${utc(t.accepted_at)}`).join(' | '))) : ''}
</table>

<h2>5. All charges of this subscription</h2>
${d.charges.length ? `<table><tr><th>Date</th><th>Transaction ID</th><th>Type</th><th>Amount</th><th>Status</th></tr>${d.charges.map(c => `<tr><td>${esc(utc(c.created_at))}</td><td>${esc(c.sale_id)}</td><td>${esc(c.kind === 'renewal' ? 'Renewal' : 'First month')}</td><td>${esc(money(c.amount))}</td><td>${esc(c.status)}</td></tr>`).join('')}</table>` : '<p>No charges recorded.</p>'}

<h2>6. Renewal reminders sent to the buyer</h2>
${d.renewal_reminders.length ? `<table><tr><th>Sent</th><th>Announced renewal</th><th>Channels</th><th>Delivery</th></tr>${d.renewal_reminders.map(r => `<tr><td>${esc(utc(r.sent_at))}</td><td>${esc(`${day(r.renews_at)} · ${money(r.amount)}`)}</td><td>${esc([r.bell ? 'Website notification' : '', r.email ? 'E-mail' : ''].filter(Boolean).join(' + '))}</td><td>${esc([r.bell_read_at ? `Notification read ${utc(r.bell_read_at)}` : '', r.email_delivered_at ? `E-mail accepted for delivery ${utc(r.email_delivered_at)}` : r.email_error ? 'E-mail not delivered' : r.email ? 'E-mail queued' : ''].filter(Boolean).join('; ') || '—')}</td></tr>`).join('')}</table>
<p class="muted">Text of the reminder (Spanish original): “Tu suscripción a ${esc(creator)} se renovará el [date] por [amount]. Si no deseas renovarla, puedes cancelarla desde Mi cuenta.” — English: “Your subscription to ${esc(creator)} will renew on [date] for [amount]. If you do not want to renew it, you can cancel it from My account.”</p>` : '<p>No renewal reminders recorded (reminders started on 2026-11-10).</p>'}

<h2>7. Buyer's access to the content</h2>
${d.access_log.length ? `<p class="muted">Recorded by our server when the signed-in buyer opened the creator's profile or an exclusive post (at most one record per page every 30 minutes). Times only; no IP address or device data.</p>
<table><tr><th>Time</th><th>Access</th><th>Exclusive post</th></tr>${d.access_log.map(l => `<tr><td>${esc(utc(l.at))}</td><td>${esc(l.kind === 'profile_view' ? 'Opened the creator profile' : 'Opened an exclusive post')}</td><td>${esc(l.kind === 'post_open' ? `${l.media_type ?? 'text'} post published ${l.post_created_at ? day(l.post_created_at) : '—'}` : l.locked_posts !== null ? `${l.locked_posts} exclusive posts available` : '')}</td></tr>`).join('')}</table>` : '<p>No access recorded (records started on 2026-11-10).</p>'}

<h2>8. Exclusive content published since the subscription started</h2>
${d.content.posts_since_start.filter(x => x.locked).length ? `<table><tr><th>Published</th><th>Type</th></tr>${d.content.posts_since_start.filter(x => x.locked).map(x => `<tr><td>${esc(utc(x.created_at))}</td><td>${esc(x.media_type ?? 'text')}</td></tr>`).join('')}</table>` : '<p>No new exclusive posts since the subscription started.</p>'}

<h2>9. Terms the buyer agreed to (subscriptions)</h2>
<div class="box"><ul>${TERMS_EN.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
${checkoutShown ? `<p><b>Shown at checkout before payment:</b> ${esc(CHECKOUT_NOTE_EN)} <span class="muted">(Spanish original: ${esc(CHECKOUT_NOTE_ES)})</span></p>` : ''}
<p class="muted">Full terms: https://fansreserve.com/legal (Terms of Service, section 6.2).</p>

<p class="muted" style="margin-top:28px">Generated from the Fans Reserve database; subscription ${esc(s.paypal_subscription_id)}.</p>
</body></html>`;
}

export const subscriptionDossierFileName = (d: SubscriptionDossier) =>
  `fans-reserve-subscription-dispute-${(d.disputed_sale ?? d.subscription.paypal_subscription_id).replace(/[^A-Za-z0-9-]/g, '')}.html`;
