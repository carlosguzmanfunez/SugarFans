import React, { useState } from 'react';
import { backend } from '../../lib/backend';
import { money } from '../../lib/platform';
import { formatLongDate, reserveStatusOf, typeOf, CUSTOM_EXPERIENCE, MIN_SESSION_MINUTES, MAX_SESSION_MINUTES, type VipBooking } from '../../lib/vip';
import { LOCATION_TYPES, PURPOSES, RESERVE_MODALITIES } from '../../config/reserve';
import { MODERATION_RULES } from '../../lib/moderation';
import type { User } from '../../context/AuthContext';
import { ReserveStatusBadge } from './ReserveBits';
import LiveRoomButton from '../LiveRoomButton';
import ReportDialog from '../ReportDialog';
import { displayEmail } from '../../config/demoAccounts';

interface Props {
  booking: VipBooking;
  user: User;
  as: 'fan' | 'creator';
  onChanged: () => void;
  onPay?: (b: VipBooking) => void;
  testId?: string;
}

const btn = 'inline-flex h-9 items-center justify-center rounded-full px-4 text-xs font-semibold transition';

// One Reserve as either side sees it: what was booked or requested, its state,
// and the next action (accept, reject, counter-offer / accept or decline the
// counter-offer, pay, cancel, join, report).
const ReserveBookingCard: React.FC<Props> = ({ booking: b, user, as, onChanged, onPay, testId }) => {
  const [countering, setCountering] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [counter, setCounter] = useState({ price: String(b.price), date: b.date, time: b.time, duration: String(b.durationMinutes ?? 30), note: '' });
  const d = b.details ?? {};
  const status = reserveStatusOf(b);
  const isCustom = b.experienceId === CUSTOM_EXPERIENCE || d.kind === 'custom';
  const modality = d.modality ?? 'virtual';

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setError(r.ok ? '' : r.error || 'No se pudo completar la acción');
    if (r.ok) {
      setCountering(false);
      onChanged();
    }
  };

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
      ? 'Online · sala privada'
      : [d.venue, d.locationType ? LOCATION_TYPES[d.locationType]?.label : '', d.city].filter(Boolean).join(' · ');

  return (
    <div data-testid={testId} className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700">
            {isCustom ? 'Experiencia personalizada' : d.typeId ? typeOf(d.typeId).name : 'Reserve'}
            {as === 'fan' ? ` · ${b.creatorName}` : ` · ${b.fanName}`}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{b.title}</p>
          <p className="mt-0.5 text-xs text-ink/60 first-letter:uppercase">
            {formatLongDate(b.date)} · {b.time}
            {b.durationMinutes ? ` · ${b.durationMinutes} min` : ''}
          </p>
        </div>
        <div className="text-right">
          <span className="text-sm font-bold text-ink">{money(b.price)}</span>
          {d.discountPercent ? <span className="block text-[11px] text-iris-700">−{d.discountPercent}% suscriptor</span> : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/70">
        <span><i aria-hidden="true" className={`fas ${RESERVE_MODALITIES[modality].icon} mr-1 text-brand-600`}></i>{RESERVE_MODALITIES[modality].label}</span>
        <span><i aria-hidden="true" className="fas fa-location-dot mr-1 text-brand-600"></i>{where}</span>
        {d.participants && d.participants > 1 && <span><i aria-hidden="true" className="fas fa-user-group mr-1 text-brand-600"></i>{d.participants} personas</span>}
        {isCustom && d.purpose && <span><i aria-hidden="true" className={`fas ${PURPOSES[d.purpose].icon} mr-1 text-brand-600`}></i>{PURPOSES[d.purpose].label}</span>}
      </div>

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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <ReserveStatusBadge status={status} />
        <div className="flex flex-wrap items-center gap-2">
          <LiveRoomButton booking={b} />
          {as === 'creator' && b.status === 'pending' && (
            <>
              <button type="button" disabled={busy} onClick={() => run(() => backend.updateBooking(user, b.id, 'rejected'))} className={`${btn} border border-line text-ink/70 hover:bg-gray-50`}>
                Rechazar
              </button>
              <button type="button" disabled={busy} onClick={() => setCountering(!countering)} aria-expanded={countering} className={`${btn} border border-iris-300 text-iris-700 hover:bg-iris-50`}>
                Contraoferta
              </button>
              <button type="button" disabled={busy} onClick={() => run(() => backend.updateBooking(user, b.id, 'accepted'))} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                Aceptar
              </button>
            </>
          )}
          {as === 'fan' && b.status === 'countered' && (
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
            <button type="button" onClick={() => onPay(b)} className={`${btn} bg-gradient-to-r from-brand-600 to-iris-600 text-white`}>
              Pagar {money(b.price)}
            </button>
          )}
          {as === 'fan' && (b.status === 'pending' || b.status === 'accepted') && (
            <button type="button" disabled={busy} onClick={() => run(() => backend.updateBooking(user, b.id, 'cancelled'))} className={`${btn} text-red-600 hover:bg-red-50`}>
              Cancelar
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

export default ReserveBookingCard;
