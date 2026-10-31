import { inPerson, locationLabel, bookingHasAttendance } from '../../lib/reserveLocation';
import ReserveCitySelector from './ReserveCitySelector';
import React, { useState } from 'react';
import { backend } from '../../lib/backend';
import { money } from '../../lib/platform';
import { formatLongDate, reserveStatusOf, typeOf, CUSTOM_EXPERIENCE, MIN_SESSION_MINUTES, MAX_SESSION_MINUTES, type VipBooking } from '../../lib/vip';
import { viewerSlotLabel, zoneCity } from '../../lib/timeZones';
import { LOCATION_TYPES, PURPOSES, RESERVE_MODALITIES } from '../../config/reserve';
import { MODERATION_RULES } from '../../lib/moderation';
import type { User } from '../../context/AuthContext';
import { ReserveStatusBadge } from './ReserveBits';
import LiveRoomButton from '../LiveRoomButton';
import ReportDialog from '../ReportDialog';
import { displayEmail } from '../../config/demoAccounts';
import { deadlineLabel, timeLeft } from '../../lib/reserveAlerts';
import { canRequestReschedule, cancellationOutcome, rescheduleMinDate } from '../../lib/reserveCancellation';
import { formatCoins } from '../../lib/giftRules';
import { platformChanged } from '../../lib/platform';
import { useLanguage } from '../../context/LanguageContext';

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return mins < 1 ? 'ahora' : mins < 60 ? `hace ${mins} min` : mins < 1440 ? `hace ${Math.round(mins / 60)} h` : new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
};

interface Props {
  booking: VipBooking;
  user: User;
  as: 'fan' | 'creator';
  onChanged: () => void;
  onPay?: (b: VipBooking) => void;
  // The fan's Créditos: enough of them lets the fan pay with them.
  credits?: number;
  testId?: string;
}

// Fills {name}-style placeholders in a translated line.
const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

const btn = 'inline-flex h-9 items-center justify-center rounded-full px-4 text-xs font-semibold transition';

// One Reserve as either side sees it: what was booked or requested, its state,
// and the next action (accept, reject, counter-offer / accept or decline the
// counter-offer, pay, cancel, change the date, join, report).
const ReserveBookingCard: React.FC<Props> = ({ booking: b, user, as, onChanged, onPay, credits, testId }) => {
  const { t } = useLanguage();
  const [countering, setCountering] = useState(false);
  // The confirmation panel open under the card, if any.
  const [panel, setPanel] = useState<'cancel' | 'reschedule' | 'credits' | null>(null);
  const [move, setMove] = useState({ date: '', time: b.time, note: '' });
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [willAttend, setWillAttend] = useState(false);
  const [counter, setCounter] = useState({ price: String(b.price), date: b.date, time: b.time, duration: String(b.durationMinutes ?? 30), note: '' });
  const d = b.details ?? {};
  const status = reserveStatusOf(b);
  const isCustom = b.experienceId === CUSTOM_EXPERIENCE || d.kind === 'custom';
  // A seat in a Reserve Event: same day and time for everyone, so no counter-offer.
  const isEvent = d.kind === 'event';
  const modality = d.modality ?? 'virtual';
  // Booked in the creator's clock; someone elsewhere also sees their own hour.
  const theirHour = viewerSlotLabel(b.date, b.time, b.timeZone);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    try {
      const r = await fn();
      setError(r.ok ? '' : r.error || 'No se pudo completar la acción');
      if (r.ok) {
        setCountering(false);
        setPanel(null);
        // Créditos may have moved (paid with them, or given back).
        platformChanged();
        onChanged();
      }
    } catch { setError('No pudimos comprobar el resultado. Recarga para ver el estado antes de repetir la acción.'); }
    finally { setBusy(false); }
  };
  const outcome = cancellationOutcome(b, as);
  const priceCoins = Math.round(b.price * 100);
  const canPayWithCredits = as === 'fan' && b.status === 'accepted' && !d.ticketId && credits !== undefined && credits >= priceCoins;
  const canMove = as === 'fan' && canRequestReschedule(b);
  const other = (as === 'fan' ? b.creatorName : b.fanName).split(' ')[0];
  const cancelled = b.status === 'cancelled' ? d.cancellation : undefined;

  const sendCounter = (askChanges: boolean) =>
    run(() =>
      backend.counterOffer(user, b.id, {
        price: askChanges ? b.price : Number(counter.price),
        date: askChanges ? b.date : counter.date,
        time: askChanges ? b.time : counter.time,
        durationMinutes: askChanges ? b.durationMinutes : Number(counter.duration) || undefined,
        note: counter.note.trim(),
      })
    );

  const flags = (d.flags ?? []).map((id) => MODERATION_RULES.find((r) => r.id === id)?.message).filter(Boolean);
  const where =
    modality === 'virtual'
      ? isEvent ? 'Online · sala del evento' : 'Online · Sala 1:1'
      : [d.venue, d.locationType ? LOCATION_TYPES[d.locationType]?.label : '', locationLabel(d)].filter(Boolean).join(' · ');

  return (
    <div data-testid={testId} className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700">
            {isEvent ? 'Reserve Event · 1 plaza' : isCustom ? 'Experiencia personalizada' : d.typeId ? typeOf(d.typeId).name : 'Reserve'}
            {as === 'fan' ? ` · ${b.creatorName}` : ` · ${b.fanName}`}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{b.title}</p>
          <p className="mt-0.5 text-xs text-ink/60 first-letter:uppercase">
            {formatLongDate(b.date)} · {b.time}
            {theirHour ? ` (hora de ${zoneCity(b.timeZone)})` : ''}
            {b.durationMinutes ? ` · ${b.durationMinutes} min` : ''}
          </p>
          {theirHour && (
            <p className="text-xs font-semibold text-ink/75" data-testid="booking-local-time">
              <i aria-hidden="true" className="fas fa-globe mr-1 text-brand-600"></i>Tu hora: {theirHour}
            </p>
          )}
        </div>
        <div className="text-right">
          {d.ticketId ? (
            <span className="text-sm font-bold text-pink-600" data-testid="booking-ticket"><i aria-hidden="true" className="fas fa-ticket mr-1"></i>Ticket</span>
          ) : (
            <span className="text-sm font-bold text-ink">{money(b.price)}</span>
          )}
          {d.discountPercent ? <span className="block text-[11px] text-iris-700">−{d.discountPercent}% suscriptor</span> : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/70">
        <span><i aria-hidden="true" className={`fas ${RESERVE_MODALITIES[modality].icon} mr-1 text-brand-600`}></i>{RESERVE_MODALITIES[modality].label}</span>
        <span><i aria-hidden="true" className="fas fa-location-dot mr-1 text-brand-600"></i>{where}</span>
        {d.participants && d.participants > 1 && <span><i aria-hidden="true" className="fas fa-user-group mr-1 text-brand-600"></i>{d.participants} personas</span>}
        {isCustom && d.purpose && <span><i aria-hidden="true" className={`fas ${PURPOSES[d.purpose].icon} mr-1 text-brand-600`}></i>{PURPOSES[d.purpose].label}</span>}
      </div>

      {d.ticketId && (
        <p className="mt-2 rounded-xl bg-pink-50 px-3 py-2 text-xs text-pink-800" data-testid="booking-ticket-bonus">
          <i aria-hidden="true" className="fas fa-trophy mr-1"></i>Meta de experiencia: sin costo para el fan.
        </p>
      )}
      {b.message && <p className="mt-2 text-sm italic text-ink/70">“{b.message}”</p>}
      {as === 'creator' && flags.length > 0 && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="request-flags">
          <i aria-hidden="true" className="fas fa-triangle-exclamation mr-1"></i>Revisa: {flags.join(' ')}
        </p>
      )}

      {b.status === 'countered' && d.counter && (
        <div className="mt-3 rounded-xl border border-iris-200 bg-iris-50 p-3 text-sm" data-testid="counter-offer">
          <p className="font-semibold text-iris-800">
            <i aria-hidden="true" className="fas fa-right-left mr-1.5"></i>
            {as === 'fan' ? `${b.creatorName.split(' ')[0]} te propone:` : 'Tu contraoferta:'}
          </p>
          <p className="mt-1 text-ink/80 first-letter:uppercase">
            {formatLongDate(d.counter.date)} · {d.counter.time}
            {d.counter.durationMinutes ? ` · ${d.counter.durationMinutes} min` : ''} · <strong>{money(d.counter.price)}</strong>
          </p>
          {d.counter.note && <p className="mt-1 italic text-ink/70">“{d.counter.note}”</p>}
        </div>
      )}

      {as === 'fan' && b.status === 'accepted' && inPerson(d) && <div className="mt-3 space-y-2">
        {!bookingHasAttendance(d) && <ReserveCitySelector experiences={[{ active: true, details: d }]} />}
        <label className="flex min-h-11 items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={willAttend} onChange={(e) => setWillAttend(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
          <span>Confirmo que asistiré presencialmente en {locationLabel(d)} antes de pagar.</span>
        </label>
      </div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <ReserveStatusBadge status={status} />
        <div className="flex flex-wrap items-center gap-2">
          <LiveRoomButton booking={b} />
          {as === 'creator' && status === 'pending' && (
            <>
              <button type="button" disabled={busy} onClick={() => run(() => backend.updateBooking(user, b.id, 'rejected'))} className={`${btn} border border-line text-ink/70 hover:bg-gray-50`}>
                Rechazar
              </button>
              {!isEvent && !d.ticketId && (
                <button type="button" disabled={busy} onClick={() => setCountering(!countering)} aria-expanded={countering} className={`${btn} border border-iris-300 text-iris-700 hover:bg-iris-50`}>
                  Contraoferta
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => run(() => backend.updateBooking(user, b.id, 'accepted'))} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                Aceptar
              </button>
            </>
          )}
          {as === 'fan' && status === 'countered' && (
            <>
              <button type="button" disabled={busy} onClick={() => run(() => backend.respondCounter(user, b.id, false))} className={`${btn} border border-line text-ink/70`}>
                Rechazar contraoferta
              </button>
              <button type="button" disabled={busy} onClick={() => run(() => backend.respondCounter(user, b.id, true))} className={`${btn} bg-ink text-white`}>
                Aceptar contraoferta
              </button>
            </>
          )}
          {as === 'fan' && b.status === 'accepted' && onPay && (
            <button type="button" disabled={busy || (inPerson(d) && !willAttend)} onClick={async () => {
              if (inPerson(d)) {
                setBusy(true);
                try {
                  const r = await backend.confirmBookingAttendance(user, b.id);
                  if (!r.ok) return setError(r.error || 'Confirma la ciudad antes de pagar.');
                } catch { return setError('No se pudo comprobar la ciudad. Inténtalo de nuevo.'); }
                finally { setBusy(false); }
              }
              onPay(b);
            }} className={`${btn} bg-gradient-to-r from-brand-600 to-iris-600 text-white disabled:opacity-50`}>
              Pagar {money(b.price)}
            </button>
          )}
          {canPayWithCredits && (
            <button type="button" onClick={() => setPanel(panel === 'credits' ? null : 'credits')} aria-expanded={panel === 'credits'} className={`${btn} btn-gold`} data-testid="pay-credits">
              {fill(t('reserveCancel.payCredits'), { coins: formatCoins(priceCoins) })}
            </button>
          )}
          {canMove && (
            <button type="button" onClick={() => setPanel(panel === 'reschedule' ? null : 'reschedule')} aria-expanded={panel === 'reschedule'} className={`${btn} border border-line text-ink/70 hover:bg-gray-50`} data-testid="reschedule-open">
              <i aria-hidden="true" className="fas fa-calendar-days mr-1.5 text-[10px]"></i>{t('reserveCancel.reschedule')}
            </button>
          )}
          {outcome && (status === 'confirmed' || (as === 'fan' && (status === 'pending' || status === 'accepted' || status === 'countered'))) && (
            <button type="button" disabled={busy} onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')} aria-expanded={panel === 'cancel'} className={`${btn} text-red-600 hover:bg-red-50`} data-testid="cancel-open">
              {t('reserveCancel.cancel')}
            </button>
          )}
          {(status === 'confirmed' || status === 'completed') && (
            <button type="button" onClick={() => setReporting(true)} className={`${btn} text-ink/60 hover:text-ink`} aria-label={`Reportar un problema con ${b.title}`}>
              <i aria-hidden="true" className="fas fa-flag mr-1.5 text-[10px]"></i>Reportar
            </button>
          )}
        </div>
      </div>

      {countering && (
        <div className="mt-3 space-y-3 rounded-xl border border-line bg-gray-50 p-3" data-testid="counter-form">
          <p className="text-xs text-ink/70">Propón otra fecha, hora, precio o duración. Si solo necesitas más información, escribe tu pregunta y usa “Pedir cambios”.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs">
              <span className="font-semibold text-ink">Precio (USD)</span>
              <input name="counterPrice" type="number" min={5} max={5000} value={counter.price} onChange={(e) => setCounter({ ...counter, price: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="font-semibold text-ink">Fecha</span>
              <input name="counterDate" type="date" value={counter.date} onChange={(e) => setCounter({ ...counter, date: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="font-semibold text-ink">Hora</span>
              <input name="counterTime" type="time" step={3600} value={counter.time} onChange={(e) => setCounter({ ...counter, time: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="font-semibold text-ink">Duración (min)</span>
              <input name="counterDuration" type="number" min={MIN_SESSION_MINUTES} max={MAX_SESSION_MINUTES} step={5} value={counter.duration} onChange={(e) => setCounter({ ...counter, duration: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm" />
            </label>
          </div>
          <label className="block text-xs">
            <span className="font-semibold text-ink">Mensaje para {b.fanName.split(' ')[0]}</span>
            <input name="counterNote" maxLength={300} value={counter.note} onChange={(e) => setCounter({ ...counter, note: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm" />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy || counter.note.trim().length < 5} onClick={() => sendCounter(true)} className={`${btn} border border-line text-ink disabled:opacity-50`}>
              Pedir cambios
            </button>
            <button type="button" disabled={busy} onClick={() => sendCounter(false)} className={`${btn} bg-iris-600 text-white`}>
              Enviar contraoferta
            </button>
          </div>
        </div>
      )}

      {d.reschedule && b.status === 'confirmed' && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="reschedule-pending">
          <p>
            <i aria-hidden="true" className="fas fa-calendar-days mr-1.5"></i>
            {fill(t(as === 'fan' ? 'reserveCancel.reschedulePendingFan' : 'reserveCancel.reschedulePendingCreator'), {
              name: other,
              when: `${formatLongDate(d.reschedule.date)} · ${d.reschedule.time}`,
            })}
          </p>
          {d.reschedule.note && <p className="mt-1 italic text-amber-900/80">“{d.reschedule.note}”</p>}
          {as === 'creator' && (
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => run(() => backend.respondReschedule(user, b.id, false))} className={`${btn} border border-line bg-white text-ink/70`}>
                {t('reserveCancel.decline')}
              </button>
              <button type="button" disabled={busy} onClick={() => run(() => backend.respondReschedule(user, b.id, true))} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} data-testid="reschedule-accept">
                {t('reserveCancel.accept')}
              </button>
            </div>
          )}
        </div>
      )}
      {d.rescheduledFrom && b.status === 'confirmed' && (
        <p className="mt-2 text-xs text-ink/60">
          {fill(t('reserveCancel.rescheduledFrom'), { when: `${formatLongDate(d.rescheduledFrom.date)} · ${d.rescheduledFrom.time}` })}
        </p>
      )}

      {panel === 'credits' && canPayWithCredits && (
        <div className="mt-3 rounded-xl border border-gold-200 bg-gold-50 p-3 text-sm" data-testid="credits-panel">
          <p className="text-ink/80">{fill(t('reserveCancel.payCreditsNote'), { have: formatCoins(credits ?? 0), coins: formatCoins(priceCoins) })}</p>
          <p className="mt-1 text-xs text-ink/60">{t('reserveCancel.policy')}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setPanel(null)} className={`${btn} border border-line bg-white text-ink/70`}>{t('reserveCancel.back')}</button>
            <button type="button" disabled={busy || (inPerson(d) && !willAttend)} onClick={() => run(async () => {
              if (inPerson(d)) {
                if (!willAttend) return { ok: false, error: 'Confirma que asistirás presencialmente antes de pagar.' };
                const r = await backend.confirmBookingAttendance(user, b.id);
                if (!r.ok) return r;
              }
              return backend.payBookingWithCredits(user, b.id);
            })} className={`${btn} btn-gold`} data-testid="pay-credits-confirm">
              {t('reserveCancel.payCreditsConfirm')}
            </button>
          </div>
        </div>
      )}

      {panel === 'reschedule' && canMove && (
        <div className="mt-3 space-y-3 rounded-xl border border-line bg-gray-50 p-3" data-testid="reschedule-form">
          <p className="text-xs text-ink/70">{fill(t('reserveCancel.rescheduleHelp'), { name: other })}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="font-semibold text-ink">{t('reserveCancel.newDate')}</span>
              <input name="rescheduleDate" type="date" min={rescheduleMinDate()} value={move.date} onChange={(e) => setMove({ ...move, date: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="font-semibold text-ink">{t('reserveCancel.newTime')}</span>
              <input name="rescheduleTime" type="time" step={3600} value={move.time} onChange={(e) => setMove({ ...move, time: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm" />
            </label>
          </div>
          <label className="block text-xs">
            <span className="font-semibold text-ink">{t('reserveCancel.note')}</span>
            <input name="rescheduleNote" maxLength={300} value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPanel(null)} className={`${btn} border border-line bg-white text-ink/70`}>{t('reserveCancel.back')}</button>
            <button type="button" disabled={busy || !move.date || !move.time} onClick={() => run(() => backend.requestReschedule(user, b.id, move))} className={`${btn} bg-ink text-white disabled:opacity-50`} data-testid="reschedule-send">
              {t('reserveCancel.sendReschedule')}
            </button>
          </div>
        </div>
      )}

      {panel === 'cancel' && outcome && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid="cancel-panel">
          <p>
            {!outcome.paid
              ? t('reserveCancel.unpaid')
              : as === 'creator'
                ? outcome.ticket ? t('reserveCancel.creatorTicket') : fill(t('reserveCancel.creator'), { coins: formatCoins(outcome.refundCoins) })
                : outcome.ticket
                  ? t(outcome.ticketBack ? 'reserveCancel.fanTicketFull' : 'reserveCancel.fanTicketLate')
                  : fill(t(outcome.late ? 'reserveCancel.fanLate' : 'reserveCancel.fanFull'), { coins: formatCoins(outcome.refundCoins) })}
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setPanel(null)} className={`${btn} border border-line bg-white text-ink/70`}>{t('reserveCancel.back')}</button>
            <button type="button" disabled={busy} onClick={() => run(() => backend.cancelBooking(user, b.id))} className={`${btn} bg-red-600 text-white hover:bg-red-700`} data-testid="cancel-confirm">
              {t('reserveCancel.confirm')}
            </button>
          </div>
        </div>
      )}

      {cancelled?.paid && (
        <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-ink/70" data-testid="cancel-result">
          <i aria-hidden="true" className="fas fa-coins mr-1.5 text-gold-600"></i>
          {d.ticketId
            ? t(cancelled.ticketBack ? 'reserveCancel.doneTicketBack' : 'reserveCancel.doneTicketLost')
            : as === 'fan'
              ? cancelled.by === 'creator'
                ? fill(t('reserveCancel.doneByCreator'), { name: other, coins: formatCoins(cancelled.refundCoins ?? 0) })
                : fill(t('reserveCancel.doneFan'), { coins: formatCoins(cancelled.refundCoins ?? 0), percent: cancelled.refundPercent ?? 0 })
              : cancelled.by === 'creator'
                ? t('reserveCancel.creatorSelf')
                : fill(t((cancelled.refundPercent ?? 100) < 100 ? 'reserveCancel.creatorFanLate' : 'reserveCancel.creatorFanFull'), { name: other })}
        </p>
      )}
      {as === 'fan' && (status === 'accepted' || status === 'confirmed') && !d.ticketId && (
        <p className="mt-2 text-[11px] text-ink/55" data-testid="cancel-policy">{t('reserveCancel.policy')}</p>
      )}

      <WaitingNote booking={b} status={status} as={as} />

      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      {as === 'fan' && b.emailSentAt && (
        <p className="mt-2 text-xs text-emerald-700">
          <i aria-hidden="true" className="fas fa-envelope mr-1"></i> Correo de confirmación enviado a {displayEmail(b.fanEmail)}
        </p>
      )}
      {reporting && <ReportDialog kind="other" targetId={b.id} targetLabel={`Reserva: ${b.title} (${b.date} ${b.time})`} onClose={() => setReporting(false)} />}
    </div>
  );
};

// Where a request stands while someone has to answer: sent / seen (the fan's
// read receipt), the deadline, and what happens when it passes.
const WaitingNote: React.FC<{ booking: VipBooking; status: ReturnType<typeof reserveStatusOf>; as: 'fan' | 'creator' }> = ({ booking: b, status, as }) => {
  const creator = b.creatorName.split(' ')[0];
  const fan = b.fanName.split(' ')[0];
  const due = b.respondBy ? `${deadlineLabel(b.respondBy)} (${timeLeft(b.respondBy)})` : '';
  const line = 'mt-2 flex items-start gap-1.5 text-xs';
  if (status === 'pending' && as === 'fan')
    return (
      <div className="mt-2 space-y-1" data-testid="request-receipt">
        <p className={`${line} ${b.seenAt ? 'text-emerald-700' : 'text-ink/60'}`}>
          <i aria-hidden="true" className={`fas ${b.seenAt ? 'fa-check-double' : 'fa-check'} mt-0.5`}></i>
          {b.seenAt ? `Vista por ${creator} · ${ago(b.seenAt)}` : `Enviada · ${creator} aún no la ha visto`}
        </p>
        {due && <p className="text-xs text-ink/60">{creator} tiene hasta el {due} para responder. Si no responde, se cierra sola y no se te cobra nada.</p>}
      </div>
    );
  if (status === 'pending' && as === 'creator' && due)
    return (
      <p className={`${line} font-medium text-amber-800`} data-testid="request-deadline">
        <i aria-hidden="true" className="fas fa-clock mt-0.5"></i>Responde antes del {due}.
      </p>
    );
  if (status === 'countered' && due)
    return (
      <p className={`${line} text-ink/60`} data-testid="request-deadline">
        <i aria-hidden="true" className="fas fa-clock mt-0.5"></i>
        {as === 'fan' ? `Tienes hasta el ${due} para responder a la contraoferta.` : `${fan} tiene hasta el ${due} para responder.`}
      </p>
    );
  if (status === 'expired')
    return (
      <p className={`${line} text-ink/60`}>
        <i aria-hidden="true" className="fas fa-clock mt-0.5"></i>
        {as === 'fan' ? 'Nadie respondió a tiempo. No se te cobró nada y puedes enviar otra solicitud.' : 'Se cerró porque pasó el tiempo para responder. El horario quedó libre.'}
      </p>
    );
  return null;
};

export default ReserveBookingCard;
