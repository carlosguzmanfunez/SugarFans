import { safePath } from './safePath';

// Where to come back after signing in, kept on the device for a while so it
// survives creating an account, the trip to Google and the confirmation email
// (which can open in a new tab). Example: a fan taking a live slot.
const KEY = 'return_to';
const TTL_MS = 60 * 60_000;

export const rememberReturn = (path: string) => {
  try { localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() })); } catch { /* private mode */ }
};

export const peekReturn = (): string | undefined => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as { path?: string; at?: number } | null;
    if (!saved || typeof saved.at !== 'number' || Date.now() - saved.at > TTL_MS) return undefined;
    return safePath(saved.path);
  } catch {
    return undefined;
  }
};

export const clearReturn = () => {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
};

export const takeReturn = (): string | undefined => {
  const path = peekReturn();
  clearReturn();
  return path;
};
