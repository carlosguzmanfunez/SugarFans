import { localBackend } from './local';
import { createSupabaseBackend } from './supabase';
import type { Backend } from './types';

export * from './types';
export { defaultSettings, DEMO_PASSWORD } from './shared';

// Read before the Supabase client consumes the URL: the emailed "new password"
// link lands with #...type=recovery, possibly on the home page.
export const openedFromRecoveryLink = typeof window !== 'undefined' && /type=recovery/.test(window.location.hash);

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Supabase when configured; otherwise a browser-only store (dev and offline tests).
export const backend: Backend = url && key ? createSupabaseBackend(url, key) : localBackend;
