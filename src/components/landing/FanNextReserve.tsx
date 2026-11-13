import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { backend } from '../../lib/backend';
import { useBackendData } from '../../lib/useBackendData';
import { useLanguage } from '../../context/LanguageContext';
import type { User } from '../../context/AuthContext';
import { isEventBooking, isLiveBooking, liveState, liveWindow, reserveStatusOf, sessionMinutes, type VipBooking } from '../../lib/vip';
import { zonedDate } from '../../lib/timeZones';
import Icon from '../Icon';
import { ArrowRight } from './landingBits';

// "Tu próxima Reserve" on the fan's Inicio (Carlos 2026-11-13): a small card under the
// search bar with the one booking that matters now and its next step. Hidden when the
// fan has no active booking, so the page stays as it was for everyone else.

type Tone = 'wait' | 'act' | 'ok' | 'live';
const ACTIVE = new Set(['pending', 'countered', 'accepted', 'confirmed', 'disputed']);

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

// Needs the fan first (pay, answer), then the soonest confirmed one, then waiting requests.
const rank = (b: VipBooking, now: Date) => {
  const s = reserveStatusOf(b, now);
  const start = zonedDate(b.date, b.time, b.timeZone).getTime();
  const order = s === 'accepted' ? 0 : s === 'countered' ? 1 : s === 'confirmed' ? 2 : 3;
  return order * 1e15 + start;
};

export const activeFanBookings = (list: VipBooking[], now = new Date()) =>
  list.filter((b) => ACTIVE.has(reserveStatusOf(b, now))).sort((a, b) => rank(a, now) - rank(b, now));

const FanNextReserve: React.FC<{ user: User }> = ({ user }) => {
  const { t, language } = useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const { data } = useBackendData(() => backend.fanBookings(user.id), [user.id], [] as VipBooking[], `fanBookings:${user.id}`);

  const active = activeFanBookings(data, now);
  const b = active[0];
  if (!b) return null;

  const status = reserveStatusOf(b, now);
  const name = b.creatorName.split(' ')[0];
  const start = zonedDate(b.date, b.time, b.timeZone);
  const day = start.toLocaleDateString(language, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
  const when = `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${start.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  const minutes = sessionMinutes(b);
  const live = status === 'confirmed' && minutes && isLiveBooking(b) ? liveState(b.date, b.time, minutes, now, b.timeZone) : null;
  const room = isEventBooking(b) ? `/evento/${b.id}` : `/live/${b.id}`;
  const list = '/profile#mis-reservas';

  let tone: Tone = 'wait';
  let label = fill(t('nextReserve.pending'), { name });
  let action = { text: t('nextReserve.details'), to: list };
  if (status === 'countered') {
    tone = 'act';
    label = fill(t('nextReserve.countered'), { name });
    action = { text: t('nextReserve.answer'), to: list };
  } else if (status === 'accepted') {
    tone = 'act';
    const due = b.paymentDueAt ? new Date(b.paymentDueAt).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
    label = due ? fill(t('nextReserve.payBy'), { time: due }) : t('nextReserve.pay');
    action = { text: t('nextReserve.payNow'), to: list };
  } else if (status === 'disputed') {
    label = t('nextReserve.review');
  } else if (status === 'confirmed') {
    tone = 'ok';
    label = t('nextReserve.confirmed');
    if (live === 'open') {
      tone = 'live';
      label = t('nextReserve.liveNow');
      action = { text: t('nextReserve.join'), to: room };
    } else if (live === 'early' && minutes) {
      const opensIn = Math.round((liveWindow(b.date, b.time, minutes, b.timeZone).start.getTime() - now.getTime()) / 60000);
      if (opensIn <= 60) label = fill(t('nextReserve.startsIn'), { min: Math.max(1, opensIn) });
    }
  }

  return (
    <section className={`next-rsv next-rsv-${tone}`} data-testid="next-reserve" aria-label={t('nextReserve.title')}>
      <div className="next-rsv-head">
        <span className="next-rsv-kicker"><Icon name="fa-ticket" /> {t('nextReserve.title')}</span>
        {active.length > 1 && <Link to={list} className="next-rsv-all">{fill(t('nextReserve.all'), { n: active.length })}</Link>}
      </div>
      <p className="next-rsv-title">{b.title} <span>· {b.creatorName}</span></p>
      <p className="next-rsv-when">{when}</p>
      <div className="next-rsv-foot">
        <span className="next-rsv-status" data-testid="next-reserve-status">{tone === 'live' && <i className="next-rsv-dot" aria-hidden="true" />}{label}</span>
        <Link to={action.to} className="next-rsv-btn" data-testid="next-reserve-action">{action.text} <ArrowRight /></Link>
      </div>
    </section>
  );
};

export default FanNextReserve;
