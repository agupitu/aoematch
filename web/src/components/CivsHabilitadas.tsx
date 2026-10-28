import { civs as catalogoCivs } from '../logica/catalogo.js';
import type { Civ } from '../types';

/**
 * Las civs del juego en dos bloques: arriba las del pool del torneo, abajo las
 * inhabilitadas, apagadas y con una diagonal roja sobre la bandera.
 */
export function CivsHabilitadas({ pool }: { pool: Civ[] }) {
  const todas: Civ[] = catalogoCivs();
  const ids = new Set(pool.map((c) => c.id));
  const habilitadas = todas.filter((c) => ids.has(c.id));
  const inhabilitadas = todas.filter((c) => !ids.has(c.id));

  return (
    <section className="card space-y-5 p-5">
      <div>
        <h3 className="title mb-3 text-lg">
          Civilizaciones habilitadas ({habilitadas.length} de {todas.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {habilitadas.map((c) => (
            <Civ key={c.id} civ={c} habilitada />
          ))}
        </div>
      </div>

      {inhabilitadas.length > 0 && (
        <div>
          <h3 className="title mb-3 text-lg text-parch-400">Inhabilitadas ({inhabilitadas.length})</h3>
          <div className="flex flex-wrap gap-2">
            {inhabilitadas.map((c) => (
              <Civ key={c.id} civ={c} habilitada={false} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Civ({ civ, habilitada }: { civ: Civ; habilitada: boolean }) {
  return (
    <span
      title={habilitada ? undefined : 'Inhabilitada'}
      className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${habilitada ? 'border-ink-700' : 'border-ink-800'}`}
    >
      {/* La diagonal roja va sobre la bandera, no sobre el nombre. */}
      <span className="relative h-5 w-8 shrink-0 overflow-hidden rounded-[3px]">
        <img
          src={civ.flag}
          alt=""
          className={`h-full w-full object-cover ${habilitada ? '' : 'opacity-40 grayscale'}`}
        />
        {!habilitada && (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <line x1="0" y1="100" x2="100" y2="0" stroke="#d64545" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </span>
      <span className={`text-[11px] ${habilitada ? 'text-parch-200' : 'text-parch-400/60'}`}>{civ.name_es}</span>
    </span>
  );
}
