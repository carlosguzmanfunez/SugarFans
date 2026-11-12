import type { UserRole } from '../context/AuthContext';

// Where each role starts after signing in (email or Google). The owner account
// follows the view it is in (fan, creator or admin), so each test starts from
// the right place.
export const homeForRole = (role: UserRole): string => (role === 'admin' ? '/admin' : '/');

// A creator who hasn't verified their identity yet starts on their panel, where
// the verification step is (also after confirming the sign-up email); everyone
// else starts on their role's page.
export const homeForUser = (user?: { role: UserRole; isVerified?: boolean; isOwner?: boolean } | null): string =>
  user?.role === 'creator' && !user.isVerified && !user.isOwner ? '/creator/dashboard?bienvenida=1' : homeForRole(user?.role ?? 'fan');
