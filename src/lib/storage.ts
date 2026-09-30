// Small persistence layer on top of localStorage.
// Every read/write is guarded so a blocked or full storage never crashes the app.
// This is the single place to swap for a real backend (e.g. Supabase) later.

const PREFIX = 'sugarfans_';

export const readJSON = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const writeJSON = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): keep working in memory.
  }
};

export const removeKey = (key: string): void => {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
};

// Demo-grade password hashing (salted SHA-256). This is a client-side prototype:
// real authentication must live on a server.
export const hashPassword = async (password: string, salt: string): Promise<string> => {
  const input = `${salt}:${password}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for non-secure contexts where crypto.subtle is missing (FNV-1a).
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv${(h >>> 0).toString(16)}`;
};

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
