import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Alerta } from '../components/ui';
import { zonaDelNavegador } from '../lib';

export function Login() {
  const { login, registrar } = useAuth();
  const navigate = useNavigate();
  const [modo, setModo] = useState<'entrar' | 'crear'>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      if (modo === 'entrar') await login(email, password);
      else await registrar({ email, password, display_name: nombre, timezone: zonaDelNavegador() });
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="title mb-1 text-2xl">{modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}</h1>
      <p className="mb-6 text-sm text-parch-400">
        También podés entrar con Steam y queda vinculada tu cuenta de AoE III.
      </p>

      <a href="/api/auth/steam" className="btn btn-ghost mb-5 w-full">
        Continuar con Steam
      </a>

      <div className="mb-5 flex items-center gap-3 text-xs text-parch-400">
        <span className="h-px flex-1 bg-ink-700" /> o con email <span className="h-px flex-1 bg-ink-700" />
      </div>

      <form onSubmit={enviar} className="space-y-4">
        {modo === 'crear' && (
          <div>
            <label className="label">Nombre en juego</label>
            <input className="field" value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={40} />
          </div>
        )}
        <div>
          <label className="label">Email</label>
          <input
            className="field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
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
            minLength={8}
            autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
          />
        </div>

        <Alerta>{error}</Alerta>

        <button className="btn btn-primary w-full" disabled={enviando}>
          {modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}
        </button>
      </form>

      <button
        className="mt-4 w-full text-sm text-parch-400 hover:text-gold-400"
        onClick={() => {
          setModo(modo === 'entrar' ? 'crear' : 'entrar');
          setError('');
        }}
      >
        {modo === 'entrar' ? '¿No tenés cuenta? Creá una' : '¿Ya tenés cuenta? Entrá'}
      </button>
    </div>
  );
}
