import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { backend } from '../lib/backend';
import { usePlatformQuery } from '../lib/platform';
import { useCreatorCatalog } from '../lib/catalog';
import type { VipExperience } from '../lib/vip';
import { detailsOf, isUpcomingEvent, reserveProductOf, type ReserveProduct } from '../lib/vip';
import { useEventSeats } from '../components/reserve/CreatorReserveSection';
import { CREATOR_CATEGORIES, MODALITY_IDS, PROFESSIONAL_SERVICES_ALLOWED, PROHIBITED_EXPERIENCES, RESERVE_COPY, RESERVE_FLOW, RESERVE_MODALITIES, categoryFor, type ReserveModality } from '../config/reserve';
import ReserveExperienceCard from '../components/reserve/ReserveExperienceCard';
import ReserveBookingDialog from '../components/reserve/ReserveBookingDialog';
import { ReserveNotice } from '../components/reserve/ReserveBits';

// Reserve: experiences fans can book with creators. Each one is defined by its
// creator (type, modality, duration, price, venue, rules) and approved by them.
// Its two main products: Reserve Event (group, one seat per fan) and Reserve 1:1
// (private session); other experiences (in person, delivered) are listed too.
const PRODUCTS: { id: ReserveProduct | 'all'; label: string; icon: string }[] = [
  { id: 'all', label: 'Todo Reserve', icon: 'fa-ticket' },
  { id: 'event', label: 'Reserve Event', icon: 'fa-people-group' },
  { id: 'one-to-one', label: 'Reserve 1:1', icon: 'fa-user-lock' },
  { id: 'other', label: 'Otras experiencias', icon: 'fa-star' },
];

const ReservePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [modality, setModality] = useState<ReserveModality | 'all'>('all');
  const [category, setCategory] = useState('all');
  const [product, setProduct] = useState<ReserveProduct | 'all'>('all');
  const [open, setOpen] = useState<{ exp: VipExperience; book: boolean } | null>(null);
  const { data: experiences, loading } = usePlatformQuery(() => backend.listExperiences(), [], [] as VipExperience[]);
  const { creators } = useCreatorCatalog();
  const creatorOf = (exp: VipExperience) => creators.find((c) => c.id === exp.creatorProfileId);
  const goLogin = () => navigate('/login', { state: { from: location.pathname } });

  const visible = experiences
    .filter((e) => e.active)
    // Events that already happened aren't bookable.
    .filter((e) => reserveProductOf(e) !== 'event' || isUpcomingEvent(e))
    .filter((e) => product === 'all' || reserveProductOf(e) === product)
    .filter((e) => modality === 'all' || detailsOf(e).modality === modality)
    .filter((e) => category === 'all' || categoryFor(creatorOf(e)?.category).id === category);

  const seats = useEventSeats(visible);
  const chip = (active: boolean) =>
    `inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition ${active ? 'bg-ink text-white' : 'border border-line bg-white text-ink/80 hover:border-ink/30'}`;

  return (
    <div className="min-h-screen bg-canvas">
      <div className="relative overflow-hidden bg-night-950 text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 -top-40 h-[480px] w-[480px] rounded-full bg-[radial-gradient(closest-side,rgba(200,27,99,0.35),transparent)]" />
          <div className="absolute -bottom-48 -right-32 h-[480px] w-[480px] rounded-full bg-[radial-gradient(closest-side,rgba(109,60,230,0.3),transparent)]" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl px-4 py-14 text-center sm:px-6 md:py-20 lg:px-8">
          <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-200 to-gold-400 text-xl text-night-900">
            <i className="fas fa-ticket" aria-hidden="true"></i>
          </span>
          <h1 className="text-display-lg mb-4">Reserve</h1>
          <p className="mx-auto max-w-2xl text-lg text-white/75 md:text-xl">
            Reserve Events en grupo, sesiones privadas 1:1 y experiencias definidas por tus creators. Cada una con su fecha, duración, precio, alcance y reglas.
          </p>
          <p className="mt-4 text-sm font-semibold uppercase tracking-[0.18em] text-gold-200">{RESERVE_COPY.principle}</p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 space-y-3">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Tipo de Reserve" data-testid="reserve-products">
            {PRODUCTS.map((p) => (
              <button key={p.id} type="button" aria-pressed={product === p.id} onClick={() => setProduct(p.id)} className={chip(product === p.id)}>
                <i aria-hidden="true" className={`fas ${p.icon} text-xs`}></i>
                {p.label}
              </button>
            ))}
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Modalidad">
            <button type="button" aria-pressed={modality === 'all'} onClick={() => setModality('all')} className={chip(modality === 'all')}>
              Todas
            </button>
            {MODALITY_IDS.map((m) => (
              <button key={m} type="button" aria-pressed={modality === m} onClick={() => setModality(m)} className={chip(modality === m)}>
                <i aria-hidden="true" className={`fas ${RESERVE_MODALITIES[m].icon} text-xs`}></i>
                {RESERVE_MODALITIES[m].label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3 text-sm text-ink/70 sm:max-w-xs">
            <span className="shrink-0">Categoría</span>
            <select name="reserveCategory" value={category} onChange={(e) => setCategory(e.target.value)} className="block w-full rounded-full border border-line bg-white px-4 py-2 text-sm text-ink">
              <option value="all">Todas las categorías</option>
              {CREATOR_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((exp) => {
            const c = creatorOf(exp);
            const isOwn = !!user?.creatorProfileId && user.creatorProfileId === exp.creatorProfileId;
            return (
              <ReserveExperienceCard
                key={exp.id}
                exp={exp}
                isOwner={isOwn}
                creator={{ id: exp.creatorProfileId, name: exp.creatorName, avatar: c?.avatar ?? '' }}
                seatsTaken={seats[exp.id] ?? 0}
                onDetails={() => setOpen({ exp, book: false })}
                onBook={() => (user ? setOpen({ exp, book: true }) : goLogin())}
              />
            );
          })}
        </div>
        {!loading && visible.length === 0 && <p className="py-12 text-center text-muted">Todavía no hay experiencias con estos filtros.</p>}

        <section className="mt-14 grid gap-6 rounded-3xl bg-white p-6 shadow-sm md:grid-cols-2 md:p-10" aria-labelledby="how-title">
          <div>
            <h2 id="how-title" className="text-2xl font-bold text-ink">Cómo funciona Reserve</h2>
            <ol className="mt-5 space-y-3">
              {RESERVE_FLOW.slice(0, 5).map((s, i) => (
                <li key={s} className="flex items-center gap-3 text-sm text-ink/80">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{i + 1}</span>
                  {
                    [
                      'Eliges una experiencia, o propones una personalizada.',
                      'El creator la acepta, la rechaza o te hace una contraoferta.',
                      'Pagas solo cuando la acepta.',
                      'Recibes la confirmación con fecha, hora y lugar.',
                      'Vives la experiencia: en la sala privada de Fans Reserve o en el venue acordado.',
                    ][i]
                  }
                </li>
              ))}
            </ol>
            <div className="mt-5 space-y-2">
              <ReserveNotice kind="subscription" />
              <ReserveNotice kind="gift" />
              <ReserveNotice kind="payments" />
            </div>
          </div>
          <div className="rounded-2xl bg-gray-50 p-5">
            <h3 className="font-semibold text-ink">Reserve no es</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink/80" data-testid="prohibited-list">
              {PROHIBITED_EXPERIENCES.map((p) => (
                <li key={p} className="flex gap-2">
                  <i aria-hidden="true" className="fas fa-xmark mt-1 text-xs text-red-500"></i>
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-4 flex gap-2 text-sm text-ink/80" data-testid="professional-allowed">
              <i aria-hidden="true" className="fas fa-check mt-1 text-xs text-emerald-600"></i>
              <span>{PROFESSIONAL_SERVICES_ALLOWED}</span>
            </p>
            <p className="mt-4 text-xs text-ink/60">
              Las experiencias presenciales ocurren en venues, estudios, eventos y lugares públicos o profesionales; en el lugar del creator o del fan solo servicios profesionales con aprobación del creator, nunca en Tu gente. Lee la{' '}
              <Link to="/legal?doc=reserve-policy" className="font-semibold text-ink underline">Política de Reserve</Link>.
            </p>
          </div>
        </section>
      </div>

      {open && <ReserveBookingDialog exp={open.exp} user={user} startBooking={open.book} seatsTaken={seats[open.exp.id] ?? 0} onNeedLogin={goLogin} onClose={() => setOpen(null)} />}
    </div>
  );
};

export default ReservePage;
