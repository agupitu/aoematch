import { civs as catalogoCivs } from '../logica/catalogo.js';
import type { Civ } from '../types';

/**
 * Todas las civs del juego: las del pool del torneo se ven normales y las
 * inhabilitadas, apagadas y tachadas con una diagonal roja.
 */
export function CivsHabilitadas({ pool }: { pool: Civ[] }) {
  const todas: Civ[] = catalogoCivs();
  const habilitadas = new Set(pool.map((c) => c.id));

  return (
    <section className="card p-5">
      <h3 className="title mb-3 text-lg">
        Civilizaciones habilitadas ({pool.length} de {todas.length})
      </h3>
      <div className="flex flex-wrap gap-2">
        {todas.map((c) => {
          const habilitada = habilitadas.has(c.id);
          return (
            <span
              key={c.id}
              title={habilitada ? undefined : 'Inhabilitada'}
              className={`relative flex items-center gap-1.5 overflow-hidden rounded-lg border px-2 py-1 ${
                habilitada ? 'border-ink-700' : 'border-ink-800'
              }`}
            >
              <img
                src={c.flag}
                alt=""
                className={`h-4 w-6 rounded-[2px] object-cover ${habilitada ? '' : 'opacity-40 grayscale'}`}
              />
              <span className={`text-[11px] ${habilitada ? 'text-parch-200' : 'text-parch-400/60'}`}>{c.name_es}</span>
              {!habilitada && (
                <svg
                  aria-hidden
                  className="pointer-events-none absolute inset-0 h-full w-full text-blood-500"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
              )}
            </span>
          );
        })}
      </div>
    </section>
  );
}
