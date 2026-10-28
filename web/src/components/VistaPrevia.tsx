import { useState } from 'react';
import { Bracket, MatchCard } from './Bracket';
import { Badge } from './ui';
import { ETIQUETA_FORMATO } from '../lib';
import { MAX_EQUIPOS_PREVIA, armarPrevia, equiposPorDefecto } from '../logica/previa.js';
import { etiquetaDeSerie } from '../logica/series.js';
import type { Match } from '../types';
import type { Borrador } from './TournamentForm';

/** Fechas de la liga que se muestran antes de pedir "ver todas". */
const FECHAS_VISIBLES = 2;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * El torneo tal como va a quedar con el formato del formulario: se arma con el
 * mismo generador de llaves, con equipos de prueba. `nombres` son los equipos
 * que ya existen (los primeros lugares); el resto se llama "Equipo N".
 */
export function VistaPrevia({ value, nombres = [] }: { value: Borrador; nombres?: string[] }) {
  const [elegida, setElegida] = useState<number | null>(null);
  const automatica = Math.min(MAX_EQUIPOS_PREVIA, Math.max(equiposPorDefecto(value), nombres.length));
  const cantidad = elegida ?? automatica;
  const previa = armarPrevia(value, cantidad, nombres);
  const partidos = previa.partidos as unknown as Match[];

  const serie = etiquetaDeSerie({ series_mode: value.series_mode, best_of: value.best_of });
  const final = Number(value.best_of_final)
    ? etiquetaDeSerie({ series_mode: value.series_mode, best_of: Number(value.best_of_final) })
    : null;

  return (
    <section className="card mt-5 p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h3 className="title text-lg">Vista previa</h3>
        <label className="flex items-center gap-2 text-sm text-parch-400">
          Con
          <input
            className="field !w-20"
            type="number"
            min={2}
            max={MAX_EQUIPOS_PREVIA}
            value={elegida ?? automatica}
            onChange={(e) => setElegida(e.target.value === '' ? null : Number(e.target.value))}
            onBlur={() => setElegida((n) => (n === null ? null : Math.max(2, Math.min(MAX_EQUIPOS_PREVIA, n || 2))))}
          />
          equipos
        </label>
      </div>
      <p className="hint mb-3 text-sm">
        Así se arma con la configuración de arriba, con el mismo generador que usan las llaves de verdad.
        {value.max_teams === '' && ' Sin tope de equipos: probá con distintas cantidades.'}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Badge tone="gold">{ETIQUETA_FORMATO[value.format]}</Badge>
        <Badge>{previa.cantidad} equipos</Badge>
        {previa.fases.map((f) => (
          <Badge key={f.id}>
            {previa.fases.length > 1 ? `${f.nombre}: ` : ''}
            {plural(f.partidos, 'partido', 'partidos')}
          </Badge>
        ))}
        <Badge>
          {serie}
          {final && ` · final ${final}`}
        </Badge>
      </div>

      <Cuerpo value={value} previa={previa} partidos={partidos} />
    </section>
  );
}

type Previa = ReturnType<typeof armarPrevia>;

function Cuerpo({ value, previa, partidos }: { value: Borrador; previa: Previa; partidos: Match[] }) {
  if (value.format === 'liga') return <Fechas partidos={partidos} />;

  if (value.format === 'suizo') {
    const rondas = Number(value.swiss_rounds) || 0;
    return (
      <div className="space-y-3">
        <p className="label mb-0">Ronda 1</p>
        <Tarjetas partidos={partidos} />
        <p className="hint text-xs">
          {rondas > 1 ? `Las ${rondas - 1} rondas siguientes ` : 'Las rondas siguientes '}
          se arman según los puntos, sin repetir rivales.
          {previa.cantidad % 2 === 1 && ' Con una cantidad impar, uno queda libre en cada ronda.'}
        </p>
      </div>
    );
  }

  if (value.format === 'grupos_playoff') {
    const grupos = previa.etapas[0].groups as { id: string; name: string; team_ids: string[] }[];
    const nombre = new Map(previa.equipos.map((e) => [e.id, e.name]));
    const deGrupos = partidos.filter((m) => m.stage_id === previa.etapas[0].id);
    const fechas = new Set(deGrupos.map((m) => m.round)).size;
    const playoffs = previa.etapas[1] ? partidos.filter((m) => m.stage_id === previa.etapas[1].id) : [];

    return (
      <div className="space-y-5">
        <div>
          <p className="label">Fase de grupos</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {grupos.map((g) => (
              <div key={g.id} className="rounded-lg border border-ink-700 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <strong className="text-sm text-parch-100">{g.name}</strong>
                  <span className="text-xs text-parch-400">
                    {plural(deGrupos.filter((m) => m.group_id === g.id).length, 'partido', 'partidos')}
                  </span>
                </div>
                <ul className="space-y-1 text-sm text-parch-200">
                  {g.team_ids.map((id) => (
                    <li key={id} className="truncate">
                      {nombre.get(id)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="hint mt-2 text-xs">
            Se reparten en serpiente según la siembra. Dentro de cada grupo juegan todos contra todos
            ({plural(fechas, 'fecha', 'fechas')}) y pasan {value.group_advance} por grupo.
          </p>
        </div>

        {playoffs.length > 0 && (
          <div>
            <p className="label">Playoffs</p>
            <Bracket matches={playoffs} previa />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Bracket matches={partidos} previa />
      <p className="hint text-xs">
        Siembra clásica: el 1 juega contra el último, el 2 contra el anteúltimo, y así. Si sobran lugares, los
        mejor sembrados pasan directo.
      </p>
    </div>
  );
}

function Tarjetas({ partidos }: { partidos: Match[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {partidos.map((m) => (
        <MatchCard key={m.id} m={m} previa />
      ))}
    </div>
  );
}

/** Liga: las primeras fechas y un botón para ver el resto. */
function Fechas({ partidos }: { partidos: Match[] }) {
  const [todas, setTodas] = useState(false);
  const rondas = [...new Set(partidos.map((m) => m.round))].sort((a, b) => a - b);
  const visibles = todas ? rondas : rondas.slice(0, FECHAS_VISIBLES);

  return (
    <div className="space-y-4">
      {visibles.map((r) => (
        <div key={r}>
          <p className="label">{partidos.find((m) => m.round === r)?.label ?? `Fecha ${r}`}</p>
          <Tarjetas partidos={partidos.filter((m) => m.round === r)} />
        </div>
      ))}
      {rondas.length > FECHAS_VISIBLES && (
        <button type="button" className="btn btn-ghost" onClick={() => setTodas(!todas)}>
          {todas ? 'Ver menos' : `Ver las ${rondas.length} fechas`}
        </button>
      )}
    </div>
  );
}
