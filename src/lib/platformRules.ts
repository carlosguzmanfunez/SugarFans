// Pure rules shared by the UI and both backends: validation, dates and money.
import type {
  DocType,
  ManagedProfileInput,
  NewPaymentMethod,
  PaymentKind,
  Payout,
  PayoutAccount,
  ReportInput,
  Transaction,
  VerificationInput,
} from './backend/platformTypes';

export const CREATOR_SHARE = 0.8;
export const MIN_PAYOUT = 50;

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
  if (!input.docFront) return bad('Sube la foto del frente de tu documento');
  if (!input.selfie) return bad('Sube un selfie de frente');
  return good;
};

export const MANAGED_CATEGORIES = ['Modelaje', 'Fitness', 'Lifestyle', 'Arte', 'Música', 'Cocina', 'Gaming', 'Educación', 'Experiencias VIP'];

export const managedAvatar = (username: string) => `https://api.dicebear.com/7.0/adventurer/svg?seed=${encodeURIComponent(username)}`;
export const MANAGED_COVER = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=400&fit=crop';

// Trims the admin's input and fills in default images.
export const buildManagedProfile = (
  input: ManagedProfileInput,
  takenUsernames: string[]
): { profile?: ManagedProfileInput; error?: string } => {
  const name = input.name.trim();
  const username = input.username.trim().replace(/^@/, '').toLowerCase();
  if (name.length < 2) return { error: 'Escribe el nombre del perfil' };
  if (!/^[a-z0-9_]{3,30}$/.test(username)) return { error: 'El usuario debe tener de 3 a 30 letras minúsculas, números o _' };
  if (takenUsernames.includes(username)) return { error: 'Ese nombre de usuario ya existe' };
  if (input.bio.trim().length > 500) return { error: 'La biografía admite hasta 500 caracteres' };
  if (!(input.subscriptionPrice >= 0.99 && input.subscriptionPrice <= 999)) return { error: 'El precio debe estar entre $0.99 y $999' };
  return {
    profile: {
      name,
      username,
      bio: input.bio.trim(),
      avatar: input.avatar || managedAvatar(username),
      cover: input.cover || MANAGED_COVER,
      category: input.category || MANAGED_CATEGORIES[0],
      subscriptionPrice: round2(input.subscriptionPrice),
      isAi: input.isAi,
    },
  };
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

// Only Visa and Mastercard are accepted.
export const cardBrand = (digits: string): 'Visa' | 'Mastercard' | null => {
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)/.test(digits)) return 'Mastercard';
  return null;
};

export type PaymentMethodInput =
  | { kind: 'card'; holder: string; number: string; expiry: string; cvc: string }
  | { kind: 'paypal'; email: string }
  | { kind: 'google_pay'; email: string };

export const paymentKindLabel: Record<PaymentKind, string> = { card: 'Tarjeta', paypal: 'PayPal', google_pay: 'Google Pay' };

const emailOk = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}•••@${domain}`;
};

const accountOk = (account: string) => /^[A-Za-z0-9]{8,34}$/.test(account);

// Validates what the user typed and returns only the masked data we keep.
// INTEGRATION: with a real gateway the card is tokenised in the browser (Stripe
// Elements), PayPal is linked with the PayPal JS SDK (vaulted billing agreement)
// and Google Pay returns a token through Stripe's Payment Request button; only the
// token + brand + last 4 / account email reach our backend.
export const buildPaymentMethod = (input: PaymentMethodInput): { method?: NewPaymentMethod; error?: string } => {
  if (input.kind === 'card') {
    const digits = input.number.replace(/\D/g, '');
    if (!input.holder.trim()) return { error: 'Escribe el nombre del titular' };
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return { error: 'El número de tarjeta no es válido' };
    const brand = cardBrand(digits);
    if (!brand) return { error: 'Solo aceptamos tarjetas Visa y Mastercard' };
    const m = input.expiry.trim().match(/^(\d{2})\s*\/\s*(\d{2})$/);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return { error: 'La fecha de expiración debe tener el formato MM/AA' };
    if (new Date(2000 + Number(m[2]), Number(m[1]), 1) <= new Date()) return { error: 'La tarjeta está vencida' };
    if (!/^\d{3,4}$/.test(input.cvc.trim())) return { error: 'El CVC no es válido' };
    return { method: { kind: 'card', label: `${brand} •••• ${digits.slice(-4)}`, detail: `Expira ${m[1]}/${m[2]}` } };
  }
  const email = input.email.trim().toLowerCase();
  const name = paymentKindLabel[input.kind];
  if (!emailOk(email)) return { error: `Escribe el email de tu cuenta de ${name}` };
  return { method: { kind: input.kind, label: `${name} · ${maskEmail(email)}`, detail: input.kind === 'paypal' ? 'Cuenta PayPal' : 'Cuenta de Google' } };
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

// The creator keeps 80% of what fans paid, minus what they already withdrew.
export const computeEarnings = (sales: Transaction[], payouts: Payout[], at = new Date()) => {
  const paid = sales.filter((t) => t.status === 'paid');
  const gross = paid.reduce((s, t) => s + t.amount, 0);
  const net = round2(gross * CREATOR_SHARE);
  const monthStart = new Date(at.getFullYear(), at.getMonth(), 1).toISOString();
  const thisMonth = round2(paid.filter((t) => t.createdAt >= monthStart).reduce((s, t) => s + t.amount, 0) * CREATOR_SHARE);
  const withdrawn = payouts.reduce((s, p) => s + p.amount, 0);
  return {
    gross: round2(gross),
    net,
    thisMonth,
    totalEarned: net,
    withdrawn: round2(withdrawn),
    available: round2(net - withdrawn),
  };
};

// Payouts settle by themselves once their date arrives (no admin step).
export const settlePayout = (p: Payout, at = new Date()): Payout =>
  p.status === 'scheduled' && new Date(p.scheduledFor) <= at ? { ...p, status: 'paid', paidAt: p.scheduledFor } : p;

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
