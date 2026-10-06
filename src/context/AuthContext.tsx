import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { readJSON, writeJSON } from '../lib/storage';
import { backend, type AuthResult, type MediaUpload, type ProfilePatch, type SignupExtras, type SocialProvider, type Subscription, type User, type UserRole } from '../lib/backend';

export type { SocialProvider, User, UserRole, UserSettings, Subscription, CreatorPost, AuthResult } from '../lib/backend';
export { defaultSettings } from '../lib/backend';

const AGE_KEY = 'age_verified';

interface AuthContextType {
  user: User | null;
  // True until the stored session has been restored.
  loading: boolean;
  isAuthenticated: boolean;
  ageVerified: boolean;
  backendMode: 'supabase' | 'local';
  login: (email: string, password: string, remember?: boolean) => Promise<AuthResult>;
  register: (name: string, email: string, password: string, role: UserRole, ref?: string, extras?: SignupExtras) => Promise<AuthResult & { needsConfirmation?: boolean }>;
  // Leaves for Google/Microsoft; the user comes back to /auth/callback.
  signInWithProvider: (provider: SocialProvider) => Promise<AuthResult>;
  completeSocialSignup: (role: UserRole, ref?: string, extras?: SignupExtras) => Promise<AuthResult>;
  logout: () => Promise<void>;
  verifyAge: () => void;
  updateUser: (data: ProfilePatch) => Promise<AuthResult>;
  changePassword: (current: string, next: string) => Promise<AuthResult>;
  deleteAccount: (password: string) => Promise<AuthResult>;
  isSubscribed: (creatorId: string) => boolean;
  toggleSubscription: (creatorId: string, price: number) => Promise<AuthResult>;
  // Stops renewing; access lasts until the end of the paid month (`until`).
  cancelSubscription: (creatorId: string) => Promise<AuthResult & { until?: string }>;
  subscriptionOf: (creatorId: string) => Subscription | undefined;
  addPost: (content: string, isLocked: boolean, media?: MediaUpload, asProfileId?: string) => Promise<AuthResult>;
  deletePost: (id: string) => Promise<AuthResult>;
  listAccounts: () => Promise<User[]>;
  refreshUser: () => Promise<void>;
}

const notSignedIn: AuthResult = { ok: false, error: 'No has iniciado sesión' };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [deviceAgeVerified, setDeviceAgeVerified] = useState<boolean>(() => readJSON<boolean>(AGE_KEY, false));

  const refreshUser = useCallback(async () => {
    const current = await backend.getCurrentUser();
    setUser(current);
    if (current?.ageVerified) {
      writeJSON(AGE_KEY, true);
      setDeviceAgeVerified(true);
    }
  }, []);

  // Restore the session, then follow changes made in other tabs.
  useEffect(() => {
    let active = true;
    refreshUser().finally(() => active && setLoading(false));
    const unsubscribe = backend.onChange(() => {
      if (!active) return;
      refreshUser();
      setDeviceAgeVerified(readJSON<boolean>(AGE_KEY, false));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshUser]);

  // Run a mutation, then reload the user so every screen sees the saved state.
  const run = async (fn: () => Promise<AuthResult>): Promise<AuthResult> => {
    const result = await fn();
    await refreshUser();
    return result;
  };

  const login = (email: string, password: string, remember = true) => run(() => backend.login(email, password, remember));

  const register = async (name: string, email: string, password: string, role: UserRole, ref?: string, extras?: SignupExtras) => {
    const result = await backend.register(name, email, password, role, ref, extras);
    await refreshUser();
    if (result.ok) {
      // The sign-up form includes the 18+ confirmation.
      writeJSON(AGE_KEY, true);
      setDeviceAgeVerified(true);
    }
    return result;
  };

  const signInWithProvider = (provider: SocialProvider) =>
    backend.signInWithProvider(provider, `${window.location.origin}/auth/callback`);

  const completeSocialSignup = async (role: UserRole, ref?: string, extras?: SignupExtras) => {
    const result = await run(() => backend.completeSocialSignup(role, ref, extras));
    if (result.ok) {
      // The completion form includes the 18+ confirmation.
      writeJSON(AGE_KEY, true);
      setDeviceAgeVerified(true);
    }
    return result;
  };

  const logout = async () => {
    await backend.logout();
    setUser(null);
  };

  const verifyAge = () => {
    writeJSON(AGE_KEY, true);
    setDeviceAgeVerified(true);
    if (user && !user.ageVerified) run(() => backend.updateProfile(user, { ageVerified: true }));
  };

  const updateUser = (data: ProfilePatch) => (user ? run(() => backend.updateProfile(user, data)) : Promise.resolve(notSignedIn));

  const changePassword = (current: string, next: string) =>
    user ? backend.changePassword(user, current, next) : Promise.resolve(notSignedIn);

  const deleteAccount = async (password: string) => {
    if (!user) return notSignedIn;
    const result = await backend.deleteAccount(user, password);
    if (result.ok) setUser(null);
    return result;
  };

  const isSubscribed = (creatorId: string) => !!user?.subscriptions.some((s) => s.creatorId === creatorId);

  const toggleSubscription = (creatorId: string, price: number) =>
    user ? run(() => backend.setSubscription(user, creatorId, price, !isSubscribed(creatorId))) : Promise.resolve(notSignedIn);

  const cancelSubscription = async (creatorId: string) => {
    if (!user) return notSignedIn;
    const result = await backend.cancelSubscription(user, creatorId);
    await refreshUser();
    return result;
  };

  const subscriptionOf = (creatorId: string) => user?.subscriptions.find((s) => s.creatorId === creatorId);

  const addPost = (content: string, isLocked: boolean, media?: MediaUpload, asProfileId?: string) =>
    user ? run(() => backend.addPost(user, content, isLocked, media, asProfileId)) : Promise.resolve(notSignedIn);

  const deletePost = (id: string) => (user ? run(() => backend.deletePost(user, id)) : Promise.resolve(notSignedIn));

  const ageVerified = deviceAgeVerified || !!user?.ageVerified;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        ageVerified,
        backendMode: backend.mode,
        login,
        register,
        signInWithProvider,
        completeSocialSignup,
        logout,
        verifyAge,
        updateUser,
        changePassword,
        deleteAccount,
        isSubscribed,
        toggleSubscription,
        cancelSubscription,
        subscriptionOf,
        addPost,
        deletePost,
        listAccounts: () => backend.listAccounts(),
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
