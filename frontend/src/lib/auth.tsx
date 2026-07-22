'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, User, getToken, setToken, clearToken } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Restore session on load if a token exists.
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((u) => setUser(u))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const { token, user: u } = await api.login(email, password);
    setToken(token);
    setUser(u);
    return u;
  }

  function logout() {
    clearToken();
    setUser(null);
    router.push('/login');
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// Route guard: redirects to /login if unauthenticated, or to the correct home
// if the user's role doesn't match the area they're trying to view.
function homeFor(user: User) {
  if (user.mustChangePassword) return '/change-password';
  if (user.role === 'admin') return '/admin/users';
  return user.role === 'inventory' ? '/dashboard/requests' : '/rep/request-stones';
}

export function useRequireRole(role: 'sales_rep' | 'inventory' | 'admin') {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
    } else if (user.mustChangePassword || user.role !== role) {
      router.replace(homeFor(user));
    }
  }, [user, loading, role, router]);

  return { user, loading };
}

export { homeFor };
