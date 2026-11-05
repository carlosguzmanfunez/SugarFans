import { addLocalNotification } from './localLive';
import type { AppNotification } from './liveTypes';
import type { Transaction } from './platformTypes';

const send = (fanId: string, creatorId: string, ownerId: string | undefined, kind: AppNotification['kind'], fanTitle: string, creatorTitle: string, fanBody: string, creatorBody: string) => {
  addLocalNotification(fanId, { kind, creatorProfileId: creatorId, title: fanTitle, body: fanBody.slice(0, 200), link: '/profile#mis-suscripciones' });
  if (ownerId && ownerId !== fanId)
    addLocalNotification(ownerId, { kind, creatorProfileId: creatorId, title: creatorTitle, body: creatorBody.slice(0, 200), link: '/creator/dashboard?tab=subscribers' });
};

// Called only after a new paid entry has been saved, never by a signup/approval form.
export const localSubscriptionPaymentNotice = (t: Transaction, ownerId?: string) => {
  if (!t.payerId || !['subscription', 'renewal'].includes(t.kind) || t.status !== 'paid' || t.amount <= 0) return;
  const renewal = t.kind === 'renewal';
  send(t.payerId, t.creatorProfileId, ownerId, 'subscription_payment',
    renewal ? 'Suscripción renovada' : 'Suscripción confirmada', renewal ? 'Renovación de suscripción' : 'Nueva suscripción',
    `Se confirmó ${renewal ? 'la renovación' : 'el pago'} de tu suscripción a ${t.creatorName || 'tu creador'} por USD ${t.amount.toFixed(2)}.`,
    `${t.payerName || 'Un fan'} · USD ${t.amount.toFixed(2)} · ${renewal ? 'Renovación confirmada.' : 'Suscripción confirmada.'}`);
};

export const localSubscriptionChangeNotice = (fanId: string, fanName: string, creatorId: string, creatorName: string, ownerId: string | undefined, previous: string | undefined, next: string | undefined) => {
  if (previous === next || (!next && (!previous || Date.parse(previous) <= Date.now()))) return;
  const ended = !!next && Date.parse(next) <= Date.now();
  const title = !next ? 'Renovación reactivada' : ended ? 'Suscripción finalizada' : 'Renovación cancelada';
  const body = !next ? 'La renovación automática de esta suscripción vuelve a estar activada.' : ended ? 'El acceso de esta suscripción finalizó.' :
    `No se renovará. El acceso se conserva hasta el ${new Intl.DateTimeFormat('es', { timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short' }).format(new Date(next))} (UTC−6).`;
  send(fanId, creatorId, ownerId, 'subscription_update', title,
    !next ? title : ended ? 'Una suscripción finalizó' : 'Un fan canceló su renovación',
    `${creatorName || 'tu creador'} · ${body}`, `${fanName || 'Un fan'} · ${body}`);
};
