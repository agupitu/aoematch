import type { MatchDetail } from '../types';
import { Badge } from './ui';

type Partida = MatchDetail['games'][number];

/**
 * Las partidas jugadas de la serie: quién ganó cada una, el mapa y las civs de
 * cada equipo (lo que se cargó o salió del draft). Una partida sin mapa ni
 * civs muestra solo el resultado.
 */
export function PartidasDeLaSerie({ m }: { m: MatchDetail }) {
  const nombres = { a: m.teams.a?.name ?? 'Equipo A', b: m.teams.b?.name ?? 'Equipo B' };
  const jugadas = m.games.filter((g) => g.winner_team_id || g.map || g.civs.length);
  if (!jugadas.length) return null;

  const civsDe = (g: Partida, teamId: string | null) => g.civs.filter((c) => c.team_id === teamId);

  return (
    <section className="card p-4">
      <h3 className="title mb-3 text-base">Partidas de la serie</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {jugadas.map((g) => (
          <div key={g.id} className="space-y-3 rounded-lg border border-ink-700 p-3">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm text-parch-100">Partida {g.game_no}</strong>
              {g.winner_team_id && (
                <Badge tone="good">Ganó {g.winner_team_id === m.team_a_id ? nombres.a : nombres.b}</Badge>
              )}
            </div>

            {g.map && (
              <div className="flex items-center gap-2">
                <img src={g.map.img} alt="" className="h-10 w-10 rounded object-cover" />
                <span className="text-sm text-parch-200">{g.map.name_es}</span>
              </div>
            )}

            {g.civs.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {([['a', m.team_a_id], ['b', m.team_b_id]] as const).map(([lado, teamId]) => (
                  <div key={lado} className="min-w-0">
                    <p
                      className={`mb-1 truncate text-[11px] ${
                        g.winner_team_id && g.winner_team_id === teamId ? 'text-gold-400' : 'text-parch-400'
                      }`}
                    >
                      {nombres[lado]}
                    </p>
                    <ul className="space-y-1">
                      {civsDe(g, teamId).map((c, i) => (
                        <li key={`${c.user_id ?? 'sin'}-${i}`} className="flex items-center gap-1.5 text-xs">
                          {c.flag && <img src={c.flag} alt="" className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover" />}
                          <span className="min-w-0 truncate text-parch-200">
                            {c.name_es}
                            {c.user_id && <span className="text-parch-400"> · {c.display_name}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
