// "Mano derecha" chat, browser side: gathers the open cases with the admin's own
// session (the same lists the admin screens use), asks the server, and runs an
// action only when the admin clicks "Aplicar" and confirms. Each action calls the
// very same function as the button in its admin screen.
import { backend } from './backend';
import { platformApi, platformChanged, resolveReport, reviewVerification } from './platform';
import { PROBLEM_SECTION } from './adminMonitor';
import type { User } from './backend/types';
import type { ActionType, AssistantCase, AssistantPlan, CaseKind, ChatTurn } from './assistantPlan';

// What the panel keeps about a case to act on it (never sent to the server).
export interface CaseRef { kind: CaseKind; ref: string; section: string; extra?: string }
export interface CaseBundle { cases: AssistantCase[]; refs: Record<string, CaseRef>; status: unknown; failed: string[] }

const SECTION: Record<CaseKind, string> = {
  report: 'reports', verification: 'verifications', media: 'moderation', refund: 'payouts',
  dispute: 'finance', payout: 'payouts', error: 'errors', alert: 'overview',
};
// Monitor alerts that no list below covers already.
const ALERT_ONLY = new Set(['incidentes', 'tareas_fallidas', 'correos', 'avisos_finanzas', 'reporte_correo', 'reserve_disputa', 'reserve_sin_respuesta', 'pagos_fallidos', 'retiros_atascados']);
const WEEK = 7 * 86_400_000;
const HOURS_2 = 2 * 3_600_000;

const settle = async <T,>(name: string, failed: string[], load: () => Promise<T>, empty: T): Promise<T> => {
  try { return await load(); } catch { failed.push(name); return empty; }
};

export async function loadCases(user: User): Promise<CaseBundle> {
  const failed: string[] = [];
  const [reports, verifications, media, refunds, payments, payouts, errors, monitor] = await Promise.all([
    settle('denuncias', failed, () => platformApi.listReports(), []),
    settle('verificaciones', failed, () => platformApi.listVerifications(), []),
    settle('fotos y videos', failed, () => backend.moderationQueue(), []),
    settle('devoluciones', failed, () => backend.reserveRefunds(user), []),
    settle('pagos', failed, () => platformApi.allPayments(), []),
    settle('retiros', failed, () => platformApi.listPayouts(), []),
    settle('errores', failed, () => backend.appErrors(), []),
    settle('monitoreo', failed, () => backend.monitor(), { hours: [], days: [], reports: [] }),
  ]);
  const cases: AssistantCase[] = [];
  const refs: Record<string, CaseRef> = {};
  const counters: Record<string, number> = {};
  const add = (prefix: string, c: Omit<AssistantCase, 'id'>, ref: string, extra?: string, section?: string) => {
    const id = `${prefix}${(counters[prefix] = (counters[prefix] ?? 0) + 1)}`;
    cases.push({ id, ...c });
    refs[id] = { kind: c.kind, ref, section: section ?? SECTION[c.kind], extra };
  };
  const now = Date.now();

  for (const t of payments.filter((p) => p.status === 'disputed'))
    add('D', { kind: 'dispute', title: `Disputa PayPal: ${t.payerName} → ${t.creatorName} (${t.kind})`, status: t.status, amount: t.amount, createdAt: t.createdAt,
      detail: t.platformCovers ? 'Fans Reserve cubre la parte del creador.' : undefined }, t.id);
  for (const p of payouts.filter((x) => x.status === 'failed' || (x.status === 'sending' && now - Date.parse(x.requestedAt) > HOURS_2)))
    add('P', { kind: 'payout', title: `Retiro de ${p.creatorName} ${p.status === 'failed' ? 'falló' : 'lleva más de 2 h enviándose'}`, status: p.paypalState ? `${p.status} (${p.paypalState})` : p.status,
      amount: p.amount, createdAt: p.requestedAt, detail: `Cuenta: ${p.accountLabel}` }, p.id);
  for (const r of refunds.filter((x) => x.state === 'pending' || x.state === 'approved'))
    add('F', { kind: 'refund', title: `Devolución Reserve: ${r.title} · ${r.fanName}`, status: r.state, amount: r.amount, createdAt: r.createdAt,
      detail: [`Motivo: ${r.reason}`, r.funding ? `Medio: ${r.funding}` : '', r.note ? `Nota: ${r.note}` : ''].filter(Boolean).join(' · ') }, r.id);
  for (const r of reports.filter((x) => x.status === 'pending'))
    add('R', { kind: 'report', title: `Denuncia (${r.kind}) sobre ${r.targetLabel}: ${r.reason}`, status: r.status, createdAt: r.createdAt,
      detail: `De ${r.reporterName}: ${r.description}` }, r.id);
  for (const v of verifications.filter((x) => x.status === 'pending'))
    add('V', { kind: 'verification', title: `Verificar identidad de ${v.userName} (${v.role})`, status: v.status, createdAt: v.submittedAt,
      detail: [v.provider ? `Proveedor: ${v.provider}` : '', v.rejectionReason ? `Nota: ${v.rejectionReason}` : ''].filter(Boolean).join(' · ') || undefined }, v.id);
  for (const m of media.filter((x) => x.status === 'pending' || x.status === 'review'))
    add('M', { kind: 'media', title: `${m.mediaType} de ${m.ownerName} (${m.kind}) por revisar`, status: m.status, createdAt: m.createdAt,
      detail: m.reason ? `Moderación: ${m.reason} (${m.provider})` : undefined }, m.path, m.bucket);
  for (const e of errors.filter((x) => now - Date.parse(x.lastSeen) < WEEK).sort((a, b) => b.count - a.count).slice(0, 8))
    add('E', { kind: 'error', title: `Error ${e.source}: ${e.message}`, status: `${e.count} veces`, createdAt: e.lastSeen, detail: `${e.url} · ${e.detail}`.slice(0, 300) }, e.id);
  const snap = monitor.hours[0]?.data;
  for (const p of (snap?.problemas ?? []).filter((x) => ALERT_ONLY.has(x.code)))
    add('A', { kind: 'alert', title: p.titulo, status: p.nivel, detail: [p.code, p.donde, p.detalle].filter(Boolean).join(' · ') }, p.code, undefined, PROBLEM_SECTION[p.code] ?? 'overview');

  const status = snap ? { revisado: snap.at, hoy: snap.hoy, mes: { cobrado: snap.mes?.cobrado, fr_con_isv: snap.mes?.fr_con_isv, fr_sin_isv: snap.mes?.fr_sin_isv, creadores: snap.mes?.creadores }, pendiente: snap.pendiente, problemas: snap.problemas } : null;
  return { cases, refs, status, failed };
}

export interface AskResult { plan?: AssistantPlan; error?: string; code?: string }

export async function askAssistant(question: string, history: ChatTurn[], bundle: CaseBundle, lang: 'es' | 'en'): Promise<AskResult> {
  const token = await backend.accessToken();
  if (!token) return { error: lang === 'en' ? 'Sign in again.' : 'Vuelve a iniciar sesión.', code: 'auth' };
  try {
    const r = await fetch('/api/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'assistant', question, history, cases: bundle.cases, status: bundle.status, lang }),
    });
    const data = await r.json().catch(() => ({})) as { plan?: AssistantPlan; error?: string; code?: string };
    if (!r.ok || !data.plan) return { error: data.error ?? (lang === 'en' ? 'Mano derecha did not answer. Try again.' : 'Mano derecha no respondió. Intenta de nuevo.'), code: data.code };
    return { plan: data.plan };
  } catch {
    return { error: lang === 'en' ? 'No connection. Try again.' : 'Sin conexión. Intenta de nuevo.', code: 'network' };
  }
}

// Runs one approved action with the same call as its admin screen.
export async function applyAction(user: User, action: ActionType, ref: CaseRef, reason: string): Promise<{ ok: boolean; error?: string }> {
  const note = reason.trim() || 'Resuelto con Mano derecha';
  const done = (r: { ok: boolean; error?: string }) => { if (r.ok) platformChanged(); return r; };
  switch (action) {
    case 'report_resolve': return done(await resolveReport(ref.ref, 'resolve'));
    case 'report_remove': return done(await resolveReport(ref.ref, 'remove'));
    case 'report_dismiss': return done(await resolveReport(ref.ref, 'dismiss'));
    case 'verification_approve': return done(await reviewVerification(ref.ref, true, ''));
    case 'verification_reject': return done(await reviewVerification(ref.ref, false, note));
    case 'media_approve': return done(await backend.reviewMedia(ref.extra as 'post-media' | 'profile-images', ref.ref, true));
    case 'media_reject': return done(await backend.reviewMedia(ref.extra as 'post-media' | 'profile-images', ref.ref, false, note));
    case 'refund_approve': return done(await backend.decideReserveRefund(user, ref.ref, 'approve', note));
    case 'refund_legal': return done(await backend.decideReserveRefund(user, ref.ref, 'legal', note));
    case 'refund_decline': return done(await backend.decideReserveRefund(user, ref.ref, 'decline', note));
    default: return { ok: false, error: 'Esta acción se hace desde su pantalla.' };
  }
}
