import { guardarVodFase } from '../datos/torneos';
import type { Stage, StandingRow, Tournament } from '../types';
import { Bracket, MatchCard } from './Bracket';
import { Empty } from './ui';
import { EditorVod, ListaVod } from './VodLinks';

/**
 * Lo que se ve en la pestaña Llaves, fase por fase. En grupos + playoff, la
 * fase de grupos va primero, un bloque por grupo (su tabla y sus fechas), y
 * después las llaves de los playoffs; cada partido se muestra en la fase a la
 * que pertenece, nunca mezclado por número de ronda.
 */
export function Fases({ t, staff, onDone }: { t: Tournament; staff: boolean; onDone: () => void }) {
  const conGrupos = t.stages.some((s) => s.type === 'grupos');
  const hayPlayoffs = t.stages.some((s) => s.type !== 'grupos');
  const deLaFase = (id: string) => t.matches.filter((m) => m.stage_id === id);

  return (
    <div className="space-y-6">
      {t.standings && t.standings.length > 0 && <Tabla filas={t.standings} titulo="Posiciones" />}

      {t.stages.map((s) => (
        <section key={s.id} className="space-y-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="title text-base">{s.name}</h3>
            <ListaVod links={s.vod_links ?? []} />
          </header>
          {staff && (
            <EditorVod
              links={s.vod_links ?? []}
              onGuardar={(links) => guardarVodFase(t.id, s.id, links).then(onDone)}
            />
          )}
          {s.type === 'grupos' ? (
            <div className="space-y-8">
              {s.groups.map((g) => (
                <Grupo key={g.id} grupo={g} matches={deLaFase(s.id).filter((m) => m.group_id === g.id)} />
              ))}
            </div>
          ) : conGrupos ? (
            <Bracket matches={deLaFase(s.id)} />
          ) : null}
        </section>
      ))}

      {conGrupos && !hayPlayoffs && t.matches.length > 0 && (
        <section className="space-y-4">
          <h3 className="title text-base">Playoffs</h3>
          <Empty>Las llaves de los playoffs se arman al cerrar la fase de grupos.</Empty>
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

/** Un grupo: su tabla de posiciones y, debajo, sus fechas. */
function Grupo({ grupo, matches }: { grupo: Stage['groups'][number]; matches: Tournament['matches'] }) {
  return (
    <div className="space-y-4">
      <div className="max-w-xl">
        <Tabla filas={grupo.standings} titulo={grupo.name} />
      </div>
      <ListaPartidos matches={matches} />
    </div>
  );
}

function Tabla({ filas, titulo }: { filas: StandingRow[]; titulo: string }) {
  return (
    <section className="card overflow-hidden">
      <h4 className="title border-b border-ink-700 px-4 py-2.5 text-sm">{titulo}</h4>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-parch-400">
          <tr>
            <th className="px-4 py-2">Equipo</th>
            <th className="px-2 py-2">PJ</th>
            <th className="px-2 py-2">G</th>
            <th className="px-2 py-2">P</th>
            <th className="px-2 py-2">+/-</th>
            <th className="px-4 py-2">Pts</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr key={r.team.id} className="border-t border-ink-800">
              <td className="px-4 py-2 text-parch-100">{r.team.name}</td>
              <td className="px-2 py-2 text-parch-400">{r.pj}</td>
              <td className="px-2 py-2 text-parch-400">{r.pg}</td>
              <td className="px-2 py-2 text-parch-400">{r.pp}</td>
              <td className="px-2 py-2 text-parch-400">{r.gf - r.gc}</td>
              <td className="px-4 py-2 font-semibold text-gold-400">{r.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Los partidos agrupados por ronda (fecha), cada una con su título. */
function ListaPartidos({ matches }: { matches: Tournament['matches'] }) {
  const rondas = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  return (
    <div className="space-y-5">
      {rondas.map((r) => (
        <div key={r}>
          <h4 className="label">{matches.find((m) => m.round === r)?.label ?? `Ronda ${r}`}</h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
