import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery, money } from '../lib/platform';
import {
  CREATOR_INVITE_BONUS,
  CREATOR_INVITE_CAP,
  CREATOR_INVITE_MIN,
  CREATOR_INVITE_QUALIFY,
  EMPTY_MEDALS,
  IMAN_TIERS,
  LEVELS,
  MEDALS,
  PUNTUAL_REQUESTS,
  CONSTANTE_WEEKS,
  REFERRAL_DAYS,
  REFERRAL_SHARE,
  earnedMedals,
  levelById,
  nextLevel,
  pct,
  rewardsApi,
  type CreatorRewards,
  type MedalId,
} from '../lib/rewards';
import { BRAND } from '../config/brand';
import { ratePct, specialApi } from '../lib/special';
import ExperienceGoalSettings from './ExperienceGoalSettings';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const EMPTY: CreatorRewards = {
  level: 'bronce', activeFans: 0, sales: 0, clean: true, reliable: true, share: 0.8, attractedThisMonth: 0, attractedLastMonth: 0,
  medals: EMPTY_MEDALS, referrals: [], invitedCreators: [],
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

// Creator panel > Recompensas: level and what it unlocks, medals, the Meta de
// experiencia, the invitation links and the fans and creators they brought.
const CreatorRewardsPanel: React.FC = () => {
  const { user } = useAuth();
  const { data } = usePlatformQuery(() => (user ? rewardsApi.myRewards(user) : Promise.resolve(EMPTY)), [user?.id], EMPTY);
  const { data: special } = usePlatformQuery(() => (user ? specialApi.mine() : Promise.resolve(null)), [user?.id], null);
  const [copied, setCopied] = useState('');
  if (!user) return null;

  const link = `${window.location.origin}/r/${user.creatorProfileId ?? user.id}`;
  const creatorLink = `${link}?as=creator`;
  const level = levelById(data.level);
  const next = nextLevel(level);
  const earned = new Set(earnedMedals(data.medals));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      setCopied('');
    }
  };

  return (
    <div className="space-y-6" data-testid="rewards-panel">
      {special && !special.revokedAt && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border-2 border-purple-200" data-testid="special-plan">
          <h3 className="font-bold text-gray-900 mb-2"><i aria-hidden="true" className="fas fa-star text-purple-500 mr-2"></i>Tienes un plan especial</h3>
          <ul className="text-sm text-gray-700 space-y-1">
            {special.reserveNet && (
              <li>
                <span className="font-semibold">Reserve al neto:</span> recibes cada pago de Reserve completo, menos la comisión que cobra PayPal por ese pago,
                el 5% de servicio de {BRAND.name}{special.taxRate > 0 ? ` y el ${ratePct(special.taxRate)} de impuesto` : ''}.
              </li>
            )}
            {special.featured && (
              <li>
                <span className="font-semibold">Visibilidad extra:</span> apareces primero entre los creadores destacados.
              </li>
            )}
            <li className="text-gray-500">Suscripciones, propinas y regalos siguen con tu parte normal. Al retirar, PayPal cobra su comisión de envío como siempre.</li>
          </ul>
        </div>
      )}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-gray-500">Tu nivel</p>
          <p className="text-2xl font-bold text-gray-900 mt-1" data-testid="rewards-level">{level.icon} {level.name}</p>
          <p className="text-xs text-gray-500 mt-1">
            {data.activeFans} fans activos · {money(data.sales)} vendidos en 30 días
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-gray-500">Tu parte de cada pago</p>
          <p className="text-2xl font-bold text-green-600 mt-1" data-testid="rewards-share">{pct(data.share)}</p>
          <p className="text-xs text-gray-500 mt-1">
            De lo que llega después de la comisión de PayPal. En suscripciones, renovaciones, propinas y Reserve. Regalos: 60%.
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-gray-500">Fans atraídos este mes</p>
          <p className="text-2xl font-bold text-pink-600 mt-1" data-testid="rewards-attracted">{data.attractedThisMonth}</p>
          <p className="text-xs text-gray-500 mt-1">Se registraron con tu enlace y ya te pagaron algo</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm" data-testid="levels">
        <h3 className="font-bold text-gray-900 mb-1"><i aria-hidden="true" className="fas fa-medal text-amber-500 mr-2"></i>Niveles y lo que desbloquean</h3>
        <p className="text-sm text-gray-500 mb-4">
          Subes con fans activos (los de tu enlace cuentan doble) o con lo que vendes en 30 días. Desde Plata, sin reportes confirmados;
          desde Oro, respondiendo a tiempo el 95% de tus solicitudes de Reserve.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {LEVELS.map((l) => (
            <div key={l.id} data-testid="level-card" className={`rounded-xl p-4 border text-sm ${l.id === level.id ? 'border-pink-400 bg-pink-50' : 'border-gray-100'}`}>
              <p className="font-semibold text-gray-900">{l.icon} {l.name}{l.id === level.id ? ' · tu nivel' : ''}</p>
              <p className="text-gray-500 text-xs mt-1">
                {l.minFans === 0 ? 'Al empezar' : `${l.minFans}+ fans activos o ${money(l.minSales)} al mes`}
              </p>
              <p className="text-green-600 font-bold mt-1">{pct(l.share)}</p>
              <ul className="mt-2 space-y-1 text-xs text-gray-700">
                {l.perks.map((p) => (
                  <li key={p} className="flex gap-1.5"><i aria-hidden="true" className="fas fa-check text-green-500 mt-0.5"></i>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3" data-testid="level-next">
          {next
            ? `Para ${next.name}: ${Math.max(0, next.minFans - data.activeFans)} fans activos más, o ${money(Math.max(0, next.minSales - data.sales))} más en ventas.`
            : 'Estás en el nivel más alto.'}
          {!data.clean ? ' Tienes un reporte confirmado en los últimos 90 días: no puedes subir de Bronce por ahora.' : ''}
          {data.clean && !data.reliable ? ' Para Oro y Diamante responde a tiempo al menos el 95% de tus solicitudes de Reserve.' : ''}
        </p>
      </div>

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

      <div className="bg-gradient-to-br from-pink-500 to-purple-600 text-white rounded-2xl p-6">
        <h3 className="font-bold text-lg"><i aria-hidden="true" className="fas fa-link mr-2"></i>Tu enlace de invitación</h3>
        <p className="text-sm opacity-90 mt-1">
          Compártelo en Instagram, TikTok o X. De cada fan que se registre con él te quedas con el {pct(REFERRAL_SHARE)} de lo que te pague durante {REFERRAL_DAYS} días, y cuenta doble para subir de nivel.
        </p>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input readOnly value={link} aria-label="Enlace de invitación" data-testid="referral-link" className="flex-1 px-4 py-2.5 rounded-xl text-gray-900 text-sm" onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => copy(link)} className="bg-white text-pink-600 px-5 py-2.5 rounded-xl font-bold hover:bg-pink-50">
            {copied === link ? 'Copiado' : 'Copiar enlace'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm" data-testid="invite-creators">
        <h3 className="font-bold text-gray-900 mb-1"><i aria-hidden="true" className="fas fa-user-plus text-purple-500 mr-2"></i>Invita a otros creadores</h3>
        <p className="text-sm text-gray-500 mb-4">
          Cuando {CREATOR_INVITE_MIN} creadores que invitaste estén verificados y hayan vendido sus primeros {money(CREATOR_INVITE_QUALIFY)}, ganas un {pct(CREATOR_INVITE_BONUS)} extra
          de lo que venda cada uno (suscripciones, renovaciones y propinas) durante un mes, hasta {money(CREATOR_INVITE_CAP)} por creador.
          Lo pone {BRAND.name}: al creador que invitas no se le descuenta nada.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input readOnly value={creatorLink} aria-label="Enlace para invitar creadores" data-testid="creator-invite-link" className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm" onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => copy(creatorLink)} className="bg-purple-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-purple-700">
            {copied === creatorLink ? 'Copiado' : 'Copiar enlace'}
          </button>
        </div>
        {data.invitedCreators.length === 0 ? (
          <p className="text-sm text-gray-500 mt-4">Todavía no has invitado a ningún creador.</p>
        ) : (
          <div className="divide-y divide-gray-100 mt-4">
            {data.invitedCreators.map((c, i) => (
              <div key={i} className="py-2 flex items-center justify-between text-sm" data-testid="invited-creator">
                <span>
                  {c.name} ·{' '}
                  <span className="text-gray-500">
                    {c.until ? `bono hasta el ${fmtDate(c.until)}` : c.qualifiedAt ? `listo; se activa con ${CREATOR_INVITE_MIN} creadores listos` : `se activa cuando se verifique y venda ${money(CREATOR_INVITE_QUALIFY)}`}
                  </span>
                </span>
                <span className="text-green-600 font-medium">{money(c.bonus)} ganados</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h3 className="font-bold text-gray-900 mb-3">Fans que invitaste</h3>
        {data.referrals.length === 0 ? (
          <p className="text-sm text-gray-500">Todavía nadie se ha registrado con tu enlace.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.referrals.map((r, i) => (
              <div key={i} className="py-2 flex items-center justify-between text-sm" data-testid="referred-fan">
                <span>{r.name} · <span className="text-gray-500">se unió el {fmtDate(r.joinedAt)}</span></span>
                <span className={r.paid ? 'text-green-600' : 'text-gray-400'}>
                  {r.paid ? `${pct(REFERRAL_SHARE)} hasta el ${fmtDate(r.referralUntil)}` : 'Aún no te ha pagado'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CreatorRewardsPanel;
