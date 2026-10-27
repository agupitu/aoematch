import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { guardarHorario, horarioDe } from '../datos/usuarios';
import { useAuth } from '../auth';
import { Alerta, Avatar, Spinner } from '../components/ui';
import { AvailabilityGrid, type Bloque } from '../components/AvailabilityGrid';
import { horas, steamUrlValida, zonaDelNavegador } from '../lib';

const ZONAS = [
  'America/Argentina/Buenos_Aires', 'America/Santiago', 'America/Bogota', 'America/Mexico_City',
  'America/Sao_Paulo', 'America/New_York', 'America/Los_Angeles', 'Europe/Madrid', 'Europe/London',
  'Europe/Berlin', 'Europe/Moscow', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'UTC',
];

export function Profile() {
  const { user, actualizar, cargando } = useAuth();
  const [bloques, setBloques] = useState<Bloque[] | null>(null);
  const [sucio, setSucio] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    display_name: '', timezone: 'UTC', discord: '', xbox_tag: '', aoe3_profile: '', steam_url: '',
    rating_1v1: '', rating_team: '',
  });

  useEffect(() => {
    if (!user) return;
    setForm({
      display_name: user.display_name,
      timezone: user.timezone || zonaDelNavegador(),
      discord: user.discord ?? '',
      xbox_tag: user.xbox_tag ?? '',
      aoe3_profile: user.aoe3_profile ?? '',
      steam_url: user.steam_url ?? '',
      rating_1v1: user.rating_1v1?.toString() ?? '',
      rating_team: user.rating_team?.toString() ?? '',
    });
    horarioDe(user.id)
      .then(setBloques)
      .catch(() => setBloques([]));
  }, [user]);

  if (cargando) return <Spinner />;
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-4 text-parch-400">Necesitás una cuenta para ver tu perfil.</p>
        <Link to="/entrar" className="btn btn-primary">
          Entrar
        </Link>
      </div>
    );
  }

  const guardarPerfil = async () => {
    setError('');
    const steam = form.steam_url.trim();
    if (steam && !steamUrlValida(steam)) {
      return setError('El link tiene que ser https://steamcommunity.com/id/… o /profiles/…');
    }
    try {
      await actualizar({
        ...form,
        rating_1v1: form.rating_1v1 === '' ? null : Number(form.rating_1v1),
        rating_team: form.rating_team === '' ? null : Number(form.rating_team),
      } as never);
      setMensaje('Perfil guardado.');
      setTimeout(() => setMensaje(''), 2500);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const guardarHorarios = async () => {
    if (!user) return;
    await guardarHorario(user.id, bloques ?? []);
    setSucio(false);
    setMensaje('Horarios guardados.');
    setTimeout(() => setMensaje(''), 2500);
  };

  const totalMin = (bloques ?? []).reduce((s, b) => s + (b.end_min - b.start_min), 0);
  const steamGuardado = user.steam_url && steamUrlValida(user.steam_url) ? user.steam_url : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-4">
        <Avatar src={user.avatar_url} name={user.display_name} size={56} />
        <div>
          <h1 className="title text-2xl">{user.display_name}</h1>
          <p className="text-sm text-parch-400">{user.timezone}</p>
        </div>
      </div>

      {mensaje && <Alerta tone="good">{mensaje}</Alerta>}
      {error && <Alerta>{error}</Alerta>}

      <section className="card p-5">
        <h2 className="title mb-4 text-lg">Datos</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Nombre en juego</label>
            <input
              className="field"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Zona horaria</label>
            <select
              className="field"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              {[...new Set([form.timezone, zonaDelNavegador(), ...ZONAS])].map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Discord</label>
            <input
              className="field"
              value={form.discord}
              onChange={(e) => setForm({ ...form, discord: e.target.value })}
              placeholder="usuario#0000"
            />
          </div>
          <div>
            <label className="label">Gamertag de Xbox</label>
            <input
              className="field"
              value={form.xbox_tag}
              onChange={(e) => setForm({ ...form, xbox_tag: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Perfil de Steam</label>
            <input
              className="field"
              value={form.steam_url}
              onChange={(e) => setForm({ ...form, steam_url: e.target.value })}
              placeholder="https://steamcommunity.com/id/…"
            />
            <p className="hint mt-1 text-xs">No verificado. Solo steamcommunity.com/id/… o /profiles/…</p>
            {steamGuardado && (
              <a
                className="mt-1 inline-block text-sm text-gold-400 underline"
                href={steamGuardado}
                target="_blank"
                rel="noopener noreferrer"
              >
                Ver perfil · no verificado
              </a>
            )}
          </div>
          <div>
            <label className="label">Perfil de AoE III (id de leaderboard)</label>
            <input
              className="field"
              value={form.aoe3_profile}
              onChange={(e) => setForm({ ...form, aoe3_profile: e.target.value })}
              placeholder="ej. 1234567"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Elo 1v1</label>
              <input
                className="field"
                type="number"
                value={form.rating_1v1}
                onChange={(e) => setForm({ ...form, rating_1v1: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Elo equipos</label>
              <input
                className="field"
                type="number"
                value={form.rating_team}
                onChange={(e) => setForm({ ...form, rating_team: e.target.value })}
              />
            </div>
          </div>
        </div>
        <button className="btn btn-primary mt-4" onClick={guardarPerfil}>
          Guardar datos
        </button>
      </section>

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="title text-lg">Cuándo podés jugar</h2>
            <p className="hint text-sm">
              Pintá tus franjas de la semana. Con esto el sistema cruza horarios y propone cuándo jugar cada
              partido. Total marcado: <span className="text-parch-200">{horas(totalMin)}</span>
            </p>
          </div>
          <button className="btn btn-primary" disabled={!sucio} onClick={guardarHorarios}>
            Guardar horarios
          </button>
        </div>
        {bloques === null ? (
          <Spinner />
        ) : (
          <AvailabilityGrid
            value={bloques}
            timezone={form.timezone}
            onChange={(b) => {
              setBloques(b);
              setSucio(true);
            }}
          />
        )}
      </section>
    </div>
  );
}
