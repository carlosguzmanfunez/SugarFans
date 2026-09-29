import React, { createContext, useContext, useState, ReactNode } from 'react';

export type UserRole = 'fan' | 'creator' | 'admin';

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
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  ageVerified: boolean;
  login: (email: string, password: string) => boolean;
  register: (name: string, email: string, password: string, role: UserRole) => boolean;
  logout: () => void;
  verifyAge: () => void;
  updateUser: (data: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [ageVerified, setAgeVerified] = useState(false);

  const login = (email: string, _password: string): boolean => {
    // Simulated login
    if (email.includes('admin')) {
      setUser({
        id: '1',
        name: 'Admin SugarFans',
        email,
        role: 'admin',
        avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=admin',
        ageVerified: true,
      });
    } else if (email.includes('creator')) {
      setUser({
        id: '2',
        name: 'Valentina Rose',
        email,
        role: 'creator',
        avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=valentina',
        bio: 'Modelo y creadora de contenido exclusivo ✨',
        isVerified: true,
        subscriptionPrice: 9.99,
        followers: 12500,
        following: 340,
        posts: 256,
        ageVerified: true,
      });
    } else {
      setUser({
        id: '3',
        name: 'Carlos M.',
        email,
        role: 'fan',
        avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=carlos',
        ageVerified: true,
      });
    }
    setAgeVerified(true);
    return true;
  };

  const register = (name: string, email: string, _password: string, role: UserRole): boolean => {
    setUser({
      id: Date.now().toString(),
      name,
      email,
      role,
      avatar: `https://api.dicebear.com/7.0/adventurer/svg?seed=${name}`,
      ageVerified: false,
    });
    return true;
  };

  const logout = () => {
    setUser(null);
    setAgeVerified(false);
  };

  const verifyAge = () => {
    setAgeVerified(true);
    if (user) {
      setUser({ ...user, ageVerified: true });
    }
  };

  const updateUser = (data: Partial<User>) => {
    if (user) {
      setUser({ ...user, ...data });
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, ageVerified, login, register, logout, verifyAge, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
