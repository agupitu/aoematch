import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { User } from './types';

type Ctx = {
  user: User | null;
  cargando: boolean;
  refrescar: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  registrar: (datos: { email: string; password: string; display_name: string; timezone: string }) => Promise<void>;
  logout: () => Promise<void>;
  actualizar: (campos: Partial<User>) => Promise<void>;
};

const AuthCtx = createContext<Ctx>(null as unknown as Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [cargando, setCargando] = useState(true);

  const refrescar = useCallback(async () => {
    try {
      const r = await api.get<{ user: User | null }>('/api/auth/me');
      setUser(r.user);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  const value: Ctx = {
    user,
    cargando,
    refrescar,
    login: async (email, password) => {
      const r = await api.post<{ user: User }>('/api/auth/login', { email, password });
      setUser(r.user);
    },
    registrar: async (datos) => {
      const r = await api.post<{ user: User }>('/api/auth/register', datos);
      setUser(r.user);
    },
    logout: async () => {
      await api.post('/api/auth/logout');
      setUser(null);
    },
    actualizar: async (campos) => {
      const r = await api.patch<{ user: User }>('/api/auth/me', campos);
      setUser(r.user);
    },
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
