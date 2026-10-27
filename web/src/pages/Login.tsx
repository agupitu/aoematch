import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { useAuth } from '../auth';
import { Alerta } from '../components/ui';
import { auth } from '../firebase';
import { popupCerrado } from '../lib';

const MENSAJES: Record<string, string> = {
  error: 'No se pudo completar el ingreso. Probá de nuevo.',
};

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorGoogle, setErrorGoogle] = useState('');

  const entrarConGoogle = async () => {
    setErrorGoogle('');
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      navigate('/perfil');
    } catch (err) {
      if (!popupCerrado(err)) setErrorGoogle(MENSAJES.error);
    }
  };

  const entrarDemo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="title mb-1 text-2xl">Entrar</h1>
      <p className="hint mb-6 text-sm">
        Entrás con tu cuenta de Google. No hay registro ni contraseñas: la primera vez se te crea el
        perfil solo.
      </p>

      {errorGoogle && (
        <div className="mb-5">
          <Alerta>{errorGoogle}</Alerta>
        </div>
      )}

      <button type="button" className="btn btn-primary w-full py-3" onClick={entrarConGoogle}>
        Continuar con Google
      </button>

      {import.meta.env.DEV && (
        <details className="mt-8">
          <summary className="cursor-pointer text-xs text-parch-400 hover:text-gold-400">
            Entrar con una cuenta de prueba
          </summary>
          <form onSubmit={entrarDemo} className="mt-3 space-y-3">
            <div>
              <label className="label">Email</label>
              <input
                className="field"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kaiser@demo.aoematch"
                required
              />
            </div>
            <div>
              <label className="label">Contraseña</label>
              <input
                className="field"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Alerta>{error}</Alerta>
            <button className="btn btn-ghost w-full" disabled={enviando}>
              Entrar
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
