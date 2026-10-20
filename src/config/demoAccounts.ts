// Historical demo identities are retained for labels and for denying real Auth.
// Credentials and access buttons exist only in an explicit disconnected build.
export const offlineDemoEnabled = import.meta.env?.MODE === 'offline'
  && !import.meta.env.VITE_SUPABASE_URL && !import.meta.env.VITE_SUPABASE_ANON_KEY;

export type DemoRole = 'fan' | 'creator' | 'admin';

export interface DemoAccount {
  role: DemoRole;
  label: string;
  description: string;
  icon: string; // Font Awesome class
  email: string; // internal Auth identity, never displayed
  password: string;
}

export const DEMO_PASSWORD = offlineDemoEnabled ? 'demo1234' : '';

const DEMO_IDENTITIES: Omit<DemoAccount, 'password'>[] = [
  { role: 'fan', label: 'Demo Fan', description: 'Explora, suscríbete y envía regalos', icon: 'fa-heart', email: 'fan@sugarfans.com' },
  { role: 'creator', label: 'Demo Creator', description: 'Panel de creador, contenido y ganancias', icon: 'fa-star', email: 'creator@sugarfans.com' },
  { role: 'admin', label: 'Demo Admin', description: 'Moderación, verificaciones y pagos', icon: 'fa-shield-halved', email: 'admin@sugarfans.com' },
];

export const DEMO_ACCOUNTS: DemoAccount[] = offlineDemoEnabled
  ? DEMO_IDENTITIES.map((identity) => ({ ...identity, password: DEMO_PASSWORD }))
  : [];

export const demoAccount = (role: DemoRole) => DEMO_ACCOUNTS.find((a) => a.role === role)!;

const byEmail = (email?: string | null) => DEMO_IDENTITIES.find((a) => a.email === (email ?? '').trim().toLowerCase());

export const isDemoEmail = (email?: string | null) => !!byEmail(email);

// What the UI shows instead of a demo account's internal email.
export const displayEmail = (email?: string | null) => {
  const demo = byEmail(email);
  return demo ? `Cuenta ${demo.label}` : (email ?? '');
};
