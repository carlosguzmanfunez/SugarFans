// Meta de experiencia: each fan fills a creator's goal with gifts and tips; a full
// goal gives a ticket for one of the creator's experiences (the fan picks it) plus a
// free extra from a wheel where every slot wins. The fan books it choosing only the
// date and time; nothing is charged. Tickets last 60 days. Mirrors section 10 of
// supabase/migrations/20261006000001_creator_incentives_v2.sql: keep both in sync.
import type { Transaction } from './backend/platformTypes';
import type { ExperienceGoalSettings, TicketBonus } from './backend/rewardTypes';

export const GOAL_MIN = 20;
export const GOAL_MAX = 2000;
export const TICKET_DAYS = 60;
export const GOAL_KINDS: Transaction['kind'][] = ['gift', 'tip'];

export interface BonusInfo {
  id: TicketBonus;
  label: string;
  hint: string;
  icon: string;
}

// The wheel: every slot is a win the creator gives on top of the experience.
export const TICKET_BONUSES: BonusInfo[] = [
  { id: 'extra-time', label: '10 minutos más', hint: 'Tu experiencia dura 10 minutos más.', icon: 'fa-hourglass-half' },
  { id: 'live-shoutout', label: 'Saludo en su próximo Live', hint: 'Te saluda por tu nombre en su próximo Live.', icon: 'fa-tower-broadcast' },
  { id: 'thank-you', label: 'Mensaje de agradecimiento', hint: 'Te deja un mensaje personal de agradecimiento.', icon: 'fa-envelope-open-text' },
  { id: 'photo', label: 'Foto de recuerdo', hint: 'Una foto o captura de recuerdo al final de la experiencia.', icon: 'fa-camera' },
];

export const bonusInfo = (id: string) => TICKET_BONUSES.find((b) => b.id === id) ?? TICKET_BONUSES[0];
export const pickBonus = (): TicketBonus => TICKET_BONUSES[Math.floor(Math.random() * TICKET_BONUSES.length)].id;

export const validateGoal = (input: ExperienceGoalSettings): { ok: boolean; error?: string } => {
  if (!Number.isFinite(input.target) || input.target < GOAL_MIN || input.target > GOAL_MAX)
    return { ok: false, error: `La meta debe estar entre $${GOAL_MIN} y $${GOAL_MAX.toLocaleString('en-US')}` };
  if (input.enabled && input.experienceIds.length === 0) return { ok: false, error: 'Elige al menos una experiencia para tu meta' };
  return { ok: true };
};

// What a fan has put into the goal since it started, minus what became tickets.
export const goalProgress = (txs: Transaction[], fanId: string, creatorProfileId: string, since: string, ticketsAmount: number) =>
  Math.max(
    0,
    Math.round(
      (txs
        .filter((t) => t.payerId === fanId && t.creatorProfileId === creatorProfileId && t.status === 'paid' && GOAL_KINDS.includes(t.kind) && t.createdAt >= since)
        .reduce((s, t) => s + t.amount, 0) -
        ticketsAmount) *
        100
    ) / 100
  );
