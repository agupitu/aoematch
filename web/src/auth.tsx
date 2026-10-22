import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signOut } from 'firebase/auth';
import { api } from './api';
import { auth } from './firebase';
import type { User } from './types';

type Ctx = {
  user: User | null;
  cargando: boolean;
  refrescar: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
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

  // Firebase avisa al cargar (con la sesión recuperada o sin sesión), al entrar,
  // al salir y cada vez que renueva el token: el perfil sale siempre de la API.
  useEffect(() => onIdTokenChanged(auth, () => void refrescar()), [refrescar]);

  const value: Ctx = {
    user,
    cargando,
    refrescar,
    // Login por email de las cuentas de demo, con la sesión por cookie de antes
    // (pasa a Firebase en T12).
    login: async (email, password) => {
      const r = await api.post<{ user: User }>('/api/auth/login', { email, password });
      setUser(r.user);
    },
    logout: async () => {
      // La cookie vieja (hasta T33) y la sesión de Firebase.
      await api.post('/api/auth/logout');
      await signOut(auth);
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
