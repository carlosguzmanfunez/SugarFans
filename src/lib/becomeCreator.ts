import type { User } from './backend/types';
import { isDemoEmail } from '../config/demoAccounts';

// "Hazte creador": only a fan with a finished sign-up can switch, never a demo account.
export const canBecomeCreator = (user: User | null | undefined): user is User =>
  !!user && user.role === 'fan' && user.signupCompleted !== false && !isDemoEmail(user.email);

// Where the "Hazte creador" card lives (Ajustes > Editar perfil).
export const BECOME_CREATOR_LINK = '/settings?section=profile&focus=creador';
