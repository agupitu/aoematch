import { useMemo } from 'react';
import { guardarVodFase } from '../datos/torneos';
import { previaDePlayoffs, terminado } from '../logica/llaves.js';
import type { Match, Stage, StandingRow, Tournament } from '../types';
import { Bracket, MatchCard } from './Bracket';
import { Empty } from './ui';
import { EditorVod, ListaVod } from './VodLinks';

/**
 * Lo que se ve en la pestaña Llaves, fase por fase. En grupos + playoff, la
 * fase de grupos va primero, un grupo por columna (su tabla y, desplegable, sus
 * fechas), y después los playoffs. Mientras los grupos no terminan, los
 * playoffs se muestran con sus lugares ("1º Grupo A"), sin equipos.
 */
export function Fases({ t, staff, onDone }: { t: Tournament; staff: boolean; onDone: () => void }) {
  const etapaGrupos = t.stages.find((s) => s.type === 'grupos');
  const conGrupos = !!etapaGrupos;
  const hayPlayoffs = t.stages.some((s) => s.type !== 'grupos');
  const deLaFase = (id: string) => t.matches.filter((m) => m.stage_id === id);
  const delGrupos = etapaGrupos ? deLaFase(etapaGrupos.id) : [];
  const gruposTerminados = delGrupos.length > 0 && delGrupos.every(terminado);

  const encabezado = (s: Stage) => (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="title text-base">{s.name}</h3>
        <ListaVod links={s.vod_links ?? []} />
      </header>
      {staff && (
        <EditorVod links={s.vod_links ?? []} onGuardar={(links) => guardarVodFase(t.id, s.id, links).then(onDone)} />
      )}
    </>
  );

  return (
    <div className="space-y-6">
      {t.standings && t.standings.length > 0 && <Tabla filas={t.standings} titulo="Posiciones" />}

      {t.stages.map((s) => (
        <section key={s.id} className="space-y-4">
          {encabezado(s)}
          {s.type === 'grupos' ? (
            <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,30rem),1fr))]">
              {s.groups.map((g) => (
                <Grupo key={g.id} grupo={g} matches={deLaFase(s.id).filter((m) => m.group_id === g.id)} />
              ))}
            </div>
          ) : conGrupos ? (
            gruposTerminados ? (
              <Bracket matches={deLaFase(s.id)} />
            ) : (
              <PlayoffsPrevistos t={t} etapaGrupos={etapaGrupos} />
            )
          ) : null}
        </section>
      ))}

      {conGrupos && !hayPlayoffs && t.matches.length > 0 && (
        <section className="space-y-4">
          <h3 className="title text-base">Playoffs</h3>
          <PlayoffsPrevistos t={t} etapaGrupos={etapaGrupos} />
        </section>
      )}

      {t.matches.length === 0 ? (
        <Empty>Las llaves todavía no están generadas.</Empty>
      ) : conGrupos ? null : t.format === 'liga' || t.format === 'suizo' ? (
        <ListaPartidos matches={t.matches} />
      ) : (
        <Bracket matches={t.matches} />
      )}
    </div>
  );
}

/**
 * Los playoffs con sus lugares sin equipo ("1º Grupo A", "2º Grupo B"...):
 * quién pasa se sabe recién cuando terminan los grupos.
 */
function PlayoffsPrevistos({ t, etapaGrupos }: { t: Tournament; etapaGrupos: Stage | undefined }) {
  const partidos = useMemo(() => {
    if (!etapaGrupos) return [];
    let k = 0;
    const ids = { nuevoId: () => `p${++k}`, nuevoIdEtapa: () => `s${++k}` };
    const grupos = etapaGrupos.groups.map((g) => ({ id: g.id, name: g.name, cantidad: g.standings.length }));
    const p = previaDePlayoffs(t, grupos, ids);
    if (!p) return [];
    return (p.partidos as Match[])
      // Un lugar libre del cuadro no es un partido que se vea.
      .filter((m) => !(m.status === 'walkover' && !m.team_a_id && !m.team_b_id))
      .map((m) => ({
        ...m,
        team_a_name: (m.team_a_id && p.nombres.get(m.team_a_id)) || null,
        team_b_name: (m.team_b_id && p.nombres.get(m.team_b_id)) || null,
      }));
  }, [t, etapaGrupos]);

  const delGrupos = etapaGrupos ? t.matches.filter((m) => m.stage_id === etapaGrupos.id) : [];
  const terminaron = delGrupos.length > 0 && delGrupos.every(terminado);

  return (
    <div className="space-y-3">
      <p className="hint text-xs">
        {terminaron
          ? 'La fase de grupos terminó: falta generar los playoffs.'
          : 'Cuadro previsto: los equipos se definen cuando termina la fase de grupos.'}
      </p>
      {partidos.length > 0 ? <Bracket matches={partidos} previa /> : <Empty>Todavía no hay cuadro para mostrar.</Empty>}
    </div>
  );
}

/** Un grupo: su tabla de posiciones y, desplegable, sus fechas. */
function Grupo({ grupo, matches }: { grupo: Stage['groups'][number]; matches: Tournament['matches'] }) {
  return (
    <div className="space-y-2">
      <Tabla filas={grupo.standings} titulo={grupo.name} />
      <details className="group card overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm text-parch-200 select-none hover:text-gold-400 [&::-webkit-details-marker]:hidden">
          <span className="text-[10px] text-parch-400 transition-transform group-open:rotate-90">▶</span>
          Fechas · {matches.length} {matches.length === 1 ? 'partido' : 'partidos'}
        </summary>
        <div className="border-t border-ink-700 p-3">
          <ListaPartidos matches={matches} compacta />
        </div>
      </details>
    </div>
  );
}

/**
 * Posiciones. Las columnas de números tienen ancho fijo y van pegadas a la
 * derecha: el nombre ocupa el resto y se corta con "…" si no entra, así los
 * datos no se mueven con el largo del nombre.
 */
function Tabla({ filas, titulo }: { filas: StandingRow[]; titulo: string }) {
  return (
    <section className="card overflow-hidden">
      <h4 className="title border-b border-ink-700 px-4 py-2.5 text-sm">{titulo}</h4>
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-11" />
          <col className="w-12" />
        </colgroup>
        <thead className="text-xs text-parch-400">
          <tr>
            <th className="py-2 pr-2 pl-4 text-left font-semibold">Equipo</th>
            <th className="px-1 py-2 text-right font-semibold">PJ</th>
            <th className="px-1 py-2 text-right font-semibold">G</th>
            <th className="px-1 py-2 text-right font-semibold">P</th>
            <th className="px-1 py-2 text-right font-semibold">+/-</th>
            <th className="py-2 pr-4 pl-1 text-right font-semibold">Pts</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {filas.map((r) => (
            <tr key={r.team.id} className="border-t border-ink-800">
              <td className="truncate py-2 pr-2 pl-4 text-parch-100" title={r.team.name}>
                {r.team.name}
              </td>
              <td className="px-1 py-2 text-right text-parch-400">{r.pj}</td>
              <td className="px-1 py-2 text-right text-parch-400">{r.pg}</td>
              <td className="px-1 py-2 text-right text-parch-400">{r.pp}</td>
              <td className="px-1 py-2 text-right text-parch-400">{r.gf - r.gc}</td>
              <td className="py-2 pr-4 pl-1 text-right font-semibold text-gold-400">{r.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Los partidos agrupados por ronda (fecha), cada una con su título. `compacta`: una sola columna. */
function ListaPartidos({ matches, compacta = false }: { matches: Tournament['matches']; compacta?: boolean }) {
  const rondas = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  return (
    <div className="space-y-5">
      {rondas.map((r) => (
        <div key={r}>
          <h4 className="label">{matches.find((m) => m.round === r)?.label ?? `Ronda ${r}`}</h4>
          <div className={compacta ? 'grid gap-2' : 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'}>
            {matches
              .filter((m) => m.round === r)
              .map((m) => (
                <MatchCard key={m.id} m={m} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
