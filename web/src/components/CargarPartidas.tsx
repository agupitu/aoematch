import { useState } from 'react';
import type { DraftRevelado } from '../datos/drafts';
import type { PartidaDeSerie } from '../datos/resultados';
import { civs as catalogoCivs, maps as catalogoMapas } from '../logica/catalogo.js';
import { civsALugares, civsDelEquipo, lugaresACivs, lugaresDelEquipo } from '../logica/detallePartida.js';
import { estadoDeSerie, partidasJugables, partidasMaximas } from '../logica/series.js';
import type { Civ, GameMap, MatchDetail } from '../types';
import { ElegirConImagen, type ItemElegible } from './ElegirConImagen';
import { Alerta } from './ui';

/** Mapa y civs elegidos para una partida, como texto ('' = sin cargar): las civs por lugar de cada equipo. */
type Detalle = { mapa: string; a: string[]; b: string[] };

const LADOS = ['a', 'b'] as const;

const ITEMS_CIVS: ItemElegible[] = (catalogoCivs() as Civ[]).map((c) => ({ id: c.id, nombre: c.name_es, img: c.flag }));
const ITEMS_MAPAS: ItemElegible[] = (catalogoMapas() as GameMap[]).map((mp) => ({ id: mp.id, nombre: mp.name_es, img: mp.img }));
const CIV = new Map(ITEMS_CIVS.map((i) => [String(i.id), i]));
const MAPA = new Map(ITEMS_MAPAS.map((i) => [String(i.id), i]));

/** ¿Hace falta un modal ancho? Cada partida lleva un círculo y una civ por jugador. */
export const necesitaAncho = (m: MatchDetail) =>
  112 + partidasMaximas(m) * (44 + Math.max(1, m.tournament.team_size) * 36 + 8) + 48 > 470;

/**
 * Staff: carga todas las partidas de la serie en un solo cuadro. Las partidas
 * van en las columnas y, de arriba abajo: el mapa, una fila por equipo (el
 * círculo amarillo marca a quien ganó y al lado va la civ que usó cada jugador)
 * y el link del replay de esa partida. Debajo, un link para todas. Las partidas
 * sin mapa ni civs cargados salen precargadas con las de su draft revelado.
 */
export function CargarPartidas({
  m, delDrafts, error, onGuardar,
}: {
  m: MatchDetail;
  delDrafts: DraftRevelado[];
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
  const [global, setGlobal] = useState('');

  // Un lugar de civ por jugador de cada equipo; el draft revelado de una partida sin datos la rellena.
  const lugares = Object.fromEntries(
    LADOS.map((l) => {
      const e = m.teams[l];
      return [l, e ? lugaresDelEquipo(e, Math.max(m.tournament.team_size, civsDelEquipo([...m.games, ...delDrafts], e.id))) : []];
    })
  ) as Record<'a' | 'b', ReturnType<typeof lugaresDelEquipo>>;
  const delDraft = (n: number) => delDrafts.find((d) => d.game_no === n);
  const detallesDe = (drafts: DraftRevelado[]): Detalle[] =>
    Array.from({ length: total }, (_, i) => {
      const propia = cargada(i + 1);
      const fuente = propia && (propia.map_id || propia.civs?.length) ? propia : drafts.find((d) => d.game_no === i + 1) ?? propia;
      const civs = fuente?.civs ?? [];
      return {
        mapa: fuente?.map_id ? String(fuente.map_id) : '',
        a: m.teams.a ? civsALugares(civs, m.teams.a, lugares.a) : [],
        b: m.teams.b ? civsALugares(civs, m.teams.b, lugares.b) : [],
      };
    });
  const [detalles, setDetalles] = useState<Detalle[]>(() => detallesDe(delDrafts));
  // Lo ya guardado, sin el draft: lo que el draft completa cuenta como cambio y deja guardar.
  const [inicial] = useState(() => JSON.stringify({ ganadores, replays, global, detalles: detallesDe([]) }));

  const lados = ganadores.map((id) => (id && id === m.team_a_id ? 'a' : id && id === m.team_b_id ? 'b' : null));
  const jugables: boolean[] = partidasJugables(m, lados);
  const gana = (lado: 'a' | 'b') => lados.filter((l, i) => jugables[i] && l === lado).length;
  const [a, b] = [gana('a'), gana('b')];
  const { ganador } = estadoDeSerie(m, a, b);

  const elegir = (i: number, teamId: string) =>
    setGanadores((g) => g.map((x, j) => (j === i ? (x === teamId ? null : teamId) : x)));
  const cambiarLink = (i: number, valor: string) => setReplays((r) => r.map((x, j) => (j === i ? valor : x)));
  const cambiarMapa = (i: number, mapa: string) => setDetalles((d) => d.map((x, j) => (j === i ? { ...x, mapa } : x)));
  const cambiarCiv = (i: number, lado: 'a' | 'b', lugar: number, valor: string) =>
    setDetalles((d) => d.map((x, j) => (j === i ? { ...x, [lado]: x[lado].map((v, k) => (k === lugar ? valor : v)) } : x)));

  const guardar = () => {
    const partidas: PartidaDeSerie[] = [];
    for (let i = 0; i < total; i++) {
      // Una partida que ya no se juega (la serie quedó definida antes) no guarda nada.
      const d = detalles[i];
      const winner = jugables[i] ? ganadores[i] : null;
      const map_id = jugables[i] && d.mapa ? Number(d.mapa) : null;
      const civs = jugables[i] ? LADOS.flatMap((l) => (m.teams[l] ? lugaresACivs(d[l], m.teams[l], lugares[l]) : [])) : [];
      const conDatos = !!winner || map_id !== null || civs.length > 0;
      if (!conDatos && !cargada(i + 1)) continue;
      // El link propio de la partida, o el de todas; sin ninguno se borra el que hubiera.
      const replay_url = conDatos ? replays[i].trim() || global.trim() : '';
      partidas.push({ game_no: i + 1, winner_team_id: winner, replay_url, map_id, civs });
    }
    onGuardar(partidas);
  };

  const sinCambios = JSON.stringify({ ganadores, replays, global, detalles }) === inicial;
  const nombreGanador = ganador === 'a' ? m.teams.a?.name : ganador === 'b' ? m.teams.b?.name : null;
  const columnas = Array.from({ length: total }, (_, i) => i);
  // Las partidas que se completaron con el draft (no tenían mapa ni civs guardados).
  const conDraft = columnas.filter((i) => {
    const propia = cargada(i + 1);
    return delDraft(i + 1) && !(propia && (propia.map_id || propia.civs?.length));
  });

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-[11px] text-parch-400">
              <th className="pr-2 text-left font-normal">Partida</th>
              {columnas.map((i) => (
                <th key={i} className="px-1 text-center font-normal" title={i + 1 > m.best_of ? 'Desempate' : undefined}>
                  {i + 1}
                  {i + 1 > m.best_of ? '*' : ''}
                </th>
              ))}
              <th className="pl-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pr-2 text-xs text-parch-400">Mapa</td>
              {columnas.map((i) => {
                const elegido = MAPA.get(detalles[i].mapa);
                return (
                  <td key={i} className="px-1 text-center align-top">
                    <ElegirConImagen
                      items={ITEMS_MAPAS}
                      valor={detalles[i].mapa}
                      onChange={(v) => cambiarMapa(i, v)}
                      titulo={`Mapa de la partida ${i + 1}`}
                      vacio="Sin mapa"
                      disabled={!jugables[i]}
                      className="mx-auto flex w-full min-w-[5.5rem] flex-col items-center gap-0.5 rounded-lg border border-dashed border-ink-600 px-1 py-1 text-[10px] text-parch-400 hover:border-gold-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-ink-600"
                    >
                      {elegido ? (
                        <>
                          <img src={elegido.img} alt="" className="h-9 w-9 rounded object-cover" />
                          <span className="max-w-[5.5rem] truncate text-parch-200">{elegido.nombre}</span>
                        </>
                      ) : (
                        <span className="grid h-9 place-items-center">Elegir mapa</span>
                      )}
                    </ElegirConImagen>
                  </td>
                );
              })}
              <td />
            </tr>

            {equipos.map((e, k) => {
              const lado = k === 0 ? 'a' : 'b';
              return (
                <tr key={e.id}>
                  <td className="max-w-[8rem] truncate pr-2 text-parch-100" title={e.name}>
                    {e.name}
                  </td>
                  {columnas.map((i) => {
                    const marcada = ganadores[i] === e.id && jugables[i];
                    return (
                      <td key={i} className="px-1">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            disabled={!jugables[i]}
                            aria-pressed={marcada}
                            aria-label={`${e.name} gana la partida ${i + 1}`}
                            onClick={() => elegir(i, e.id)}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                          >
                            <span
                              className={`h-5 w-5 rounded-full border-2 transition-colors ${
                                marcada ? 'border-gold-400 bg-gold-400' : 'border-ink-600'
                              }`}
                            />
                          </button>
                          {lugares[lado].map((lugar, n) => {
                            const civ = CIV.get(detalles[i][lado][n] ?? '');
                            return (
                              <ElegirConImagen
                                key={n}
                                items={ITEMS_CIVS}
                                valor={detalles[i][lado][n] ?? ''}
                                onChange={(v) => cambiarCiv(i, lado, n, v)}
                                titulo={`Civ de ${lugar.nombre} en la partida ${i + 1}${civ ? `: ${civ.nombre}` : ''}`}
                                vacio="Sin civ"
                                disabled={!jugables[i]}
                                className={`grid h-6 w-9 shrink-0 place-items-center overflow-hidden rounded border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                                  civ ? 'border-ink-600' : 'border-dashed border-ink-600 text-parch-400 hover:border-gold-600'
                                }`}
                              >
                                {civ ? <img src={civ.img} alt="" className="h-full w-full object-cover" /> : '+'}
                              </ElegirConImagen>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                  <td className="pl-2 text-right font-semibold text-gold-400 tabular-nums">{k === 0 ? a : b}</td>
                </tr>
              );
            })}

            <tr>
              <td className="pr-2 text-xs text-parch-400">Link</td>
              {columnas.map((i) => (
                <td key={i} className="px-1">
                  <input
                    className="field !py-1 text-xs"
                    style={{ minWidth: '5.5rem' }}
                    aria-label={`Link del replay de la partida ${i + 1}`}
                    placeholder="https://…"
                    disabled={!jugables[i]}
                    value={replays[i]}
                    onChange={(ev) => cambiarLink(i, ev.target.value)}
                  />
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <p className="hint text-xs">
        {nombreGanador ? `Gana la serie ${nombreGanador} (${a}–${b}).` : `La serie sigue sin definir (${a}–${b}).`}
        {total > m.best_of && ' * Desempate: se juega solo si empatan.'}
      </p>

      <div>
        <label className="label">Link de todas las partidas (opcional)</label>
        <input
          className="field"
          value={global}
          onChange={(ev) => setGlobal(ev.target.value)}
          placeholder="https://…"
        />
        <p className="hint mt-1 text-xs">Lo usan las partidas que no tienen su propio link.</p>
      </div>

      {conDraft.length > 0 && (
        <p className="hint text-xs">
          Mapa y civs de {conDraft.length > 1 ? 'las partidas' : 'la partida'} {conDraft.map((i) => i + 1).join(', ')} tomados del
          draft: se guardan con el resultado.
        </p>
      )}
      {error && <Alerta>{error}</Alerta>}
      <button className="btn btn-primary w-full" disabled={sinCambios} onClick={guardar}>
        Guardar
      </button>
    </div>
  );
}
