import React from 'react';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery, money } from '../lib/platform';
import {
  CONSTANTE_WEEKS,
  CREATOR_INVITE_MIN,
  EMPTY_MEDALS,
  IMAN_TIERS,
  LEVELS,
  MEDALS,
  PUNTUAL_REQUESTS,
  earnedMedals,
  levelById,
  nextLevel,
  pct,
  rewardsApi,
  type CreatorRewards,
  type MedalId,
} from '../lib/rewards';
import { BRAND } from '../config/brand';
import ExperienceGoalSettings from './ExperienceGoalSettings';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useCreatorCountries } from '../lib/catalog';
import { OTHER_COUNTRY, countryName } from '../config/countries';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const EMPTY: CreatorRewards = {
  level: 'bronce', activeFans: 0, sales: 0, clean: true, reliable: true, share: 0.8, attractedThisMonth: 0, attractedLastMonth: 0,
  medals: EMPTY_MEDALS, referrals: [], invitedCreators: [],
};

const Bar: React.FC<{ value: number; max: number; label: string; text: string }> = ({ value, max, label, text }) => {
  const p = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-white/85">{text}</span>
      </div>
      <div className="mt-1.5 h-3 rounded-full bg-white/25 overflow-hidden" role="progressbar" aria-label={label} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${Math.max(3, p)}%` }} />
      </div>
    </div>
  );
};

// Progress line under each medal.
const medalProgress = (id: MedalId, data: CreatorRewards): string => {
  const m = data.medals;
  switch (id) {
    case 'primer-reserve':
      return m.firstReserveAt ? `Ganada el ${fmtDate(m.firstReserveAt)}` : 'Aún no completas tu primera experiencia';
    case 'iman': {
      const next = IMAN_TIERS.find((t) => data.attractedThisMonth < t.fans);
      return next ? `${data.attractedThisMonth}/${next.fans} fans nuevos este mes` : '¡Nivel máximo este mes!';
    }
    case 'puntual':
      return m.puntual ? 'Activa' : `${m.puntualCount}/${PUNTUAL_REQUESTS} solicitudes respondidas a tiempo`;
    case 'constante':
      return m.constante ? 'Racha activa' : `${m.liveWeeks}/${CONSTANTE_WEEKS} semanas seguidas con Live`;
    case 'embajador':
      return m.embajador ? 'Bono de invitación activo' : `${m.qualifiedInvites}/${CREATOR_INVITE_MIN} creadores invitados listos`;
  }
};

// The creator's place this month among creators of the same country, by new
// paying fans (the same count as Explore's Top del mes).
const CountryRankCard: React.FC = () => {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const countries = useCreatorCountries();
  const { data: newFans } = usePlatformQuery(() => rewardsApi.monthlyNewFans(), [], {} as Record<string, number>);
  if (!user?.creatorProfileId) return null;
  const myId = user.creatorProfileId;
  const country = user.country && user.country !== OTHER_COUNTRY ? user.country : '';
  const place = country ? countryName(country, language, t('country.other')) : '';
  const mine = newFans[myId] ?? 0;
  const peers = new Set([myId, ...Object.keys(countries).filter((id) => countries[id] === country)]);
  const rank = 1 + [...peers].filter((id) => id !== myId && (newFans[id] ?? 0) > mine).length;
  const text = !country
    ? t('goals.countryMissing')
    : mine === 0
      ? t('goals.countryStart').replace('{country}', place)
      : t('goals.countryRank').replace('{rank}', String(rank)).replace('{total}', String(peers.size)).replace('{country}', place);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm" data-testid="country-rank">
      <h3 className="font-bold text-gray-900 mb-1"><i aria-hidden="true" className="fas fa-trophy text-amber-500 mr-2"></i>{t('goals.countryTitle')}</h3>
      <p className="text-sm text-gray-700">{text}</p>
      {!country && (
        <Link to="/settings?section=profile" className="mt-3 inline-block text-sm font-medium text-pink-600 hover:text-pink-700">{t('nav.settings')}</Link>
      )}
    </div>
  );
};

// Creator panel > Metas: what to aim for next. The next level (with progress
// bars), the medals still to win and the Meta de experiencia for fans.
const CreatorGoalsPanel: React.FC = () => {
  const { user } = useAuth();
  const { data } = usePlatformQuery(() => (user ? rewardsApi.myRewards(user) : Promise.resolve(EMPTY)), [user?.id], EMPTY);
  if (!user) return null;

  const level = levelById(data.level);
  const next = nextLevel(level);
  const earned = new Set(earnedMedals(data.medals));
  // The best cut a higher level offers, to show what climbing changes.
  const better = LEVELS.find((l) => l.share > data.share);

  return (
    <div className="space-y-6" data-testid="goals-panel">
      <div className="rounded-2xl p-6 text-white bg-gradient-to-br from-amber-500 via-orange-500 to-brand-600 shadow-lg shadow-orange-500/20" data-testid="next-goal">
        <p className="text-sm font-semibold uppercase tracking-wide text-white/80">Tu próxima meta</p>
        {next ? (
          <>
            <p className="font-display text-3xl font-bold mt-1">{next.icon} Llegar a {next.name}</p>
            <p className="text-sm text-white/85 mt-1">Hoy eres {level.icon} {level.name}. Llega a una de las dos y subes de nivel.</p>
            <div className="mt-5 grid sm:grid-cols-2 gap-5">
              <Bar label="Fans activos" value={data.activeFans} max={next.minFans} text={`${data.activeFans} / ${next.minFans}`} />
              <Bar label="Ventas en 30 días" value={data.sales} max={next.minSales} text={`${money(data.sales)} / ${money(next.minSales)}`} />
            </div>
            <p className="text-sm mt-5">
              <span className="font-semibold">Desbloqueas:</span> {next.perks.join(' · ')}
            </p>
            {!data.clean && <p className="text-sm mt-2 text-white/90">Tienes un reporte confirmado en los últimos 90 días: no puedes subir por ahora.</p>}
            {data.clean && !data.reliable && next.reliable && (
              <p className="text-sm mt-2 text-white/90">Para {next.name} también responde a tiempo al menos el 95% de tus solicitudes de Reserve.</p>
            )}
          </>
        ) : (
          <p className="font-display text-3xl font-bold mt-1">{level.icon} Estás en {level.name}, el nivel más alto</p>
        )}

        <div className="mt-4 inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-2xl bg-white/20 px-4 py-2.5 ring-1 ring-white/30" data-testid="goals-share">
          <span className="text-sm font-semibold">Tu ganancia actual:</span>
          <span className="font-display text-2xl font-bold tabular-nums">{pct(data.share)}</span>
          <span className="text-xs text-white/85">
            de cada pago, después de la comisión de PayPal{better ? `. En ${better.name} sube a ${pct(better.share)}` : ''}.
          </span>
        </div>
      </div>

      <CountryRankCard />

      <div className="bg-white rounded-2xl p-6 shadow-sm" data-testid="medals">
        <h3 className="font-bold text-gray-900 mb-1"><i aria-hidden="true" className="fas fa-award text-pink-500 mr-2"></i>Medallas</h3>
        <p className="text-sm text-gray-500 mb-4">Cada medalla te da visibilidad o una insignia. Se ganan con lo que ya haces en {BRAND.name}.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {MEDALS.map((m) => {
            const has = earned.has(m.id);
            return (
              <div key={m.id} data-testid={`medal-${m.id}`} data-earned={has ? 'true' : 'false'} className={`flex gap-3 rounded-xl border p-4 ${has ? 'border-amber-300 bg-amber-50' : 'border-gray-100'}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${has ? 'bg-amber-400 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  <i aria-hidden="true" className={`fas ${m.icon}`}></i>
                </span>
                <div className="text-sm">
                  <p className="font-semibold text-gray-900">{m.name}{has ? ' ✓' : ''}</p>
                  <p className="text-gray-600 text-xs mt-0.5">{m.how}</p>
                  <p className="text-xs mt-1"><span className="font-medium text-gray-900">Desbloquea:</span> <span className="text-gray-600">{m.unlocks}</span></p>
                  <p className="text-xs text-pink-600 mt-1">{medalProgress(m.id, data)}</p>
                </div>
              </div>
            );
          })}
        </div>
        {data.medals.boostUntil && (
          <p className="text-sm text-gray-700 mt-4" data-testid="medal-boost">
            <i aria-hidden="true" className="fas fa-bolt text-amber-500 mr-1"></i>Estás destacado en Explorar hasta el {fmtDate(data.medals.boostUntil)}.
          </p>
        )}
      </div>


      <ExperienceGoalSettings />
    </div>
  );
};

export default CreatorGoalsPanel;
