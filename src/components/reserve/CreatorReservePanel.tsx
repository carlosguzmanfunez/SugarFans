import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { backend } from '../../lib/backend';
import { usePlatformQuery, platformChanged, money } from '../../lib/platform';
import { creators as demoCreators } from '../../data/mockData';
import { categoryFor, RESERVE_COPY, RESERVE_RESPONSE_HOURS } from '../../config/reserve';
import { detailsOf, reserveStatusOf, typeOf, type Availability, type VipBooking, type VipExperience } from '../../lib/vip';
import ReserveExperienceWizard from './ReserveExperienceWizard';
import ReserveBookingCard from './ReserveBookingCard';
import { ExperienceFacts } from './ReserveBits';
import PushOptIn from '../PushOptIn';

interface Props {
  availability: Availability;
  bookings: VipBooking[];
  reloadBookings: () => void;
  // The general days/hours editor (kept in the dashboard, shown in "Disponibilidad").
  availabilityEditor: React.ReactNode;
}

type Section = 'experiences' | 'requests' | 'availability' | 'upcoming' | 'history';

// The creator's Reserve: what they offer, who asked, when they are available,
// what is coming up and what already happened.
const CreatorReservePanel: React.FC<Props> = ({ availability, bookings, reloadBookings, availabilityEditor }) => {
  const { user } = useAuth();
  const profileId = user?.creatorProfileId ?? '';
  const { data: all, reload } = usePlatformQuery(() => backend.listExperiences(), [], [] as VipExperience[]);
  const mine = all.filter((e) => e.creatorProfileId === profileId);
  const [picked, setPicked] = useState<Section | null>(null);
  const [wizard, setWizard] = useState<{ editing?: VipExperience } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const requests = bookings.filter((b) => {
    const s = reserveStatusOf(b);
    return s === 'pending' || s === 'countered' || s === 'reschedule_requested';
  });
  // Opens on Solicitudes while some are waiting, otherwise on the experiences.
  const section: Section = picked ?? (requests.length ? 'requests' : 'experiences');
  const setSection = (s: Section) => setPicked(s);
  useEffect(() => {
    if (!picked && requests.length) setPicked('requests');
  }, [picked, requests.length]);

  // Looking at Solicitudes counts as having read them: the fan sees "Vista".
  const unseen = section === 'requests' && requests.some((b) => !b.seenAt && b.status === 'pending');
  useEffect(() => {
    if (!unseen || !user) return;
    backend.markBookingsSeen(user).then(reloadBookings);
  }, [unseen, user, reloadBookings]);

  if (!user || user.role !== 'creator') return null;
  const category = categoryFor(user.settings.category || demoCreators.find((c) => c.id === profileId)?.category);

  const upcoming = bookings.filter((b) => {
    const s = reserveStatusOf(b);
    return s === 'accepted' || s === 'confirmed';
  });
  const history = bookings.filter((b) => {
    const s = reserveStatusOf(b);
    return s === 'completed' || s === 'rejected' || s === 'cancelled' || s === 'disputed';
  });

  const changed = () => {
    platformChanged();
    reload();
    reloadBookings();
  };

  const toggleActive = async (exp: VipExperience) => {
    const result = await backend.saveExperience(user, { ...exp, active: !exp.active }, exp.id);
    setMessage(result.ok ? null : { ok: false, text: result.error || 'No se pudo actualizar' });
    changed();
  };

  const remove = async (exp: VipExperience) => {
    if (!window.confirm(`¿Eliminar "${exp.title}"? Las reservas ya hechas se mantienen.`)) return;
    const result = await backend.deleteExperience(user, exp.id);
    setMessage(result.ok ? { ok: true, text: 'Experiencia eliminada.' } : { ok: false, text: result.error || 'No se pudo eliminar' });
    changed();
  };

  const sections: { id: Section; label: string; count?: number }[] = [
    { id: 'experiences', label: 'Mis experiencias', count: mine.length },
    { id: 'requests', label: 'Solicitudes', count: requests.length },
    { id: 'availability', label: 'Disponibilidad' },
    { id: 'upcoming', label: 'Próximas', count: upcoming.length },
    { id: 'history', label: 'Historial' },
  ];

  const list = (items: VipBooking[], empty: string, testId: string) =>
    items.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{empty}</p>
    ) : (
      <div className="space-y-3">
        {items.map((b) => (
          <ReserveBookingCard key={b.id} booking={b} user={user} as="creator" onChanged={changed} testId={testId} />
        ))}
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Reserve · {category.name}</p>
            <h2 className="mt-1 text-xl font-bold text-ink">Experiencias que los fans pueden reservar contigo</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink/70">{RESERVE_COPY.principle} Tú decides qué ofreces, cuándo, dónde, a qué precio y a quién aceptas.</p>
          </div>
          {!wizard && (
            <button
              type="button"
              onClick={() => { setWizard({}); setSection('experiences'); setMessage(null); }}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-white"
            >
              <i aria-hidden="true" className="fas fa-plus"></i> Crear experiencia
            </button>
          )}
        </div>
        <nav className="-mx-1 mt-5 flex gap-1 overflow-x-auto px-1" aria-label="Secciones de Reserve">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => { setSection(s.id); setWizard(null); }}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${section === s.id ? 'bg-ink text-white' : 'text-ink/70 hover:bg-gray-100'}`}
            >
              {s.label}
              {!!s.count && <span className={`ml-1.5 rounded-full px-1.5 text-xs ${section === s.id ? 'bg-white/20' : 'bg-gray-100'}`}>{s.count}</span>}
            </button>
          ))}
        </nav>
      </div>

      {/* Always in sight, whatever section is open: phone alerts for new requests. */}
      <PushOptIn user={user} />

      {message && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${message.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {section === 'experiences' && (
        <div data-testid="vip-experiences-admin">
          {wizard ? (
            <ReserveExperienceWizard
              user={user}
              category={category}
              availability={availability}
              editing={wizard.editing}
              onCancel={() => setWizard(null)}
              onSaved={(text) => { setWizard(null); setMessage({ ok: true, text }); changed(); }}
            />
          ) : mine.length === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
              <p className="font-semibold text-ink">Aún no tienes experiencias</p>
              <p className="mt-1 text-sm text-muted">Crea la primera: elige entre las experiencias permitidas para {category.name}.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {mine.map((exp) => {
                const d = detailsOf(exp);
                return (
                  <div key={exp.id} data-testid="my-experience" className="rounded-2xl bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700">{typeOf(exp.type).name}</p>
                        <p className="mt-0.5 font-semibold text-ink">
                          {exp.title}
                          {!exp.active && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-muted">Oculta</span>}
                        </p>
                      </div>
                      <span className="shrink-0 font-bold text-ink">{money(exp.price)}</span>
                    </div>
                    <div className="mt-2">
                      <ExperienceFacts exp={exp} compact />
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {d.approval === 'manual' ? 'Apruebas cada solicitud' : 'Confirmación automática'} · {d.maxParticipants === 1 ? '1 participante' : `hasta ${d.maxParticipants} participantes`}
                    </p>
                    <div className="mt-3 flex gap-4 text-xs font-medium">
                      <button type="button" onClick={() => { setWizard({ editing: exp }); setMessage(null); }} className="text-brand-700 hover:text-brand-800">Editar</button>
                      <button type="button" onClick={() => toggleActive(exp)} className="text-ink/70 hover:text-ink">{exp.active ? 'Ocultar' : 'Mostrar'}</button>
                      <button type="button" onClick={() => remove(exp)} className="text-red-600 hover:text-red-700">Eliminar</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {section === 'requests' && (
        <div data-testid="vip-requests" className="space-y-3">
          <p className="text-xs text-muted">
            <i aria-hidden="true" className="fas fa-clock mr-1"></i>
            Tienes {RESERVE_RESPONSE_HOURS} horas para responder cada solicitud. Si no respondes, se cierra sola, el horario queda libre y al fan no se le cobra nada.
          </p>
          {list(requests, 'No tienes solicitudes pendientes.', 'vip-request')}
        </div>
      )}
      {section === 'availability' && availabilityEditor}
      {section === 'upcoming' && <div data-testid="reserve-upcoming">{list(upcoming, 'No tienes reservas próximas.', 'vip-request')}</div>}
      {section === 'history' && <div data-testid="reserve-history">{list(history, 'Aún no hay historial.', 'vip-request')}</div>}
    </div>
  );
};

export default CreatorReservePanel;
