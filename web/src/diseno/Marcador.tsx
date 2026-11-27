import type { ReactNode } from 'react';
import type { MatchDetail } from '../types';

/**
 * Cabecera de la sala del partido en el diseño nuevo: los dos equipos a los
 * lados y el tanteo en el medio; el ganador queda en oro y el otro, apagado.
 * `volver`, `detalle` y `acciones` son los mismos que usa la cabecera original.
 */
export function Marcador({
  m,
  nombres,
  volver,
  detalle,
  acciones,
}: {
  m: MatchDetail;
  nombres: { a: string; b: string };
  volver: ReactNode;
  detalle: ReactNode;
  acciones: ReactNode;
}) {
  const ganoA = !!m.winner_team_id && m.winner_team_id === m.team_a_id;
  const ganoB = !!m.winner_team_id && m.winner_team_id === m.team_b_id;

  return (
    <header className="dn-marcador-cab">
      <div className="dn-marcador-arriba">
        {volver}
        {acciones}
      </div>
      <h1 className="title dn-marcador" data-gano={ganoA ? 'a' : ganoB ? 'b' : undefined}>
        <span className="dn-bando" data-gano={ganoA || undefined}>
          {nombres.a}
        </span>
        <span className="dn-tanteo">
          <b>{m.score_a}</b>
          <i aria-hidden>–</i>
          <b>{m.score_b}</b>
        </span>
        <span className="dn-bando" data-gano={ganoB || undefined}>
          {nombres.b}
        </span>
      </h1>
      <p className="dn-marcador-detalle">{detalle}</p>
    </header>
  );
}
