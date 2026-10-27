import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { actualizarPerfil, asegurarPerfil } from './datos/usuarios';
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
      await auth.authStateReady();
      const cuenta = auth.currentUser;
      setUser(cuenta ? await asegurarPerfil(cuenta) : null);
    } catch (err) {
      console.error('No se pudo leer o crear el perfil:', err);
      setUser(null);
    } finally {
      setCargando(false);
    }
  }, []);

  // Firebase avisa al cargar (con la sesión recuperada o sin sesión), al entrar,
  // al salir y cada vez que renueva el token: el perfil sale de users/{uid}, y
  // la primera vez se crea.
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
      await signOut(auth);
      setUser(null);
    },
    actualizar: async (campos) => {
      if (!user) return;
      setUser(await actualizarPerfil(user.id, campos));
    },
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
