import { money } from './platformRules';

// A request acknowledgement is not proof that PayPal delivered the money.
export const payoutRequestMessage = (status?: 'sending' | 'paid', amount = 0) =>
  status === 'paid'
    ? `PayPal confirmó la entrega de ${money(amount)} a tu cuenta PayPal.`
    : 'Retiro registrado. Estamos confirmando su estado; tu saldo sigue apartado. No necesitas solicitar otro retiro.';

export const sendingPayoutNote = (state?: string) => {
  if (state === 'MANUAL_REVIEW') return 'Este retiro necesita revisión. El saldo sigue apartado para evitar un pago duplicado.';
  if (state === 'SUBMISSION_UNCERTAIN' || state === 'RECOVERY_PENDING')
    return 'Estamos confirmando el envío. Tu saldo sigue apartado; no necesitas solicitar otro retiro.';
  if (state === 'UNCLAIMED') return 'Este retiro sigue sin reclamar en PayPal. Revisa la cuenta receptora. Si solicitas la cancelación, el saldo se libera cuando PayPal confirme la devolución.';
  if (state === 'ONHOLD' || state === 'BLOCKED') return 'PayPal tiene este retiro en revisión. La entrega todavía no está confirmada y tu saldo sigue apartado.';
  if (state === 'PENDING' || state === 'NEW' || state === 'PROCESSING')
    return 'PayPal está procesando este retiro. La entrega todavía no está confirmada; tu saldo sigue apartado.';
  return 'Estamos confirmando el estado del retiro. Tu saldo sigue apartado.';
};
