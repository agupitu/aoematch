import { useState } from 'react';
import type { PartidaDeSerie } from '../datos/resultados';
import { estadoDeSerie, partidasJugables, partidasMaximas } from '../logica/series.js';
import type { MatchDetail } from '../types';
import { Alerta } from './ui';

/** Mapa y civs del draft ya revelado de una partida: se guardan junto con su resultado. */
export type DelDraft = { game_no: number; map_id: number | null; civs: NonNullable<PartidaDeSerie['civs']> };

type ModoLink = 'todas' | 'cada';

/**
 * Staff: carga todas las partidas de la serie en un solo cuadro. Los equipos
 * van en las filas y las partidas en las columnas; el círculo amarillo marca
 * a quien ganó cada una. El link del replay es uno para todas o uno por partida.
 */
export function CargarPartidas({
  m, delDraft, error, onGuardar,
}: {
  m: MatchDetail;
  delDraft: DelDraft | null;
  error: string;
  onGuardar: (partidas: PartidaDeSerie[]) => void;
}) {
  const equipos = [m.teams.a, m.teams.b].filter((e): e is NonNullable<typeof e> => !!e);
  const total = partidasMaximas(m);
  const cargada = (n: number) => m.games.find((g) => g.game_no === n);

  const [ganadores, setGanadores] = useState<(string | null)[]>(() =>
    Array.from({ length: total }, (_, i) => cargada(i + 1)?.winner_team_id ?? null)
  );
  const [replays, setReplays] = useState<string[]>(() =>
    Array.from({ length: total }, (_, i) => cargada(i + 1)?.replay_url ?? '')
  );
  const [modo, setModo] = useState<ModoLink>(() => (m.games.some((g) => g.replay_url) ? 'cada' : 'todas'));
  const [global, setGlobal] = useState('');
  const [inicial] = useState(() => JSON.stringify({ ganadores, replays, modo, global }));

  const lados = ganadores.map((id) => (id && id === m.team_a_id ? 'a' : id && id === m.team_b_id ? 'b' : null));
  const jugables: boolean[] = partidasJugables(m, lados);
  const gana = (lado: 'a' | 'b') => lados.filter((l, i) => jugables[i] && l === lado).length;
  const [a, b] = [gana('a'), gana('b')];
  const { ganador } = estadoDeSerie(m, a, b);

  const elegir = (i: number, teamId: string) =>
    setGanadores((g) => g.map((x, j) => (j === i ? (x === teamId ? null : teamId) : x)));
  const cambiarLink = (i: number, valor: string) => setReplays((r) => r.map((x, j) => (j === i ? valor : x)));

  const guardar = () => {
    const partidas: PartidaDeSerie[] = [];
    for (let i = 0; i < total; i++) {
      const winner = jugables[i] ? ganadores[i] : null;
      if (!winner && !cargada(i + 1)) continue;
      const link = modo === 'cada' ? (winner ? replays[i].trim() : '') : winner && global.trim() ? global.trim() : undefined;
      partidas.push({
        game_no: i + 1,
        winner_team_id: winner,
        replay_url: link,
        ...(winner && delDraft?.game_no === i + 1 ? { map_id: delDraft.map_id, civs: delDraft.civs } : {}),
      });
    }
    onGuardar(partidas);
  };

  const sinCambios = JSON.stringify({ ganadores, replays, modo, global }) === inicial;
  const nombreGanador = ganador === 'a' ? m.teams.a?.name : ganador === 'b' ? m.teams.b?.name : null;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-[11px] text-parch-400">
              <th className="pr-2 text-left font-normal">Partida</th>
              {Array.from({ length: total }, (_, i) => (
                <th key={i} className="px-0.5 text-center font-normal" title={i + 1 > m.best_of ? 'Desempate' : undefined}>
                  {i + 1}
                  {i + 1 > m.best_of ? '*' : ''}
                </th>
              ))}
              <th className="pl-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {equipos.map((e, k) => (
              <tr key={e.id}>
                <td className="max-w-[9rem] truncate pr-2 text-parch-100">{e.name}</td>
                {Array.from({ length: total }, (_, i) => {
                  const marcada = ganadores[i] === e.id && jugables[i];
                  return (
                    <td key={i} className="px-0.5 text-center">
                      <button
                        type="button"
                        disabled={!jugables[i]}
                        aria-pressed={marcada}
                        aria-label={`${e.name} gana la partida ${i + 1}`}
                        onClick={() => elegir(i, e.id)}
                        className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <span
                          className={`h-5 w-5 rounded-full border-2 transition-colors ${
                            marcada ? 'border-gold-400 bg-gold-400' : 'border-ink-600'
                          }`}
                        />
                      </button>
                    </td>
                  );
                })}
                <td className="pl-2 text-right font-semibold text-gold-400 tabular-nums">{k === 0 ? a : b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint text-xs">
        {nombreGanador ? `Gana la serie ${nombreGanador} (${a}–${b}).` : `La serie sigue sin definir (${a}–${b}).`}
        {total > m.best_of && ' * Desempate: se juega solo si empatan.'}
      </p>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <label className="label mb-0">Link del replay (opcional)</label>
          <div className="flex gap-1 text-xs">
            {(['todas', 'cada'] as const).map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={modo === o}
                onClick={() => setModo(o)}
                className={`rounded-md border px-2 py-0.5 transition-colors ${
                  modo === o ? 'border-gold-500 bg-gold-500/10 text-gold-400' : 'border-ink-700 text-parch-400 hover:text-parch-100'
                }`}
              >
                {o === 'todas' ? 'Uno para todas' : 'Uno por partida'}
              </button>
            ))}
          </div>
        </div>
        {modo === 'todas' ? (
          <input className="field" value={global} onChange={(e) => setGlobal(e.target.value)} placeholder="https://…" />
        ) : (
          <div className="space-y-1.5">
            {Array.from({ length: total }, (_, i) =>
              jugables[i] ? (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-parch-400">Partida {i + 1}</span>
                  <input
                    className="field"
                    value={replays[i]}
                    onChange={(e) => cambiarLink(i, e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      {delDraft && (
        <p className="hint text-xs">Se guardan el mapa y las civs del draft de la partida {delDraft.game_no}.</p>
      )}
      {error && <Alerta>{error}</Alerta>}
      <button className="btn btn-primary w-full" disabled={sinCambios} onClick={guardar}>
        Guardar
      </button>
    </div>
  );
}
