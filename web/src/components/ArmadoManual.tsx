import { useMemo, useState } from 'react';
import type { OrdenManual } from '../datos/llaves';
import { cantidadDeGrupos, ordenarManual, repartirEnGrupos } from '../logica/llaves.js';
import type { Team, Tournament } from '../types';
import { Alerta } from './ui';

const AYUDA: Record<string, string> = {
  eliminacion_simple: 'La posición es la siembra: el 1.º se cruza con el último, el 2.º con el anteúltimo… Si sobran lugares, los primeros pasan libres.',
  eliminacion_doble: 'La posición es la siembra: el 1.º se cruza con el último, el 2.º con el anteúltimo… Si sobran lugares, los primeros pasan libres.',
  liga: 'El orden define el calendario de fechas. Todos juegan contra todos.',
  suizo: 'La primera ronda enfrenta a la mitad de arriba con la de abajo: el 1.º contra el del medio, y así.',
};

type Reparto = { listas: string[][]; libres: string[] };

const letra = (i: number) => String.fromCharCode(65 + i);

/** Punto de partida: lo que ya está armado (si hay grupos) o el reparto automático. */
function repartoInicial(t: Tournament, grupal: boolean, cantidad: number): Reparto {
  const todos = t.teams.map((e) => e.id);
  if (!grupal) return { listas: [todos], libres: [] };

  const guardados = t.stages.find((s) => s.type === 'grupos')?.groups ?? [];
  if (!guardados.length) return { listas: repartirEnGrupos(t.teams, cantidad), libres: [] };

  const existentes = new Set(todos);
  const listas = Array.from({ length: cantidad }, (_, i) =>
    (guardados[i]?.standings ?? []).map((f) => f.team.id).filter((id) => existentes.has(id))
  );
  const ubicados = new Set(listas.flat());
  return { listas, libres: todos.filter((id) => !ubicados.has(id)) };
}

/**
 * Staff: arma las llaves a mano. En grupos + playoff reparte los equipos entre
 * los grupos; en los demás formatos ordena la lista (la posición es la siembra).
 * Los equipos pueden estar vacíos: los jugadores se suman después.
 */
export function ArmadoManual({
  t, onGenerar, onCerrar,
}: {
  t: Tournament;
  onGenerar: (orden: OrdenManual) => Promise<void>;
  onCerrar: () => void;
}) {
  const grupal = t.format === 'grupos_playoff';
  const cantidad = grupal ? (cantidadDeGrupos(t) as number) : 1;
  const [reparto, setReparto] = useState<Reparto>(() => repartoInicial(t, grupal, cantidad));
  const [generando, setGenerando] = useState(false);

  const equipo = useMemo(() => new Map<string, Team>(t.teams.map((e) => [e.id, e])), [t.teams]);
  const orden: OrdenManual = grupal ? { grupos: reparto.listas } : { equipos: reparto.listas[0] };

  // Lo mismo que valida el generador: así el botón avisa antes de tocar nada.
  const problema = useMemo(() => {
    try {
      ordenarManual(t, t.teams, orden);
      return '';
    } catch (err) {
      return (err as Error).message;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, reparto]);

  const mover = (id: string, destino: number | 'libres') =>
    setReparto(({ listas, libres }) => {
      const sacados = listas.map((l) => l.filter((x) => x !== id));
      const sinId = libres.filter((x) => x !== id);
      if (destino === 'libres') return { listas: sacados, libres: [...sinId, id] };
      return { listas: sacados.map((l, i) => (i === destino ? [...l, id] : l)), libres: sinId };
    });

  const correr = (lista: number, i: number, delta: -1 | 1) =>
    setReparto(({ listas, libres }) => {
      const j = i + delta;
      if (j < 0 || j >= listas[lista].length) return { listas, libres };
      const nueva = [...listas[lista]];
      [nueva[i], nueva[j]] = [nueva[j], nueva[i]];
      return { listas: listas.map((l, k) => (k === lista ? nueva : l)), libres };
    });

  const generar = async () => {
    setGenerando(true);
    try {
      await onGenerar(orden);
    } finally {
      setGenerando(false);
    }
  };

  const fila = (id: string, lista: number | 'libres', i: number, largo: number) => {
    const e = equipo.get(id);
    if (!e) return null;
    return (
      <li key={id} className="flex items-center gap-2 rounded border border-ink-700 px-2 py-1.5 text-sm">
        <span className="w-6 shrink-0 text-right text-xs text-parch-400">{lista === 'libres' ? '·' : i + 1}</span>
        <span className="min-w-0 flex-1 truncate">
          {e.name}
          {!e.members.length && <span className="ml-2 text-xs text-parch-400">vacío</span>}
        </span>
        {lista !== 'libres' && (
          <>
            <button
              type="button"
              className="btn btn-ghost !px-2 !py-0.5"
              disabled={i === 0}
              aria-label={`Subir ${e.name}`}
              onClick={() => correr(lista, i, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-ghost !px-2 !py-0.5"
              disabled={i === largo - 1}
              aria-label={`Bajar ${e.name}`}
              onClick={() => correr(lista, i, 1)}
            >
              ↓
            </button>
          </>
        )}
        {grupal && (
          <select
            className="field !w-auto !py-0.5 text-xs"
            value={lista === 'libres' ? 'libres' : String(lista)}
            aria-label={`Mover ${e.name} a`}
            onChange={(ev) => mover(id, ev.target.value === 'libres' ? 'libres' : Number(ev.target.value))}
          >
            {reparto.listas.map((_, k) => (
              <option key={k} value={k}>
                Grupo {letra(k)}
              </option>
            ))}
            <option value="libres">Sin ubicar</option>
          </select>
        )}
      </li>
    );
  };

  return (
    <section className="card space-y-4 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="title text-lg">{grupal ? 'Armar los grupos a mano' : 'Ordenar los equipos'}</h3>
          <p className="mt-1 text-sm text-parch-400">
            {grupal
              ? 'Elegí en qué grupo juega cada equipo. El orden dentro del grupo define el calendario de fechas.'
              : AYUDA[t.format]}
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onCerrar}>
          Cancelar
        </button>
      </header>

      <div className={grupal ? 'grid gap-4 md:grid-cols-2' : ''}>
        {reparto.listas.map((ids, k) => (
          <div key={k}>
            {grupal && (
              <h4 className="title mb-2 text-sm">
                Grupo {letra(k)} <span className="text-parch-400">· {ids.length}</span>
              </h4>
            )}
            <ol className="space-y-1.5">{ids.map((id, i) => fila(id, k, i, ids.length))}</ol>
            {!ids.length && <p className="text-xs text-parch-400">Sin equipos.</p>}
          </div>
        ))}
      </div>

      {grupal && reparto.libres.length > 0 && (
        <div>
          <h4 className="title mb-2 text-sm">
            Sin ubicar <span className="text-parch-400">· {reparto.libres.length}</span>
          </h4>
          <ul className="space-y-1.5">{reparto.libres.map((id, i) => fila(id, 'libres', i, reparto.libres.length))}</ul>
        </div>
      )}

      {problema && <Alerta tone="info">{problema}</Alerta>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={!!problema || generando} onClick={generar}>
          {t.matches.length ? 'Regenerar con este orden' : 'Generar con este orden'}
        </button>
        {t.matches.length > 0 && (
          <span className="text-xs text-parch-400">Regenerar borra los partidos y los chats de partido.</span>
        )}
      </div>
    </section>
  );
}
