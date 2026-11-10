// Reminders to a creator about a Reserve request still without answer, and the
// proof of each send (supabase/migrations/20261107230000_reserve_response_reminders.sql).
// Cadence: on arrival (email), 3 h later, 24 h, 6 h and 1 h before the deadline.

export type NudgeStep = 'inicio' | 'r3h' | 'h24' | 'h6' | 'h1';

export interface NudgeSend {
  step: NudgeStep;
  due_at: string;
  sent_at: string;
  skipped: boolean;
  bell: boolean;
  bell_read_at: string | null;
  push_attempted_at: string | null;
  push_devices: number | null;
  push_sent: number | null;
  email: boolean;
  email_delivered_at: string | null;
  email_error: string | null;
  opened_at: string | null;
}

export interface NudgeBooking {
  booking_id: string;
  title: string;
  creator_name: string;
  fan_name: string;
  status: string;
  waiting: boolean;
  respond_by: string | null;
  seen_at: string | null;
  requested_at: string;
  reminders: NudgeSend[] | null;
}

export interface ReserveResponseLog {
  as_of: string;
  items: NudgeBooking[];
}

// Translation key for where the request stands now.
export const nudgeStateKey = (b: Pick<NudgeBooking, 'status' | 'waiting'>) =>
  b.waiting
    ? 'admin.nudge.waiting'
    : ['accepted', 'confirmed', 'completed', 'rejected', 'countered'].includes(b.status)
      ? 'admin.nudge.answered'
      : b.status === 'expired' || b.status === 'pending'
        ? 'admin.nudge.expired'
        : 'admin.nudge.closed';

// Each channel of one send, as [translation key, n, d] (n/d only for the phone).
// A phone push still missing two minutes after the send means no device had
// alerts turned on (the database only calls /api/push when one exists).
export const nudgeChannels = (m: NudgeSend, now = Date.now()): [string, number?, number?][] => {
  if (m.skipped) return [['admin.nudge.skipped']];
  const out: [string, number?, number?][] = [];
  if (m.bell) {
    out.push([m.bell_read_at ? 'admin.nudge.bellRead' : 'admin.nudge.bellUnread']);
    if (m.push_attempted_at) out.push([m.push_sent ? 'admin.nudge.pushSent' : 'admin.nudge.pushFailed', m.push_sent ?? 0, m.push_devices ?? 0]);
    else out.push([now - Date.parse(m.sent_at) > 120_000 ? 'admin.nudge.pushNone' : 'admin.nudge.pushPending']);
  }
  if (m.email) out.push([m.email_delivered_at ? 'admin.nudge.emailSent' : m.email_error ? 'admin.nudge.emailFailed' : 'admin.nudge.emailPending']);
  if (m.opened_at) out.push(['admin.nudge.opened']);
  return out;
};
