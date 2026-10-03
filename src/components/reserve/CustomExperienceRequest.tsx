import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReserveModal from './ReserveModal';
import { ReserveNotice } from './ReserveBits';
import BookingCalendar from '../BookingCalendar';
import { backend } from '../../lib/backend';
import { money } from '../../lib/platform';
import { moderate } from '../../lib/moderation';
import { DEFAULT_AVAILABILITY, formatLongDate, validateCustomRequest, type Availability, type CustomRequestInput, type TakenSlot } from '../../lib/vip';
import {
  LOCATION_TYPES,
  isHomeService,
  PURPOSES,
  RESERVE_MODALITIES,
  categoryFor,
  locationsFor,
  purposesFor,
  type ReserveModality,
} from '../../config/reserve';
import type { User } from '../../context/AuthContext';

interface Props {
  creator: { id: string; name: string; category?: string };
  user: User;
  onClose: () => void;
}

const STEPS = ['Modalidad', 'Propósito', 'Fecha y lugar', 'Presupuesto', 'Mensaje'] as const;
const DURATIONS = [15, 20, 30, 45, 60, 90, 120, 180];

// "Solicitar experiencia personalizada": not a blank box but five structured
// steps, with options that depend on the creator's category. The creator then
// accepts, rejects, asks for changes or sends a counter-offer.
const CustomExperienceRequest: React.FC<Props> = ({ creator, user, onClose }) => {
  const category = categoryFor(creator.category);
  const first = creator.name.split(' ')[0];
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [availability, setAvailability] = useState<Availability>(DEFAULT_AVAILABILITY);
  const [taken, setTaken] = useState<TakenSlot[]>([]);
  const [form, setForm] = useState<CustomRequestInput>({
    creatorProfileId: creator.id,
    modality: category.modalities[0],
    purpose: purposesFor(category, category.modalities[0])[0] ?? 'other',
    purposeNote: '',
    date: '',
    time: '',
    durationMinutes: 30,
    participants: 1,
    locationType: 'online',
    city: '',
    venue: '',
    budget: 100,
    message: '',
  });
  const set = (patch: Partial<CustomRequestInput>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError('');
  };

  useEffect(() => {
    Promise.all([backend.getAvailability(creator.id), backend.takenSlots(creator.id)]).then(([a, t]) => {
      setAvailability(a);
      setTaken(t);
    });
  }, [creator.id]);

  const pickModality = (modality: ReserveModality) => {
    const purposes = purposesFor(category, modality);
    const locations = locationsFor(category, null, modality);
    set({
      modality,
      purpose: purposes.includes(form.purpose) ? form.purpose : purposes[0] ?? 'other',
      locationType: locations[0] ?? 'online',
    });
  };

  // Each step checks only its own fields; the last runs the full validation.
  const stepError = (i: number): string | null => {
    if (i === 1 && form.purpose === 'other' && form.purposeNote.trim().length < 5) return 'Describe brevemente el propósito';
    if (i === 1 && form.purpose === 'other') {
      const m = moderate(form.purposeNote, 'request', { homeAllowed });
      if (!m.ok) return m.error!;
    }
    if (i === 2) {
      if (!form.date) return 'Elige un día en el calendario';
      if (!form.time) return 'Elige una hora disponible';
      if (form.modality !== 'virtual' && form.city.trim().length < 2) return 'Indica la ciudad';
      const m = moderate([form.city, form.venue], 'request', { homeAllowed });
      if (!m.ok) return m.error!;
    }
    if (i === 3 && (!Number.isFinite(form.budget) || form.budget < 5 || form.budget > 5000)) return 'El presupuesto debe estar entre $5 y $5000';
    return null;
  };

  const next = () => {
    const e = stepError(step);
    if (e) return setError(e);
    setStep(step + 1);
  };

  const send = async () => {
    const check = validateCustomRequest(form, creator.category);
    if (!check.ok) return setError(check.error!);
    setSending(true);
    const result = await backend.requestCustomExperience(user, form);
    setSending(false);
    if (!result.ok) return setError(result.error || 'No se pudo enviar la solicitud');
    setDone(true);
  };

  if (done) {
    return (
      <ReserveModal title="¡Solicitud enviada!" onClose={onClose} size="md" testId="custom-request">
        <div className="text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <i aria-hidden="true" className="fas fa-check text-xl"></i>
          </span>
          <p className="text-sm text-ink/70">
            {first} revisará tu propuesta. Puede aceptarla, rechazarla, pedirte cambios o enviarte una contraoferta con otra fecha, precio o duración.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" onClick={onClose} className="h-11 rounded-full border border-line px-6 text-sm font-semibold text-ink">Cerrar</button>
            <Link to="/profile" className="inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 text-sm font-semibold text-white">Ver mis reservas</Link>
          </div>
        </div>
      </ReserveModal>
    );
  }

  const locations = locationsFor(category, null, form.modality);
  const homeAllowed = isHomeService(locations);
  const purposes = purposesFor(category, form.modality);
  const option = (active: boolean) =>
    `flex items-start gap-3 rounded-2xl border p-3.5 text-left transition ${active ? 'border-ink bg-ink/[0.03] ring-1 ring-ink' : 'border-line hover:border-ink/30'}`;

  return (
    <ReserveModal
      title="Solicitar experiencia personalizada"
      subtitle={<>Para {creator.name} · {category.name}</>}
      onClose={onClose}
      testId="custom-request"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (step === 0 ? onClose() : (setStep(step - 1), setError('')))}
            className="h-11 rounded-full border border-line px-5 text-sm font-semibold text-ink"
          >
            {step === 0 ? 'Cancelar' : 'Atrás'}
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={next} className="h-11 rounded-full bg-ink px-6 text-sm font-semibold text-white">Siguiente</button>
          ) : (
            <button type="button" onClick={send} disabled={sending} className="h-11 rounded-full bg-gradient-to-r from-brand-600 to-iris-600 px-6 text-sm font-semibold text-white disabled:opacity-60">
              Enviar solicitud
            </button>
          )}
        </div>
      }
    >
      <ol className="mb-5 grid grid-cols-5 gap-1.5" aria-label="Pasos">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className="min-w-0">
            <span className={`block h-1.5 rounded-full ${i <= step ? 'bg-brand-600' : 'bg-gray-200'}`}></span>
            <span className={`mt-1.5 block truncate text-[11px] ${i === step ? 'font-semibold text-ink' : 'text-muted'}`}>{s}</span>
          </li>
        ))}
      </ol>
      <p className="mb-4 text-sm font-semibold text-ink" data-testid="custom-step">Paso {step + 1} de {STEPS.length} · {STEPS[step]}</p>

      {step === 0 && (
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Modalidad</legend>
          {category.modalities.map((m) => (
            <button key={m} type="button" aria-pressed={form.modality === m} onClick={() => pickModality(m)} className={option(form.modality === m)}>
              <i aria-hidden="true" className={`fas ${RESERVE_MODALITIES[m].icon} mt-0.5 text-brand-600`}></i>
              <span>
                <span className="block text-sm font-semibold text-ink">{RESERVE_MODALITIES[m].label}</span>
                <span className="block text-xs text-ink/60">{RESERVE_MODALITIES[m].description}</span>
              </span>
            </button>
          ))}
        </fieldset>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <legend className="mb-2 text-xs text-ink/60">Opciones para {category.name} en modalidad {RESERVE_MODALITIES[form.modality].label.toLowerCase()}</legend>
            {purposes.map((p) => (
              <button key={p} type="button" aria-pressed={form.purpose === p} onClick={() => set({ purpose: p })} className={option(form.purpose === p)}>
                <i aria-hidden="true" className={`fas ${PURPOSES[p].icon} mt-0.5 text-brand-600`}></i>
                <span className="text-sm font-semibold text-ink">{PURPOSES[p].label}</span>
              </button>
            ))}
          </fieldset>
          {form.purpose === 'other' && (
            <label className="block text-sm">
              <span className="font-semibold text-ink">¿Qué experiencia propones?</span>
              <input name="purposeNote" maxLength={80} value={form.purposeNote} onChange={(e) => set({ purposeNote: e.target.value })} placeholder="Ej.: revisión de mi look para un evento" className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5" />
            </label>
          )}
          {category.restrictions && (
            <ul className="space-y-1 rounded-xl bg-gray-50 p-3 text-xs text-ink/70">
              {category.restrictions.map((r) => (
                <li key={r} className="flex gap-2"><i aria-hidden="true" className="fas fa-shield-halved mt-0.5 text-[10px] text-muted"></i>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <BookingCalendar availability={availability} taken={taken} creatorName={creator.name} date={form.date} time={form.time} onChange={(date, time) => set({ date, time })} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-semibold text-ink">Duración</span>
              <select name="duration" value={form.durationMinutes} onChange={(e) => set({ durationMinutes: Number(e.target.value) })} className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5">
                {DURATIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-ink">Participantes</span>
              <input name="participants" type="number" min={1} max={50} value={form.participants} onChange={(e) => set({ participants: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5" />
            </label>
          </div>
          {form.modality === 'virtual' ? (
            <p className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-ink/70">
              <i aria-hidden="true" className="fas fa-video text-brand-600"></i> {LOCATION_TYPES.online.label}
            </p>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="font-semibold text-ink">Tipo de lugar</span>
                <select name="locationType" value={form.locationType} onChange={(e) => set({ locationType: e.target.value as CustomRequestInput['locationType'] })} className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5">
                  {locations.map((l) => <option key={l} value={l}>{LOCATION_TYPES[l].label}</option>)}
                </select>
                <span className="mt-1 block text-xs text-muted">
                  {homeAllowed
                    ? 'Venues, establecimientos, el lugar del creator o el que tú propongas. Si es tu lugar, escribe la dirección o la zona en "Venue o dirección"; solo la ve este creator. Nunca hoteles.'
                    : 'Solo venues, estudios, establecimientos y lugares públicos. Nunca domicilios ni hoteles.'}
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-semibold text-ink">Ciudad</span>
                  <input name="city" maxLength={60} value={form.city} onChange={(e) => set({ city: e.target.value })} className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5" />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-ink">{homeAllowed ? 'Venue o dirección (opcional)' : 'Venue (opcional)'}</span>
                  <input name="venue" maxLength={80} value={form.venue} onChange={(e) => set({ venue: e.target.value })} placeholder="Nombre del evento o establecimiento" className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5" />
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="font-semibold text-ink">Presupuesto que ofreces (USD)</span>
            <input name="budget" type="number" min={5} max={5000} step="1" value={form.budget} onChange={(e) => set({ budget: Number(e.target.value) })} className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5 text-lg font-semibold" />
          </label>
          <p className="text-xs text-ink/60">
            {first} puede aceptarlo o proponerte otro precio. Solo pagas si acepta y tú confirmas.
          </p>
          <ReserveNotice kind="payments" />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="font-semibold text-ink">Detalles para {first}</span>
            <textarea name="message" rows={4} maxLength={500} value={form.message} onChange={(e) => set({ message: e.target.value })} placeholder="Qué te gustaría lograr, contexto del evento o del proyecto, preguntas…" className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5" />
          </label>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl bg-gray-50 p-4 text-sm" data-testid="custom-summary">
            <dt className="text-ink/60">Modalidad</dt><dd className="font-medium text-ink">{RESERVE_MODALITIES[form.modality].label}</dd>
            <dt className="text-ink/60">Propósito</dt><dd className="font-medium text-ink">{form.purpose === 'other' ? form.purposeNote : PURPOSES[form.purpose].label}</dd>
            <dt className="text-ink/60">Fecha</dt><dd className="font-medium text-ink first-letter:uppercase">{form.date ? `${formatLongDate(form.date)} · ${form.time}` : '—'}</dd>
            <dt className="text-ink/60">Duración</dt><dd className="font-medium text-ink">{form.durationMinutes} min · {form.participants} {form.participants === 1 ? 'persona' : 'personas'}</dd>
            <dt className="text-ink/60">Lugar</dt><dd className="font-medium text-ink">{form.modality === 'virtual' ? 'Online' : [LOCATION_TYPES[form.locationType].label, form.city].filter(Boolean).join(' · ')}</dd>
            <dt className="text-ink/60">Presupuesto</dt><dd className="font-medium text-ink">{money(form.budget)}</dd>
          </dl>
          <ReserveNotice kind="reserve" />
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    </ReserveModal>
  );
};

export default CustomExperienceRequest;
