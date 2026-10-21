import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta, Spinner } from '../components/ui';
import {
  BORRADOR_INICIAL, TournamentForm, type Borrador, type PestaniaForm,
} from '../components/TournamentForm';
import type { Civ, GameMap, Tournament } from '../types';

/** Pool competitivo típico, por si querés arrancar con algo cargado. */
const SUGERIDOS = [
  'yucatan', 'andes', 'decan', 'saguenay', 'grandes-llanuras', 'arabia',
  'rio-amarillo', 'bayou', 'carolina',
];

export function CreateTournament() {
  const { user, cargando } = useAuth();
  const navigate = useNavigate();
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [civs, setCivs] = useState<Civ[]>([]);
  const [form, setForm] = useState<Borrador>(BORRADOR_INICIAL);
  const [tab, setTab] = useState<PestaniaForm>('basico');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    Promise.all([api.get<GameMap[]>('/api/maps'), api.get<Civ[]>('/api/civs')]).then(([m, c]) => {
      setMaps(m);
      setCivs(c);
      setForm((f) => ({
        ...f,
        civ_ids: c.map((x) => x.id),
        map_ids: m.filter((x) => SUGERIDOS.includes(x.slug)).map((x) => x.id),
      }));
    });
  }, []);

  if (cargando) return <Spinner />;
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-4 text-parch-400">Entrá para crear un torneo.</p>
        <Link to="/entrar" className="btn btn-primary">
          Entrar
        </Link>
      </div>
    );
  }

  const crear = async () => {
    setError('');
    if (!form.name.trim()) {
      setTab('basico');
      return setError('Ponele un nombre al torneo.');
    }
    if (form.map_ids.length < 1) {
      setTab('mapas');
      return setError('Elegí al menos un mapa.');
    }
    if (form.civ_ids.length < form.team_size * 2) {
      setTab('civs');
      return setError(`Con ${form.team_size}v${form.team_size} necesitás al menos ${form.team_size * 2} civilizaciones.`);
    }
    setEnviando(true);
    try {
      const t = await api.post<Tournament>('/api/tournaments', {
        ...form,
        max_teams: form.max_teams === '' ? null : Number(form.max_teams),
        best_of_final: form.best_of_final === '' ? null : Number(form.best_of_final),
        third_place: form.third_place ? 1 : 0,
        map_repeat: form.map_repeat ? 1 : 0,
        civ_repeat_series: form.civ_repeat_series ? 1 : 0,
        civ_repeat_team: form.civ_repeat_team ? 1 : 0,
        civ_mirror: form.civ_mirror ? 1 : 0,
        allow_solo: form.allow_solo ? 1 : 0,
        civ_pattern: form.civ_pattern.trim() || null,
        reg_closes_at: form.reg_closes_at || null,
        starts_at: form.starts_at || null,
        prizes: form.prizes,
        first_map_id: form.first_map_id,
      });
      navigate(`/t/${t.slug}`);
    } catch (err) {
      setError((err as Error).message);
      setEnviando(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="title mb-1 text-2xl">Crear torneo</h1>
      <p className="hint mb-6 text-sm">
        Todo esto se puede cambiar después desde la pestaña de configuración.
      </p>

      <TournamentForm value={form} onChange={setForm} maps={maps} civs={civs} tab={tab} onTab={setTab} />

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-ink-700 bg-ink-950/90 py-4 backdrop-blur">
        <button className="btn btn-primary" onClick={crear} disabled={enviando}>
          {enviando ? 'Creando…' : 'Crear torneo'}
        </button>
        <Link to="/" className="btn btn-ghost">
          Cancelar
        </Link>
        <div className="flex-1">{error && <Alerta>{error}</Alerta>}</div>
      </div>
    </div>
  );
}
