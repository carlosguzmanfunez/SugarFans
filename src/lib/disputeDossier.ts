// PayPal dispute dossier for a Reserve booking. The admin downloads one English
// HTML file, opens it and prints it to PDF (PayPal accepts PDF/JPG/PNG uploads).
// Only facts recorded by the server are stated; anything unverified is marked
// for review instead of being written as delivered.
import { summarizeSession, type SessionReceipt } from './reserveSession';

export interface DossierPayment { order_id: string; capture_id: string | null; amount: number | string; fee: number | string | null; status: string; created_at: string; completed_at: string | null }
export interface DisputeDossier {
  generated_at: string;
  booking: {
    id: string; title: string; experience_id?: string; creator_name: string; creator_profile_id?: string;
    fan_name: string; fan_email?: string; price: number | string; status: string; date: string; time: string;
    time_zone: string; duration_minutes: number | null; modality: string; kind?: string | null; fan_message?: string;
    session_policy_version: string; reserve_rules_version?: number; created_at: string; updated_at?: string;
    paid_at: string | null; confirmation_email_sent_at?: string | null;
  };
  fan: { id: string; account_created_at?: string | null; terms_accepted_at: string | null; terms_version: string | null;
    terms_history: Array<{ version: string; method: string; accepted_at: string }>; reserve_bookings_with_creator?: number };
  payments: DossierPayment[];
  refund_requests: Array<{ amount: number | string; reason: string; state: string; creator_fault: boolean; recovered_fee?: number | string; created_at: string; updated_at?: string }>;
  disputes: Array<{ dispute_id: string; payment_ref: string; status: string; outcome: string | null; refunded: number | string | null }>;
  attendance: SessionReceipt | null;
}

export const DOSSIER_REFERENCE = /^[A-Za-z0-9-]{6,64}$/;
// The pre-payment notice went live with PR #159 (merged 2026-11-05 ~18:15 UTC).
export const PAY_NOTICE_SINCE = '2026-11-05T18:15:00Z';
export const PAY_NOTICE_ES = 'Cancelación: con 24 h o más te devolvemos el 100% y con menos de 24 h el 50%, menos la comisión de cobro de PayPal, que no es reembolsable. Si eliges Créditos, recibes el importe completo. Si el creador cancela, te devolvemos el 100%.';
export const PAY_NOTICE_EN = 'Cancellation: at least 24 h before you get 100% back and less than 24 h before 50%, minus the PayPal collection fee, which is non-refundable. If you choose Credits, you get the full amount. If the creator cancels, you get 100% back.';
const TIMING_EN = 'The booking keeps its end time if the fan arrives late. Time lost for reasons attributable to the fan is not made up. The creator has a one-minute grace period and must complete the contracted duration. Service failures and statutory rights are reviewed separately.';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (v: unknown) => v === null || v === undefined || v === '' ? '—' : `USD ${Number(v).toFixed(2)}`;
export function utc(at: string | null | undefined): string {
  if (!at) return '—';
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '—';
  const hn = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Tegucigalpa', dateStyle: 'medium', timeStyle: 'medium' }).format(d);
  return `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC (${hn} Honduras, UTC−6)`;
}
const minutes = (s: number) => `${Math.floor(s / 60)} min ${s % 60} s`;
const kindLabel = (k: string) => k === 'participant_joined' ? 'Joined the call' : k === 'participant_left' ? 'Left the call' : k === 'participant_connection_aborted' ? 'Connection interrupted' : k;
const role = (r: string) => r === 'creator' ? 'Creator (seller side)' : 'Buyer (fan)';

export interface DeliveryFacts { verified: boolean; booked: number; shared: number; fanJoined: boolean; creatorJoined: boolean; full: boolean; review: boolean }
export function deliveryFacts(d: DisputeDossier): DeliveryFacts | null {
  const r = d.attendance; if (!r) return null;
  const s = summarizeSession(r), booked = Math.round((Date.parse(r.end_at) - Date.parse(r.start_at)) / 1000);
  const joined = (who: 'fan' | 'creator') => r.events.some(e => e.source === 'livekit' && e.role === who && e.kind === 'participant_joined');
  return { verified: s.verified, booked, shared: s.sharedSeconds, fanJoined: joined('fan'), creatorJoined: joined('creator'),
    full: s.verified && s.sharedSeconds >= booked, review: !s.verified || s.requiresReview || s.sharedSeconds < booked };
}

export function dossierHtml(d: DisputeDossier): string {
  const b = d.booking, f = d.fan, pay = d.payments.find(p => p.status === 'completed' || p.status === 'refunded') ?? d.payments[0];
  const facts = deliveryFacts(d), r = d.attendance;
  const paidAt = pay?.completed_at ?? b.paid_at;
  const noticeShown = !!paidAt && Date.parse(paidAt) >= Date.parse(PAY_NOTICE_SINCE);
  const service = `${b.modality === 'virtual' ? 'Live one-to-one video call' : 'In-person experience'}${b.duration_minutes ? ` of ${b.duration_minutes} minutes` : ''} with the content creator “${b.creator_name}”, booked through fansreserve.com (“${b.title}”)`;
  const events = r ? r.events.filter(e => e.source === 'livekit').sort((a, c) => a.at.localeCompare(c.at)) : [];
  const browser = r ? r.events.filter(e => e.source === 'browser').sort((a, c) => a.at.localeCompare(c.at)) : [];

  const response: string[] = [];
  response.push(`The buyer purchased a digital service: a ${service.charAt(0).toLowerCase()}${service.slice(1)}, scheduled for ${utc(r?.start_at ?? null)}.`);
  if (f.terms_accepted_at && (!paidAt || Date.parse(f.terms_accepted_at) <= Date.parse(paidAt))) response.push(`Before purchasing, the buyer accepted our Terms of Service (version ${f.terms_version}) on ${utc(f.terms_accepted_at)}.`);
  if (noticeShown) response.push('Our cancellation policy was displayed next to the PayPal button before payment (copy included).');
  if (facts?.full) response.push(`Our video provider (LiveKit) recorded signed join and leave events for both participants. The buyer and the creator were connected together for ${minutes(facts.shared)}, covering the full ${minutes(facts.booked)} that were booked. The service was delivered as described.`);
  else if (facts?.verified && facts.fanJoined) response.push(`Our video provider (LiveKit) recorded signed join and leave events showing the buyer joined the call; both were connected together for ${minutes(facts.shared)} of the ${minutes(facts.booked)} booked.`);
  if (!d.refund_requests.length) response.push('The buyer never requested a cancellation or refund through the platform.');
  response.push('All times and records are attached. We do not record calls to protect the privacy of both participants.');

  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fans Reserve — Dispute evidence ${esc(pay?.capture_id ?? b.id)}</title>
<style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;max-width:860px;margin:24px auto;padding:0 16px}
h1{font-size:22px;margin:0}h2{font-size:16px;margin:28px 0 8px;border-bottom:2px solid #111;padding-bottom:4px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #ddd}th{width:34%;font-weight:600;color:#333}
.muted{color:#555;font-size:12px}.box{border:1px solid #ccc;border-radius:6px;padding:12px;background:#fafafa}
.warn{border:2px solid #b45309;background:#fffbeb;padding:12px;border-radius:6px}.ok{color:#166534;font-weight:600}
.howto{background:#eef2ff;border:1px solid #6366f1;padding:12px;border-radius:6px}@media print{.howto{display:none}body{margin:0}}</style></head><body>
<div class="howto"><b>Para subirlo a PayPal:</b> abre este archivo, pulsa Imprimir (Ctrl+P, o Compartir → Imprimir en el celular) y elige «Guardar como PDF». Sube ese PDF en el Centro de resoluciones y pega el texto de la sección 1 como respuesta. Este recuadro no sale en el PDF.</div>
<h1>Fans Reserve — Seller evidence for PayPal dispute</h1>
<p class="muted">Seller: Fans Reserve (fansreserve.com) · support@fansreserve.com · Generated ${esc(utc(d.generated_at))}</p>
${facts && facts.review ? `<div class="warn"><b>Internal review needed before sending:</b> ${!facts.verified ? 'no signed connection from the video provider was recorded for this booking.' : 'the verified shared time is shorter than the booked time or some records are incomplete.'} Do not claim full delivery unless other evidence supports it.</div>` : ''}

<h2>1. Summary for the PayPal case</h2>
<div class="box">${response.map(p => `<p>${esc(p)}</p>`).join('')}</div>

<h2>2. Transaction</h2><table>
${row('PayPal transaction (capture) ID', esc(pay?.capture_id ?? '—'))}
${row('PayPal order ID', esc(pay?.order_id ?? '—'))}
${row('Amount charged', esc(money(pay?.amount ?? b.price)))}
${row('PayPal fee', esc(money(pay?.fee)))}
${row('Payment completed', esc(utc(paidAt)))}
${row('Payment status in our records', esc(pay?.status ?? 'no PayPal payment found'))}
${d.payments.length > 1 ? row('Other PayPal orders for this booking', esc(d.payments.filter(p => p !== pay).map(p => `${p.order_id} (${p.status})`).join(', '))) : ''}
</table>

<h2>3. Service purchased</h2><table>
${row('Description', esc(service))}
${row('Type', 'Intangible digital service delivered online through the Fans Reserve website (no physical shipment)')}
${row('Booking reference', esc(b.id))}
${row('Scheduled start', esc(utc(r?.start_at ?? null)))}
${row('Scheduled end', esc(utc(r?.end_at ?? null)))}
${row('Booked in time zone', esc(`${b.date} ${b.time} (${b.time_zone})`))}
${row('Booking status', esc(b.status))}
${row('Booking created', esc(utc(b.created_at)))}
${row('Confirmation e-mail sent', esc(utc(b.confirmation_email_sent_at)))}
</table>

<h2>4. Buyer</h2><table>
${row('Name on the platform', esc(b.fan_name))}
${row('E-mail on the platform', esc(b.fan_email ?? '—'))}
${row('Account created', esc(utc(f.account_created_at)))}
${row('Terms of Service accepted', f.terms_accepted_at ? esc(`Version ${f.terms_version}, ${utc(f.terms_accepted_at)}`) : 'Not stored (account created before acceptance records started on 2026-11-05; acceptance was a required checkbox at sign-up)')}
${f.terms_history.length ? row('Acceptance history', esc(f.terms_history.map(t => `${t.version} · ${t.method} · ${utc(t.accepted_at)}`).join(' | '))) : ''}
${row('Confirmed bookings with this creator (incl. this one)', esc(f.reserve_bookings_with_creator ?? '—'))}
</table>

<h2>5. Proof of delivery (video call connection records)</h2>
${!r ? '<p>This booking has no online session (in-person or no duration).</p>' : `<p class="muted">Events below are sent by our video provider LiveKit through signed webhooks (signature and body hash verified by our server). The buyer and the creator cannot create or change them, and the records are append-only (no edits or deletions).</p>
<table>${row('Verified time both were connected together', facts?.verified ? `<span class="${facts.full ? 'ok' : ''}">${esc(minutes(facts.shared))}</span> of ${esc(minutes(facts.booked))} booked` : 'Not verified')}
${row('Buyer joined', facts?.fanJoined ? 'Yes' : 'No signed join recorded')}
${row('Creator joined', facts?.creatorJoined ? 'Yes' : 'No signed join recorded')}</table>
<table style="margin-top:10px"><tr><th>Time</th><th>Participant</th><th>Event</th></tr>
${events.length ? events.map(e => `<tr><td>${esc(utc(e.at))}</td><td>${esc(role(e.role))}</td><td>${esc(kindLabel(e.kind))}</td></tr>`).join('') : '<tr><td colspan="3">No signed events.</td></tr>'}</table>
${browser.length ? `<p class="muted">Also recorded by the website (server time, lower weight): ${esc(browser.map(e => `${role(e.role)} ${e.kind.replace(/_/g, ' ')} at ${utc(e.at)}`).join('; '))}.</p>` : ''}`}

<h2>6. Reminders sent before the call</h2>
${r && r.reminders.length ? `<table><tr><th>Recipient</th><th>When</th><th>Delivery</th></tr>${r.reminders.map(m => `<tr><td>${esc(role(m.role))}</td><td>${esc(`${m.minutes_before} min before`)}</td><td>${esc(m.opened_at ? `Opened by the recipient ${utc(m.opened_at)}` : m.push_accepted_at ? `Accepted by the push service ${utc(m.push_accepted_at)}` : m.push_attempted_at ? `Sent ${utc(m.push_attempted_at)}` : `Created ${utc(m.created_at)}`)}</td></tr>`).join('')}</table>` : '<p>No reminders recorded for this booking.</p>'}

<h2>7. Policies the buyer agreed to</h2>
<p><b>Cancellation notice shown next to the PayPal button before payment</b>${noticeShown ? '' : ' (this notice was added on 2026-11-05; for earlier payments the same rule was in the Terms and the Reserve policy)'}:</p>
<div class="box"><p>${esc(PAY_NOTICE_EN)}</p><p class="muted">Original text shown to the buyer (Spanish): ${esc(PAY_NOTICE_ES)}</p></div>
${b.session_policy_version !== 'legacy' ? `<p><b>Session rules accepted with the booking (${esc(b.session_policy_version)}):</b> ${esc(TIMING_EN)}</p>` : ''}
<p class="muted">Full terms: https://fansreserve.com/legal (Terms of Service, Reserve policy, Refund policy).</p>

<h2>8. Cancellations, refunds and previous disputes</h2>
${d.refund_requests.length ? `<table><tr><th>Requested</th><th>Reason</th><th>Amount</th><th>State</th></tr>${d.refund_requests.map(q => `<tr><td>${esc(utc(q.created_at))}</td><td>${esc(q.reason)}${q.creator_fault ? ' (creator)' : ''}</td><td>${esc(money(q.amount))}</td><td>${esc(q.state)}</td></tr>`).join('')}</table>` : '<p>The buyer did not request a cancellation or refund through the platform.</p>'}
${d.disputes.length ? `<p>Disputes recorded from PayPal: ${esc(d.disputes.map(x => `${x.dispute_id} (${x.status}${x.outcome ? `, ${x.outcome}` : ''})`).join('; '))}</p>` : ''}

<p class="muted" style="margin-top:28px">Fans Reserve does not record video calls. These records are kept to document service delivery. Generated from the Fans Reserve database; booking ${esc(b.id)}.</p>
</body></html>`;
}

export const dossierFileName = (d: DisputeDossier) => {
  const pay = d.payments.find(p => p.capture_id)?.capture_id ?? d.booking.id;
  return `fans-reserve-dispute-${pay.replace(/[^A-Za-z0-9-]/g, '')}.html`;
};
