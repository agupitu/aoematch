import { useMemo, useState } from 'react';
import type { Civ, GameMap } from '../types';
import { coincide } from '../lib';
import { ETIQUETA_REGION, ETIQUETA_TERRENO, REGIONES, TERRENOS, filtrarMapas } from '../logica/mapas-info.js';

function toggle(set: number[], id: number) {
  return set.includes(id) ? set.filter((x) => x !== id) : [...set, id];
}

type Opcion = { id: string; label: string; n?: number };

/** Una fila de filtros: una sola opción activa, con cuántos mapas daría cada una. */
function Chips({
  titulo,
  valor,
  onChange,
  opciones,
}: {
  titulo: string;
  valor: string;
  onChange: (v: string) => void;
  opciones: Opcion[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 text-xs text-parch-400">{titulo}</span>
      {opciones.map((o) => (
        <button
          type="button"
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={valor === o.id}
          className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
            valor === o.id
              ? 'border-gold-500 bg-gold-500/10 text-gold-400'
              : 'border-ink-700 text-parch-400 hover:border-ink-600 hover:text-parch-200'
          }`}
        >
          {o.label}
          {o.n !== undefined && <span className="ml-1 opacity-60">{o.n}</span>}
        </button>
      ))}
    </div>
  );
}

const etiquetaDe = (tabla: Record<string, string>, clave?: string) => (clave ? tabla[clave] : undefined);

/** Un mapa: la foto y el nombre. El clic lo agrega al pool (a la izquierda) o lo quita (a la derecha). */
function TarjetaDeMapa({
  m,
  accion,
  detalle,
  onClick,
}: {
  m: GameMap;
  accion: 'agregar' | 'quitar';
  detalle: string;
  onClick: () => void;
}) {
  const quitar = accion === 'quitar';
  return (
    <button
      type="button"
      onClick={onClick}
      title={detalle ? `${m.name_es} · ${detalle}` : m.name_es}
      aria-label={`${quitar ? 'Quitar' : 'Agregar'} ${m.name_es} ${quitar ? 'del' : 'al'} pool`}
      className={`group relative rounded-lg border p-1 text-left transition-colors ${
        quitar ? 'border-gold-500 bg-gold-500/10 hover:border-blood-500' : 'border-ink-700 hover:border-gold-600'
      }`}
    >
      <img src={m.img} alt="" className="aspect-square w-full rounded object-cover" loading="lazy" />
      <span className="mt-1 block truncate text-[11px] text-parch-200">{m.name_es}</span>
      {quitar ? (
        <span className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink-950/85 text-[11px] text-parch-200 group-hover:bg-blood-500 group-hover:text-parch-100">
          ✕
        </span>
      ) : (
        <span className="absolute top-1.5 right-1.5 hidden h-5 w-5 place-items-center rounded-full bg-gold-500 text-sm font-bold text-ink-950 group-hover:grid group-focus-visible:grid">
          +
        </span>
      )}
    </button>
  );
}

/**
 * Pool de mapas del torneo en dos lados: a la izquierda los mapas disponibles
 * (con búsqueda y filtros por terreno y región) y a la derecha el pool, en el
 * orden en que se fueron eligiendo. Un clic pasa un mapa de un lado al otro.
 */
export function MapPicker({
  maps,
  value,
  onChange,
}: {
  maps: GameMap[];
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const [q, setQ] = useState('');
  const [terreno, setTerreno] = useState('');
  const [region, setRegion] = useState('');

  const etiquetasTerreno: Record<string, string> = ETIQUETA_TERRENO;
  const etiquetasRegion: Record<string, string> = ETIQUETA_REGION;
  const detalleDe = (m: GameMap) =>
    [etiquetaDe(etiquetasTerreno, m.terreno), (m.regiones ?? []).map((r) => etiquetasRegion[r]).join(' y ')]
      .filter(Boolean)
      .join(' · ');

  const porId = useMemo(() => new Map(maps.map((m) => [m.id, m])), [maps]);
  const elegidos = value.map((id) => porId.get(id)).filter((m): m is GameMap => !!m);
  const disponibles = useMemo(() => maps.filter((m) => !value.includes(m.id)), [maps, value]);

  const filtros = { q, terreno, region };
  const visibles: GameMap[] = useMemo(
    () => filtrarMapas(disponibles, { q, terreno, region }),
    [disponibles, q, terreno, region]
  );
  // Cuántos mapas daría cada opción con los otros filtros puestos.
  const cuantos = (extra: { terreno?: string; region?: string }) =>
    filtrarMapas(disponibles, { ...filtros, ...extra }).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h4 className="label mb-0">Mapas disponibles</h4>
          <span className="text-xs text-parch-400">
            {visibles.length === disponibles.length ? disponibles.length : `${visibles.length} de ${disponibles.length}`}
          </span>
          <button
            type="button"
            className="btn btn-ghost ml-auto"
            disabled={!visibles.length}
            onClick={() => onChange([...value, ...visibles.map((m) => m.id)])}
          >
            Agregar los visibles{visibles.length ? ` (${visibles.length})` : ''}
          </button>
        </div>

        <input
          className="field mb-3 max-w-xs"
          placeholder="Buscar mapa…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mb-3 space-y-1.5">
          <Chips
            titulo="Terreno"
            valor={terreno}
            onChange={setTerreno}
            opciones={[
              { id: '', label: 'Todos', n: cuantos({ terreno: '' }) },
              ...(TERRENOS as string[]).map((t) => ({ id: t, label: etiquetasTerreno[t], n: cuantos({ terreno: t }) })),
            ]}
          />
          <Chips
            titulo="Región"
            valor={region}
            onChange={setRegion}
            opciones={[
              { id: '', label: 'Todas', n: cuantos({ region: '' }) },
              ...(REGIONES as string[]).map((r) => ({ id: r, label: etiquetasRegion[r], n: cuantos({ region: r }) })),
            ]}
          />
        </div>

        <div className="grid max-h-[28rem] min-h-40 grid-cols-[repeat(auto-fill,minmax(92px,1fr))] content-start gap-2 overflow-y-auto rounded-lg border border-ink-700 p-2">
          {visibles.length === 0 && (
            <p className="col-span-full p-6 text-center text-sm text-parch-400">
              {disponibles.length ? 'Ningún mapa disponible coincide con los filtros.' : 'Ya elegiste todos los mapas.'}
            </p>
          )}
          {visibles.map((m) => (
            <TarjetaDeMapa
              key={m.id}
              m={m}
              accion="agregar"
              detalle={detalleDe(m)}
              onClick={() => onChange([...value, m.id])}
            />
          ))}
        </div>
      </section>

      <aside className="min-w-0 self-start">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h4 className="label mb-0">Pool del torneo</h4>
          <span className="text-xs text-parch-400">
            {elegidos.length} {elegidos.length === 1 ? 'mapa' : 'mapas'}
          </span>
          <button type="button" className="btn btn-ghost ml-auto" disabled={!elegidos.length} onClick={() => onChange([])}>
            Quitar todos
          </button>
        </div>
        <div className="grid max-h-[34rem] min-h-40 grid-cols-[repeat(auto-fill,minmax(92px,1fr))] content-start gap-2 overflow-y-auto rounded-lg border border-gold-600/50 bg-gold-500/5 p-2">
          {elegidos.length === 0 && (
            <p className="col-span-full p-6 text-center text-sm text-parch-400">
              Todavía no elegiste ningún mapa. Hacé clic en uno de la izquierda para sumarlo.
            </p>
          )}
          {elegidos.map((m) => (
            <TarjetaDeMapa
              key={m.id}
              m={m}
              accion="quitar"
              detalle={detalleDe(m)}
              onClick={() => onChange(value.filter((id) => id !== m.id))}
            />
          ))}
        </div>
      </aside>
    </div>
  );
}

export function CivPicker({
  civs,
  value,
  onChange,
}: {
  civs: Civ[];
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const [q, setQ] = useState('');
  const grupos = useMemo(() => {
    const m = new Map<string, Civ[]>();
    for (const c of civs) {
      if (!coincide(q, c.name_es, c.name_en, c.slug)) continue;
      if (!m.has(c.grp)) m.set(c.grp, []);
      m.get(c.grp)!.push(c);
    }
    return [...m.entries()];
  }, [civs, q]);

  const etiquetas: Record<string, string> = {
    europea: 'Europeas',
    nativa: 'Nativas americanas',
    asiatica: 'Asiáticas',
    africana: 'Africanas',
    americana: 'Americanas',
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="field max-w-xs"
          placeholder="Buscar civilización…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-sm text-parch-400">{value.length} de {civs.length} habilitadas</span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => onChange(civs.map((c) => c.id))}>
            Todas
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onChange([])}>
            Ninguna
          </button>
        </div>
      </div>
      <div className="space-y-4">
        {grupos.length === 0 && (
          <p className="text-sm text-parch-400">Ninguna civilización coincide con «{q}».</p>
        )}
        {grupos.map(([grupo, lista]) => (
          <div key={grupo}>
            <div className="mb-1.5 flex items-center gap-2">
              <h4 className="label mb-0">{etiquetas[grupo] ?? grupo}</h4>
              <button
                type="button"
                className="text-[11px] text-parch-400 hover:text-gold-400"
                onClick={() => {
                  const ids = lista.map((c) => c.id);
                  const todas = ids.every((id) => value.includes(id));
                  onChange(todas ? value.filter((id) => !ids.includes(id)) : [...new Set([...value, ...ids])]);
                }}
              >
                alternar
              </button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
              {lista.map((c) => {
                const on = value.includes(c.id);
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => onChange(toggle(value, c.id))}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
                      on ? 'border-gold-500 bg-gold-500/10' : 'border-ink-700 opacity-50 hover:opacity-100'
                    }`}
                  >
                    <img src={c.flag} alt="" className="h-5 w-8 rounded-[2px] object-cover" />
                    <span className="truncate text-[11px] text-parch-200">{c.name_es}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
