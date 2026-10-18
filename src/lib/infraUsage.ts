// What Fans Reserve uses of each provider's plan, how close it is to the limit,
// and which plan comes next. Shared by the admin's "Consumo" tab and the daily
// check (api/usage.ts) that emails at 70% and 90%, so both always agree.
// Plan limits and prices as published by each provider in October 2026; they are
// estimates to plan with, the provider's own bill is what counts.
// Data: public.infra_usage() in supabase/migrations/20261018000001_infra_usage.sql.

export type ProviderId = 'supabase' | 'livekit' | 'resend' | 'sightengine' | 'didit' | 'vercel';
export type MetricId = 'supabase_db' | 'supabase_storage' | 'supabase_mau' | 'livekit_minutes' | 'resend_month' | 'resend_day' | 'sightengine_month' | 'didit_month';

export interface InfraUsage {
  month: string; // YYYY-MM
  measuredAt: string;
  dbBytes: number;
  storageBytes: number;
  mau: number;
  usersTotal: number;
  emailsMonth: number;
  emailsToday: number;
  scansMonth: number;
  kycMonth: number;
  videoMinutesMonth: number;
  plans: Partial<Record<ProviderId, string>>;
  fundPct: number;
}

export interface Plan {
  id: string;
  name: string;
  price: number; // USD a month
  limits: Partial<Record<MetricId, number>>;
  note?: string;
}

const GB = 1024 ** 3;

export const PROVIDERS: Record<ProviderId, { name: string; what: string; plans: Plan[]; extra?: string }> = {
  supabase: {
    name: 'Supabase',
    what: 'Base de datos, cuentas y fotos/videos',
    plans: [
      { id: 'free', name: 'Free', price: 0, limits: { supabase_db: 0.5 * GB, supabase_storage: 1 * GB, supabase_mau: 50_000 }, note: 'Se pausa tras 7 días sin visitas y no tiene copias diarias' },
      { id: 'pro', name: 'Pro', price: 25, limits: { supabase_db: 8 * GB, supabase_storage: 100 * GB, supabase_mau: 100_000 } },
    ],
    extra: 'En Pro, lo que pase del límite se cobra aparte (no se corta) si el "Spend cap" está apagado.',
  },
  livekit: {
    name: 'LiveKit',
    what: 'Videollamadas 1:1 y eventos de Reserve',
    plans: [
      { id: 'build', name: 'Build', price: 0, limits: { livekit_minutes: 5_000 }, note: 'Corta las llamadas al llegar al límite' },
      { id: 'ship', name: 'Ship', price: 50, limits: { livekit_minutes: 150_000 } },
      { id: 'scale', name: 'Scale', price: 500, limits: { livekit_minutes: 1_500_000 } },
    ],
    extra: 'En Ship y Scale, los minutos de más se cobran aparte (no se corta).',
  },
  resend: {
    name: 'Resend',
    what: 'Correos de la web y de inicio de sesión',
    plans: [
      { id: 'free', name: 'Free', price: 0, limits: { resend_month: 3_000, resend_day: 100 }, note: 'Máximo 100 correos al día' },
      { id: 'pro', name: 'Pro 50k', price: 20, limits: { resend_month: 50_000 } },
      { id: 'pro100', name: 'Pro 100k', price: 35, limits: { resend_month: 100_000 } },
      { id: 'scale', name: 'Scale', price: 90, limits: { resend_month: 100_000 } },
    ],
  },
  sightengine: {
    name: 'Sightengine',
    what: 'Revisión automática de fotos y videos',
    plans: [
      { id: 'free', name: 'Free', price: 0, limits: { sightengine_month: 2_000 }, note: 'Máximo 500 al día; al pasarse, las fotos esperan revisión manual' },
      { id: 'starter', name: 'Starter', price: 29, limits: { sightengine_month: 10_000 } },
      { id: 'pro', name: 'Pro', price: 99, limits: { sightengine_month: 40_000 } },
    ],
    extra: 'Las revisiones de más cuestan unos $0.002 cada una.',
  },
  didit: {
    name: 'Didit',
    what: 'Verificación de identidad de creadores',
    plans: [
      { id: 'free', name: 'Gratis', price: 0, limits: { didit_month: 500 } },
      { id: 'payg', name: 'Pago por uso', price: 0, limits: {}, note: 'Unos $0.30 por verificación de más (cambia el 1 de noviembre de 2026)' },
    ],
  },
  vercel: {
    name: 'Vercel',
    what: 'La web y las funciones del servidor',
    plans: [
      { id: 'hobby', name: 'Hobby', price: 0, limits: {}, note: 'No permite uso comercial' },
      { id: 'pro', name: 'Pro', price: 20, limits: {} },
    ],
    extra: 'Su consumo no se ve desde aquí: Vercel Pro manda sus propias alertas de gasto.',
  },
};

export const METRICS: { id: MetricId; provider: ProviderId; label: string; unit: 'bytes' | 'count' | 'minutes'; daily?: boolean; value: (u: InfraUsage) => number }[] = [
  { id: 'supabase_db', provider: 'supabase', label: 'Tamaño de la base de datos', unit: 'bytes', value: (u) => u.dbBytes },
  { id: 'supabase_storage', provider: 'supabase', label: 'Fotos y videos guardados', unit: 'bytes', value: (u) => u.storageBytes },
  { id: 'supabase_mau', provider: 'supabase', label: 'Usuarios activos (30 días)', unit: 'count', value: (u) => u.mau },
  { id: 'livekit_minutes', provider: 'livekit', label: 'Minutos de video este mes', unit: 'minutes', value: (u) => u.videoMinutesMonth },
  { id: 'resend_month', provider: 'resend', label: 'Correos este mes', unit: 'count', value: (u) => u.emailsMonth },
  { id: 'resend_day', provider: 'resend', label: 'Correos hoy', unit: 'count', daily: true, value: (u) => u.emailsToday },
  { id: 'sightengine_month', provider: 'sightengine', label: 'Fotos y videos revisados este mes', unit: 'count', value: (u) => u.scansMonth },
  { id: 'didit_month', provider: 'didit', label: 'Verificaciones este mes', unit: 'count', value: (u) => u.kycMonth },
];

export const ALERT_LEVELS = [70, 90] as const;

export const currentPlan = (provider: ProviderId, plans: InfraUsage['plans']): Plan => {
  const list = PROVIDERS[provider].plans;
  return list.find((p) => p.id === plans[provider]) ?? list[0];
};

// The cheapest plan above the current one that fits `needed` (or simply the next one).
export const nextPlan = (provider: ProviderId, plans: InfraUsage['plans'], metric?: MetricId, needed = 0): Plan | null => {
  const list = PROVIDERS[provider].plans;
  const above = list.slice(list.indexOf(currentPlan(provider, plans)) + 1);
  if (!metric) return above[0] ?? null;
  return above.find((p) => (p.limits[metric] ?? Infinity) > needed) ?? above[0] ?? null;
};

export const monthlyBill = (plans: InfraUsage['plans']) =>
  (Object.keys(PROVIDERS) as ProviderId[]).reduce((sum, id) => sum + currentPlan(id, plans).price, 0);

export const formatAmount = (n: number, unit: 'bytes' | 'count' | 'minutes') => {
  if (unit === 'bytes') return n >= GB ? `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;
  const s = Math.round(n).toLocaleString('es');
  return unit === 'minutes' ? `${s} min` : s;
};

export interface UsageRow {
  metric: MetricId;
  provider: ProviderId;
  label: string;
  used: number;
  limit: number | null; // null: the current plan has no cap for it
  pct: number;
  level: 0 | 70 | 90;
  usedText: string;
  limitText: string;
  plan: Plan;
  next: Plan | null;
  daily: boolean;
}

export const usageRows = (u: InfraUsage): UsageRow[] =>
  METRICS.flatMap((m) => {
    const plan = currentPlan(m.provider, u.plans);
    const limit = plan.limits[m.id] ?? null;
    // A daily cap only exists on some plans (Resend Free): hide the row elsewhere.
    if (m.daily && limit === null) return [];
    const used = m.value(u);
    const pct = limit ? Math.round((used / limit) * 1000) / 10 : 0;
    const level = pct >= 90 ? 90 : pct >= 70 ? 70 : 0;
    return [
      {
        metric: m.id,
        provider: m.provider,
        label: m.label,
        used,
        limit,
        pct,
        level,
        usedText: formatAmount(used, m.unit),
        limitText: limit === null ? 'sin tope' : formatAmount(limit, m.unit),
        plan,
        next: nextPlan(m.provider, u.plans, m.id, used),
        daily: !!m.daily,
      },
    ];
  });

// Alerts not sent yet: the highest level each metric reached, once per period
// (the month, or the day for a daily cap). `sent` holds "period|metric|level".
export const pendingAlerts = (u: InfraUsage, sent: Set<string>, today: string) =>
  usageRows(u)
    .filter((r) => r.level > 0)
    .map((r) => ({ row: r, period: r.daily ? today : u.month }))
    .filter(({ row, period }) => !sent.has(`${period}|${row.metric}|${row.level}`));

export const alertEmail = (rows: UsageRow[]) => {
  const top = Math.max(...rows.map((r) => r.level));
  const subject = top >= 90 ? 'Urgente: un proveedor está al 90% de su plan' : 'Aviso: un proveedor pasó el 70% de su plan';
  const lines = rows.map((r) => {
    const provider = PROVIDERS[r.provider];
    const step = r.next
      ? `Siguiente plan: ${provider.name} ${r.next.name}${r.next.price ? ` ($${r.next.price}/mes)` : ''}${r.next.note ? `. ${r.next.note}` : ''}.`
      : provider.extra ?? 'Ya está en el plan más alto: lo de más se cobra aparte.';
    return `• ${provider.name} (plan ${r.plan.name}): ${r.label} ${r.usedText} de ${r.limitText} (${r.pct}%). ${step}`;
  });
  const body = [
    'Hola Carlos,',
    '',
    'La revisión diaria de consumo de Fans Reserve encontró esto:',
    '',
    ...lines,
    '',
    'Para que el servicio no se pause, sube de plan en la web del proveedor y luego marca el plan nuevo en el panel de administración, pestaña "Consumo". El fondo para proveedores también está ahí.',
  ].join('\n');
  return { subject, body };
};

// Raw row from public.infra_usage() (snake_case) to InfraUsage.
export const fromRpc = (r: Record<string, unknown>): InfraUsage => ({
  month: String(r.month ?? ''),
  measuredAt: String(r.measured_at ?? ''),
  dbBytes: Number(r.db_bytes ?? 0),
  storageBytes: Number(r.storage_bytes ?? 0),
  mau: Number(r.mau ?? 0),
  usersTotal: Number(r.users_total ?? 0),
  emailsMonth: Number(r.emails_month ?? 0),
  emailsToday: Number(r.emails_today ?? 0),
  scansMonth: Number(r.scans_month ?? 0),
  kycMonth: Number(r.kyc_month ?? 0),
  videoMinutesMonth: Number(r.video_minutes_month ?? 0),
  plans: (r.plans ?? {}) as InfraUsage['plans'],
  fundPct: Number(r.fund_pct ?? 10),
});
