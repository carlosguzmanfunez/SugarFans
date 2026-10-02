// Demo accounts for TEST MODE (shown on the login page until the site goes live).
//
// INTERNAL vs DISPLAY. The emails below are the real Supabase Auth identities of
// the demo accounts and come from the previous brand. They must stay as they are
// (renaming them means migrating Auth), so the UI never shows them: the login
// page offers "Demo Fan / Demo Creator / Demo Admin" and signs in with these
// credentials, and anywhere a demo user's email would be shown, displayEmail()
// shows the account label instead.

export type DemoRole = 'fan' | 'creator' | 'admin';

export interface DemoAccount {
  role: DemoRole;
  label: string;
  description: string;
  icon: string; // Font Awesome class
  email: string; // internal Auth identity, never displayed
  password: string;
}

export const DEMO_PASSWORD = 'demo1234';

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { role: 'fan', label: 'Demo Fan', description: 'Explora, suscríbete y envía regalos', icon: 'fa-heart', email: 'fan@sugarfans.com', password: DEMO_PASSWORD },
  { role: 'creator', label: 'Demo Creator', description: 'Panel de creador, contenido y ganancias', icon: 'fa-star', email: 'creator@sugarfans.com', password: DEMO_PASSWORD },
  { role: 'admin', label: 'Demo Admin', description: 'Moderación, verificaciones y pagos', icon: 'fa-shield-halved', email: 'admin@sugarfans.com', password: DEMO_PASSWORD },
];

export const demoAccount = (role: DemoRole) => DEMO_ACCOUNTS.find((a) => a.role === role)!;

const byEmail = (email?: string | null) => DEMO_ACCOUNTS.find((a) => a.email === (email ?? '').trim().toLowerCase());

export const isDemoEmail = (email?: string | null) => !!byEmail(email);

// What the UI shows instead of a demo account's internal email.
export const displayEmail = (email?: string | null) => {
  const demo = byEmail(email);
  return demo ? `Cuenta ${demo.label}` : (email ?? '');
};
