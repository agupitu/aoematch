import { useEffect, useRef } from 'react';
import { rectangulo } from '../logica/calendario.js';
import type { Dia } from '../types';

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type Punto = { d: number; i: number };

/** Día de la semana (0 = domingo) de una fecha 'YYYY-MM-DD'. */
const diaDeSemana = (dia: string) => {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
};

/**
 * Calendario de una ronda: una columna por día del rango y una barra de 30
 * minutos por cada media hora, de 00:00 a 24:00. Se pinta con el mouse
 * arrastrando un rectángulo: si la barra donde se apretó estaba apagada el
 * rectángulo enciende, y si estaba prendida borra. Las barras fuera del rango
 * de la ronda quedan apagadas. Controlado: `seleccion[d][i]` es la barra `i`
 * del día `d`. La lógica está en `web/src/logica/calendario.js`.
 */
export function CalendarioRonda({
  dias,
  seleccion,
  onChange,
  soloLectura = false,
}: {
  dias: Dia[];
  seleccion: boolean[][];
  onChange: (s: boolean[][]) => void;
  soloLectura?: boolean;
}) {
  const arrastre = useRef<{ base: boolean[][]; ancla: Punto; modo: boolean } | null>(null);

  useEffect(() => {
    const soltar = () => {
      arrastre.current = null;
    };
    window.addEventListener('mouseup', soltar);
    window.addEventListener('blur', soltar);
    return () => {
      window.removeEventListener('mouseup', soltar);
      window.removeEventListener('blur', soltar);
    };
  }, []);

  const empezar = (p: Punto) => {
    if (soloLectura) return;
    const modo = !seleccion[p.d][p.i];
    arrastre.current = { base: seleccion, ancla: p, modo };
    onChange(rectangulo(seleccion, dias, p, p, modo));
  };

  const seguir = (p: Punto) => {
    const a = arrastre.current;
    if (a) onChange(rectangulo(a.base, dias, a.ancla, p, a.modo));
  };

  return (
    <div className="select-none" aria-label="Calendario de horarios de la ronda">
      <div className="flex overflow-x-auto pb-1">
        <div className="sticky left-0 z-10 w-9 shrink-0 bg-ink-850">
          <div className="h-[45px]" />
          <div className="relative h-[384px]">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-1.5 text-[11px] leading-[11px] text-parch-400"
                style={{ top: 16 * h - 2 }}
              >
                {String(h).padStart(2, '0')}h
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1 gap-0.5">
          {dias.map((dia, d) => {
            const semana = diaDeSemana(dia.dia);
            const numero = Number(dia.dia.slice(8));
            const mes = d === 0 || numero === 1 ? MESES[Number(dia.dia.slice(5, 7)) - 1] : ' ';
            return (
              <div key={dia.dia} className={`min-w-[28px] flex-1 ${semana === 1 && d > 0 ? 'ml-1.5' : ''}`}>
                <div className="h-[45px] pt-[3px] text-center text-[11px] leading-[14px] text-parch-400">
                  <span className="block h-[14px]">{mes}</span>
                  <span className="block h-[14px]">{DIAS_SEMANA[semana]}</span>
                  <b className="block h-[14px] text-xs font-medium text-parch-100">{numero}</b>
                </div>
                {dia.barras.map((b, i) => {
                  const prendida = !!seleccion[d]?.[i];
                  const color = prendida ? 'bg-gold-500' : i % 2 ? 'bg-ink-700' : 'bg-ink-800';
                  const cursor = !b.dentro ? 'cursor-not-allowed opacity-30' : soloLectura ? '' : 'cursor-pointer';
                  const hover = b.dentro && !soloLectura && !prendida ? 'hover:bg-ink-600' : '';
                  return (
                    <div
                      key={i}
                      title={`${dia.dia} ${b.hora}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (b.dentro) empezar({ d, i });
                      }}
                      onMouseEnter={() => seguir({ d, i })}
                      className={`mb-px h-[7px] rounded-[2px] ${color} ${cursor} ${hover}`}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
