import { ETIQUETA_ESTADO } from '../lib';

/**
 * Piezas decorativas del diseño nuevo: la rosa de los vientos, los íconos de
 * línea y la pastilla de estado de un torneo. Todo es SVG en línea, sin
 * archivos ni dependencias.
 */

/** Una punta de la rosa: dos mitades, una clara y otra en sombra. */
function Punta({ giro, largo, ancho }: { giro: number; largo: number; ancho: number }) {
  return (
    <g transform={`rotate(${giro} 100 100)`}>
      <polygon className="dn-rosa-clara" points={`100,100 ${100 - ancho},${100 - ancho} 100,${100 - largo}`} />
      <polygon className="dn-rosa-sombra" points={`100,100 ${100 + ancho},${100 - ancho} 100,${100 - largo}`} />
    </g>
  );
}

/** Rosa de los vientos: el aro de marcas gira muy despacio y la estrella se asienta al entrar. */
export function RosaDeLosVientos({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden className={`dn-rosa ${className}`}>
      <g className="dn-rosa-aro">
        <circle cx="100" cy="100" r="97" className="dn-rosa-linea" />
        <circle cx="100" cy="100" r="86" className="dn-rosa-linea" />
        {Array.from({ length: 72 }, (_, i) => {
          const largo = i % 18 === 0 ? 11 : i % 9 === 0 ? 8 : i % 3 === 0 ? 5 : 3;
          return (
            <line
              key={i}
              x1="100"
              y1="3"
              x2="100"
              y2={3 + largo}
              transform={`rotate(${i * 5} 100 100)`}
              className="dn-rosa-linea"
            />
          );
        })}
      </g>
      <g className="dn-rosa-estrella">
        <circle cx="100" cy="100" r="58" className="dn-rosa-linea dn-rosa-tenue" />
        <circle cx="100" cy="100" r="34" className="dn-rosa-linea dn-rosa-tenue" />
        {[22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((g) => (
          <Punta key={g} giro={g} largo={44} ancho={5} />
        ))}
        {[45, 135, 225, 315].map((g) => (
          <Punta key={g} giro={g} largo={60} ancho={8} />
        ))}
        {[0, 90, 180, 270].map((g) => (
          <Punta key={g} giro={g} largo={82} ancho={11} />
        ))}
        <circle cx="100" cy="100" r="5" className="dn-rosa-centro" />
      </g>
    </svg>
  );
}

type IconoProps = { className?: string };
const base = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function IconoCopa({ className = 'h-4 w-4' }: IconoProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 3h8v4a4 4 0 0 1-8 0V3Z" />
      <path d="M6 4.5H3.5c0 2.2 1 3.6 2.9 3.9M14 4.5h2.5c0 2.2-1 3.6-2.9 3.9" />
      <path d="M10 11v3M7 17h6M8 14h4" />
    </svg>
  );
}

export function IconoGente({ className = 'h-4 w-4' }: IconoProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="7.5" cy="7" r="2.6" />
      <path d="M2.5 16c.4-2.7 2.3-4.2 5-4.2s4.6 1.5 5 4.2" />
      <path d="M13 4.7a2.4 2.4 0 0 1 0 4.6M15 12.2c1.5.5 2.3 1.8 2.5 3.8" />
    </svg>
  );
}

export function IconoCalendario({ className = 'h-4 w-4' }: IconoProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.5h14M6.5 2.8v3M13.5 2.8v3" />
    </svg>
  );
}

export function IconoFlecha({ className = 'h-4 w-4' }: IconoProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5" />
    </svg>
  );
}

/** Estado del torneo con su punto de color; el de "en curso" late. */
export function EstadoTorneo({ status }: { status: string }) {
  return (
    <span className="dn-estado" data-estado={status}>
      <i aria-hidden />
      {ETIQUETA_ESTADO[status] ?? status}
    </span>
  );
}
