import type { ReactNode } from 'react';
import { ETIQUETA_FORMATO } from '../lib';
import { etiquetaDeSerie } from '../logica/series.js';
import type { GameMap, Tournament } from '../types';
import { EstadoTorneo } from './Adornos';

/**
 * Cabecera del torneo en el diseño nuevo: estado, formato, nombre en relieve y,
 * a la derecha, tres minimapas del pool como medallones.
 */
export function CabeceraTorneo({ t, acciones }: { t: Tournament; acciones: ReactNode }) {
  // El primer mapa del torneo, si está fijado, va adelante.
  const mapas = [t.first_map, ...t.maps]
    .filter((m, i, todos): m is GameMap => !!m && todos.findIndex((x) => x?.id === m.id) === i)
    .slice(0, 3);

  return (
    <header className="dn-cab">
      {mapas.length > 0 && (
        <div className="dn-cab-mapas" aria-hidden>
          {mapas.map((m) => (
            <img key={m.id} src={m.img} alt="" />
          ))}
        </div>
      )}

      <div className="dn-hero-texto dn-cab-texto">
        <div className="dn-cab-fichas">
          <EstadoTorneo status={t.status} />
          <span className="dn-ficha">{ETIQUETA_FORMATO[t.format] ?? t.format}</span>
          <span className="dn-ficha">
            {t.team_size}v{t.team_size}
          </span>
          <span className="dn-ficha">{etiquetaDeSerie(t)}</span>
        </div>
        <h1 className="title dn-titular dn-cab-nombre">{t.name}</h1>
        <p className="dn-cab-organiza">
          Organiza <strong>{t.organizer.display_name}</strong>
        </p>
        {t.description && <p className="dn-bajada">{t.description}</p>}
      </div>

      <div className="dn-cab-acciones">{acciones}</div>
    </header>
  );
}
