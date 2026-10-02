// Moves browser data saved under the previous storage prefix to the current
// one, once, so language, "remember me", referral links and offline data
// survive the rename. Imported first in main.tsx, before anything reads storage.
import { BRAND, LEGACY_STORAGE_PREFIX } from './brand';

const migrate = (store: Storage) => {
  const legacy: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(LEGACY_STORAGE_PREFIX)) legacy.push(key);
  }
  for (const key of legacy) {
    const next = BRAND.storagePrefix + key.slice(LEGACY_STORAGE_PREFIX.length);
    const value = store.getItem(key);
    if (value !== null && store.getItem(next) === null) store.setItem(next, value);
    store.removeItem(key);
  }
};

try {
  migrate(localStorage);
  migrate(sessionStorage);
} catch {
  // Storage blocked: nothing to carry over.
}
