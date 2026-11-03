import type { UserRole } from '../context/AuthContext';

// Where each role starts after signing in (email or Google). The owner account
// follows the view it is in (fan, creator or admin), so each test starts from
// the right place.
export const homeForRole = (role: UserRole): string => (role === 'admin' ? '/admin' : '/');
