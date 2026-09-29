import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { readJSON, writeJSON, removeKey, hashPassword, newId, isValidEmail } from '../lib/storage';
import { cancelBookingsForFan } from '../lib/vip';

export type UserRole = 'fan' | 'creator' | 'admin';

export interface UserSettings {
  notifications: Record<string, boolean>;
  privacy: {
    profileVisible: boolean;
    showActivity: boolean;
    contentProtection: boolean;
  };
  twoFactor: boolean;
  category?: string;
}

export interface Subscription {
  creatorId: string;
  price: number;
  since: string;
}

export interface CreatorPost {
  id: string;
  content: string;
  isLocked: boolean;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  cover?: string;
  bio?: string;
  isVerified?: boolean;
  subscriptionPrice?: number;
  followers?: number;
  following?: number;
  posts?: number;
  ageVerified?: boolean;
  createdAt: string;
  settings: UserSettings;
  subscriptions: Subscription[];
  // Links a creator account to its public creator profile / VIP experiences.
  creatorProfileId?: string;
  createdPosts: CreatorPost[];
}

interface StoredAccount extends User {
  passwordHash: string;
  salt: string;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  ageVerified: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<AuthResult>;
  register: (name: string, email: string, password: string, role: UserRole) => Promise<AuthResult>;
  logout: () => void;
  verifyAge: () => void;
  updateUser: (data: Partial<User>) => AuthResult;
  changePassword: (current: string, next: string) => Promise<AuthResult>;
  deleteAccount: (password: string) => Promise<AuthResult>;
  isSubscribed: (creatorId: string) => boolean;
  toggleSubscription: (creatorId: string, price: number) => void;
  addPost: (content: string, isLocked: boolean) => void;
  deletePost: (id: string) => void;
  listAccounts: () => User[];
}

const ACCOUNTS_KEY = 'accounts';
const SESSION_KEY = 'session';
const AGE_KEY = 'age_verified';
const SEEDED_KEY = 'seeded_v1';
export const DEMO_PASSWORD = 'demo1234';

export const defaultSettings = (): UserSettings => ({
  notifications: {
    newPosts: true,
    messages: true,
    tips: true,
    subscribers: true,
    promotions: false,
    platform: false,
    email: true,
    push: true,
  },
  privacy: { profileVisible: true, showActivity: false, contentProtection: true },
  twoFactor: false,
});

const baseUser = (partial: Pick<User, 'id' | 'name' | 'email' | 'role' | 'avatar'> & Partial<User>): User => ({
  ageVerified: true,
  createdAt: new Date().toISOString(),
  settings: defaultSettings(),
  subscriptions: [],
  createdPosts: [],
  ...partial,
});

const demoUsers: User[] = [
  baseUser({
    id: 'demo-admin',
    name: 'Admin SugarFans',
    email: 'admin@sugarfans.com',
    role: 'admin',
    avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=admin',
  }),
  baseUser({
    id: 'demo-creator',
    name: 'Valentina Rose',
    email: 'creator@sugarfans.com',
    role: 'creator',
    avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=valentina',
    bio: 'Modelo y creadora de contenido exclusivo ✨',
    isVerified: true,
    subscriptionPrice: 9.99,
    creatorProfileId: '1',
    followers: 12500,
    following: 340,
    posts: 256,
  }),
  baseUser({
    id: 'demo-fan',
    name: 'Carlos M.',
    email: 'fan@sugarfans.com',
    role: 'fan',
    avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=carlos',
  }),
];

const loadAccounts = (): StoredAccount[] => {
  const accounts = readJSON<StoredAccount[]>(ACCOUNTS_KEY, []);
  // Fill fields added after an account was first saved.
  return accounts.map((a) => ({
    ...a,
    settings: { ...defaultSettings(), ...a.settings },
    subscriptions: a.subscriptions ?? [],
    createdPosts: a.createdPosts ?? [],
    creatorProfileId: a.creatorProfileId ?? (a.role === 'creator' ? (a.id === 'demo-creator' ? '1' : a.id) : undefined),
    createdAt: a.createdAt ?? new Date().toISOString(),
  }));
};

const saveAccounts = (accounts: StoredAccount[]) => writeJSON(ACCOUNTS_KEY, accounts);

// Seed the demo accounts once per browser; deleting one keeps it deleted.
const seedPromise: Promise<void> = (async () => {
  if (readJSON<boolean>(SEEDED_KEY, false)) return;
  const accounts = loadAccounts();
  for (const demo of demoUsers) {
    if (accounts.some((a) => a.email === demo.email)) continue;
    const salt = newId();
    accounts.push({ ...demo, salt, passwordHash: await hashPassword(DEMO_PASSWORD, salt) });
  }
  saveAccounts(accounts);
  writeJSON(SEEDED_KEY, true);
})();

// The session lives in localStorage ("remember me") or sessionStorage (this tab only).
const readSession = (): string | null => {
  try {
    return (
      JSON.parse(sessionStorage.getItem('sugarfans_' + SESSION_KEY) || 'null') ??
      readJSON<string | null>(SESSION_KEY, null)
    );
  } catch {
    return readJSON<string | null>(SESSION_KEY, null);
  }
};

const writeSession = (id: string | null, remember = true) => {
  try {
    sessionStorage.removeItem('sugarfans_' + SESSION_KEY);
    if (id && !remember) sessionStorage.setItem('sugarfans_' + SESSION_KEY, JSON.stringify(id));
  } catch {
    // ignore
  }
  if (id && remember) writeJSON(SESSION_KEY, id);
  else removeKey(SESSION_KEY);
};

const toPublic = (account: StoredAccount): User => {
  const { passwordHash: _h, salt: _s, ...user } = account;
  return user;
};

const findSessionUser = (): User | null => {
  const id = readSession();
  if (!id) return null;
  const account = loadAccounts().find((a) => a.id === id);
  return account ? toPublic(account) : null;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(findSessionUser);
  const [deviceAgeVerified, setDeviceAgeVerified] = useState<boolean>(() => readJSON<boolean>(AGE_KEY, false));

  // Keep tabs in sync: logging out or editing in one tab reflects in the others.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith('sugarfans_')) return;
      setUser(findSessionUser());
      setDeviceAgeVerified(readJSON<boolean>(AGE_KEY, false));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Apply a change to the logged-in account and persist it.
  const mutateCurrent = useCallback((fn: (account: StoredAccount) => StoredAccount) => {
    const id = readSession();
    if (!id) return;
    const accounts = loadAccounts();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx === -1) return;
    accounts[idx] = fn(accounts[idx]);
    saveAccounts(accounts);
    setUser(toPublic(accounts[idx]));
  }, []);

  const login = async (email: string, password: string, remember = true): Promise<AuthResult> => {
    await seedPromise;
    const account = loadAccounts().find((a) => a.email === normalizeEmail(email));
    if (!account || (await hashPassword(password, account.salt)) !== account.passwordHash) {
      return { ok: false, error: 'Email o contraseña incorrectos' };
    }
    writeSession(account.id, remember);
    setUser(toPublic(account));
    if (account.ageVerified) {
      writeJSON(AGE_KEY, true);
      setDeviceAgeVerified(true);
    }
    return { ok: true };
  };

  const register = async (name: string, email: string, password: string, role: UserRole): Promise<AuthResult> => {
    await seedPromise;
    const cleanEmail = normalizeEmail(email);
    if (!name.trim()) return { ok: false, error: 'El nombre es obligatorio' };
    if (!isValidEmail(cleanEmail)) return { ok: false, error: 'Introduce un email válido' };
    if (password.length < 8) return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres' };
    if (role === 'admin') return { ok: false, error: 'Tipo de cuenta no permitido' };
    const accounts = loadAccounts();
    if (accounts.some((a) => a.email === cleanEmail)) {
      return { ok: false, error: 'Ya existe una cuenta con este email' };
    }
    const salt = newId();
    const account: StoredAccount = {
      ...baseUser({
        id: newId(),
        name: name.trim(),
        email: cleanEmail,
        role,
        avatar: `https://api.dicebear.com/7.0/adventurer/svg?seed=${encodeURIComponent(name.trim())}`,
        // Registration requires confirming the user is 18+ (terms checkbox).
        ageVerified: true,
        ...(role === 'creator' ? { subscriptionPrice: 9.99, followers: 0, following: 0, posts: 0, bio: '' } : {}),
      }),
      salt,
      passwordHash: await hashPassword(password, salt),
    };
    saveAccounts([...accounts, account]);
    writeSession(account.id, true);
    writeJSON(AGE_KEY, true);
    setDeviceAgeVerified(true);
    setUser(toPublic(account));
    return { ok: true };
  };

  const logout = () => {
    writeSession(null);
    setUser(null);
  };

  const verifyAge = () => {
    writeJSON(AGE_KEY, true);
    setDeviceAgeVerified(true);
    if (user) mutateCurrent((a) => ({ ...a, ageVerified: true }));
  };

  const updateUser = (data: Partial<User>): AuthResult => {
    if (!user) return { ok: false, error: 'No has iniciado sesión' };
    const next = { ...data };
    if (next.email !== undefined) {
      next.email = normalizeEmail(next.email);
      if (!isValidEmail(next.email)) return { ok: false, error: 'Introduce un email válido' };
      if (loadAccounts().some((a) => a.email === next.email && a.id !== user.id)) {
        return { ok: false, error: 'Ese email ya está en uso por otra cuenta' };
      }
    }
    if (next.name !== undefined) {
      next.name = next.name.trim();
      if (!next.name) return { ok: false, error: 'El nombre es obligatorio' };
    }
    if (next.subscriptionPrice !== undefined && !(next.subscriptionPrice >= 0.99 && next.subscriptionPrice <= 999)) {
      return { ok: false, error: 'El precio debe estar entre $0.99 y $999' };
    }
    // Never let these be overwritten through a generic update.
    delete (next as Partial<StoredAccount>).passwordHash;
    delete (next as Partial<StoredAccount>).salt;
    delete next.id;
    delete next.role;
    mutateCurrent((a) => ({ ...a, ...next }));
    return { ok: true };
  };

  const verifyCurrentPassword = async (password: string): Promise<StoredAccount | null> => {
    const account = loadAccounts().find((a) => a.id === user?.id);
    if (!account) return null;
    return (await hashPassword(password, account.salt)) === account.passwordHash ? account : null;
  };

  const changePassword = async (current: string, next: string): Promise<AuthResult> => {
    if (!(await verifyCurrentPassword(current))) return { ok: false, error: 'La contraseña actual no es correcta' };
    if (next.length < 8) return { ok: false, error: 'La nueva contraseña debe tener al menos 8 caracteres' };
    const salt = newId();
    const passwordHash = await hashPassword(next, salt);
    mutateCurrent((a) => ({ ...a, salt, passwordHash }));
    return { ok: true };
  };

  const deleteAccount = async (password: string): Promise<AuthResult> => {
    const account = await verifyCurrentPassword(password);
    if (!account) return { ok: false, error: 'La contraseña no es correcta' };
    saveAccounts(loadAccounts().filter((a) => a.id !== account.id));
    cancelBookingsForFan(account.id);
    logout();
    return { ok: true };
  };

  const isSubscribed = (creatorId: string) => !!user?.subscriptions.some((s) => s.creatorId === creatorId);

  const toggleSubscription = (creatorId: string, price: number) => {
    mutateCurrent((a) => ({
      ...a,
      subscriptions: a.subscriptions.some((s) => s.creatorId === creatorId)
        ? a.subscriptions.filter((s) => s.creatorId !== creatorId)
        : [...a.subscriptions, { creatorId, price, since: new Date().toISOString() }],
    }));
  };

  const addPost = (content: string, isLocked: boolean) => {
    mutateCurrent((a) => ({
      ...a,
      posts: (a.posts ?? 0) + 1,
      createdPosts: [{ id: newId(), content: content.trim(), isLocked, createdAt: new Date().toISOString() }, ...a.createdPosts],
    }));
  };

  const deletePost = (id: string) => {
    mutateCurrent((a) => ({
      ...a,
      posts: Math.max(0, (a.posts ?? 0) - 1),
      createdPosts: a.createdPosts.filter((p) => p.id !== id),
    }));
  };

  const listAccounts = () => loadAccounts().map(toPublic);

  const ageVerified = deviceAgeVerified || !!user?.ageVerified;

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        ageVerified,
        login,
        register,
        logout,
        verifyAge,
        updateUser,
        changePassword,
        deleteAccount,
        isSubscribed,
        toggleSubscription,
        addPost,
        deletePost,
        listAccounts,
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
