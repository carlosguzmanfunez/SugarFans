// Financial calendar only. Subscription renewals, rewards and provider billing
// keep their own calendar. Every interval is [start, end), in Honduras (UTC−6).
export const PAYOUT_TIME_ZONE = 'America/Tegucigalpa';
const OFFSET = 6 * 60 * 60 * 1000;
export interface PayoutCalendarPolicy { legacyCutoff: string }
export const hondurasParts = (at = new Date()) => {
  const local = new Date(at.getTime() - OFFSET);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth(), day: local.getUTCDate() };
};
export const hondurasMidnight = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day) + OFFSET).toISOString();
export const hondurasDateKey = (at = new Date()) => new Date(at.getTime() - OFFSET).toISOString().slice(0, 10);
export const hondurasTimestamp = (iso: string) => `${new Date(Date.parse(iso) - OFFSET).toISOString().slice(0, -1)}-06:00`;
export const formatPayoutDate = (iso: string) => new Date(iso).toLocaleDateString('es-HN', {
  timeZone: PAYOUT_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric',
});
export const earningsCycle = (at = new Date()) => {
  const { year, month, day } = hondurasParts(at);
  const startMonth = day >= 26 ? month : month - 1;
  const start = hondurasMidnight(year, startMonth, 26);
  const end = hondurasMidnight(year, startMonth + 1, 26);
  return { start, end, lastDay: new Date(Date.parse(end) - 1).toISOString() };
};
// Most recently closed cycle's payment window. On the 1st it still belongs to
// the previous month's closure. At 00:00 on the 2nd the window is closed.
export const payoutWindow = (at = new Date()) => {
  const cycle = earningsCycle(at);
  const { year, month } = hondurasParts(new Date(cycle.start));
  const end = hondurasMidnight(year, month + 1, 2);
  const open = at.getTime() >= Date.parse(cycle.start) && at.getTime() < Date.parse(end);
  const nextStart = open ? cycle.start : cycle.end;
  const nextParts = hondurasParts(new Date(nextStart));
  return {
    start: cycle.start, end, open,
    lastDay: new Date(Date.parse(end) - 1).toISOString(),
    nextStart, nextEnd: hondurasMidnight(nextParts.year, nextParts.month + 1, 2),
  };
};
// The migration freezes the old UTC-month boundary once. Never move earnings
// already credited back to pending, and never reset the floor each month.
export const creditCutoff = (at = new Date(), legacyCutoff?: string) => {
  const start = earningsCycle(at).start;
  return legacyCutoff && Date.parse(legacyCutoff) > Date.parse(start) ? legacyCutoff : start;
};
export const nextCreditDate = (at = new Date()) => earningsCycle(at).end;
