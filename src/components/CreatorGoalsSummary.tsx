import React from 'react';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery, money } from '../lib/platform';
import {
  CREATOR_INVITE_BONUS,
  CREATOR_INVITE_MONTHS,
  CREATOR_INVITE_QUALIFY,
  EMPTY_MEDALS,
  FOUNDER_GOAL,
  FOUNDER_SHARE,
  daysLeft,
  founderOpen,
  levelById,
  nextLevel,
  pct,
  rewardsApi,
  type CreatorRewards,
} from '../lib/rewards';

const EMPTY: CreatorRewards = {
  level: 'bronce', activeFans: 0, sales: 0, clean: true, reliable: true, share: 0.8, attractedThisMonth: 0, attractedLastMonth: 0,
  medals: EMPTY_MEDALS, referrals: [], invitedCreators: [],
};

const percent = (value: number, max: number) => (max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100);

const Goal: React.FC<{
  id: string;
  icon: string;
  tone: 'gold' | 'brand' | 'iris';
  title: string;
  value?: number;
  max?: number;
  amount?: string;
  note: React.ReactNode;
  action: string;
  onAction: () => void;
}> = ({ id, icon, tone, title, value, max, amount, note, action, onAction }) => {
  const p = max !== undefined && value !== undefined ? percent(value, max) : null;
  const fill = { gold: 'from-amber-400 to-orange-500', brand: 'from-brand-500 to-iris-500', iris: 'from-iris-500 to-teal-500' }[tone];
  const chip = { gold: 'bg-amber-50 text-amber-600', brand: 'bg-brand-50 text-brand-600', iris: 'bg-iris-50 text-iris-600' }[tone];
  return (
    <li className="flex gap-3 py-3.5 first:pt-0 last:pb-0" data-testid={`my-goal-${id}`}>
      <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${chip}`}><i aria-hidden="true" className={`fas ${icon}`} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-semibold text-ink text-sm sm:text-base">{title}</p>
          {amount && <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{amount}</span>}
        </div>
        {p !== null && (
          <div className="mt-1.5 h-2.5 rounded-full bg-canvas overflow-hidden" role="progressbar" aria-label={title} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full bg-gradient-to-r ${fill} transition-[width] duration-700`} style={{ width: `${Math.max(4, p)}%` }} />
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-ink/60">{note}</p>
          <button type="button" onClick={onAction} className="text-xs font-semibold text-brand-600 hover:text-brand-700 whitespace-nowrap">{action} <i aria-hidden="true" className="fas fa-arrow-right text-[10px]" /></button>
        </div>
      </div>
    </li>
  );
};

// Mi panel > Resumen: up to three goals with bars that fill as the creator moves
// (Fundador in the first month, the next level, and invited creators).
const CreatorGoalsSummary: React.FC<{ onOpenTab: (tab: string) => void }> = ({ onOpenTab }) => {
  const { user } = useAuth();
  const { data, loading } = usePlatformQuery(() => (user ? rewardsApi.myRewards(user) : Promise.resolve(EMPTY)), [user?.id], EMPTY);
  if (!user || loading) return null;

  const level = levelById(data.level);
  const next = nextLevel(level);
  const f = data.founder;
  const invited = data.invitedCreators;
  const ready = invited.filter((c) => c.qualifiedAt).length;
  // The closer of the two ways up.
  const byFans = next ? percent(data.activeFans, next.minFans) : 0;
  const bySales = next ? percent(data.sales, next.minSales) : 0;

  return (
    <section className="bg-white rounded-2xl border border-line p-4 sm:p-6 mb-5 sm:mb-8" aria-labelledby="my-goals-title" data-testid="my-goals">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 id="my-goals-title" className="font-display text-lg font-bold text-ink"><i aria-hidden="true" className="fas fa-bullseye text-orange-500 mr-2" />Tus metas</h3>
        {data.medals.fundador && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200" data-testid="my-goals-founder">
            <i aria-hidden="true" className="fas fa-crown" />Fundador{f?.active ? ` · hoy ganas ${pct(FOUNDER_SHARE)}` : ''}
          </span>
        )}
      </div>
      <ul className="divide-y divide-line">
        {founderOpen(f) && f && (
          <Goal
            id="founder"
            icon="fa-crown"
            tone="gold"
            title={`Fundador: vende $${FOUNDER_GOAL} en tu primer mes`}
            value={f.sales}
            max={FOUNDER_GOAL}
            amount={`${money(f.sales)} / ${money(FOUNDER_GOAL)}`}
            note={<>{f.verified ? <span className="text-emerald-700"><i aria-hidden="true" className="fas fa-circle-check mr-1" />Verificado</span> : 'Falta verificarte'} · {daysLeft(f.until)} · Premio: insignia para siempre y {pct(FOUNDER_SHARE)}</>}
            action="Ver metas"
            onAction={() => onOpenTab('goals')}
          />
        )}
        {next && (
          <Goal
            id="level"
            icon="fa-medal"
            tone="brand"
            title={`Llegar a ${next.icon} ${next.name}`}
            value={bySales >= byFans ? data.sales : data.activeFans}
            max={bySales >= byFans ? next.minSales : next.minFans}
            amount={bySales >= byFans ? `${money(data.sales)} / ${money(next.minSales)}` : `${data.activeFans} / ${next.minFans} fans`}
            note={bySales >= byFans ? `Ventas en 30 días, o ${next.minFans} fans activos` : `Fans activos, o ${money(next.minSales)} en ventas en 30 días`}
            action="Ver metas"
            onAction={() => onOpenTab('goals')}
          />
        )}
        {invited.length ? (
          <Goal
            id="invites"
            icon="fa-user-plus"
            tone="iris"
            title="Invitados que llegaron a $100"
            value={ready}
            max={invited.length}
            amount={`${ready} / ${invited.length}`}
            note={`Con cada uno ganas ${pct(CREATOR_INVITE_BONUS)} de lo que venda durante ${CREATOR_INVITE_MONTHS} meses`}
            action="Mis invitados"
            onAction={() => onOpenTab('invites')}
          />
        ) : (
          <Goal
            id="invites"
            icon="fa-user-plus"
            tone="iris"
            title="Invita a un creador"
            note={`Cuando venda sus primeros $${CREATOR_INVITE_QUALIFY}, ganas ${pct(CREATOR_INVITE_BONUS)} de lo que venda durante ${CREATOR_INVITE_MONTHS} meses`}
            action="Invitar"
            onAction={() => onOpenTab('invites')}
          />
        )}
      </ul>
    </section>
  );
};

export default CreatorGoalsSummary;
