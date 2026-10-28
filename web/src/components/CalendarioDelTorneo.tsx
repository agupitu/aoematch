import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { listarRondas } from '../datos/rondas';
import { zonaDelNavegador } from '../lib';
import { fasesDelCalendario, mesesDelCalendario, rangoEnTexto } from '../logica/calendarioTorneo.js';
import { rondasDelCuadro } from '../logica/rondas.js';
import type { RondaDoc, Tournament } from '../types';

export type Fase = { id: string; label: string; tipo: string; desde: string | null; hasta: string | null };

/** Color del borde de cada tipo de fase. */
const COLOR: Record<string, string> = {
  inscripcion: '#5b9bd5',
  arranque: '#9aa5b5',
  grupos: '#6fa86a',
  octavos: '#a07fd0',
  cuartos: '#d98c4a',
  semifinal: '#d4607a',
  final: '#d9b25f',
  perdedores: '#6fc4c0',
  ronda: '#b08968',
};
const colorDe = (f: Fase) => COLOR[f.tipo] ?? COLOR.ronda;

const SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Calendario del resumen: inscripción, arranque y cada ronda con las fechas
 * que fijó el staff. Si todavía no hay ninguna fecha, no se muestra.
 */
export function CalendarioDelTorneo({ t }: { t: Tournament }) {
  const { user } = useAuth();
  const zona = user?.timezone || zonaDelNavegador();
  const [docs, setDocs] = useState<Map<string, RondaDoc>>(new Map());

  useEffect(() => {
    let vigente = true;
    listarRondas(t.id)
      .then((d) => vigente && setDocs(d))
      .catch(() => {}); // sin fechas de ronda se ve igual la inscripción
    return () => {
      vigente = false;
    };
  }, [t.id, t.matches]);

  const fases = useMemo(
    () => fasesDelCalendario(t, rondasDelCuadro(t.matches, t.stages), docs, t.stages, zona) as Fase[],
    [t, docs, zona]
  );
  return <Calendario fases={fases} zona={zona} />;
}

/** Los meses con las fases pintadas y, debajo, la leyenda con las fechas de cada una. */
export function Calendario({ fases, zona }: { fases: Fase[]; zona: string }) {
  const meses = useMemo(() => mesesDelCalendario(fases), [fases]);
  if (!meses.length) return null;

  const porId = new Map(fases.map((f) => [f.id, f]));
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date());

  return (
    <section className="card p-5">
      <h3 className="title mb-3 text-lg">Calendario</h3>

      <div className="space-y-4">
        {meses.map((m) => (
          <div key={`${m.anio}-${m.mes}`}>
            <h4 className="label normal-case first-letter:uppercase">
              {new Date(Date.UTC(m.anio, m.mes - 1, 1)).toLocaleDateString('es-AR', {
                month: 'long', year: 'numeric', timeZone: 'UTC',
              })}
            </h4>
            <div className="grid grid-cols-7 gap-1">
              {SEMANA.map((d, i) => (
                <span key={i} className="text-center text-[10px] text-parch-400">
                  {d}
                </span>
              ))}
              {m.dias.map((d, i) => {
                if (!d) return <span key={i} />;
                const delDia = d.fases.map((id) => porId.get(id)!);
                const principal = delDia[0];
                const color = principal ? colorDe(principal) : undefined;
                return (
                  <div
                    key={i}
                    title={delDia.length ? delDia.map((f) => f.label).join(' · ') : undefined}
                    style={principal ? { borderColor: color, backgroundColor: `${color}26` } : undefined}
                    className={`relative grid aspect-square place-items-center rounded-lg border-2 text-[11px] tabular-nums ${
                      principal ? 'text-parch-100' : 'border-ink-800 text-parch-400'
                    } ${d.dia === hoy ? 'ring-1 ring-parch-100' : ''}`}
                  >
                    {Number(d.dia.slice(8))}
                    {delDia.length > 1 && (
                      <span className="absolute right-0.5 bottom-0.5 left-0.5 flex justify-center gap-0.5">
                        {delDia.slice(1).map((f) => (
                          <span key={f.id} className="h-1 w-1 rounded-full" style={{ backgroundColor: colorDe(f) }} />
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <ul className="mt-4 space-y-1.5">
        {fases.map((f) => {
          const rango = rangoEnTexto(f);
          return (
            <li key={f.id} className="flex items-center gap-2 text-xs">
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-[5px] border-2 border-ink-700"
                style={rango ? { borderColor: colorDe(f), backgroundColor: `${colorDe(f)}26` } : undefined}
              />
              <span className={`min-w-0 flex-1 truncate ${rango ? 'text-parch-200' : 'text-parch-400/60'}`}>{f.label}</span>
              <span className="text-parch-400">{rango ?? 'sin fecha'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
