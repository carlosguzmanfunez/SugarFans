// Shared platform data behind the promises made in the Help/Pricing FAQs:
// identity verification, payment methods and charges, creator payouts, reports and blocks.
// It is stored in one localStorage key so admins and users in this browser see the same data.
//
// Integration points (see INTEGRATIONS.md): every place that would call an external
// service in production is a single function here, marked with "INTEGRATION".

import { useSyncExternalStore } from 'react';
import { readJSON, writeJSONChecked, newId } from './storage';
import type { User } from '../context/AuthContext';

export interface Result {
  ok: boolean;
  error?: string;
}

// ---------- Types ----------

export type DocType = 'dni' | 'passport' | 'license';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface VerificationRequest {
  id: string;
  userId: string;
  userName: string;
  email: string;
  role: User['role'];
  legalName: string;
  birthDate: string;
  country: string;
  docType: DocType;
  docNumber: string;
  docFront: string; // data URL (downscaled JPEG)
  docBack?: string;
  selfie: string;
  status: ReviewStatus;
  rejectionReason?: string;
  submittedAt: string;
  reviewedAt?: string;
}

export type PaymentKind = 'card' | 'bank' | 'crypto';

export interface PaymentMethod {
  id: string;
  userId: string;
  kind: PaymentKind;
  label: string; // "Visa •••• 4242"
  detail: string; // "Expira 12/28", "Banco X", "Red USDT"
  isDefault: boolean;
  createdAt: string;
}

export interface Transaction {
  id: string;
  key: string; // idempotency key, one per billing cycle
  userId: string; // payer ('' once the payer deleted their account)
  payerName: string;
  creatorProfileId: string;
  creatorName: string;
  kind: 'subscription' | 'renewal';
  amount: number;
  methodLabel: string;
  status: 'paid' | 'failed';
  createdAt: string;
}

export interface PayoutAccount {
  holder: string;
  bank: string;
  accountLast4: string;
}

export interface Payout {
  id: string;
  userId: string;
  creatorName: string;
  amount: number;
  accountLabel: string;
  status: 'scheduled' | 'paid' | 'rejected';
  requestedAt: string;
  scheduledFor: string;
  processedAt?: string;
}

export type ReportKind = 'post' | 'creator' | 'support' | 'other';

export interface Report {
  id: string;
  kind: ReportKind;
  targetId?: string;
  targetLabel: string;
  reason: string;
  description: string;
  reporterId?: string;
  reporterName: string;
  contactEmail?: string;
  status: 'pending' | 'resolved' | 'dismissed';
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface Block {
  blockerId: string;
  targetId: string; // a user id, or a public creator profile id
  targetName: string;
  createdAt: string;
}

export interface PlatformData {
  verifications: VerificationRequest[];
  paymentMethods: PaymentMethod[];
  transactions: Transaction[];
  payoutAccounts: Record<string, PayoutAccount>;
  payouts: Payout[];
  reports: Report[];
  blocks: Block[];
  removedPosts: string[];
}

// ---------- Constants ----------

export const CREATOR_SHARE = 0.8;
export const MIN_PAYOUT = 50;
// Earnings the demo creator had before this ledger existed (matches the old hard-coded balance).
const OPENING_BALANCES: Record<string, number> = { 'demo-creator': 1245 };
// Accounts that own a public creator profile from the catalogue.
const PROFILE_BY_ACCOUNT: Record<string, string> = { 'demo-creator': '1' };

export const creatorProfileIdFor = (userId: string): string => PROFILE_BY_ACCOUNT[userId] ?? userId;
export const accountIdForProfile = (profileId: string): string =>
  Object.keys(PROFILE_BY_ACCOUNT).find((k) => PROFILE_BY_ACCOUNT[k] === profileId) ?? profileId;

export const docTypeLabel: Record<DocType, string> = {
  dni: 'Documento nacional de identidad',
  passport: 'Pasaporte',
  license: 'Licencia de conducir',
};

// ---------- Store ----------

const KEY = 'platform';
const SEEDED_KEY = 'platform_seeded_v1';

const empty = (): PlatformData => ({
  verifications: [],
  paymentMethods: [],
  transactions: [],
  payoutAccounts: {},
  payouts: [],
  reports: [],
  blocks: [],
  removedPosts: [],
});

let cache: PlatformData | null = null;
const listeners = new Set<() => void>();

const load = (): PlatformData => {
  if (!cache) {
    cache = { ...empty(), ...readJSON<Partial<PlatformData>>(KEY, {}) };
    if (!readJSON<boolean>(SEEDED_KEY, false)) {
      // The demo fan starts with the card the old settings screen showed.
      if (!cache.paymentMethods.some((m) => m.userId === 'demo-fan')) {
        cache.paymentMethods.push({
          id: newId(),
          userId: 'demo-fan',
          kind: 'card',
          label: 'Visa •••• 4242',
          detail: 'Expira 12/29',
          isDefault: true,
          createdAt: new Date().toISOString(),
        });
      }
      writeJSONChecked(KEY, cache);
      writeJSONChecked(SEEDED_KEY, true);
    }
  }
  return cache;
};

const emit = () => listeners.forEach((l) => l());

const commit = (fn: (d: PlatformData) => PlatformData): Result => {
  const next = fn(load());
  if (!writeJSONChecked(KEY, next)) {
    return { ok: false, error: 'No se pudo guardar: el almacenamiento del navegador está lleno' };
  }
  cache = next;
  emit();
  return { ok: true };
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === 'sugarfans_' + KEY) {
      cache = null;
      emit();
    }
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const usePlatform = (): PlatformData => useSyncExternalStore(subscribe, load);
export const getPlatform = load;

// ---------- Helpers ----------

const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;
export const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ageFrom = (birthDate: string) => {
  const b = new Date(birthDate + 'T00:00:00');
  const t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--;
  return age;
};

// Same day of month, clamped to shorter months (Jan 31 -> Feb 28).
export const addMonths = (iso: string, months: number): Date => {
  const d = new Date(iso);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1, d.getHours(), d.getMinutes(), d.getSeconds());
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
};

export const nextRenewal = (since: string, at = new Date()): Date => {
  let n = 1;
  while (addMonths(since, n) <= at) n++;
  return addMonths(since, n);
};

export const firstOfNextMonth = (at = new Date()) => new Date(at.getFullYear(), at.getMonth() + 1, 1);

// ---------- Identity verification ----------

export const latestVerification = (d: PlatformData, userId: string): VerificationRequest | undefined =>
  [...d.verifications].reverse().find((v) => v.userId === userId);

export const isIdentityVerified = (d: PlatformData, user: Pick<User, 'id' | 'isVerified'> | null | undefined) =>
  !!user && (!!user.isVerified || latestVerification(d, user.id)?.status === 'approved');

export interface VerificationInput {
  legalName: string;
  birthDate: string;
  country: string;
  docType: DocType;
  docNumber: string;
  docFront: string;
  docBack?: string;
  selfie: string;
}

// INTEGRATION: in production send the images to a KYC provider (Stripe Identity, Veriff, Onfido)
// and store only the provider's session id + result; here an admin reviews them by hand.
export const submitVerification = (user: User, input: VerificationInput): Result => {
  if (input.legalName.trim().split(/\s+/).length < 2) return { ok: false, error: 'Escribe tu nombre completo como aparece en el documento' };
  if (!input.birthDate || Number.isNaN(new Date(input.birthDate).getTime())) return { ok: false, error: 'Indica tu fecha de nacimiento' };
  if (ageFrom(input.birthDate) < 18) return { ok: false, error: 'Debes ser mayor de 18 años' };
  if (!input.country.trim()) return { ok: false, error: 'Indica el país que emitió el documento' };
  if (!/^[A-Za-z0-9-]{5,20}$/.test(input.docNumber.trim())) return { ok: false, error: 'El número de documento no es válido' };
  if (!input.docFront) return { ok: false, error: 'Sube la foto del frente del documento' };
  if (input.docType !== 'passport' && !input.docBack) return { ok: false, error: 'Sube la foto del reverso del documento' };
  if (!input.selfie) return { ok: false, error: 'Sube un selfie sosteniendo tu documento' };
  const current = latestVerification(load(), user.id);
  if (current?.status === 'pending') return { ok: false, error: 'Ya tienes una solicitud en revisión' };
  if (current?.status === 'approved' || user.isVerified) return { ok: false, error: 'Tu identidad ya está verificada' };
  return commit((d) => ({
    ...d,
    // Keep only the latest request per user so old document images don't pile up.
    verifications: [
      ...d.verifications.filter((v) => v.userId !== user.id),
      {
        id: newId(),
        userId: user.id,
        userName: user.name,
        email: user.email,
        role: user.role,
        legalName: input.legalName.trim(),
        birthDate: input.birthDate,
        country: input.country.trim(),
        docType: input.docType,
        docNumber: input.docNumber.trim().toUpperCase(),
        docFront: input.docFront,
        docBack: input.docType === 'passport' ? undefined : input.docBack,
        selfie: input.selfie,
        status: 'pending',
        submittedAt: now(),
      },
    ],
  }));
};

export const reviewVerification = (id: string, approve: boolean, reason = ''): Result => {
  if (!approve && !reason.trim()) return { ok: false, error: 'Indica el motivo del rechazo' };
  return commit((d) => ({
    ...d,
    verifications: d.verifications.map((v) =>
      v.id === id
        ? {
            ...v,
            status: approve ? 'approved' : 'rejected',
            rejectionReason: approve ? undefined : reason.trim(),
            reviewedAt: now(),
            // Documents are no longer needed once reviewed (data minimisation).
            docFront: approve ? '' : v.docFront,
            docBack: approve ? undefined : v.docBack,
            selfie: approve ? '' : v.selfie,
          }
        : v
    ),
  }));
};

// Downscale an uploaded photo so several fit in browser storage.
export const readImageFile = (file: File, maxSize = 900): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('El archivo debe ser una imagen (JPG o PNG)'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('La imagen supera los 10 MB'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(String(reader.result));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

// ---------- Payment methods ----------

export const methodsFor = (d: PlatformData, userId: string) => d.paymentMethods.filter((m) => m.userId === userId);
export const defaultMethodFor = (d: PlatformData, userId: string) => {
  const mine = methodsFor(d, userId);
  return mine.find((m) => m.isDefault) ?? mine[0];
};

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
};

export const cardBrand = (digits: string) => {
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'Amex';
  if (/^6/.test(digits)) return 'Discover';
  return 'Tarjeta';
};

export type PaymentMethodInput =
  | { kind: 'card'; holder: string; number: string; expiry: string; cvc: string }
  | { kind: 'bank'; holder: string; bank: string; account: string }
  | { kind: 'crypto'; network: 'BTC' | 'ETH' | 'USDT'; wallet: string };

// INTEGRATION: in production the card is tokenised by the payment gateway (Stripe Elements,
// PayPal, etc.) and only the token + last 4 digits reach our storage. We never keep the full
// number or the CVC here either.
export const addPaymentMethod = (userId: string, input: PaymentMethodInput): Result & { id?: string } => {
  let label = '';
  let detail = '';
  if (input.kind === 'card') {
    const digits = input.number.replace(/\D/g, '');
    if (!input.holder.trim()) return { ok: false, error: 'Escribe el nombre del titular' };
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return { ok: false, error: 'El número de tarjeta no es válido' };
    const m = input.expiry.trim().match(/^(\d{2})\s*\/\s*(\d{2})$/);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return { ok: false, error: 'La fecha de expiración debe tener el formato MM/AA' };
    const expEnd = new Date(2000 + Number(m[2]), Number(m[1]), 1);
    if (expEnd <= new Date()) return { ok: false, error: 'La tarjeta está vencida' };
    if (!/^\d{3,4}$/.test(input.cvc.trim())) return { ok: false, error: 'El CVC no es válido' };
    label = `${cardBrand(digits)} •••• ${digits.slice(-4)}`;
    detail = `Expira ${m[1]}/${m[2]}`;
  } else if (input.kind === 'bank') {
    const account = input.account.replace(/\s/g, '');
    if (!input.holder.trim()) return { ok: false, error: 'Escribe el nombre del titular' };
    if (!input.bank.trim()) return { ok: false, error: 'Escribe el nombre del banco' };
    if (!/^[A-Za-z0-9]{8,34}$/.test(account)) return { ok: false, error: 'La cuenta o IBAN no es válido' };
    label = `Transferencia •••• ${account.slice(-4)}`;
    detail = input.bank.trim();
  } else {
    const wallet = input.wallet.trim();
    const valid =
      input.network === 'BTC' ? /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(wallet) : /^0x[a-fA-F0-9]{40}$/.test(wallet);
    if (!valid) return { ok: false, error: `La dirección de wallet ${input.network} no es válida` };
    label = `${input.network} ${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
    detail = input.network === 'USDT' ? 'USDT (ERC-20)' : input.network === 'BTC' ? 'Bitcoin' : 'Ethereum';
  }
  const id = newId();
  const result = commit((d) => {
    const isFirst = !methodsFor(d, userId).length;
    return {
      ...d,
      paymentMethods: [...d.paymentMethods, { id, userId, kind: input.kind, label, detail, isDefault: isFirst, createdAt: now() }],
    };
  });
  return result.ok ? { ok: true, id } : result;
};

export const removePaymentMethod = (userId: string, id: string): Result =>
  commit((d) => {
    const rest = d.paymentMethods.filter((m) => !(m.id === id && m.userId === userId));
    const mine = rest.filter((m) => m.userId === userId);
    if (mine.length && !mine.some((m) => m.isDefault)) mine[0] = { ...mine[0], isDefault: true };
    return { ...d, paymentMethods: [...rest.filter((m) => m.userId !== userId), ...mine] };
  });

export const setDefaultPaymentMethod = (userId: string, id: string): Result =>
  commit((d) => ({
    ...d,
    paymentMethods: d.paymentMethods.map((m) => (m.userId === userId ? { ...m, isDefault: m.id === id } : m)),
  }));

// ---------- Charges and renewals ----------

// INTEGRATION: this is where the gateway would be charged (Stripe PaymentIntent / PayPal order).
// Returns the recorded transaction; a real gateway call may also fail here.
export const chargeSubscription = (
  payer: Pick<User, 'id' | 'name'>,
  creatorProfileId: string,
  creatorName: string,
  amount: number,
  methodId: string
): Result => {
  const d = load();
  const method = methodsFor(d, payer.id).find((m) => m.id === methodId);
  if (!method) return { ok: false, error: 'Elige un método de pago' };
  if (isBlockedEitherWay(d, payer.id, creatorProfileId)) return { ok: false, error: 'No puedes suscribirte a este perfil' };
  return commit((data) => ({
    ...data,
    transactions: [
      ...data.transactions,
      {
        id: newId(),
        key: `sub:${payer.id}:${creatorProfileId}:${now()}`,
        userId: payer.id,
        payerName: payer.name,
        creatorProfileId,
        creatorName,
        kind: 'subscription',
        amount: round2(amount),
        methodLabel: method.label,
        status: 'paid',
        createdAt: now(),
      },
    ],
  }));
};

// Bill every monthly cycle that has come due since each subscription started (idempotent).
// INTEGRATION: in production the gateway's recurring billing + a webhook does this server-side.
export const syncRenewals = (user: Pick<User, 'id' | 'name' | 'subscriptions'>, creatorNames: Record<string, string>) => {
  const d = load();
  const method = defaultMethodFor(d, user.id);
  const at = new Date();
  const missing: Transaction[] = [];
  for (const sub of user.subscriptions) {
    if (isBlockedEitherWay(d, user.id, sub.creatorId)) continue;
    for (let n = 1; addMonths(sub.since, n) <= at; n++) {
      const key = `renew:${user.id}:${sub.creatorId}:${sub.since}:${n}`;
      if (d.transactions.some((t) => t.key === key)) continue;
      missing.push({
        id: newId(),
        key,
        userId: user.id,
        payerName: user.name,
        creatorProfileId: sub.creatorId,
        creatorName: creatorNames[sub.creatorId] ?? 'Creador',
        kind: 'renewal',
        amount: round2(sub.price),
        methodLabel: method?.label ?? 'Sin método de pago',
        status: method ? 'paid' : 'failed',
        createdAt: addMonths(sub.since, n).toISOString(),
      });
    }
  }
  if (missing.length) commit((data) => ({ ...data, transactions: [...data.transactions, ...missing] }));
};

export const transactionsFor = (d: PlatformData, userId: string) =>
  d.transactions.filter((t) => t.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

// ---------- Creator earnings and payouts ----------

export const creatorSales = (d: PlatformData, creatorUserId: string) => {
  const profileId = creatorProfileIdFor(creatorUserId);
  return d.transactions
    .filter((t) => t.creatorProfileId === profileId && t.status === 'paid')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const creatorEarnings = (d: PlatformData, creatorUserId: string) => {
  const sales = creatorSales(d, creatorUserId);
  const opening = OPENING_BALANCES[creatorUserId] ?? 0;
  const gross = sales.reduce((s, t) => s + t.amount, 0);
  const net = round2(gross * CREATOR_SHARE);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const thisMonth = round2(sales.filter((t) => t.createdAt >= monthStart).reduce((s, t) => s + t.amount, 0) * CREATOR_SHARE);
  const payouts = d.payouts.filter((p) => p.userId === creatorUserId);
  const withdrawn = payouts.filter((p) => p.status !== 'rejected').reduce((s, p) => s + p.amount, 0);
  return {
    opening,
    gross: round2(gross),
    net,
    thisMonth,
    totalEarned: round2(opening + net),
    available: round2(opening + net - withdrawn),
    payouts: [...payouts].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
  };
};

// INTEGRATION: payouts would go through Stripe Connect / PayPal Payouts on the scheduled date.
export const setPayoutAccount = (userId: string, holder: string, bank: string, account: string): Result => {
  const clean = account.replace(/\s/g, '');
  if (!holder.trim()) return { ok: false, error: 'Escribe el nombre del titular' };
  if (!bank.trim()) return { ok: false, error: 'Escribe el nombre del banco' };
  if (!/^[A-Za-z0-9]{8,34}$/.test(clean)) return { ok: false, error: 'La cuenta o IBAN no es válido' };
  return commit((d) => ({
    ...d,
    payoutAccounts: { ...d.payoutAccounts, [userId]: { holder: holder.trim(), bank: bank.trim(), accountLast4: clean.slice(-4) } },
  }));
};

export const requestPayout = (user: User, amount: number): Result => {
  const d = load();
  if (user.role !== 'creator') return { ok: false, error: 'Solo los creadores pueden retirar' };
  if (!isIdentityVerified(d, user)) return { ok: false, error: 'Verifica tu identidad antes de solicitar un retiro' };
  const account = d.payoutAccounts[user.id];
  if (!account) return { ok: false, error: 'Añade una cuenta bancaria para retiros' };
  if (!(amount >= MIN_PAYOUT)) return { ok: false, error: `El mínimo de retiro es ${money(MIN_PAYOUT)} USD` };
  const { available } = creatorEarnings(d, user.id);
  if (amount > available) return { ok: false, error: `Tu saldo disponible es ${money(available)}` };
  return commit((data) => ({
    ...data,
    payouts: [
      ...data.payouts,
      {
        id: newId(),
        userId: user.id,
        creatorName: user.name,
        amount: round2(amount),
        accountLabel: `${account.bank} •••• ${account.accountLast4}`,
        status: 'scheduled',
        requestedAt: now(),
        scheduledFor: firstOfNextMonth().toISOString(),
      },
    ],
  }));
};

export const processPayout = (id: string, paid: boolean): Result =>
  commit((d) => ({
    ...d,
    payouts: d.payouts.map((p) => (p.id === id ? { ...p, status: paid ? 'paid' : 'rejected', processedAt: now() } : p)),
  }));

// ---------- Reports ----------

export interface ReportInput {
  kind: ReportKind;
  targetId?: string;
  targetLabel: string;
  reason: string;
  description: string;
  contactEmail?: string;
}

export const submitReport = (reporter: Pick<User, 'id' | 'name' | 'email'> | null, input: ReportInput): Result & { id?: string } => {
  if (!input.reason) return { ok: false, error: 'Elige un motivo' };
  if (input.description.trim().length < 10) return { ok: false, error: 'Describe el problema (mínimo 10 caracteres)' };
  const email = reporter?.email ?? input.contactEmail?.trim();
  if (!reporter && !(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false, error: 'Deja un email de contacto válido' };
  }
  const id = newId();
  const result = commit((d) => ({
    ...d,
    reports: [
      ...d.reports,
      {
        id,
        kind: input.kind,
        targetId: input.targetId,
        targetLabel: input.targetLabel.trim() || 'Sin especificar',
        reason: input.reason,
        description: input.description.trim(),
        reporterId: reporter?.id,
        reporterName: reporter?.name ?? 'Visitante',
        contactEmail: email,
        status: 'pending',
        createdAt: now(),
      },
    ],
  }));
  return result.ok ? { ok: true, id } : result;
};

export const resolveReport = (id: string, action: 'remove' | 'resolve' | 'dismiss'): Result =>
  commit((d) => {
    const report = d.reports.find((r) => r.id === id);
    const removePost = action === 'remove' && report?.kind === 'post' && report.targetId;
    return {
      ...d,
      removedPosts: removePost ? [...new Set([...d.removedPosts, report!.targetId!])] : d.removedPosts,
      reports: d.reports.map((r) =>
        r.id === id
          ? {
              ...r,
              status: action === 'dismiss' ? 'dismissed' : 'resolved',
              resolution: action === 'remove' ? 'Contenido retirado' : action === 'resolve' ? 'Atendido' : 'Descartado',
              resolvedAt: now(),
            }
          : r
      ),
    };
  });

export const restorePost = (postId: string): Result =>
  commit((d) => ({ ...d, removedPosts: d.removedPosts.filter((p) => p !== postId) }));

// ---------- Blocks ----------

export const blocksBy = (d: PlatformData, userId: string) => d.blocks.filter((b) => b.blockerId === userId);
export const hasBlocked = (d: PlatformData, blockerId: string, targetId: string) =>
  d.blocks.some((b) => b.blockerId === blockerId && b.targetId === targetId);

// A fan and a creator profile are cut off if either side blocked the other.
export const isBlockedEitherWay = (d: PlatformData, fanId: string, creatorProfileId: string) =>
  hasBlocked(d, fanId, creatorProfileId) || hasBlocked(d, accountIdForProfile(creatorProfileId), fanId);

export const blockUser = (blockerId: string, targetId: string, targetName: string): Result =>
  hasBlocked(load(), blockerId, targetId)
    ? { ok: true }
    : commit((d) => ({ ...d, blocks: [...d.blocks, { blockerId, targetId, targetName, createdAt: now() }] }));

export const unblockUser = (blockerId: string, targetId: string): Result =>
  commit((d) => ({ ...d, blocks: d.blocks.filter((b) => !(b.blockerId === blockerId && b.targetId === targetId)) }));

// ---------- Account data (GDPR) ----------

export const exportUserData = (user: User) => {
  const d = load();
  return {
    exportedAt: now(),
    account: user,
    identityVerification: d.verifications
      .filter((v) => v.userId === user.id)
      .map(({ docFront: _f, docBack: _b, selfie: _s, ...rest }) => rest),
    paymentMethods: methodsFor(d, user.id),
    payments: transactionsFor(d, user.id),
    payoutAccount: d.payoutAccounts[user.id] ?? null,
    payouts: d.payouts.filter((p) => p.userId === user.id),
    reportsSent: d.reports.filter((r) => r.reporterId === user.id),
    blockedUsers: blocksBy(d, user.id),
  };
};

// Remove personal data when an account is deleted; sales stay in creators' books, anonymised.
export const purgeUserData = (userId: string): Result =>
  commit((d) => {
    const { [userId]: _removed, ...payoutAccounts } = d.payoutAccounts;
    return {
      ...d,
      verifications: d.verifications.filter((v) => v.userId !== userId),
      paymentMethods: d.paymentMethods.filter((m) => m.userId !== userId),
      transactions: d.transactions.map((t) => (t.userId === userId ? { ...t, userId: '', payerName: 'Cuenta eliminada' } : t)),
      payoutAccounts,
      reports: d.reports.map((r) => (r.reporterId === userId ? { ...r, reporterId: undefined, reporterName: 'Cuenta eliminada' } : r)),
      blocks: d.blocks.filter((b) => b.blockerId !== userId && b.targetId !== userId),
    };
  });
