import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery, money } from '../lib/platform';
import {
  CREATOR_INVITE_BONUS,
  CREATOR_INVITE_CAP,
  CREATOR_INVITE_MONTHS,
  CREATOR_INVITE_QUALIFY,
  EMPTY_MEDALS,
  LEVELS,
  REFERRAL_DAYS,
  REFERRAL_SHARE,
  levelById,
  nextLevel,
  pct,
  rewardsApi,
  type CreatorRewards,
} from '../lib/rewards';
import { BRAND } from '../config/brand';
import { ratePct, specialApi } from '../lib/special';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const EMPTY: CreatorRewards = {
  level: 'bronce', activeFans: 0, sales: 0, clean: true, reliable: true, share: 0.8, attractedThisMonth: 0, attractedLastMonth: 0,
  medals: EMPTY_MEDALS, referrals: [], invitedCreators: [],
};

// Creator panel > Recompensas: level and what it unlocks, the invitation links
// and the fans and creators they brought. Medals and goals live in Metas.
const CreatorRewardsPanel: React.FC<{ onOpenInvites?: () => void }> = ({ onOpenInvites }) => {
  const { user } = useAuth();
  const { data } = usePlatformQuery(() => (user ? rewardsApi.myRewards(user) : Promise.resolve(EMPTY)), [user?.id], EMPTY);
  const { data: special } = usePlatformQuery(() => (user ? specialApi.mine() : Promise.resolve(null)), [user?.id], null);
  const [copied, setCopied] = useState('');
  if (!user) return null;

  const link = `${window.location.origin}/r/${user.creatorProfileId ?? user.id}`;
  const creatorLink = `${link}?as=creator`;
  const level = levelById(data.level);
  const next = nextLevel(level);

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
        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border-2 border-purple-200" data-testid="special-plan">
          <h3 className="font-bold text-gray-900 mb-2"><i aria-hidden="true" className="fas fa-star text-purple-500 mr-2"></i>Tienes un plan especial</h3>
          <ul className="text-sm text-gray-700 space-y-1">
            {special.reserveNet && (
              <li>
                <span className="font-semibold">Tu parte especial en Reserve:</span> del pago del fan se descuentan el costo de PayPal,
                el 5% de servicio de {BRAND.name}{special.taxRate > 0 ? ` y el ${ratePct(special.taxRate)} de impuesto` : ''}.
                Lo que queda es para ti.
              </li>
            )}
            {special.featured && (
              <li>
                <span className="font-semibold">Visibilidad extra:</span> apareces primero entre los creadores destacados.
              </li>
            )}
            <li className="text-gray-600">Este plan no cambia el reparto de suscripciones, propinas ni regalos. Enviarte el dinero a tu PayPal tiene un costo aparte, que se descuenta de tu saldo.</li>
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
          <p className="text-sm text-gray-500">Tu parte habitual</p>
          <p className="text-2xl font-bold text-green-600 mt-1" data-testid="rewards-share">{pct(data.share)}</p>
          <p className="text-xs text-gray-500 mt-1">
            Primero se resta el costo de PayPal. De lo que queda, esta parte es para ti. Aplica a suscripciones, renovaciones, propinas y Reserve. Los regalos te dejan el 60% de su valor.
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-gray-500">Fans nuevos con tu enlace</p>
          <p className="text-2xl font-bold text-pink-600 mt-1" data-testid="rewards-attracted">{data.attractedThisMonth}</p>
          <p className="text-xs text-gray-500 mt-1">Se registraron este mes con tu enlace y ya hicieron un pago para ti.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm" data-testid="levels">
        <h3 className="font-bold text-gray-900 mb-1"><i aria-hidden="true" className="fas fa-medal text-amber-500 mr-2"></i>Qué ganas al subir de nivel</h3>
        <p className="text-sm text-gray-500 mb-4">
          Puedes subir de dos formas: por tus fans con pagos recientes o por tus ventas de los últimos 30 días. Basta alcanzar una de esas dos metas.
          Desde Plata necesitas no tener reportes confirmados en los últimos 90 días. Para Oro y Diamante también debes responder a tiempo al menos el 95% de tus solicitudes de Reserve.
        </p>
        <details className="text-sm text-gray-600 mb-4"><summary className="cursor-pointer font-medium">¿Qué significa «fan activo»?</summary><p className="mt-2 max-w-prose">Es un fan que hizo un pago para ti en los últimos 30 días. Si llegó con tu enlace, cuenta como dos para esta meta. Por eso este número puede ser mayor que la cantidad de personas.</p></details>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {LEVELS.map((l) => (
            <div key={l.id} data-testid="level-card" className={`rounded-xl p-4 border text-sm ${l.id === level.id ? 'border-pink-400 bg-pink-50' : 'border-gray-100'}`}>
              <p className="font-semibold text-gray-900">{l.icon} {l.name}{l.id === level.id ? ' · tu nivel' : ''}</p>
              <p className="text-gray-500 text-xs mt-1">
                {l.minFans === 0 ? 'Tu nivel al empezar' : `${l.minFans} fans activos o ${money(l.minSales)} en ventas en 30 días`}
              </p>
              <p className="text-green-600 font-bold mt-1">{pct(l.share)} para ti</p>
              <p className="text-xs text-gray-600 mt-1">Después del costo de cobrar al fan.</p>
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


      <div className="bg-gradient-to-br from-pink-500 to-purple-600 text-white rounded-2xl p-4 sm:p-6">
        <h3 className="font-bold text-lg"><i aria-hidden="true" className="fas fa-link mr-2"></i>Tu enlace de invitación</h3>
        <p className="text-sm opacity-90 mt-1">
          Compártelo en Instagram, TikTok o X. Cuando un fan se registra con tu enlace, recibes el {pct(REFERRAL_SHARE)} de lo que queda después del costo de PayPal en sus pagos para ti, durante {REFERRAL_DAYS} días desde su registro. Si tu parte habitual es mayor, se conserva. Ese fan también cuenta doble para subir de nivel cuando te paga.
        </p>
        <p className="text-sm opacity-90 mt-2">Aplica a suscripciones, renovaciones, propinas y Reserve. Los regalos mantienen su reparto del 60%.</p>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input readOnly value={link} aria-label="Enlace de invitación" data-testid="referral-link" className="flex-1 px-4 py-2.5 rounded-xl text-gray-900 text-sm" onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => copy(link)} className="bg-white text-pink-600 px-5 py-2.5 rounded-xl font-bold hover:bg-pink-50">
            {copied === link ? 'Copiado' : 'Copiar enlace'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm" data-testid="invite-creators">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h3 className="font-bold text-gray-900"><i aria-hidden="true" className="fas fa-user-plus text-purple-500 mr-2"></i>Invita a otros creadores</h3>
          {onOpenInvites && (
            <button type="button" onClick={onOpenInvites} className="rounded-full bg-purple-50 px-3 py-1.5 text-sm font-semibold text-purple-700 hover:bg-purple-100" data-testid="open-my-invites">
              <i aria-hidden="true" className="fas fa-diagram-project mr-1.5"></i>Ver mis invitados
            </button>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Tu bono empieza cuando el creador que invitaste verifica su identidad y llega a ${CREATOR_INVITE_QUALIFY} en ventas.
          Durante los {CREATOR_INVITE_MONTHS} meses siguientes ganas el {pct(CREATOR_INVITE_BONUS)} de lo que queda después del costo de PayPal en sus suscripciones, renovaciones, propinas y Reserve, hasta ${CREATOR_INVITE_CAP} al mes por cada creador invitado.
          {' '}{BRAND.name} lo paga de su propia parte: no se le quita dinero al creador que invitaste.
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
                    {c.until ? `bono hasta el ${fmtDate(c.until)}` : `se activa cuando se verifique y venda $${CREATOR_INVITE_QUALIFY}`}
                  </span>
                </span>
                <span className="text-green-600 font-medium">{money(c.bonus)} ganados</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm">
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
