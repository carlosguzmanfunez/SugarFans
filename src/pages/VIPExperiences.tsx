import ReserveCitySelector, { useReserveDestination } from '../components/reserve/ReserveCitySelector';
import { visibleAtLocation } from '../lib/reserveLocation';
import React, { useState } from 'react';
import { useSeoPage } from '../hooks/usePageMeta';
import { matchesCreatorSearch, searchText } from '../lib/creatorSearch';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { backend } from '../lib/backend';
import { usePlatformQuery } from '../lib/platform';
import { useCreatorCatalog } from '../lib/catalog';
import type { VipExperience } from '../lib/vip';
import { detailsOf, experienceCategory, isUpcomingEvent, reserveProductOf, type ReserveProduct } from '../lib/vip';
import { useEventSeats } from '../components/reserve/CreatorReserveSection';
import { CREATOR_CATEGORIES, MODALITY_IDS, RESERVE_COPY, RESERVE_FLOW, RESERVE_MODALITIES, type ReserveModality } from '../config/reserve';
import ReserveExperienceCard from '../components/reserve/ReserveExperienceCard';
import ReserveBookingDialog from '../components/reserve/ReserveBookingDialog';
import { ReserveNotice } from '../components/reserve/ReserveBits';
import ReserveLanguageSelector, { useReserveLanguage } from '../components/reserve/ReserveLanguageSelector';
import ReserveAccessNotice from '../components/reserve/ReserveAccessNotice';
import { catalogOrder, experienceCopy } from '../content/reserveCatalog';
import { rewardsApi, useFeatured } from '../lib/rewards';
import { socialApi } from '../lib/social';
import { trendingScores, TRENDING_WINDOW_DAYS } from '../lib/trending';
import { ExploreHeading } from '../components/ExploreActivity';
import { useLanguage } from '../context/LanguageContext';

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
  useSeoPage('reserve', '/reserve');
  const { user } = useAuth();
  const language = useReserveLanguage();
  const destination = useReserveDestination();
  const navigate = useNavigate();
  const location = useLocation();
  const [modality, setModality] = useState<ReserveModality | 'all'>('all');
  const [category, setCategory] = useState('all');
  const [product, setProduct] = useState<ReserveProduct | 'all'>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<{ exp: VipExperience; book: boolean } | null>(null);
  const { data: experiences, loading } = usePlatformQuery(() => backend.listExperiences(), [], [] as VipExperience[]);
  const { creators } = useCreatorCatalog();
  const creatorOf = (exp: VipExperience) => creators.find((c) => c.id === exp.creatorProfileId);
  const { t } = useLanguage();
  // "Reserves en tendencia" (Carlos 2026-11-13): same points as Explorar's En tendencia
  // (posted this week, new paying fans this month, top of their category, Recompensas),
  // plus seats already taken in an event. Ties keep the catalog order.
  const featured = useFeatured();
  const { data: newFans } = usePlatformQuery(() => rewardsApi.monthlyNewFans(), [], {} as Record<string, number>);
  const { data: recentPosts } = usePlatformQuery(
    () => socialApi.recentPosts(new Date(Date.now() - TRENDING_WINDOW_DAYS * 86400000).toISOString()),
    [],
    {} as Record<string, { count: number; last: string }>
  );
  const goLogin = () => navigate('/login', { state: { from: location.pathname } });

  // Search by creator (name or @username) or by the experience's title, like Explorar.
  const query = searchText(search);
  const matchesSearch = (e: VipExperience) =>
    matchesCreatorSearch({ name: e.creatorName, username: creatorOf(e)?.username }, query) ||
    (!query.startsWith('@') && [e.title, experienceCopy(e, language).title, experienceCopy(e, language).description].some((text) => searchText(text).includes(query)));

  const visible = experiences
    .filter((e) => e.active)
    .filter((e) => visibleAtLocation(e, destination))
    // Events that already happened aren't bookable.
    .filter((e) => reserveProductOf(e) !== 'event' || isUpcomingEvent(e))
    .filter((e) => product === 'all' || reserveProductOf(e) === product)
    .filter((e) => modality === 'all' || detailsOf(e).modality === modality)
    .filter((e) => category === 'all' || experienceCategory(e, creatorOf(e)?.category).id === category)
    .filter((e) => matchesSearch(e))
    .sort(catalogOrder);

  const seats = useEventSeats(visible);
  const creatorScores = trendingScores([...new Set(visible.map((e) => e.creatorProfileId))], {
    recent: recentPosts,
    newFans,
    featured,
    categoryOf: (id) => creators.find((c) => c.id === id)?.category,
  });
  const score = (e: VipExperience) => (creatorScores.get(e.creatorProfileId) ?? 0) + Math.min(seats[e.id] ?? 0, 10);
  const ranked = visible.map((e, i) => ({ e, i, s: score(e) })).sort((a, b) => b.s - a.s || a.i - b.i).map(({ e }) => e);
  const chip = (active: boolean) =>
    `inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition ${active ? 'bg-ink text-white' : 'border border-line bg-white text-ink/80 hover:border-ink/30'}`;

  return (
    <div className="min-h-screen bg-canvas">
      {/* The explanation that headed this page now lives in the Reserve card of the
          fan's Inicio (Carlos 2026-11-13); the page opens straight on the list. */}
      <h1 className="sr-only">Reserve</h1>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="relative mx-auto mb-4 max-w-2xl sm:mb-6">
          <i className="fas fa-search absolute left-5 top-1/2 -translate-y-1/2 text-ink/35" aria-hidden="true"></i>
          <input
            type="search"
            aria-label="Buscar en Reserve"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-line bg-white py-3.5 pl-12 pr-4 text-base shadow-[var(--shadow-card)] outline-none focus:border-transparent focus:ring-2 focus:ring-brand-500 md:py-4 md:text-lg"
            placeholder="Buscar nombre, @usuario o experiencia..."
          />
        </div>
        <ReserveAccessNotice />
        <ReserveCitySelector experiences={experiences} />
        <ReserveLanguageSelector />
        <div className="mb-6 space-y-3 sm:mb-8">
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

        {!query && ranked.length > 0 && <ExploreHeading id="reserve-trending-title" title={t('reserve.trending')} icon="fa-fire" />}
        <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3" data-testid="reserve-trending">
          {ranked.map((exp) => {
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
        {!loading && visible.length === 0 && <p className="py-12 text-center text-muted">{query ? `No encontramos experiencias para "${search.trim()}".` : 'Todavía no hay experiencias con estos filtros.'}</p>}

        <section className="mt-10 grid gap-6 rounded-3xl bg-white p-5 shadow-sm sm:mt-14 sm:p-6 md:grid-cols-2 md:p-10" aria-labelledby="how-title">
          <div>
            <h2 id="how-title" className="text-2xl font-bold text-ink">Cómo funciona Reserve</h2>
            <ol className="mt-5 space-y-3">
              {RESERVE_FLOW.slice(0, 5).map((s, i) => (
                <li key={s} className="flex items-center gap-3 text-sm text-ink/80">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{i + 1}</span>
                  {
                    [
                      'Eliges una experiencia, o propones una personalizada.',
                      'El creador la acepta, la rechaza o te hace una contraoferta.',
                      'Pagas solo cuando la acepta.',
                      'Recibes la confirmación con fecha, hora y lugar.',
                      'Vives la experiencia: en la Sala 1:1 o la sala del evento de Fans Reserve, o en el venue acordado.',
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
          <div className="rounded-2xl bg-gray-50 p-5" data-testid="reserve-allowed">
            <h3 className="font-semibold text-ink">Qué puedes reservar</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink/80">
              {[
                'Clases y talleres: cocina, música, arte, maquillaje',
                'Coaching, entrenamiento y asesorías',
                'Q&A, masterclasses y eventos en grupo',
                'Videollamadas 1:1 con un propósito definido',
              ].map((p) => (
                <li key={p} className="flex gap-2">
                  <i aria-hidden="true" className="fas fa-check mt-1 text-xs text-emerald-600"></i>
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-ink/70">
              Cada experiencia dice qué se hace, dónde, cuánto dura y cuánto cuesta. Las presenciales ocurren en venues, estudios, eventos y lugares públicos o profesionales.
            </p>
            <Link to="/legal?doc=reserve-policy" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline underline-offset-2" data-testid="reserve-rules-link">
              Ver qué está permitido y qué no
              <i aria-hidden="true" className="fas fa-arrow-right text-xs"></i>
            </Link>
          </div>
        </section>
      </div>

      {open && visibleAtLocation(open.exp, destination) && <ReserveBookingDialog exp={open.exp} user={user} startBooking={open.book} seatsTaken={seats[open.exp.id] ?? 0} onNeedLogin={goLogin} onClose={() => setOpen(null)} />}
    </div>
  );
};

export default ReservePage;
