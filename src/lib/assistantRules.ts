// "Mano derecha" free mode ($0, no AI): the same 3 steps as the Claude chat, but each
// kind of case gets the fixed solution of docs/operations/manual-operacion.md.
// It only proposes; "Aplicar" still needs the admin's click and confirmation.
// Pure code: no network, used by the panel and the tests.
import type { ActionType, AssistantCase, AssistantPlan, Level, PlanSolution } from './assistantPlan';

export interface RuleRef { kind: AssistantCase['kind']; meta?: Record<string, string> }
type Lang = 'es' | 'en';

const L = (lang: Lang, es: string, en: string) => (lang === 'en' ? en : es);
const money = (n: number | undefined) => `$${(n ?? 0).toFixed(2)}`;
// Anything about minors or illegal content goes first, the same day (manual 7).
const SERIOUS = /\b(menor(es)?|niñ[oa]s?|child(ren)?|minor|underage|ilegal|illegal|abuso|abuse|csam)\b/i;

// What each monitor alert means and what to do (manual 4).
const ALERTS: Record<string, { level: Level; es: [string, string]; en: [string, string] }> = {
  incidentes: { level: 'alta', es: ['Manual 4 · incidentes', 'Lee el expediente y busca la referencia en PayPal. Nunca reenvíes un retiro "por si acaso": un envío incierto no se repite.'], en: ['Manual 4 · incidents', 'Read the case file and look up the PayPal reference. Never resend a payout "just in case": an uncertain send is never repeated.'] },
  tareas_fallidas: { level: 'alta', es: ['Manual 4 · tareas automáticas', 'Mira el error en Supabase › Cron › historial y abre un PR con el arreglo.'], en: ['Manual 4 · scheduled jobs', 'Check the error in Supabase › Cron › history and open a PR with the fix.'] },
  reserve_disputa: { level: 'alta', es: ['Manual 4 · Reserve en disputa', 'Revisa el recibo de asistencia. No-show del fan = el creador cobra; el creador no llegó = 100% al fan.'], en: ['Manual 4 · Reserve dispute', 'Check the attendance receipt. Fan no-show = creator is paid; creator did not show = 100% to the fan.'] },
  retiros_atascados: { level: 'media', es: ['Manual 4 · retiro enviándose', 'Espera el aviso de PayPal. Si pasa de 24 h, revisa el lote y abre expediente. No reenviar.'], en: ['Manual 4 · payout sending', 'Wait for PayPal. After 24 h, check the batch and open a case file. Do not resend.'] },
  pagos_fallidos: { level: 'media', es: ['Manual 4 · pagos fallidos', 'Mira el error en Problemas de la página. Si se repite el mismo motivo, revisar el código de PayPal.'], en: ['Manual 4 · failed payments', 'Check the error in Site problems. If the same reason repeats, review the PayPal code.'] },
  avisos_finanzas: { level: 'media', es: ['Manual 4 · avisos de finanzas', 'Casi siempre es la llave de Resend o su límite diario de 100 correos.'], en: ['Manual 4 · finance notices', 'Almost always the Resend key or its 100 emails/day limit.'] },
  correos: { level: 'media', es: ['Manual 4 · correos', 'Revisa el último error del correo (llave de Resend, dominio o límite). Se reintentan solos 5 veces.'], en: ['Manual 4 · emails', 'Check the last email error (Resend key, domain or limit). They retry by themselves 5 times.'] },
  reporte_correo: { level: 'media', es: ['Manual 4 · reporte de las 12', 'El reporte sí está en el panel. Revisa que /api/usage diga resend: OK.'], en: ['Manual 4 · 12 o’clock report', 'The report is in the panel. Check that /api/usage says resend: OK.'] },
  reserve_sin_respuesta: { level: 'baja', es: ['Manual 4 · Reserve sin respuesta', 'El creador tiene que aceptar o rechazar; si no, vence sola. Puedes recordarle.'], en: ['Manual 4 · unanswered Reserve', 'The creator must accept or decline, or it expires by itself. You can remind them.'] },
};

const ORDER: Record<Level, number> = { alta: 0, media: 1, baja: 2 };

const ruleFor = (c: AssistantCase, ref: RuleRef | undefined, lang: Lang): { level: Level; sol: Omit<PlanSolution, 'case_id'> } => {
  const meta = ref?.meta ?? {};
  const open = (level: Level, rule: string, solution: string, action: ActionType = 'open', reason = '') => ({ level, sol: { rule, solution, action, reason } });
  switch (c.kind) {
    case 'dispute':
      return open('alta', L(lang, 'Manual 4 · disputas (contrato 6.2.3 y 6.2.4)', 'Manual 4 · disputes (agreement 6.2.3 and 6.2.4)'),
        L(lang, `Identifica la venta (${money(c.amount)}), genera el expediente en inglés si es una Reserve y decide quién paga el cargo. Nada se sube a PayPal sin tu sí.`,
          `Identify the sale (${money(c.amount)}), build the English case file if it is a Reserve and decide who pays the fee. Nothing goes to PayPal without your yes.`));
    case 'payout':
      if (meta.status === 'failed') return open('alta', L(lang, 'Manual 4 · retiro fallido', 'Manual 4 · failed payout'),
        L(lang, `No reenviar. El saldo vuelve al creador; pídele a ${meta.creator ?? 'el creador'} su correo de PayPal correcto (cambiarlo deja 48 h de espera).`,
          `Do not resend. The balance goes back to the creator; ask ${meta.creator ?? 'the creator'} for the right PayPal email (changing it holds payouts 48 h).`));
      return open(Number(meta.hours) >= 24 ? 'alta' : 'media', L(lang, 'Manual 4 · retiro enviándose', 'Manual 4 · payout sending'),
        Number(meta.hours) >= 24
          ? L(lang, 'Lleva más de 24 h: revisa el lote en PayPal y abre expediente. No reenviar.', 'Over 24 h: check the batch in PayPal and open a case file. Do not resend.')
          : L(lang, 'Espera el aviso de PayPal (puede tardar). No reenviar.', 'Wait for PayPal (it can take a while). Do not resend.'));
    case 'refund': {
      const rule = L(lang, 'Cancelación de Reserve (manual 5)', 'Reserve cancellation (manual 5)');
      if (meta.state === 'approved') return open('media', rule, L(lang, 'Ya está aprobada: falta enviarla en Retiros y devoluciones. El estado cambia solo con el comprobante de PayPal.', 'Already approved: send it from Payouts and refunds. The state changes only with PayPal’s receipt.'));
      if (meta.reason === 'withdrawal') return open('media', L(lang, 'Derecho legal de devolución: 100%', 'Legal right of withdrawal: 100%'),
        L(lang, `Aprobar la devolución legal del 100% (${money(c.amount)}).`, `Approve the legal 100% refund (${money(c.amount)}).`), 'refund_legal', L(lang, 'Derecho legal de devolución', 'Legal right of withdrawal'));
      if (meta.reason === 'creator_cancelled') return open('media', L(lang, 'Cancela el creador: 100% al fan', 'Creator cancelled: 100% to the fan'),
        L(lang, `Aprobar: se devuelve el 100% (${money(c.amount)}); el creador cubre la comisión no recuperada.`, `Approve: 100% back (${money(c.amount)}); the creator covers the unrecovered fee.`), 'refund_approve', L(lang, 'Cancelada por el creador', 'Cancelled by the creator'));
      if (meta.reason === 'creator_failure') return open('media', L(lang, 'Incumplimiento del creador por verificar', 'Creator failure to verify'),
        L(lang, 'Revisa el recibo de asistencia antes de decidir. Si se confirma, 100% al fan.', 'Check the attendance receipt before deciding. If confirmed, 100% to the fan.'));
      return open('media', rule,
        L(lang, 'Cancelación del fan: 24 h o más = todo menos PayPal y 10% de servicio ($25 → $20.85); menos de 24 h = la mitad menos PayPal ($25 → $10.85). El sistema ya calculó el tramo.',
          'Fan cancellation: 24 h or more = all back minus PayPal and the 10% service fee ($25 → $20.85); under 24 h = half minus PayPal ($25 → $10.85). The system already worked out the amount.'),
        'refund_approve', L(lang, 'Cancelación voluntaria según la regla de Reserve', 'Voluntary cancellation under the Reserve rule'));
    }
    case 'report': {
      const serious = SERIOUS.test(`${meta.text ?? ''} ${c.title}`);
      return open(serious ? 'alta' : 'media', L(lang, 'Manual 7 · denuncias', 'Manual 7 · reports'),
        serious
          ? L(lang, 'Posible menor o contenido ilegal: revisa hoy mismo, guarda evidencia y escribe desde minors@ o safety@.', 'Possible minor or illegal content: review today, keep evidence and write from minors@ or safety@.')
          : L(lang, 'Mira el contenido y decide: quitar, dejar o suspender, con motivo.', 'Look at the content and decide: remove, keep or suspend, with a reason.'));
    }
    case 'verification':
      return open('media', L(lang, 'Manual 6 · verificación con Didit', 'Manual 6 · Didit verification'),
        L(lang, 'Revisa documento y selfie. Menor de 18 = rechazo siempre.', 'Check document and selfie. Under 18 = always reject.'));
    case 'media':
      return open('media', L(lang, 'Manual 7 · moderación', 'Manual 7 · moderation'),
        L(lang, 'Quedó en revisión manual (puntaje entre 0.5 y 0.85). Míralo y aprueba o rechaza.', 'It is in manual review (score between 0.5 and 0.85). Look at it and approve or reject.'));
    case 'error': {
      const many = Number(meta.count) >= 10;
      return open(many ? 'media' : 'baja', L(lang, 'Manual 4 · errores', 'Manual 4 · errors'),
        many ? L(lang, 'Se repite mucho: abrir un PR con el arreglo.', 'It repeats a lot: open a PR with the fix.') : L(lang, 'Informativo. Vigila si se repite.', 'For information. Watch whether it repeats.'));
    }
    case 'alert': {
      const a = ALERTS[meta.code ?? ''];
      if (!a) return open((meta.level as Level) ?? 'media', 'Manual 4', L(lang, 'Ábrelo en su pantalla.', 'Open it in its screen.'));
      const [rule, solution] = lang === 'en' ? a.en : a.es;
      return open(a.level, rule, solution);
    }
  }
};

export function rulesPlan(cases: AssistantCase[], refs: Record<string, RuleRef>, lang: Lang): AssistantPlan {
  const rows = cases.map((c) => ({ c, ...ruleFor(c, refs[c.id], lang) }))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const urgent = rows.filter((r) => r.level === 'alta').length;
  const reply = !rows.length
    ? L(lang, 'Todo en orden: no hay casos abiertos ahora mismo.', 'All clear: there are no open cases right now.')
    : L(lang, `Tienes ${rows.length} ${rows.length === 1 ? 'caso' : 'casos'}${urgent ? `, ${urgent} ${urgent === 1 ? 'urgente' : 'urgentes'}` : ''}. Te dejo cada uno con su regla del manual.`,
        `You have ${rows.length} ${rows.length === 1 ? 'case' : 'cases'}${urgent ? `, ${urgent} urgent` : ''}. Here is each one with its rule from the manual.`);
  return {
    reply,
    problems: rows.map((r) => ({ case_id: r.c.id, title: r.c.amount != null ? `${r.c.title} (${money(r.c.amount)})` : r.c.title, level: r.level })),
    solutions: rows.map((r) => ({ case_id: r.c.id, ...r.sol })),
  };
}

// "How much today?" from the latest hourly snapshot, with and without ISV.
const MONEY_Q = /(cu[aá]nto|llevamos|ganamos|ganancia|dinero|cobrad|ingres|how much|money|earn|revenue|income)/i;
export const isMoneyQuestion = (q: string) => MONEY_Q.test(q);

export function moneyPlan(status: unknown, lang: Lang): AssistantPlan {
  const s = (status ?? {}) as { hoy?: Record<string, number>; mes?: Record<string, number> };
  if (!s.hoy) return { reply: L(lang, 'Todavía no hay una revisión del dinero. Toca "Actualizar ahora" abajo.', 'There is no money check yet. Tap "Update now" below.'), problems: [], solutions: [] };
  const h = s.hoy, m = s.mes ?? {};
  return {
    reply: L(lang,
      `Hoy: cobrado ${money(h.cobrado)} en ${h.pagos ?? 0} pagos. Creadores ${money(h.creadores)}. Fans Reserve ${money(h.fr_con_isv)} con ISV, ${money(h.fr_sin_isv)} sin ISV. En el mes: cobrado ${money(m.cobrado)}, Fans Reserve ${money(m.fr_con_isv)} con ISV y ${money(m.fr_sin_isv)} sin ISV.`,
      `Today: collected ${money(h.cobrado)} in ${h.pagos ?? 0} payments. Creators ${money(h.creadores)}. Fans Reserve ${money(h.fr_con_isv)} with ISV, ${money(h.fr_sin_isv)} without ISV. This month: collected ${money(m.cobrado)}, Fans Reserve ${money(m.fr_con_isv)} with ISV and ${money(m.fr_sin_isv)} without ISV.`),
    problems: [], solutions: [],
  };
}

// Fixed questions answered for free; anything else goes to Claude when it is connected.
export const isCasesQuestion = (q: string) => /(caso|resuelv|urgente|pendiente|problema|case|resolve|urgent|pending|problem)/i.test(q);
