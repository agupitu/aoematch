import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';

type Trazo = { d: string; listo: boolean; columna: number };

/** Codo redondeado: sale del partido, baja o sube a mitad de camino y entra al siguiente. */
function camino(x1: number, y1: number, x2: number, y2: number) {
  const xm = (x1 + x2) / 2;
  const salto = y2 - y1;
  if (Math.abs(salto) < 1) return `M${x1} ${y1}H${x2}`;
  const r = Math.min(8, Math.abs(salto) / 2, xm - x1);
  const s = Math.sign(salto);
  return `M${x1} ${y1}H${xm - r}Q${xm} ${y1} ${xm} ${y1 + s * r}V${y2 - s * r}Q${xm} ${y2} ${xm + r} ${y2}H${x2}`;
}

/**
 * Las líneas de la llave (diseño nuevo). Va como último hijo del contenedor de
 * columnas (`.dn-llave`) y mide las tarjetas `[data-partido]` de cada columna
 * `[data-ronda]`. Une una columna con la siguiente solo cuando el cuadro lo
 * permite sin adivinar: el doble de partidos (dos llegan a uno, como arma
 * `logica/llaves.js`) o la misma cantidad (uno a uno, en el cuadro de perdedores).
 *
 * `firma` cambia cuando cambian los partidos: ahí se vuelve a medir.
 */
export function ConectoresDeLlave({ firma }: { firma: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [trazos, setTrazos] = useState<Trazo[]>([]);

  useLayoutEffect(() => {
    const llave = svg.current?.parentElement;
    if (!llave) return;

    // Con offsetLeft/offsetTop y no con getBoundingClientRect: la posición no
    // cambia mientras las columnas entran animadas con transform.
    const caja = (el: HTMLElement) => {
      let x = 0;
      let y = 0;
      for (let n: HTMLElement | null = el; n && n !== llave; n = n.offsetParent as HTMLElement | null) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      return { izquierda: x, derecha: x + el.offsetWidth, centro: y + el.offsetHeight / 2 };
    };

    const medir = () => {
      const columnas = [...llave.querySelectorAll<HTMLElement>(':scope > [data-ronda]')].map((c) => [
        ...c.querySelectorAll<HTMLElement>('[data-partido]'),
      ]);
      const nuevos: Trazo[] = [];
      for (let c = 0; c + 1 < columnas.length; c++) {
        const desde = columnas[c];
        const hacia = columnas[c + 1];
        const porDestino = desde.length === hacia.length * 2 ? 2 : desde.length === hacia.length ? 1 : 0;
        if (!porDestino || !hacia.length) continue;
        desde.forEach((origen, i) => {
          const a = caja(origen);
          const b = caja(hacia[Math.floor(i / porDestino)]);
          nuevos.push({
            d: camino(a.derecha, a.centro, b.izquierda, b.centro),
            listo: origen.dataset.listo !== undefined,
            columna: c,
          });
        });
      }
      setTrazos(nuevos);
    };

    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(llave);
    return () => observador.disconnect();
  }, [firma]);

  return (
    <svg ref={svg} aria-hidden className="dn-conectores">
      {/* Los caminos ya jugados van al final para quedar por encima de los otros. */}
      {trazos
        .map((t, i) => ({ ...t, i }))
        .sort((a, b) => Number(a.listo) - Number(b.listo))
        .map((t) => (
          <path
            key={t.i}
            d={t.d}
            pathLength={1}
            data-listo={t.listo || undefined}
            style={{ '--dn-col': t.columna } as CSSProperties}
          />
        ))}
    </svg>
  );
}
