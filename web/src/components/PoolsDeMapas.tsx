import { useState } from 'react';
import { FASES_DE_MAPAS, fasesDelFormato } from '../logica/pools-por-fase.js';
import type { GameMap } from '../types';
import { MapPicker } from './PoolPicker';
import type { Borrador } from './TournamentForm';

const BASE = 'base';

/**
 * Pestaña Mapas del formulario: el organizador elige un pool para todo el
 * torneo o uno por fase. Con pool por fase, arriba van las fases como fichas y
 * abajo el selector de la elegida; el pool base lo usan las fases sin mapas propios.
 */
export function PoolsDeMapas({
  value,
  onChange,
  maps,
}: {
  value: Borrador;
  onChange: (v: Borrador) => void;
  maps: GameMap[];
}) {
  const fases = FASES_DE_MAPAS.filter((f) => (fasesDelFormato(value) as string[]).includes(f.id));
  const conFases = fases.length > 0;
  const porFase = conFases && value.map_pool_mode === 'por_fase';
  const [elegida, setElegida] = useState<string>(BASE);
  // Si cambia el formato y la fase elegida ya no existe, se vuelve al pool base.
  const activa = elegida === BASE || fases.some((f) => f.id === elegida) ? elegida : BASE;

  const deFase = (id: string) => value.map_pools[id] ?? [];
  const ponerFase = (id: string, ids: number[]) => {
    const pools = { ...value.map_pools };
    if (ids.length) pools[id] = ids;
    else delete pools[id];
    onChange({ ...value, map_pools: pools });
  };

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Cómo se arma el pool" className="grid gap-3 sm:grid-cols-2">
        <Opcion
          activa={!porFase}
          onClick={() => onChange({ ...value, map_pool_mode: 'unico' })}
          titulo="Un pool para todo el torneo"
          detalle="Los mismos mapas en todas las fases."
        />
        <Opcion
          activa={porFase}
          deshabilitada={!conFases}
          onClick={() => onChange({ ...value, map_pool_mode: 'por_fase' })}
          titulo="Un pool por fase"
          detalle={
            conFases
              ? 'Cada fase (grupos, cuartos, final...) con sus mapas.'
              : 'Liga y sistema suizo son una sola fase: usan un solo pool.'
          }
        />
      </div>

      {porFase && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Fase">
            <Ficha
              activa={activa === BASE}
              onClick={() => setElegida(BASE)}
              label="Pool base"
              cuenta={value.map_ids.length}
            />
            {fases.map((f) => (
              <Ficha
                key={f.id}
                activa={activa === f.id}
                onClick={() => setElegida(f.id)}
                label={f.label}
                cuenta={deFase(f.id).length || null}
              />
            ))}
          </div>
          <p className="hint text-xs">
            {activa === BASE
              ? 'Lo usan las fases que no tienen mapas propios. Las fases que no se lleguen a jugar (octavos con 8 equipos) se ignoran.'
              : deFase(activa).length
                ? `Mapas de ${FASES_DE_MAPAS.find((f) => f.id === activa)?.label}.`
                : `${FASES_DE_MAPAS.find((f) => f.id === activa)?.label} todavía usa el pool base: sumá mapas para darle uno propio.`}
          </p>
          {activa !== BASE && !deFase(activa).length && value.map_ids.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => ponerFase(activa, [...value.map_ids])}>
              Empezar con una copia del pool base
            </button>
          )}
        </div>
      )}

      {porFase && activa !== BASE ? (
        <MapPicker
          key={activa}
          maps={maps}
          value={deFase(activa)}
          onChange={(ids) => ponerFase(activa, ids)}
          titulo={`Pool de ${FASES_DE_MAPAS.find((f) => f.id === activa)?.label}`}
        />
      ) : (
        <MapPicker
          maps={maps}
          value={value.map_ids}
          onChange={(ids) => onChange({ ...value, map_ids: ids })}
          titulo={porFase ? 'Pool base' : 'Pool del torneo'}
        />
      )}
    </div>
  );
}

function Opcion({
  activa,
  deshabilitada = false,
  onClick,
  titulo,
  detalle,
}: {
  activa: boolean;
  deshabilitada?: boolean;
  onClick: () => void;
  titulo: string;
  detalle: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activa}
      disabled={deshabilitada}
      onClick={onClick}
      className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        activa ? 'border-gold-500 bg-gold-500/10' : 'border-ink-700 hover:border-ink-600'
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          activa ? 'border-gold-500' : 'border-ink-600'
        }`}
      >
        {activa && <span className="h-2 w-2 rounded-full bg-gold-500" />}
      </span>
      <span>
        <span className="block text-sm text-parch-100">{titulo}</span>
        <span className="hint block text-xs">{detalle}</span>
      </span>
    </button>
  );
}

function Ficha({
  activa,
  onClick,
  label,
  cuenta,
}: {
  activa: boolean;
  onClick: () => void;
  label: string;
  /** Mapas propios; null = usa el pool base. */
  cuenta: number | null;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        activa
          ? 'border-gold-500 bg-gold-500/10 text-gold-400'
          : 'border-ink-700 text-parch-400 hover:border-ink-600 hover:text-parch-200'
      }`}
    >
      {label}
      <span className="ml-1.5 opacity-70">{cuenta === null ? 'base' : cuenta}</span>
    </button>
  );
}
