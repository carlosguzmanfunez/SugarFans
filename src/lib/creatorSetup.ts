import { readJSON, writeJSON } from './storage';

export const FIRST_STEPS_PATH = '/creator/dashboard#primeros-pasos';
export type CreatorSetupStep = 'photo' | 'bio' | 'socials' | 'verify' | 'post' | 'reserve' | 'payout';

// Didit's callback drops our query. Keep only this tab's origin, for one hour,
// bound to the signed-in creator; no URL or identity document is stored.
const verificationKey = 'creator_setup_verification_v1';
export const rememberSetupVerification = (userId: string) => {
  try { sessionStorage.setItem(verificationKey, JSON.stringify({ userId, at: Date.now() })); } catch { /* Storage can be unavailable. */ }
};
export const clearSetupVerification = () => {
  try { sessionStorage.removeItem(verificationKey); } catch { /* No stored origin. */ }
};
export const hasSetupVerification = (userId: string) => {
  try {
    const value = JSON.parse(sessionStorage.getItem(verificationKey) || 'null');
    return value?.userId === userId && typeof value.at === 'number' && Date.now() >= value.at && Date.now() - value.at < 3_600_000;
  } catch { return false; }
};

export const setupPath = (path: string, step: CreatorSetupStep) => {
  const [route, hash] = path.split('#');
  const [pathname, query] = route.split('?');
  const params = new URLSearchParams(query);
  params.set('setup', step);
  return `${pathname}?${params}${hash ? `#${hash}` : ''}`;
};

// Once a creator finishes their first steps they start on Inicio; until then, on
// their panel (Primeros pasos). Remembered on this device; on a new device the
// panel checks the steps again and sends them on if they are already done.
const stepsDoneKey = (userId: string) => `first_steps_done_${userId}`;
export const firstStepsDone = (userId: string) => readJSON<boolean>(stepsDoneKey(userId), false);
export const markFirstStepsDone = (userId: string) => writeJSON(stepsDoneKey(userId), true);
