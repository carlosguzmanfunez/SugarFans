import type { UserRole } from '../context/AuthContext';
import { FIRST_STEPS_PATH, firstStepsDone } from '../lib/creatorSetup';

// Where each role starts after signing in (email or Google). The owner account
// follows the view it is in (fan, creator or admin), so each test starts from
// the right place.
export const homeForRole = (role: UserRole): string => (role === 'admin' ? '/admin' : '/');

// A creator starts on their panel until they finish their first steps (also after
// confirming the sign-up email): with the identity check first while unverified,
// then the Primeros pasos list. Once done, Inicio like everyone else.
export const homeForUser = (user?: { id?: string; role: UserRole; isVerified?: boolean; isOwner?: boolean } | null): string => {
  if (user?.role !== 'creator' || user.isOwner) return homeForRole(user?.role ?? 'fan');
  if (!user.isVerified) return '/creator/dashboard?bienvenida=1';
  return user.id && firstStepsDone(user.id) ? '/' : FIRST_STEPS_PATH;
};
