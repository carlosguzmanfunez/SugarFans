import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReserveModal from './ReserveModal';
import { ExperienceFacts, ExperienceTerms, PriceTag, ReserveNotice } from './ReserveBits';
import BookingCalendar from '../BookingCalendar';
import { backend } from '../../lib/backend';
import { money } from '../../lib/platform';
import { moderate } from '../../lib/moderation';
import {
  DEFAULT_AVAILABILITY,
  detailsOf,
  experienceAvailability,
  formatLongDate,
  needsApproval,
  priceFor,
  typeOf,
  type Availability,
  type TakenSlot,
  type VipExperience,
} from '../../lib/vip';
import type { User } from '../../context/AuthContext';
import { RESERVE_COPY, RESERVE_FLOW, isHomeService } from '../../config/reserve';

interface Props {
  exp: VipExperience;
  user: User | null;
  // Opens straight on the booking step ("Solicitar"/"Reservar") instead of the details.
  startBooking?: boolean;
  onNeedLogin: () => void;
  onClose: () => void;
}

// One experience, two steps: its full definition ("Ver detalles"), then day,
// time, participants and a note. Manual approval sends a request; automatic
// approval books it and leaves it waiting for payment.
const ReserveBookingDialog: React.FC<Props> = ({ exp, user, startBooking, onNeedLogin, onClose }) => {
  const d = detailsOf(exp);
  const type = typeOf(exp.type);
  const approval = needsApproval(exp);
  const isOwn = !!user?.creatorProfileId && user.creatorProfileId === exp.creatorProfileId;
  const subscribed = !!user?.subscriptions.some((s) => s.creatorId === exp.creatorProfileId);
  const price = priceFor(exp, subscribed);
  const [step, setStep] = useState<'details' | 'book' | 'done'>(startBooking && user && !isOwn ? 'book' : 'details');
  const [availability, setAvailability] = useState<Availability>(DEFAULT_AVAILABILITY);
  const [taken, setTaken] = useState<TakenSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [participants, setParticipants] = useState(1);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    Promise.all([backend.getAvailability(exp.creatorProfileId), backend.takenSlots(exp.creatorProfileId)]).then(([a, t]) => {
      setAvailability(experienceAvailability(a, exp));
      setTaken(t);
      setLoadingSlots(false);
    });
  }, [exp]);

  const begin = () => {
    if (!user) return onNeedLogin();
    setStep('book');
  };

  const submit = async () => {
    if (!user) return onNeedLogin();
    if (!date) return setError('Elige un día en el calendario');
    if (!time) return setError('Elige una hora disponible');
    const check = moderate(message, 'request', { homeAllowed: isHomeService(d.locationTypes ?? []) });
    if (!check.ok) return setError(check.error!);
    setSending(true);
    const result = await backend.createBooking(user, { experienceId: exp.id, date, time, message: message.trim(), participants });
    setSending(false);
    if (!result.ok) {
      setError(result.error || 'No se pudo enviar la reserva');
      backend.takenSlots(exp.creatorProfileId).then(setTaken);
      return;
    }
    setError('');
    setStep('done');
  };

  const verb = approval ? 'Solicitar' : 'Reservar';

  if (step === 'done') {
    return (
      <ReserveModal title={approval ? '¡Solicitud enviada!' : '¡Reserva aceptada!'} onClose={onClose} size="md" testId="reserve-dialog">
        <div className="text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <i aria-hidden="true" className="fas fa-check text-xl"></i>
          </span>
          <p className="font-semibold text-ink">{exp.title}</p>
          <p className="mt-1 text-sm text-ink/70">
            <span className="first-letter:uppercase">{formatLongDate(date)}</span> · {time}
          </p>
          <p className="mt-4 text-sm text-ink/70">
            {approval
              ? `${exp.creatorName} revisará tu solicitud. Si la acepta, podrás pagar desde Mis reservas y recibirás la confirmación.`
              : 'Esta experiencia se confirma al pagar. Completa el pago desde Mis reservas.'}
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" onClick={onClose} className="h-11 rounded-full border border-line px-6 text-sm font-semibold text-ink">Cerrar</button>
            <Link to="/profile" className="inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 text-sm font-semibold text-white">Ver mis reservas</Link>
          </div>
        </div>
      </ReserveModal>
    );
  }

  return (
    <ReserveModal
      title={step === 'book' ? `${verb}: ${exp.title}` : exp.title}
      subtitle={<>{type.name} · con {exp.creatorName}</>}
      onClose={onClose}
      testId="reserve-dialog"
      footer={
        step === 'details' ? (
          <div className="flex items-center justify-between gap-3">
            <PriceTag exp={exp} />
            {!isOwn && (
              <button type="button" onClick={begin} className="h-11 rounded-full bg-ink px-6 text-sm font-semibold text-white hover:bg-night-800">
                {verb}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => setStep('details')} className="h-11 rounded-full border border-line px-5 text-sm font-semibold text-ink">
              Volver a los detalles
            </button>
            <button type="button" onClick={submit} disabled={sending} className="h-11 rounded-full bg-gradient-to-r from-brand-600 to-iris-600 px-6 text-sm font-semibold text-white disabled:opacity-60">
              {approval ? 'Enviar solicitud' : 'Confirmar reserva'} · {money(price)}
            </button>
          </div>
        )
      }
    >
      {step === 'details' ? (
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-ink/80">{exp.description}</p>
          <ExperienceFacts exp={exp} />
          <ExperienceTerms exp={exp} />
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" aria-label="Cómo funciona">
            {RESERVE_FLOW.slice(0, 5).map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                {i > 0 && <i aria-hidden="true" className="fas fa-chevron-right text-[9px]"></i>}
                {s}
              </li>
            ))}
          </ol>
          <ReserveNotice kind="reserve" />
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Elige día y hora</p>
            {loadingSlots ? (
              <p className="py-6 text-center text-sm text-muted">Cargando horarios…</p>
            ) : (
              <BookingCalendar
                availability={availability}
                taken={taken}
                creatorName={exp.creatorName}
                date={date}
                time={time}
                minNoticeHours={d.minNoticeHours}
                onChange={(nd, nt) => { setDate(nd); setTime(nt); setError(''); }}
              />
            )}
          </div>
          {d.maxParticipants > 1 && (
            <label className="block text-sm">
              <span className="font-semibold text-ink">Participantes</span>
              <select name="participants" value={participants} onChange={(e) => setParticipants(Number(e.target.value))} className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5">
                {Array.from({ length: d.maxParticipants }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n === 1 ? 'Solo yo' : `${n} personas`}</option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm">
            <span className="font-semibold text-ink">Mensaje para {exp.creatorName.split(' ')[0]} (opcional)</span>
            <textarea
              name="message"
              rows={3}
              maxLength={500}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={(d.locationTypes ?? []).includes('fan-place') ? 'Qué te gustaría, tu nivel y, si lo quieres en tu lugar, la dirección o la zona (solo la ve el creator)' : 'Tema que te gustaría tratar, tu nivel, alguna pregunta…'}
              className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5"
            />
          </label>
          <div className="rounded-2xl bg-gray-50 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink/70">Total</span>
              <span className="text-lg font-bold text-ink">{money(price)}</span>
            </div>
            {price !== exp.price && <p className="mt-1 text-xs text-iris-700">Incluye tu descuento de suscriptor ({d.subscriberDiscount}%).</p>}
            <p className="mt-2 text-xs text-ink/70">
              {approval ? `${exp.creatorName} acepta o rechaza tu solicitud. Solo pagas si la acepta.` : 'Confirmación inmediata: pagas desde Mis reservas para confirmarla.'}
            </p>
          </div>
          <ReserveNotice kind="payments" />
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <p className="sr-only">{RESERVE_COPY.principle}</p>
        </div>
      )}
    </ReserveModal>
  );
};

export default ReserveBookingDialog;
