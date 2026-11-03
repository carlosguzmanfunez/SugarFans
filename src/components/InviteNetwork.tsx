import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery, money } from '../lib/platform';
import {
  CREATOR_INVITE_BONUS,
  CREATOR_INVITE_CAP,
  CREATOR_INVITE_MONTHS,
  CREATOR_INVITE_QUALIFY,
  EMPTY_MEDALS,
  pct,
  rewardsApi,
  type CreatorRewards,
} from '../lib/rewards';
import type { InvitedCreator } from '../lib/backend/rewardTypes';
import { BRAND } from '../config/brand';
import Avatar from './Avatar';
import InviteMap from './InviteMap';

const EMPTY: CreatorRewards = {
  level: 'bronce', activeFans: 0, sales: 0, clean: true, reliable: true, share: 0.8, attractedThisMonth: 0, attractedLastMonth: 0,
  medals: EMPTY_MEDALS, referrals: [], invitedCreators: [],
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });

// Where each invited creator is: on the way to $100, earning, or finished.
type Stage = 'waiting' | 'active' | 'done';
const stageOf = (c: InvitedCreator, now: string): Stage => (!c.until ? 'waiting' : c.until > now ? 'active' : 'done');
const RING: Record<Stage, string> = { waiting: '#e5337a', active: '#d97706', done: '#0f9f8f' };
const statusText = (c: InvitedCreator, stage: Stage) =>
  stage === 'active'
    ? `Activo: ganas ${pct(CREATOR_INVITE_BONUS)} hasta el ${shortDate(c.until!)}`
    : stage === 'done'
      ? 'Terminó su bono'
      : !c.verified
        ? 'Falta que se verifique'
        : `${money(c.sales ?? 0)} de ${money(CREATOR_INVITE_QUALIFY)}`;

// Earnings per invited creator: fixed colors in the order they joined, apart from
// the ring colors above (checked for color blindness; the legend names each one);
// after five, the rest go together in "Otros".
const SERIES = ['#6d3ce6', '#0891b2', '#c026d3', '#65a30d', '#2563eb'];
const OTHER = '#9ca3af';

// Donut of what each invited creator has earned you.
const Earnings: React.FC<{ list: InvitedCreator[] }> = ({ list }) => {
  // Oldest invitation first, so each person keeps their color as new ones arrive.
  const paid = [...list].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)).map((c, i) => ({ name: c.name, value: c.bonus, color: SERIES[i] ?? OTHER, order: i })).filter((s) => s.value > 0);
  const top = paid.filter((s) => s.order < SERIES.length);
  const rest = paid.filter((s) => s.order >= SERIES.length).reduce((t, s) => t + s.value, 0);
  const slices = [...top, ...(rest > 0 ? [{ name: 'Otros', value: rest, color: OTHER, order: 99 }] : [])];
  const total = slices.reduce((t, s) => t + s.value, 0);
  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="bg-white rounded-2xl border border-line p-4 sm:p-6" data-testid="invite-earnings">
      <h3 className="font-semibold text-ink">Lo que te han dado tus invitados</h3>
      {total === 0 ? (
        <p className="mt-2 text-sm text-ink/60">Todavía nada. Empiezas a ganar cuando un invitado vende sus primeros ${CREATOR_INVITE_QUALIFY}.</p>
      ) : (
        <div className="mt-4 flex flex-col sm:flex-row items-center gap-5">
          <div className="relative h-40 w-40 flex-none">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`Total ${money(total)}`}>
              {slices.map((s) => {
                const len = (s.value / total) * C;
                // 2px of surface between slices (when there are several).
                const gap = slices.length > 1 ? Math.min(1.2, len / 3) : 0;
                const el = (
                  <circle key={s.name} cx="50" cy="50" r={R} fill="none" stroke={s.color} strokeWidth="14" strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-acc}>
                    <title>{`${s.name}: ${money(s.value)}`}</title>
                  </circle>
                );
                acc += len;
                return el;
              })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-xl font-bold tabular-nums text-ink">{money(total)}</span>
              <span className="text-[11px] text-ink/55">en total</span>
            </div>
          </div>
          <ul className="w-full space-y-2 text-sm">
            {slices.map((s) => (
              <li key={s.name} className="flex items-center gap-2">
                <span className="h-3 w-3 flex-none rounded-sm" style={{ background: s.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
                <span className="tabular-nums font-semibold text-ink">{money(s.value)}</span>
                <span className="w-10 text-right tabular-nums text-xs text-ink/55">{Math.round((s.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// Mi panel > Dinero > Recompensas > Mis invitados: your invited creators on an
// adventure map, how close each one is to $100, and what each has earned you. One level only:
// you earn from the creators you invite, never from the ones they invite.
const InviteNetwork: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { user } = useAuth();
  const { data } = usePlatformQuery(() => (user ? rewardsApi.myRewards(user) : Promise.resolve(EMPTY)), [user?.id], EMPTY);
  const [copied, setCopied] = useState(false);
  if (!user) return null;
  const now = new Date().toISOString();
  const list = data.invitedCreators;
  const active = list.filter((c) => stageOf(c, now) === 'active').length;
  const link = `${window.location.origin}/r/${user.creatorProfileId ?? user.id}?as=creator`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="my-invites">
      <button type="button" onClick={onBack} className="text-sm font-medium text-ink/60 hover:text-ink"><i aria-hidden="true" className="fas fa-arrow-left mr-1.5" />Beneficios</button>

      <div className="bg-white rounded-2xl border border-line p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Mis invitados</h2>
            <p className="text-sm text-ink/60 mt-1">
              {list.length === 0 ? 'Aún no has invitado a nadie.' : `${list.length} ${list.length === 1 ? 'creador invitado' : 'creadores invitados'} · ${active} ${active === 1 ? 'activo' : 'activos'} ahora`}
            </p>
          </div>
        </div>

        {/* The map shows even before the first invite, so the road ahead is clear. */}
        <div className="mt-4"><InviteMap list={list} now={now} /></div>
        {list.length === 0 && (
          <p className="mt-3 text-center text-sm text-ink/70">Comparte tu enlace con creadores que conozcas. Aquí los verás avanzar por tu mapa, del Campamento al Castillo.</p>
        )}

        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <input readOnly value={link} aria-label="Enlace para invitar creadores" className="flex-1 px-4 py-2.5 border border-line rounded-xl text-sm" onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => void copy()} className="btn btn-md btn-dark">{copied ? 'Copiado' : 'Copiar enlace'}</button>
        </div>
      </div>

      {list.length > 0 && (
        <div className="bg-white rounded-2xl border border-line p-4 sm:p-6">
          <h3 className="font-semibold text-ink mb-2">Cada invitado</h3>
          <ul className="divide-y divide-line">
            {list.map((c, i) => {
              const stage = stageOf(c, now);
              const p = stage === 'waiting' ? Math.min(100, Math.round(((c.sales ?? 0) / CREATOR_INVITE_QUALIFY) * 100)) : 100;
              return (
                <li key={i} className="flex items-center gap-3 py-3" data-testid="my-invite">
                  <Avatar src={c.avatar} name={c.name} size={40} decorative />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">{money(c.bonus)}</p>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-canvas overflow-hidden" role="progressbar" aria-label={`${c.name}: camino a $${CREATOR_INVITE_QUALIFY}`} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(3, p)}%`, background: RING[stage] }} />
                    </div>
                    <p className="mt-1 text-xs text-ink/60">{statusText(c, stage)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Earnings list={list} />

      <div className="rounded-2xl bg-iris-50 p-4 sm:p-5 text-sm text-ink/80" data-testid="invite-how">
        <p className="font-semibold text-ink mb-2">Cómo funciona</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Comparte tu enlace con creadores que conozcas.</li>
          <li>Cuando tu invitado se verifica y vende sus primeros ${CREATOR_INVITE_QUALIFY}, se activa tu bono.</li>
          <li>Ganas {pct(CREATOR_INVITE_BONUS)} de todo lo que venda durante {CREATOR_INVITE_MONTHS} meses, hasta ${CREATOR_INVITE_CAP} mensuales por invitado.</li>
        </ol>
        <p className="mt-2 text-xs text-ink/60">Lo paga {BRAND.name}: a tu invitado no se le descuenta nada. Solo ganas por los creadores que tú invitas, no por los que ellos inviten.</p>
      </div>
    </div>
  );
};

export default InviteNetwork;
