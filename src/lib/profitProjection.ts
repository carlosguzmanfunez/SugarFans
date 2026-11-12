import { PROVIDERS, type ProviderId } from './infraUsage.js';
import { BASE_CREATOR_SHARE, PROVIDER_RESERVE_PERCENT } from './revenuePolicy.js';

// Owner's profit projection (Admin › Dinero › Proyección). Pure math, no data reads:
// how many creators doing N Reserve a month cover the paid provider plans and when
// Fans Reserve starts to earn, step by step up to the first $1,000 clean a month.
// Rules: PayPal 5.4% + $0.30 comes off first, the creator share is applied to the
// rest (rounded once per payment), ISV is declared on Fans Reserve's own share,
// and a % of the "renta" (our share without ISV minus providers) is set aside for
// the ISR advance payments. The provider fund is the same money that pays the
// providers: it is shown as a check, never subtracted twice.

export interface ProjectionInputs {
  price: number;            // USD per Reserve
  reservesPerCreator: number;
  creatorPct: number;       // 70 = 70%
  isvPct: number;           // 15
  isrPct: number;           // 25
  fundPct: number;          // 15 (of Fans Reserve's share, before ISV)
  costs: Record<string, number>; // USD a month
  creatorsNow: number;
  newCreatorsPerMonth: number;
}

const firstPaid = (id: ProviderId) => PROVIDERS[id].plans.find((p) => p.price > 0)?.price ?? 0;

export const COST_ITEMS: { id: string; name: string; plan: { es: string; en: string } }[] = [
  { id: 'vercel', name: 'Vercel', plan: { es: 'Pro: la web y el servidor', en: 'Pro: website and server' } },
  { id: 'supabase', name: 'Supabase', plan: { es: 'Pro: base de datos con copias diarias', en: 'Pro: database with daily backups' } },
  { id: 'livekit', name: 'LiveKit', plan: { es: 'Ship: videollamadas y eventos', en: 'Ship: video calls and events' } },
  { id: 'bunny', name: 'Bunny Stream', plan: { es: 'Prepago por uso (estimado)', en: 'Prepaid, pay as you go (estimate)' } },
  { id: 'sightengine', name: 'Sightengine', plan: { es: 'Starter: revisión de fotos', en: 'Starter: photo review' } },
  { id: 'resend', name: 'Resend', plan: { es: 'Pro: correos', en: 'Pro: emails' } },
  { id: 'didit', name: 'Didit', plan: { es: '500 verificaciones gratis al mes', en: '500 free verifications a month' } },
  { id: 'zoho', name: 'Zoho Mail', plan: { es: 'Mail Lite, 1 buzón', en: 'Mail Lite, 1 mailbox' } },
  { id: 'domain', name: 'fansreserve.com', plan: { es: 'Dominio (~$15 al año)', en: 'Domain (~$15 a year)' } },
  { id: 'anthropic', name: 'Anthropic', plan: { es: 'Opcional: Mano derecha con Claude', en: 'Optional: Mano derecha with Claude' } },
  { id: 'other', name: 'Otros / Other', plan: { es: 'Contador, LLC, abogado… (hoy $0)', en: 'Accountant, LLC, lawyer… (today $0)' } },
];

export const DEFAULT_INPUTS: ProjectionInputs = {
  price: 25, reservesPerCreator: 3, creatorPct: BASE_CREATOR_SHARE * 100, isvPct: 15, isrPct: 25,
  fundPct: PROVIDER_RESERVE_PERCENT, creatorsNow: 0, newCreatorsPerMonth: 10,
  costs: {
    vercel: firstPaid('vercel'), supabase: firstPaid('supabase'), livekit: firstPaid('livekit'), bunny: 5,
    sightengine: firstPaid('sightengine'), resend: firstPaid('resend'), didit: 0, zoho: 1, domain: 1.25, anthropic: 0, other: 0,
  },
};

const cents = (x: number) => Math.round((x + 1e-9) * 100) / 100;
export const GOALS = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

export function perReserve(i: ProjectionInputs) {
  const fee = cents(i.price * 0.054 + 0.3);
  const net = cents(i.price - fee);
  const creator = cents(net * i.creatorPct / 100);
  const frWithIsv = cents(net - creator);
  const isv = cents(frWithIsv * i.isvPct / 100);
  const frClean = cents(frWithIsv - isv);
  const fund = cents(frWithIsv * i.fundPct / 100);
  return { price: i.price, fee, net, creator, frWithIsv, isv, frClean, fund };
}

export const monthlyCosts = (i: ProjectionInputs) => Object.values(i.costs).reduce((s, v) => s + (Number(v) || 0), 0);

// The month with `creators` creators doing the assumed Reserve.
export function monthFor(i: ProjectionInputs, creators: number) {
  const r = perReserve(i);
  const reserves = creators * i.reservesPerCreator;
  const costs = monthlyCosts(i);
  const frWithIsv = reserves * r.frWithIsv;
  const isv = reserves * r.isv;
  const renta = reserves * r.frClean - costs;
  const isr = renta > 0 ? renta * i.isrPct / 100 : 0;
  const fund = reserves * r.fund;
  return { creators, reserves, charged: reserves * i.price, frWithIsv, isv, costs, renta, isr, clean: renta - isr, fund, fundCovers: fund >= costs };
}

// Fewest creators whose month leaves at least `goal` clean (after ISR).
export function creatorsFor(i: ProjectionInputs, goal: number) {
  const per = perReserve(i).frClean * i.reservesPerCreator;
  if (per <= 0) return Infinity;
  let n = Math.max(0, Math.ceil(monthlyCosts(i) / per - 1e-9));
  while (monthFor(i, n).clean < goal - 1e-9) n++;
  return n;
}

export function creatorsForFund(i: ProjectionInputs) {
  const perFund = perReserve(i).fund * i.reservesPerCreator;
  return perFund > 0 ? Math.ceil(monthlyCosts(i) / perFund - 1e-9) : Infinity;
}

// Next 12 months if creators grow by a fixed number each month.
export function growth(i: ProjectionInputs, months = 12) {
  let total = 0;
  return Array.from({ length: months }, (_, k) => {
    const m = monthFor(i, Math.max(0, Math.round(i.creatorsNow + i.newCreatorsPerMonth * (k + 1))));
    total += m.clean;
    return { month: k + 1, ...m, accumulated: total };
  });
}
