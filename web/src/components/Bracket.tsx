import { Link } from 'react-router-dom';
import type { Match } from '../types';
import { ETIQUETA_ESTADO_PARTIDO, fechaCorta } from '../lib';
import { IconosVod } from './VodLinks';

function Lado({
  nombre,
  score,
  ganador,
}: {
  nombre: string | null;
  score: number;
  ganador: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm ${
        ganador ? 'text-gold-400' : nombre ? 'text-parch-200' : 'text-ink-600 italic'
      }`}
    >
      <span className="truncate">{nombre ?? 'por definir'}</span>
      <span className="tabular-nums">{score}</span>
    </div>
  );
}

export function MatchCard({ m }: { m: Match }) {
  const listo = ['finalizado', 'walkover'].includes(m.status);
  return (
    <div className="overflow-hidden rounded-lg border border-ink-700 bg-ink-850 transition-colors hover:border-gold-600">
      <div className="flex items-center justify-between gap-2 border-b border-ink-700 bg-ink-900 px-2.5 py-1 text-[10px] text-parch-400">
        <Link to={`/m/${m.id}`} className="min-w-0 flex-1 truncate hover:text-gold-400">
          {m.label ?? `Ronda ${m.round}`}
        </Link>
        <span className="flex items-center gap-1.5">
          <IconosVod links={m.vod_links ?? []} />
          <span>{listo ? ETIQUETA_ESTADO_PARTIDO[m.status] : m.scheduled_at ? fechaCorta(m.scheduled_at) : `BO${m.best_of}`}</span>
        </span>
      </div>
      <Link to={`/m/${m.id}`} className="block">
        <Lado nombre={m.team_a_name} score={m.score_a} ganador={m.winner_team_id === m.team_a_id} />
        <div className="border-t border-ink-800" />
        <Lado nombre={m.team_b_name} score={m.score_b} ganador={m.winner_team_id === m.team_b_id} />
      </Link>
    </div>
  );
}

export function Bracket({ matches }: { matches: Match[] }) {
  if (!matches.length) return null;

  const porBracket = new Map<string, Match[]>();
  for (const m of matches) {
    const k = m.bracket;
    if (!porBracket.has(k)) porBracket.set(k, []);
    porBracket.get(k)!.push(m);
  }

  const titulos: Record<string, string> = { W: 'Cuadro de ganadores', L: 'Cuadro de perdedores', F: 'Gran final' };
  const soloW = porBracket.size === 1 && porBracket.has('W');

  return (
    <div className="space-y-8">
      {[...porBracket.entries()].map(([bracket, lista]) => {
        const rondas = [...new Set(lista.map((m) => m.round))].sort((a, b) => a - b);
        return (
          <div key={bracket}>
            {!soloW && <h4 className="title mb-3 text-sm text-parch-400">{titulos[bracket] ?? bracket}</h4>}
            <div className="flex gap-4 overflow-x-auto pb-2">
              {rondas.map((r) => {
                const deRonda = lista.filter((m) => m.round === r).sort((a, b) => a.position - b.position);
                return (
                  <div key={r} className="flex min-w-[200px] flex-col justify-around gap-3">
                    <p className="text-center text-[11px] tracking-wide text-parch-400 uppercase">
                      {deRonda[0]?.label ?? `Ronda ${r}`}
                    </p>
                    {deRonda.map((m) => (
                      <MatchCard key={m.id} m={m} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
