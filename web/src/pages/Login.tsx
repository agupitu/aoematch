import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta } from '../components/ui';

type Proveedores = { steam: boolean; google: boolean; dev_login: boolean };

const MENSAJES: Record<string, string> = {
  error: 'No se pudo completar el ingreso. Probá de nuevo.',
  sin_config: 'El ingreso con Google todavía no está configurado en este servidor.',
  ocupado: 'Esa cuenta ya está vinculada a otro usuario.',
};

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [prov, setProv] = useState<Proveedores>({ steam: true, google: false, dev_login: false });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.get<Proveedores>('/api/auth/providers').then(setProv).catch(() => {});
  }, []);

  const aviso = MENSAJES[params.get('google') ?? ''] ?? MENSAJES[params.get('steam') ?? ''] ?? '';

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
        Entrás con tu cuenta de Steam o de Google. No hay registro ni contraseñas: la primera vez
        se te crea el perfil solo.
      </p>

      {aviso && (
        <div className="mb-5">
          <Alerta>{aviso}</Alerta>
        </div>
      )}

      <div className="space-y-3">
        <a href="/api/auth/steam" className="btn btn-primary w-full py-3">
          Continuar con Steam
        </a>
        {prov.google ? (
          <a href="/api/auth/google" className="btn btn-ghost w-full py-3">
            Continuar con Google
          </a>
        ) : (
          <button className="btn btn-ghost w-full py-3" disabled title="Falta configurar GOOGLE_CLIENT_ID">
            Continuar con Google
          </button>
        )}
      </div>

      <p className="hint mt-5 text-xs">
        Con Steam queda vinculada tu cuenta de Age of Empires III y se traen tu nombre y avatar.
      </p>

      {prov.dev_login && (
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
