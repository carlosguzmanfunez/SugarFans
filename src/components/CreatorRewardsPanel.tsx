import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery } from '../lib/platform';
import {
  GOALS,
  LEVELS,
  MAX_SHARE,
  REFERRAL_DAYS,
  REFERRAL_SHARE,
  levelById,
  nextLevel,
  pct,
  rewardsApi,
  type CreatorRewards,
} from '../lib/rewards';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const EMPTY: CreatorRewards = { level: 'bronce', activeFans: 0, share: 0.8, bonus: 0, attractedThisMonth: 0, attractedLastMonth: 0, referrals: [] };

// Creator panel > Recompensas: invitation link, level, monthly goals and the fans the link brought.
const CreatorRewardsPanel: React.FC = () => {
  const { user } = useAuth();
  const { data } = usePlatformQuery(() => (user ? rewardsApi.myRewards(user) : Promise.resolve(EMPTY)), [user?.id], EMPTY);
  const [copied, setCopied] = useState(false);
  if (!user) return null;

  const link = `${window.location.origin}/r/${user.creatorProfileId ?? user.id}`;
  const level = levelById(data.level);
  const next = nextLevel(level);
  const goalsHit = GOALS.filter((g) => data.attractedThisMonth >= g.fans);
  const nextGoal = GOALS.find((g) => data.attractedThisMonth < g.fans);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="rewards-panel">
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-gray-500">Tu nivel</p>
          <p className="text-2xl font-bold text-gray-900 mt-1" data-testid="rewards-level">{level.icon} {level.name}</p>
          <p className="text-xs text-gray-500 mt-1">{data.activeFans} fans activos (pagaron en los últimos 30 días)</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-gray-500">Tu comisión este mes</p>
          <p className="text-2xl font-bold text-green-600 mt-1" data-testid="rewards-share">{pct(data.share)}</p>
          <p className="text-xs text-gray-500 mt-1">
            {level.name} {pct(level.share)}{data.bonus > 0 ? ` + ${pct(data.bonus)} por la meta del mes pasado` : ''}. En suscripciones, renovaciones y propinas.
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-gray-500">Fans atraídos este mes</p>
          <p className="text-2xl font-bold text-pink-600 mt-1" data-testid="rewards-attracted">{data.attractedThisMonth}</p>
          <p className="text-xs text-gray-500 mt-1">Se registraron con tu enlace y ya te pagaron algo</p>
        </div>
      </div>

      <div className="bg-gradient-to-br from-pink-500 to-purple-600 text-white rounded-2xl p-6">
        <h3 className="font-bold text-lg"><i className="fas fa-link mr-2"></i>Tu enlace de invitación</h3>
        <p className="text-sm opacity-90 mt-1">
          Compártelo en Instagram, TikTok o X. De cada fan que se registre con él te quedas con el {pct(REFERRAL_SHARE)} de lo que te pague durante {REFERRAL_DAYS} días.
        </p>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input readOnly value={link} aria-label="Enlace de invitación" data-testid="referral-link" className="flex-1 px-4 py-2.5 rounded-xl text-gray-900 text-sm" onFocus={(e) => e.target.select()} />
          <button type="button" onClick={copy} className="bg-white text-pink-600 px-5 py-2.5 rounded-xl font-bold hover:bg-pink-50">
            {copied ? 'Copiado' : 'Copiar enlace'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h3 className="font-bold text-gray-900 mb-1"><i className="fas fa-bullseye text-pink-500 mr-2"></i>Metas del mes</h3>
        <p className="text-sm text-gray-500 mb-4">
          Cuentan los fans que se registran este mes con tu enlace y te pagan algo. La meta más alta que alcances sube tu comisión todo el mes siguiente (hasta {pct(MAX_SHARE)}) y te lleva a Creadores destacados.
        </p>
        <div className="space-y-4">
          {GOALS.map((g) => {
            const done = data.attractedThisMonth >= g.fans;
            return (
              <div key={g.fans} data-testid="reward-goal">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-gray-900">
                    {done && <i className="fas fa-check-circle text-green-500 mr-1"></i>}
                    {g.label}
                  </span>
                  <span className="text-gray-500">+{pct(g.bonus)} de comisión · {Math.min(data.attractedThisMonth, g.fans)}/{g.fans}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${done ? 'bg-green-500' : 'bg-pink-500'}`} style={{ width: `${Math.min(100, (data.attractedThisMonth / g.fans) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-sm mt-4 text-gray-700" data-testid="goal-summary">
          {goalsHit.length
            ? `¡Meta alcanzada! El mes que viene tu comisión sube ${pct(goalsHit[goalsHit.length - 1].bonus)}.`
            : `Te faltan ${nextGoal!.fans - data.attractedThisMonth} fans para la primera meta.`}
          {goalsHit.length > 0 && nextGoal ? ` Te faltan ${nextGoal.fans - data.attractedThisMonth} para la siguiente.` : ''}
        </p>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h3 className="font-bold text-gray-900 mb-3"><i className="fas fa-medal text-amber-500 mr-2"></i>Niveles</h3>
        <div className="grid sm:grid-cols-4 gap-3">
          {LEVELS.map((l) => (
            <div key={l.id} className={`rounded-xl p-3 border text-sm ${l.id === level.id ? 'border-pink-400 bg-pink-50' : 'border-gray-100'}`}>
              <p className="font-semibold text-gray-900">{l.icon} {l.name}</p>
              <p className="text-gray-500 text-xs mt-1">{l.minFans === 0 ? 'Al empezar' : `${l.minFans}+ fans activos`}</p>
              <p className="text-green-600 font-bold mt-1">{pct(l.share)}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          {next ? `Te faltan ${next.minFans - data.activeFans} fans activos para ${next.name}.` : 'Estás en el nivel más alto.'} Oro y Diamante aparecen en Creadores destacados. Los regalos pagan siempre el 60%.
        </p>
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
                  {r.paid ? `90% hasta el ${fmtDate(r.referralUntil)}` : 'Aún no te ha pagado'}
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
