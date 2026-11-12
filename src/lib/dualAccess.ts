// Cuentas dobles: the personal code from the private link (?acceso=...) is kept on
// this device until the account it creates (or signs in to) is activated as fan +
// creator by DualAccessClaimer.
import { readJSON, removeKey, writeJSON } from './storage';

const KEY = 'dualCode';
export const saveDualCode = (code: string) => writeJSON(KEY, code);
export const readDualCode = () => readJSON<string | null>(KEY, null);
export const clearDualCode = () => removeKey(KEY);
