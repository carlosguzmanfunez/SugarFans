import React, { useState } from 'react';
import { backend } from '../../lib/backend';
import type { User } from '../../context/AuthContext';
import {
  ALL_HOURS,
  WEEKDAYS,
  DEFAULT_EXPERIENCE_IMAGE,
  MIN_EXPERIENCE_PRICE,
  MAX_EXPERIENCE_PRICE,
  defaultDetails,
  validateExperience,
  type Availability,
  type ReserveDetails,
  type VipExperience,
  type VipExperienceInput,
} from '../../lib/vip';
import {
  CANCELLATION_POLICIES,
  LOCATION_TYPES,
  MIN_NOTICE_OPTIONS,
  RESERVE_MODALITIES,
  SUBSCRIBER_DISCOUNTS,
  experienceTypeById,
  experienceTypesFor,
  locationsFor,
  modalitiesFor,
  noticeLabel,
  type CreatorCategory,
  type ReserveModality,
} from '../../config/reserve';
import { moderate } from '../../lib/moderation';
import { ExperienceFacts, ExperienceTerms } from './ReserveBits';
import ReserveExperienceCard from './ReserveExperienceCard';

interface Props {
  user: User;
  category: CreatorCategory;
  availability: Availability;
  editing?: VipExperience;
  onSaved: (text: string) => void;
  onCancel: () => void;
}

export const WIZARD_STEPS = [
  'Tipo de experiencia',
  'Nombre',
  'Descripción',
  'Modalidad',
  'Duración',
  'Precio',
  'Disponibilidad',
  'Ubicación',
  'Participantes',
  'Requisitos',
  'Aprobación',
  'Cancelación',
  'Vista previa',
  'Publicar',
] as const;

const field = 'mt-1 block w-full rounded-xl border border-line px-3 py-2.5 text-sm';
const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

// "Crear experiencia": the creator defines a Reserve step by step, choosing only
// among the experiences, modalities and venue types their category allows.
const ReserveExperienceWizard: React.FC<Props> = ({ user, category, availability, editing, onSaved, onCancel }) => {
  const allowedTypes = experienceTypesFor(category);
  const initialType = editing ? experienceTypeById(editing.type) : allowedTypes[0];
  const [step, setStep] = useState(editing ? 1 : 0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState<VipExperienceInput & { details: ReserveDetails }>(() => {
    const base = editing ?? {
      title: '',
      description: '',
      type: initialType?.id ?? 'video-call',
      price: 50,
      durationMinutes: initialType?.minutes ? initialType.defaultMinutes : undefined,
      image: DEFAULT_EXPERIENCE_IMAGE,
      active: true,
    };
    return { ...base, details: { ...defaultDetails(), ...(editing?.details ?? {}) } };
  });
  const [includes, setIncludes] = useState(input.details.includes.join('\n'));
  const [excludes, setExcludes] = useState(input.details.excludes.join('\n'));

  const type = experienceTypeById(input.type) ?? allowedTypes[0];
  const d = input.details;
  const set = (patch: Partial<VipExperienceInput>) => {
    setInput((x) => ({ ...x, ...patch }));
    setError('');
  };
  const setD = (patch: Partial<ReserveDetails>) => {
    setInput((x) => ({ ...x, details: { ...x.details, ...patch } }));
    setError('');
  };

  const pickType = (id: string) => {
    const t = experienceTypeById(id)!;
    const modality: ReserveModality = modalitiesFor(category, t)[0] ?? 'virtual';
    const locations = locationsFor(category, t, modality);
    setInput((x) => ({
      ...x,
      type: id,
      durationMinutes: t.minutes ? t.defaultMinutes ?? t.minutes[0] : undefined,
      details: {
        ...x.details,
        modality,
        locationTypes: modality === 'virtual' ? ['online'] : locations.slice(0, 1),
        maxParticipants: Math.min(x.details.maxParticipants, t.maxParticipants),
        approval: t.alwaysManual ? 'manual' : x.details.approval,
      },
    }));
    setError('');
  };

  const pickModality = (modality: ReserveModality) => {
    const locations = locationsFor(category, type, modality);
    setD({ modality, locationTypes: modality === 'virtual' ? ['online'] : locations.slice(0, 1) });
  };

  const lines = (text: string) => text.split('\n').map((x) => x.trim()).filter(Boolean);
  const current = (): VipExperienceInput => ({ ...input, details: { ...d, includes: lines(includes), excludes: lines(excludes) } });

  // What each step needs before moving on; "Cancelación" (the last editable step) runs the full validation.
  const stepError = (i: number): string | null => {
    const mod = (texts: Array<string | undefined>) => {
      const r = moderate(texts, 'experience');
      return r.ok ? null : r.error!;
    };
    if (i === 0 && !type) return 'Elige el tipo de experiencia';
    if (i === 1) return input.title.trim().length < 3 || input.title.trim().length > 80 ? 'El nombre debe tener entre 3 y 80 caracteres' : mod([input.title]);
    if (i === 2) return input.description.trim().length < 10 ? 'Describe la experiencia (mínimo 10 caracteres)' : mod([input.description]);
    if (i === 5 && (!Number.isFinite(input.price) || input.price < MIN_EXPERIENCE_PRICE || input.price > MAX_EXPERIENCE_PRICE))
      return `El precio debe estar entre $${MIN_EXPERIENCE_PRICE} y $${MAX_EXPERIENCE_PRICE}`;
    if (i === 7 && d.modality !== 'virtual') {
      if (!d.locationTypes.length || (d.city ?? '').trim().length < 2) return 'Elige el tipo de lugar e indica la ciudad';
      return mod([d.venue, d.city]);
    }
    if (i === 9) return mod([d.requirements.notes, ...lines(includes)]);
    if (i === 11) {
      const check = validateExperience(current(), user.settings.category || category.name);
      return check.ok ? null : check.error!;
    }
    return null;
  };

  const next = () => {
    const e = stepError(step);
    if (e) return setError(e);
    setStep(step + 1);
  };

  const publish = async () => {
    const final = current();
    const check = validateExperience(final, user.settings.category || category.name);
    if (!check.ok) return setError(check.error!);
    setSaving(true);
    const result = await backend.saveExperience(user, final, editing?.id);
    setSaving(false);
    if (!result.ok) return setError(result.error || 'No se pudo guardar');
    onSaved(editing ? 'Experiencia actualizada.' : final.active ? 'Experiencia publicada.' : 'Experiencia guardada como oculta.');
  };

  const preview: VipExperience = { ...current(), id: editing?.id ?? 'preview', creatorProfileId: user.creatorProfileId ?? '', creatorName: user.name, createdAt: '' };
  const option = (active: boolean) =>
    `flex items-start gap-3 rounded-2xl border p-3 text-left transition ${active ? 'border-ink bg-ink/[0.03] ring-1 ring-ink' : 'border-line hover:border-ink/30'}`;

  return (
    <div className="rounded-2xl border border-line bg-white p-4 sm:p-6" data-testid="experience-form">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">{editing ? 'Editar experiencia' : 'Crear experiencia'} · {category.name}</p>
          <h3 className="mt-1 text-lg font-bold text-ink" data-testid="wizard-step">
            Paso {step + 1} de {WIZARD_STEPS.length} · {WIZARD_STEPS[step]}
          </h3>
        </div>
        <button type="button" onClick={onCancel} className="text-sm font-medium text-ink/60 hover:text-ink">Cancelar</button>
      </div>
      <ol className="mb-5 flex gap-1" aria-label="Progreso">
        {WIZARD_STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              aria-label={`Paso ${i + 1}: ${s}`}
              aria-current={i === step ? 'step' : undefined}
              disabled={!editing && i > step}
              onClick={() => setStep(i)}
              className={`block h-1.5 w-full rounded-full ${i <= step ? 'bg-brand-600' : 'bg-gray-200'} disabled:cursor-default`}
            ></button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div>
          <p className="mb-3 text-sm text-ink/70">Solo aparecen las experiencias permitidas para <strong>{category.name}</strong>. Puedes cambiar tu categoría en Configuración.</p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de experiencia" data-testid="allowed-types">
            {allowedTypes.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={input.type === t.id} onClick={() => pickType(t.id)} className={option(input.type === t.id)} data-type={t.id}>
                <i aria-hidden="true" className={`fas ${t.icon} mt-0.5 w-4 text-brand-600`}></i>
                <span>
                  <span className="block text-sm font-semibold text-ink">{t.name}</span>
                  <span className="block text-xs text-ink/60">{t.description}</span>
                  <span className="mt-1 block text-[11px] text-muted">{t.modalities.filter((m) => category.modalities.includes(m)).map((m) => RESERVE_MODALITIES[m].label).join(' · ')}</span>
                </span>
              </button>
            ))}
          </div>
          {category.contentLine && <p className="mt-3 rounded-xl bg-gray-50 p-3 text-xs text-ink/70"><i aria-hidden="true" className="fas fa-shield-halved mr-1.5"></i>{category.contentLine}</p>}
        </div>
      )}

      {step === 1 && (
        <label className="block text-sm">
          <span className="font-semibold text-ink">Nombre de la experiencia</span>
          <input name="expTitle" maxLength={80} value={input.title} onChange={(e) => set({ title: e.target.value })} placeholder={`Ej.: ${type?.name} con ${user.name.split(' ')[0]}`} className={field} />
          <span className="mt-1 block text-xs text-muted">Concreto y descriptivo: qué es, no a quién se conoce.</span>
        </label>
      )}

      {step === 2 && (
        <label className="block text-sm">
          <span className="font-semibold text-ink">Descripción</span>
          <textarea name="expDescription" rows={4} maxLength={600} value={input.description} onChange={(e) => set({ description: e.target.value })} placeholder="Qué pasa durante la experiencia, qué se lleva el fan y para quién es." className={field} />
        </label>
      )}

      {step === 3 && type && (
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Modalidad">
          {modalitiesFor(category, type).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={d.modality === m} onClick={() => pickModality(m)} className={option(d.modality === m)}>
              <i aria-hidden="true" className={`fas ${RESERVE_MODALITIES[m].icon} mt-0.5 text-brand-600`}></i>
              <span>
                <span className="block text-sm font-semibold text-ink">{RESERVE_MODALITIES[m].label}</span>
                <span className="block text-xs text-ink/60">{RESERVE_MODALITIES[m].description}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 4 && type && (
        type.minutes ? (
          <label className="block text-sm">
            <span className="font-semibold text-ink">Duración (minutos)</span>
            <input name="expMinutes" type="number" min={type.minutes[0]} max={type.minutes[1]} step={5} value={input.durationMinutes ?? ''} onChange={(e) => set({ durationMinutes: Number(e.target.value) || undefined })} className={field} />
            <span className="mt-1 block text-xs text-muted">Entre {type.minutes[0]} y {type.minutes[1]} minutos para {type.name}.{d.modality === 'virtual' ? ' Se hace en la sala privada de Fans Reserve.' : ''}</span>
          </label>
        ) : (
          <p className="rounded-xl bg-gray-50 p-3 text-sm text-ink/70"><i aria-hidden="true" className="fas fa-box-open mr-2"></i>{type.name} se entrega en la app; no tiene sesión en vivo.</p>
        )
      )}

      {step === 5 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-semibold text-ink">Precio (USD)</span>
            <input name="expPrice" type="number" min={MIN_EXPERIENCE_PRICE} max={MAX_EXPERIENCE_PRICE} step="0.01" value={Number.isFinite(input.price) ? input.price : ''} onChange={(e) => set({ price: Number(e.target.value) })} className={field} />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink">Descuento para suscriptores</span>
            <select name="expDiscount" value={d.subscriberDiscount ?? 0} onChange={(e) => setD({ subscriberDiscount: Number(e.target.value) || undefined })} className={field}>
              {SUBSCRIBER_DISCOUNTS.map((p) => <option key={p} value={p}>{p ? `${p}%` : 'Sin descuento'}</option>)}
            </select>
            <span className="mt-1 block text-xs text-muted">Opcional y explícito: la suscripción no incluye Reserve.</span>
          </label>
        </div>
      )}

      {step === 6 && (
        <div className="space-y-4">
          <p className="text-sm text-ink/70">Por defecto usa tus horarios generales. Puedes limitar esta experiencia a algunos días u horas.</p>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Días</p>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((w, i) => {
                const on = (d.days ?? availability.days).includes(i);
                const offered = availability.days.includes(i);
                return (
                  <button key={w} type="button" disabled={!offered} aria-pressed={on && offered} onClick={() => setD({ days: toggle(d.days ?? availability.days, i) })} className={`h-10 w-12 rounded-xl border text-sm font-medium ${on && offered ? 'border-ink bg-ink text-white' : 'border-line text-ink/70'} disabled:opacity-30`}>
                    {w}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Horas</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {ALL_HOURS.filter((h) => availability.hours.includes(h)).map((h) => {
                const on = (d.hours ?? availability.hours).includes(h);
                return (
                  <button key={h} type="button" aria-pressed={on} onClick={() => setD({ hours: toggle(d.hours ?? availability.hours, h) })} className={`h-10 rounded-xl border text-sm font-medium ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line text-ink/70'}`}>
                    {h}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block text-sm sm:max-w-xs">
            <span className="font-semibold text-ink">Anticipación mínima</span>
            <select name="expNotice" value={d.minNoticeHours} onChange={(e) => setD({ minNoticeHours: Number(e.target.value) })} className={field}>
              {MIN_NOTICE_OPTIONS.map((h) => <option key={h} value={h}>{noticeLabel(h)}</option>)}
            </select>
          </label>
        </div>
      )}

      {step === 7 && (
        d.modality === 'virtual' ? (
          <p className="rounded-xl bg-gray-50 p-3 text-sm text-ink/70"><i aria-hidden="true" className="fas fa-video mr-2 text-brand-600"></i>{LOCATION_TYPES.online.label}: no hace falta ubicación.</p>
        ) : (
          <div className="space-y-3">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">Tipos de lugar permitidos</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {locationsFor(category, type, d.modality).map((l) => (
                  <label key={l} className={option(d.locationTypes.includes(l))}>
                    <input type="checkbox" className="mt-1" checked={d.locationTypes.includes(l)} onChange={() => setD({ locationTypes: toggle(d.locationTypes, l) })} />
                    <span>
                      <span className="block text-sm font-semibold text-ink">{LOCATION_TYPES[l].label}</span>
                      <span className="block text-xs text-ink/60">{LOCATION_TYPES[l].hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Fans Reserve no ofrece domicilios, hoteles ni lugares privados o discretos como ubicación.</p>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-semibold text-ink">Ciudad</span>
                <input name="expCity" maxLength={60} value={d.city ?? ''} onChange={(e) => setD({ city: e.target.value })} className={field} />
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-ink">Venue (opcional)</span>
                <input name="expVenue" maxLength={80} value={d.venue ?? ''} onChange={(e) => setD({ venue: e.target.value })} placeholder="Nombre del venue o evento" className={field} />
              </label>
            </div>
          </div>
        )
      )}

      {step === 8 && type && (
        <label className="block text-sm sm:max-w-xs">
          <span className="font-semibold text-ink">Número máximo de participantes</span>
          <select name="expParticipants" value={d.maxParticipants} onChange={(e) => setD({ maxParticipants: Number(e.target.value) })} className={field}>
            {Array.from({ length: type.maxParticipants }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? '1 (solo el fan)' : n}</option>)}
          </select>
        </label>
      )}

      {step === 9 && (
        <div className="space-y-4">
          <label className="flex items-center gap-3 text-sm text-ink">
            <input type="checkbox" checked={d.requirements.verifiedFans} onChange={(e) => setD({ requirements: { ...d.requirements, verifiedFans: e.target.checked } })} />
            Solo fans con identidad verificada
          </label>
          <label className="flex items-center gap-3 text-sm text-ink">
            <input type="checkbox" checked={d.requirements.subscribersOnly} onChange={(e) => setD({ requirements: { ...d.requirements, subscribersOnly: e.target.checked } })} />
            Solo suscriptores
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-semibold text-ink">Incluye (uno por línea)</span>
              <textarea name="expIncludes" rows={3} value={includes} onChange={(e) => setIncludes(e.target.value)} className={field} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-ink">No incluye (uno por línea)</span>
              <textarea name="expExcludes" rows={3} value={excludes} onChange={(e) => setExcludes(e.target.value)} className={field} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-semibold text-ink">Condiciones adicionales (opcional)</span>
            <textarea name="expConditions" rows={2} maxLength={400} value={d.conditions ?? ''} onChange={(e) => setD({ conditions: e.target.value })} placeholder="Ej.: llega 10 minutos antes; se requiere acreditación del evento." className={field} />
          </label>
        </div>
      )}

      {step === 10 && type && (
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Aprobación">
          {(['manual', 'automatic'] as const).map((a) => {
            const locked = a === 'automatic' && !!type.alwaysManual;
            return (
              <button key={a} type="button" role="radio" aria-checked={d.approval === a} disabled={locked} onClick={() => setD({ approval: a })} className={`${option(d.approval === a)} disabled:opacity-40`}>
                <i aria-hidden="true" className={`fas ${a === 'manual' ? 'fa-user-check' : 'fa-bolt'} mt-0.5 text-brand-600`}></i>
                <span>
                  <span className="block text-sm font-semibold text-ink">{a === 'manual' ? 'Apruebo cada solicitud' : 'Confirmación automática'}</span>
                  <span className="block text-xs text-ink/60">
                    {a === 'manual' ? 'El fan ve “Solicitar”. Tú aceptas, rechazas o envías una contraoferta.' : locked ? `${type.name} siempre requiere tu aprobación.` : 'El fan ve “Reservar” y paga directamente en tus horarios.'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {step === 11 && (
        <div className="grid gap-2" role="radiogroup" aria-label="Política de cancelación">
          {(Object.keys(CANCELLATION_POLICIES) as (keyof typeof CANCELLATION_POLICIES)[]).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={d.cancellationPolicy === p} onClick={() => setD({ cancellationPolicy: p })} className={option(d.cancellationPolicy === p)}>
              <span>
                <span className="block text-sm font-semibold text-ink">{CANCELLATION_POLICIES[p].label}</span>
                <span className="block text-xs text-ink/60">{CANCELLATION_POLICIES[p].summary}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 12 && (
        <div className="space-y-4" data-testid="experience-preview">
          <p className="text-sm text-ink/70">Así verán los fans tu experiencia:</p>
          <div className="max-w-md">
            <ReserveExperienceCard exp={preview} onDetails={() => undefined} onBook={() => undefined} />
          </div>
          <ExperienceFacts exp={preview} />
          <ExperienceTerms exp={preview} />
        </div>
      )}

      {step === 13 && (
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm text-ink">
            <input type="checkbox" checked={input.active} onChange={(e) => set({ active: e.target.checked })} />
            Visible para los fans en mi perfil y en Reserve
          </label>
          <p className="rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-ink/70">
            Al publicar confirmas que la experiencia coincide con su descripción, que cumple las políticas de Fans Reserve y las leyes aplicables, y que puedes rechazar cualquier solicitud.
          </p>
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button type="button" onClick={() => (step === 0 ? onCancel() : setStep(step - 1))} className="h-11 rounded-full border border-line px-5 text-sm font-semibold text-ink">
          {step === 0 ? 'Cancelar' : 'Atrás'}
        </button>
        {step < WIZARD_STEPS.length - 1 ? (
          <button type="button" onClick={next} className="h-11 rounded-full bg-ink px-6 text-sm font-semibold text-white">Siguiente</button>
        ) : (
          <button type="button" onClick={publish} disabled={saving} className="h-11 rounded-full bg-gradient-to-r from-brand-600 to-iris-600 px-6 text-sm font-semibold text-white disabled:opacity-60">
            {editing ? 'Guardar cambios' : 'Publicar experiencia'}
          </button>
        )}
      </div>
    </div>
  );
};

export default ReserveExperienceWizard;
