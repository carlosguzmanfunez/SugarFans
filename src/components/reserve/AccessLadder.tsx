import React, { useState } from 'react';
import Icon from '../Icon';
import type { User } from '../../context/AuthContext';
import { socialApi } from '../../lib/social';
import { usePlatformQuery } from '../../lib/platform';
import { Link } from 'react-router-dom';
import { useCurrentLive, useLiveAlerts, setLiveAlerts } from '../../lib/live';
import { ENABLE_CREATOR_LIVE, ENABLE_SUBSCRIBER_LIVE } from '../../config/features';
import { useAuth } from '../../context/AuthContext';
import { MIN_SUBSCRIPTION } from '../../lib/platformRules';
import { openCustomRequest, openReserve } from './CreatorReserveSection';

export const useFollow = (creatorProfileId: string | undefined, user: User | null) =>
  usePlatformQuery(
    () => (creatorProfileId ? socialApi.followState(creatorProfileId, user) : Promise.resolve({ following: false, count: 0 })),
    [creatorProfileId, user?.id],
    { following: false, count: 0 }
  ).data;

interface Props {
  creator: { id: string; name: string; subscriptionPrice: number; followers: number };
  user: User | null;
  isOwner: boolean;
  isSubscribed: boolean;
  following: boolean;
  experiences: number;
  onSubscribe: () => void;
  onNeedLogin: () => void;
  // The creator viewing their own account's profile changes their price right here.
  editsPrice?: boolean;
}

// How to get closer to a creator: Suscribirse (exclusive content) → Proponer (the
// fan's own idea, date and value) → Reserve (Reserve Event, Reserve 1:1). Following
// is the button in the profile header. Live is not a step of its own.
const AccessLadder: React.FC<Props> = ({ creator, user, isOwner, isSubscribed, following, experiences, onSubscribe, editsPrice = false }) => {
  // Only a Live whose mode is on offer (useCurrentLive filters by the feature flags).
  const live = useCurrentLive(creator.id);
  const subscriberLive = live?.mode === 'subscriber';
  const canEnter = !!live && (!subscriberLive || isSubscribed || isOwner);
  const alerts = useLiveAlerts(following ? creator.id : undefined, user);
  // Phones: three compact steps in one row (no descriptions); wider screens: full cards.
  const step = 'flex min-w-0 flex-col rounded-2xl border border-line bg-white px-2.5 py-3 sm:p-4';
  const eyebrow = 'whitespace-nowrap text-[10px] font-semibold uppercase tracking-normal sm:whitespace-normal sm:text-[11px] sm:tracking-[0.14em]';
  const blurb = 'text-xs text-ink/60 max-sm:hidden';
  const goldButton = 'btn-gold inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold sm:px-4 sm:py-1.5 sm:text-sm';
  // Same rule as the request inside the Reserve section: fans and visitors, not creators.
  // Wait for the session to load, so a creator's button doesn't flash before hiding.
  const { loading } = useAuth();
  const canPropose = !loading && !isOwner && user?.role !== 'creator' && user?.role !== 'admin';
  const action = 'mt-3 inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold transition';

  return (
    <section id="acceso" aria-labelledby="access-title" className="mb-6 scroll-mt-24" data-testid="access-ladder">
      <h2 id="access-title" className="sr-only">Formas de acceso</h2>
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 sm:[&>li:last-child]:col-span-2 lg:[&>li:last-child]:col-span-1">
        <li className={`${step} ${live ? 'border-iris-200 bg-iris-50/40' : ''}`} data-testid="ladder-subscribe">
          <span className={`${eyebrow} text-muted`}>1 · Suscribirse</span>
          {editsPrice && user ? (
            <PriceEditor price={user.subscriptionPrice ?? creator.subscriptionPrice} />
          ) : (
            <span className="mt-1 text-sm font-semibold text-ink">${creator.subscriptionPrice}/mes</span>
          )}
          <span className={blurb}>{ENABLE_SUBSCRIBER_LIVE ? 'Contenido exclusivo, Lives para suscriptores y beneficios del creador.' : 'Contenido exclusivo y beneficios del creador.'}</span>
          {live && (
            <span className="mt-2 flex flex-col gap-0.5" data-testid="live-now">
              <span className="flex items-center text-sm font-semibold text-red-600">
                <span className="mr-1.5 h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
                {subscriberLive ? 'Live para suscriptores · ahora' : 'En Live ahora · Gratis'}
              </span>
              <span className="truncate text-xs text-ink/60">{live.title}</span>
            </span>
          )}
          {live && !isOwner && canEnter && (
            <Link to={`/en-vivo/${creator.id}`} className={`${action} bg-red-600 text-white hover:bg-red-700`}>
              Entrar al Live
            </Link>
          )}
          {!isOwner && user?.role !== 'creator' && user?.role !== 'admin' && (isSubscribed ? (
            <span className="mt-3 inline-flex items-center text-xs font-semibold text-ink/70 sm:text-sm" data-testid="ladder-subscribed">
              <Icon name="fa-check" className="mr-1.5 text-emerald-600" /><span className="sm:hidden">Suscrito</span><span className="max-sm:hidden">Tu suscripción está activa</span>
            </span>
          ) : live && subscriberLive ? (
            // The main "Suscribirse" button lives in the profile header; here it only
            // shows when it unlocks a Live that is on right now.
            <button type="button" onClick={onSubscribe} className={`${action} bg-gradient-to-r from-brand-600 to-iris-600 text-white`}>
              Suscribirse para entrar
            </button>
          ) : null)}
          {live && subscriberLive && !canEnter && (
            <span className="mt-2 text-xs text-ink/60" data-testid="subscriber-live-locked">
              <i aria-hidden="true" className="fas fa-lock mr-1"></i>Exclusivo para suscriptores
            </span>
          )}
          {ENABLE_CREATOR_LIVE && !isOwner && following && user && (
            <button
              type="button"
              onClick={() => setLiveAlerts(user, creator.id, !alerts)}
              aria-pressed={alerts}
              data-testid="live-alerts"
              className="mt-2 inline-flex items-start gap-1.5 self-start text-left text-xs font-medium text-ink/70 hover:text-ink"
            >
              <Icon name={alerts ? 'fa-bell' : 'fa-bell-slash'} className={`mt-0.5 ${alerts ? 'text-brand-600' : ''}`} />
              <span className="sm:hidden">{alerts ? 'Avisos de Live' : 'Avisos apagados'}</span>
              <span className="max-sm:hidden">{alerts ? 'Te avisaremos cuando esté en Live' : 'Avisos de Live desactivados'}</span>
            </button>
          )}
        </li>
        <li className={step} data-testid="ladder-propose-step">
          <span className={`${eyebrow} text-muted`}>2 · Proponer</span>
          <span className="mt-1 text-sm font-semibold text-ink">A tu medida</span>
          <span className={blurb}>
            {canPropose
              ? `Propón tu idea, la fecha y el valor por la experiencia. ${creator.name.split(' ')[0]} acepta, rechaza o te hace una contraoferta.`
              : 'Los fans proponen su idea, la fecha y el valor por la experiencia.'}
          </span>
          {canPropose && (
            <button type="button" onClick={openCustomRequest} className={`${goldButton} mt-auto self-start max-sm:mt-2 sm:mt-3`} data-testid="ladder-propose">
              <Icon name="fa-wand-magic-sparkles" className="text-xs" />Proponer<span className="max-sm:hidden"> experiencia</span>
            </button>
          )}
        </li>
        <li className={`${step.replace('border-line bg-white', '')} border-gold-300 bg-gradient-to-br from-gold-100 via-gold-50 to-white shadow-md shadow-gold-400/25 ring-1 ring-gold-300`} data-testid="ladder-reserve">
          <span className={`${eyebrow} text-gold-700`}><Icon name="fa-crown" className="mr-1 text-[9px] text-gold-500 sm:text-[10px]" />3 · Reserve</span>
          <span className="mt-1 text-sm font-semibold text-ink">{experiences ? `${experiences} ${experiences === 1 ? 'experiencia' : 'experiencias'}` : 'Aún sin experiencias'}</span>
          <span className={blurb}>Reserve Events en grupo y videollamadas 1:1 con {creator.name.split(' ')[0]}, con fecha, precio y reglas.</span>
          <a href="#reserve" onClick={(e) => { e.preventDefault(); openReserve(); }} className={`${goldButton} mt-auto self-start max-sm:mt-2 sm:mt-3`}>Ver<span className="max-sm:hidden"> experiencias</span> <Icon name="fa-arrow-right" className="text-xs" /></a>
        </li>
      </ol>
    </section>
  );
};

// The creator's monthly price, editable in place (Ajustes keeps the same field).
const PriceEditor: React.FC<{ price: number }> = ({ price }) => {
  const { updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(price));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Math.round(parseFloat(value.replace(',', '.')) * 100) / 100;
    if (!(parsed >= MIN_SUBSCRIPTION && parsed <= 999)) return setNote({ ok: false, text: `El precio debe estar entre $${MIN_SUBSCRIPTION} y $999` });
    setBusy(true);
    const r = await updateUser({ subscriptionPrice: parsed });
    setBusy(false);
    if (!r.ok) return setNote({ ok: false, text: r.error || 'No se pudo guardar el precio' });
    setEditing(false);
    setNote({ ok: true, text: 'Precio actualizado. Los suscriptores actuales mantienen el suyo.' });
  };

  if (!editing) {
    return (
      <span className="mt-1 flex flex-col items-start gap-0.5">
        <span className="text-sm font-semibold text-ink">${price}/mes</span>
        <button
          type="button"
          onClick={() => { setValue(String(price)); setNote(null); setEditing(true); }}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
          data-testid="edit-sub-price"
        >
          <Icon name="fa-pen" className="text-[10px]" />Cambiar precio
        </button>
        {note && <span className={`text-xs ${note.ok ? 'text-emerald-700' : 'text-red-600'}`} role="status">{note.text}</span>}
      </span>
    );
  }
  return (
    <form onSubmit={save} noValidate className="mt-1 flex flex-col gap-1.5" data-testid="sub-price-form">
      <div className="flex items-center gap-2">
        <label className="flex h-9 flex-1 min-w-0 items-center rounded-lg border border-line bg-white focus-within:ring-2 focus-within:ring-brand-500">
          <span className="pl-2.5 text-sm text-ink/50">$</span>
          <input
            type="number"
            inputMode="decimal"
            min={MIN_SUBSCRIPTION}
            max={999}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Precio mensual de tu suscripción"
            autoFocus
            className="w-full min-w-0 bg-transparent px-1.5 text-sm outline-none"
          />
          <span className="pr-2.5 text-xs text-ink/50">/mes</span>
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="h-8 rounded-full bg-ink px-3 text-xs font-semibold text-white disabled:opacity-60">
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="h-8 rounded-full px-3 text-xs font-semibold text-ink/60 hover:text-ink">
          Cancelar
        </button>
      </div>
      <span className="text-[11px] text-ink/55">Mínimo ${MIN_SUBSCRIPTION}. Los suscriptores actuales mantienen su precio.</span>
      {note && !note.ok && <span className="text-xs text-red-600" role="alert">{note.text}</span>}
    </form>
  );
};

export default AccessLadder;
