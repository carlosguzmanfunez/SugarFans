import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import type { User } from '../../context/AuthContext';
import { isUpcomingEvent, reserveProductOf, eventStart, type ReserveProduct, type VipExperience } from '../../lib/vip';
import { categoryFor, RESERVE_FORMATS } from '../../config/reserve';
import { backend } from '../../lib/backend';
import { usePlatformQuery } from '../../lib/platform';
import ReserveExperienceCard from './ReserveExperienceCard';
import ReserveBookingDialog from './ReserveBookingDialog';
import CustomExperienceRequest from './CustomExperienceRequest';
import { ReserveNotice } from './ReserveBits';
import { money } from '../../lib/platformRules';

interface Props {
  creator: { id: string; name: string; category?: string };
  experiences: VipExperience[];
  user: User | null;
  isOwner: boolean;
  onNeedLogin: () => void;
}

// Reserve's products on a profile, in this order. The 1:1 video call always
// comes first on every profile: it is where "Habla con …" lands.
const GROUPS: { id: ReserveProduct; title: string; hint: string }[] = [
  { id: 'one-to-one', title: RESERVE_FORMATS.private.product, hint: 'Sesión en vivo por Fans Reserve: solo tú y el creador.' },
  { id: 'event', title: RESERVE_FORMATS.event.product, hint: 'Sesión en vivo en grupo, con fecha fija y plazas limitadas. Reserva tu plaza.' },
  { id: 'other', title: 'Otras experiencias', hint: 'Presenciales, profesionales o entregadas en la app.' },
];

// Seats already held per Reserve Event (counts only).
export const useEventSeats = (experiences: VipExperience[]) => {
  const ids = experiences.filter((e) => reserveProductOf(e) === 'event').map((e) => e.id);
  return usePlatformQuery(() => backend.eventSeats(ids), [ids.join(',')], {} as Record<string, number>).data;
};

// The section starts folded so the posts and media sit closer to the top. Links
// that point at it ("Habla con …", "Ver experiencias", /creator/:id#reserve)
// unfold it and scroll there.
const OPEN_EVENT = 'reserve:open';
const CUSTOM_EVENT = 'reserve:custom';
// `to: 'one-to-one'` ("Habla con …") lands on the creator's 1:1 video calls when
// they offer any, otherwise on the top of the section.
export const openReserve = (to?: ReserveProduct) => {
  window.dispatchEvent(new Event(OPEN_EVENT));
  requestAnimationFrame(() =>
    (document.getElementById(`reserve-${to}`) ?? document.getElementById('reserve'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  );
};

// "Proponer experiencia" from outside the section (the Reserve step of the access
// ladder): opens the same structured request the section offers.
export const openCustomRequest = () => window.dispatchEvent(new Event(CUSTOM_EVENT));

// "Reserve con {creator}": Reserve Events, Reserve 1:1 and the other experiences
// this creator offers, each fully defined, plus a structured request for something tailored.
const CreatorReserveSection: React.FC<Props> = ({ creator, experiences: all, user, isOwner, onNeedLogin }) => {
  // Fans only see events that haven't happened yet; the creator sees all of theirs.
  const experiences = all.filter((e) => isOwner || reserveProductOf(e) !== 'event' || isUpcomingEvent(e));
  const seats = useEventSeats(experiences);
  const [open, setOpen] = useState<{ exp: VipExperience; book: boolean } | null>(null);
  const [custom, setCustom] = useState(false);
  const first = creator.name.split(' ')[0];
  const category = categoryFor(creator.category);
  const canRequest = !isOwner && user?.role !== 'creator' && user?.role !== 'admin';
  const [expanded, setExpanded] = useState(() => window.location.hash === '#reserve');
  useEffect(() => {
    const unfold = () => setExpanded(true);
    const onHash = () => window.location.hash === '#reserve' && unfold();
    window.addEventListener(OPEN_EVENT, unfold);
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener(OPEN_EVENT, unfold); window.removeEventListener('hashchange', onHash); };
  }, []);
  useEffect(() => {
    if (!canRequest) return;
    const propose = () => (user ? setCustom(true) : onNeedLogin());
    window.addEventListener(CUSTOM_EVENT, propose);
    return () => window.removeEventListener(CUSTOM_EVENT, propose);
  }, [canRequest, user, onNeedLogin]);
  const from = experiences.length ? Math.min(...experiences.map((e) => e.price)) : 0;
  const summary = experiences.length
    ? `${experiences.length} ${experiences.length === 1 ? 'experiencia' : 'experiencias'} · desde ${money(from)}`
    : isOwner ? 'Aún no publicas experiencias' : 'Envíale una propuesta personalizada';

  return (
    <section id="reserve" aria-labelledby="reserve-title" className="mb-6 scroll-mt-24 rounded-3xl border border-gold-300 bg-gradient-to-br from-gold-100 via-gold-50 to-white p-5 shadow-lg shadow-gold-400/25 ring-1 ring-gold-200 sm:p-6" data-testid="creator-reserve">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-700"><Icon name="fa-crown" className="mr-1.5 text-gold-500" />Reserve · {category.name}</p>
          <h2 id="reserve-title" className="mt-1 text-xl font-bold text-ink sm:text-2xl">Reserve con {first}</h2>
          <p className="mt-0.5 text-sm font-semibold text-ink/70" data-testid="reserve-summary">{summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && (
            <Link
              to="/creator/dashboard?tab=vip"
              data-testid="manage-reserve"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-gold-300 to-gold-500 px-5 text-sm font-bold text-night-900 shadow-md shadow-gold-400/30 transition hover:from-gold-400 hover:to-gold-600 hover:shadow-lg"
            >
              <i aria-hidden="true" className="fas fa-calendar-check"></i>
              Gestionar Reserve
            </Link>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="reserve-body"
            data-testid="reserve-toggle"
            className="btn-gold inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-bold transition"
          >
            {expanded ? 'Ocultar' : 'Ver experiencias'}
            <i aria-hidden="true" className={`fas fa-chevron-down text-xs transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}></i>
          </button>
        </div>
      </div>

      {expanded && <div id="reserve-body" data-testid="reserve-body">
      <p className="mt-4 text-sm text-ink/70">Sesiones en vivo por nuestra plataforma, 1:1 o en grupo, y experiencias con fecha, duración, precio y reglas definidas por {first}.</p>
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gold-50 px-3 py-1 text-sm font-semibold text-gold-700 ring-1 ring-gold-200" data-testid="reserve-principle">
        <i aria-hidden="true" className="fas fa-shield-halved text-xs"></i>Reserva experiencias, no personas.
      </p>

      {experiences.length > 0 ? (
        GROUPS.map((g) => {
          const items = experiences
            .filter((e) => reserveProductOf(e) === g.id)
            .sort((a, b) => (g.id === 'event' ? (eventStart(a)?.getTime() ?? 0) - (eventStart(b)?.getTime() ?? 0) : 0));
          if (!items.length) return null;
          return (
            <div key={g.id} id={`reserve-${g.id}`} className="mt-5 scroll-mt-24" data-testid={`reserve-group-${g.id}`}>
              <h3 className="text-sm font-bold text-ink">{g.title}</h3>
              <p className="text-xs text-ink/60">{g.hint}</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {items.map((exp) => (
                  <ReserveExperienceCard
                    key={exp.id}
                    exp={exp}
                    isOwner={isOwner}
                    seatsTaken={seats[exp.id] ?? 0}
                    onDetails={() => setOpen({ exp, book: false })}
                    onBook={() => (user ? setOpen({ exp, book: true }) : onNeedLogin())}
                  />
                ))}
              </div>
            </div>
          );
        })
      ) : (
        isOwner ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gold-300 bg-gold-50 p-5 text-center">
            <p className="text-sm text-ink/80">Aún no publicas experiencias. Crea tu primer evento en grupo o tu videollamada 1:1 y empieza a recibir reservas.</p>
            <Link
              to="/creator/dashboard?tab=vip"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-gold-300 to-gold-500 px-5 text-sm font-bold text-night-900 shadow-md shadow-gold-400/30 transition hover:from-gold-400 hover:to-gold-600"
            >
              <i aria-hidden="true" className="fas fa-plus"></i>
              Crear mi primera experiencia
            </Link>
          </div>
        ) : (
          <p className="mt-5 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">
            {`${first} aún no publica experiencias. Puedes enviar una solicitud personalizada.`}
          </p>
        )
      )}

      {canRequest && (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-white/80 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-ink">¿Buscas algo diferente?</p>
            <p className="text-xs text-ink/70">Propón tu idea, la fecha y el valor por la experiencia. {first} acepta, rechaza o te hace una contraoferta.</p>
          </div>
          <button
            type="button"
            onClick={() => (user ? setCustom(true) : onNeedLogin())}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-ink px-5 text-sm font-semibold text-ink hover:bg-ink hover:text-white"
          >
            <i aria-hidden="true" className="fas fa-wand-magic-sparkles"></i> Solicitar experiencia personalizada
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <ReserveNotice kind="subscription" />
        <ReserveNotice kind="gift" />
      </div>
      </div>}

      {open && (
        <ReserveBookingDialog exp={open.exp} user={user} startBooking={open.book} seatsTaken={seats[open.exp.id] ?? 0} onNeedLogin={onNeedLogin} onClose={() => setOpen(null)} />
      )}
      {custom && user && <CustomExperienceRequest creator={creator} user={user} onClose={() => setCustom(false)} />}
    </section>
  );
};

export default CreatorReserveSection;

// "Próximamente": the creator's Subscriber Live on air and their next Reserve Events,
// each labelled with who it is for. Nothing shows when there is nothing scheduled.
export const UpcomingAccess: React.FC<{ creatorId: string; experiences: VipExperience[]; liveTitle?: string | null; isOwner?: boolean }> = ({ creatorId, experiences, liveTitle, isOwner = false }) => {
  const events = experiences
    .filter((e) => reserveProductOf(e) === 'event' && isUpcomingEvent(e))
    .sort((a, b) => (eventStart(a)?.getTime() ?? 0) - (eventStart(b)?.getTime() ?? 0))
    .slice(0, 3);
  if (!events.length && !liveTitle) return null;
  // On phones the events already sit inside the Reserve section right above, so
  // this card only shows there while a Subscriber Live is on.
  return (
    <section aria-labelledby="upcoming-title" className={`mb-6 rounded-3xl bg-white p-5 shadow-sm sm:p-6 ${liveTitle ? '' : 'max-sm:hidden'}`} data-testid="upcoming-access">
      <h2 id="upcoming-title" className="text-base font-bold text-ink">{liveTitle ? 'Próximos Lives para suscriptores y Reserve Events' : 'Próximos Reserve Events'}</h2>
      <ul className="mt-3 divide-y divide-line">
        {liveTitle && (
          <li className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-iris-700">Exclusivo para suscriptores · ahora</span>
              <span className="block truncate text-sm font-semibold text-ink">{liveTitle}</span>
            </span>
            <Link to={`/en-vivo/${creatorId}`} className="inline-flex h-9 items-center rounded-full bg-red-600 px-4 text-xs font-semibold text-white">Entrar al Live</Link>
          </li>
        )}
        {events.map((e) => {
          const start = eventStart(e)!;
          return (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-700">
                  Reserve Event · <span className="capitalize">{start.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })}</span>{' '}
                  {start.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="block truncate text-sm font-semibold text-ink">{e.title}</span>
              </span>
              {/* The creator doesn't book their own event. */}
              {!isOwner && (
                <a href="#reserve" onClick={(ev) => { ev.preventDefault(); openReserve('event'); }} className="inline-flex h-9 items-center rounded-full border border-ink px-4 text-xs font-semibold text-ink">Reservar plaza</a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
