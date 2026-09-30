// Pure rules shared by the UI and both backends: validation, dates and money.
import type {
  DocType,
  NewPaymentMethod,
  Payout,
  PayoutAccount,
  ReportInput,
  Transaction,
  VerificationInput,
} from './backend/platformTypes';

export const CREATOR_SHARE = 0.8;
export const MIN_PAYOUT = 50;
// Earnings the demo creator (public profile 1) had before the ledger existed.
export const OPENING_BALANCES: Record<string, number> = { '1': 1245 };

export const docTypeLabel: Record<DocType, string> = {
  dni: 'Documento nacional de identidad',
  passport: 'Pasaporte',
  license: 'Licencia de conducir',
};

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Same day of month, clamped to shorter months (Jan 31 -> Feb 28), like Postgres intervals.
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

export const ageFrom = (birthDate: string, at = new Date()) => {
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = at.getFullYear() - y;
  if (at.getMonth() + 1 < m || (at.getMonth() + 1 === m && at.getDate() < d)) age--;
  return age;
};

type Check = { ok: true } | { ok: false; error: string };
const bad = (error: string): Check => ({ ok: false, error });
const good: Check = { ok: true };

export const validateVerification = (input: VerificationInput): Check => {
  if (input.legalName.trim().split(/\s+/).length < 2) return bad('Escribe tu nombre completo como aparece en el documento');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) return bad('Indica tu fecha de nacimiento');
  if (ageFrom(input.birthDate) < 18) return bad('Debes ser mayor de 18 años');
  if (!input.country.trim()) return bad('Indica el país que emitió el documento');
  if (!/^[A-Za-z0-9-]{5,20}$/.test(input.docNumber.trim())) return bad('El número de documento no es válido');
  if (!input.docFront) return bad('Sube la foto del frente del documento');
  if (input.docType !== 'passport' && !input.docBack) return bad('Sube la foto del reverso del documento');
  if (!input.selfie) return bad('Sube un selfie sosteniendo tu documento');
  return good;
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

const accountOk = (account: string) => /^[A-Za-z0-9]{8,34}$/.test(account);

// Validates what the user typed and returns only the masked data we keep.
// INTEGRATION: with a real gateway (Stripe Elements, PayPal) the card is tokenised
// in the browser and only the token + brand + last 4 reach our backend.
export const buildPaymentMethod = (input: PaymentMethodInput): { method?: NewPaymentMethod; error?: string } => {
  if (input.kind === 'card') {
    const digits = input.number.replace(/\D/g, '');
    if (!input.holder.trim()) return { error: 'Escribe el nombre del titular' };
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return { error: 'El número de tarjeta no es válido' };
    const m = input.expiry.trim().match(/^(\d{2})\s*\/\s*(\d{2})$/);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return { error: 'La fecha de expiración debe tener el formato MM/AA' };
    if (new Date(2000 + Number(m[2]), Number(m[1]), 1) <= new Date()) return { error: 'La tarjeta está vencida' };
    if (!/^\d{3,4}$/.test(input.cvc.trim())) return { error: 'El CVC no es válido' };
    return { method: { kind: 'card', label: `${cardBrand(digits)} •••• ${digits.slice(-4)}`, detail: `Expira ${m[1]}/${m[2]}` } };
  }
  if (input.kind === 'bank') {
    const account = input.account.replace(/\s/g, '');
    if (!input.holder.trim()) return { error: 'Escribe el nombre del titular' };
    if (!input.bank.trim()) return { error: 'Escribe el nombre del banco' };
    if (!accountOk(account)) return { error: 'La cuenta o IBAN no es válido' };
    return { method: { kind: 'bank', label: `Transferencia •••• ${account.slice(-4)}`, detail: input.bank.trim() } };
  }
  const wallet = input.wallet.trim();
  const valid =
    input.network === 'BTC' ? /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(wallet) : /^0x[a-fA-F0-9]{40}$/.test(wallet);
  if (!valid) return { error: `La dirección de wallet ${input.network} no es válida` };
  const detail = input.network === 'USDT' ? 'USDT (ERC-20)' : input.network === 'BTC' ? 'Bitcoin' : 'Ethereum';
  return { method: { kind: 'crypto', label: `${input.network} ${wallet.slice(0, 6)}…${wallet.slice(-4)}`, detail } };
};

export const buildPayoutAccount = (holder: string, bank: string, account: string): { account?: PayoutAccount; error?: string } => {
  const clean = account.replace(/\s/g, '');
  if (!holder.trim()) return { error: 'Escribe el nombre del titular' };
  if (!bank.trim()) return { error: 'Escribe el nombre del banco' };
  if (!accountOk(clean)) return { error: 'La cuenta o IBAN no es válido' };
  return { account: { holder: holder.trim(), bank: bank.trim(), accountLast4: clean.slice(-4) } };
};

export const validateReport = (input: ReportInput, signedIn: boolean): Check => {
  if (!input.reason) return bad('Elige un motivo');
  if (input.description.trim().length < 10) return bad('Describe el problema (mínimo 10 caracteres)');
  const email = input.contactEmail?.trim();
  if (!signedIn && !(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return bad('Deja un email de contacto válido');
  return good;
};

export const computeEarnings = (opening: number, sales: Transaction[], payouts: Payout[], at = new Date()) => {
  const paid = sales.filter((t) => t.status === 'paid');
  const gross = paid.reduce((s, t) => s + t.amount, 0);
  const net = round2(gross * CREATOR_SHARE);
  const monthStart = new Date(at.getFullYear(), at.getMonth(), 1).toISOString();
  const thisMonth = round2(paid.filter((t) => t.createdAt >= monthStart).reduce((s, t) => s + t.amount, 0) * CREATOR_SHARE);
  const withdrawn = payouts.filter((p) => p.status !== 'rejected').reduce((s, p) => s + p.amount, 0);
  return {
    opening,
    gross: round2(gross),
    net,
    thisMonth,
    totalEarned: round2(opening + net),
    available: round2(opening + net - withdrawn),
  };
};

// Downscale an uploaded photo so it stays small (browser storage / database row).
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

// Tips: fixed amounts or a custom one between $1 and $500.
export const TIP_PRESETS = [2, 5, 10, 20];
export const MIN_TIP = 1;
export const MAX_TIP = 500;
export const validateTip = (amount: number): { ok: boolean; error?: string } =>
  Number.isFinite(amount) && amount >= MIN_TIP && amount <= MAX_TIP
    ? { ok: true }
    : { ok: false, error: `La propina debe estar entre $${MIN_TIP} y $${MAX_TIP}` };

export const transactionLabel: Record<Transaction['kind'], string> = {
  subscription: 'Suscripción',
  renewal: 'Renovación',
  tip: 'Propina',
};
