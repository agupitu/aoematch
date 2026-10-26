import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();

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

  // Vuelta de Steam: la API entra con un token propio que viene en el hash
  // (/entrar#token=...). Se saca de la barra antes de usarlo.
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (!token) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    signInWithCustomToken(auth, token).then(
      () => navigate('/perfil?steam=ok', { replace: true }),
      () => navigate('/entrar?steam=error', { replace: true })
    );
  }, [navigate]);

  const value: Ctx = {
    user,
    cargando,
    refrescar,
    // Cuentas de demo del emulador (@demo.aoematch). El formulario solo se muestra en DEV.
    login: async (email, password) => {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        const code = (err as { code?: string }).code ?? '';
        const credencial =
          code === 'auth/invalid-credential' ||
          code === 'auth/wrong-password' ||
          code === 'auth/user-not-found' ||
          code === 'auth/invalid-email';
        throw new Error(credencial ? 'Email o contraseña incorrectos.' : 'No se pudo entrar. Probá de nuevo.');
      }
      await refrescar();
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
