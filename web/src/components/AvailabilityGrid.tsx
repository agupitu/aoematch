import { useEffect, useMemo, useRef, useState } from 'react';
import { BLOQUE, DIAS, MINUTOS_SEMANA, localAUtc, offsetZona, utcALocal } from '../lib';

const POR_DIA = 1440 / BLOQUE; // 48
const TOTAL = (MINUTOS_SEMANA / BLOQUE) | 0; // 336

export type Bloque = { start_min: number; end_min: number };

function aMascara(bloques: Bloque[], offset: number): boolean[] {
  const m = new Array(TOTAL).fill(false);
  for (const b of bloques) {
    for (let min = b.start_min; min < b.end_min; min += BLOQUE) {
      m[Math.floor(utcALocal(min, offset) / BLOQUE)] = true;
    }
  }
  return m;
}

function aBloques(mask: boolean[], offset: number): Bloque[] {
  // Pasamos a minutos UTC sueltos y después fusionamos lo contiguo.
  const utc = new Set<number>();
  mask.forEach((v, i) => {
    if (v) utc.add(localAUtc(i * BLOQUE, offset));
  });
  const ordenados = [...utc].sort((a, b) => a - b);
  const salida: Bloque[] = [];
  for (const min of ordenados) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.end_min === min) ultimo.end_min = min + BLOQUE;
    else salida.push({ start_min: min, end_min: min + BLOQUE });
  }
  return salida;
}

export function AvailabilityGrid({
  value,
  onChange,
  timezone,
  readOnly = false,
  heat,
  heatMax,
}: {
  value: Bloque[];
  onChange?: (b: Bloque[]) => void;
  timezone: string;
  readOnly?: boolean;
  /** Conteo por bloque UTC, para pintar el cruce de un grupo. */
  heat?: number[];
  heatMax?: number;
}) {
  const offset = useMemo(() => offsetZona(timezone), [timezone]);
  const [mask, setMask] = useState<boolean[]>(() => aMascara(value, offset));
  const pintando = useRef<null | boolean>(null);

  useEffect(() => {
    setMask(aMascara(value, offset));
  }, [value, offset]);

  const aplicar = (i: number, encender: boolean) => {
    setMask((prev) => {
      if (prev[i] === encender) return prev;
      const next = [...prev];
      next[i] = encender;
      return next;
    });
  };

  const soltar = () => {
    if (pintando.current === null) return;
    pintando.current = null;
    onChange?.(aBloques(mask, offset));
  };

  useEffect(() => {
    if (readOnly) return;
    window.addEventListener('mouseup', soltar);
    return () => window.removeEventListener('mouseup', soltar);
  });

  const heatLocal = useMemo(() => {
    if (!heat) return null;
    const out = new Array(TOTAL).fill(0);
    heat.forEach((v, i) => {
      out[Math.floor(utcALocal(i * BLOQUE, offset) / BLOQUE)] = v;
    });
    return out;
  }, [heat, offset]);

  const max = heatMax || (heatLocal ? Math.max(1, ...heatLocal) : 1);

  return (
    <div className="select-none">
      <div className="flex gap-1 text-[10px] text-parch-400">
        <div className="w-10 shrink-0" />
        {DIAS.map((d) => (
          <div key={d} className="flex-1 pb-1 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        <div className="flex w-10 shrink-0 flex-col text-right text-[10px] leading-none text-parch-400">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} style={{ height: 2 * 7 }} className="pr-1">
              {h % 3 === 0 ? `${String(h).padStart(2, '0')}h` : ''}
            </div>
          ))}
        </div>
        {DIAS.map((_, dia) => (
          <div key={dia} className="flex flex-1 flex-col gap-px">
            {Array.from({ length: POR_DIA }, (_, s) => {
              const i = dia * POR_DIA + s;
              const on = mask[i];
              const h = heatLocal?.[i] ?? 0;
              const fondo = on
                ? 'bg-gold-500'
                : h
                  ? ''
                  : 'bg-ink-800 hover:bg-ink-700';
              return (
                <div
                  key={s}
                  title={`${DIAS[dia]} ${String(Math.floor((s * BLOQUE) / 60)).padStart(2, '0')}:${String((s * BLOQUE) % 60).padStart(2, '0')}${h ? ` · ${h} disponibles` : ''}`}
                  onMouseDown={() => {
                    if (readOnly) return;
                    pintando.current = !on;
                    aplicar(i, !on);
                  }}
                  onMouseEnter={() => {
                    if (readOnly || pintando.current === null) return;
                    aplicar(i, pintando.current);
                  }}
                  className={`h-[7px] rounded-[2px] ${fondo} ${readOnly ? '' : 'cursor-pointer'}`}
                  style={
                    !on && h
                      ? { backgroundColor: `color-mix(in oklab, var(--color-moss-500) ${(h / max) * 85}%, var(--color-ink-800))` }
                      : undefined
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-parch-400">
        Horarios en <span className="text-parch-200">{timezone}</span>
        {!readOnly && ' · arrastrá para pintar o borrar bloques de 30 minutos'}
      </p>
    </div>
  );
}
