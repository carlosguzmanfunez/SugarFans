import { localBackend } from './local';
import { createSupabaseBackend } from './supabase';
import type { Backend } from './types';
import { offlineDemoEnabled } from '../../config/demoAccounts';

export * from './types';
export { defaultSettings, DEMO_PASSWORD, PAID_WITH_PAYPAL } from './shared';

// Read before the Supabase client consumes the URL: the emailed "new password"
// link lands with #...type=recovery, possibly on the home page.
export const openedFromRecoveryLink = typeof window !== 'undefined' && /type=recovery/.test(window.location.hash);

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const missingBackend = (): never => { throw new Error('Falta la configuración de autenticación. Contacta con soporte.'); };
// A published build must not silently become a local authentication demo.
export const backend: Backend = url && key ? createSupabaseBackend(url, key)
  : offlineDemoEnabled ? localBackend : missingBackend();
