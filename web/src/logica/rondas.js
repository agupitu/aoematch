// Rondas de un cuadro: la unidad en la que cada jugador carga sus horarios
// (docs/superpowers/specs/2026-10-27-horarios-por-ronda-design.md).
//
// Una ronda es la terna (etapa, cuadro, número) de los partidos: `stage_id`,
// `bracket` (W, L o F) y `round`. El tercer puesto comparte ronda con la
// final y los grupos comparten la fecha N. Sin base de datos: trabaja sobre
// los partidos y etapas ya leídos.

import { terminado } from './llaves.js';
import { ordenarPor } from './orden.js';

const ORDEN_CUADRO = { W: 0, L: 1, F: 2 };

/** Id de la ronda de un partido: `{stage_id}_{bracket}{round}`, por ejemplo `Zk3_W2`. */
export const rondaIdDe = (m) => `${m.stage_id}_${m.bracket}${m.round}`;

/**
 * Las rondas de los partidos, en orden: etapa (`idx`), después ganadores,
 * perdedores y gran final, después número. El nombre es el `label` del primer
 * partido de la ronda por `position`.
 * @returns {{ id: string, stage_id: string, bracket: string, round: number, label: string, partidos: object[] }[]}
 */
export function rondasDelCuadro(partidos, etapas) {
  const idxDe = new Map(etapas.map((e) => [e.id, e.idx]));
  const porId = new Map();
  for (const m of partidos) {
    const id = rondaIdDe(m);
    if (!porId.has(id)) porId.set(id, { id, stage_id: m.stage_id, bracket: m.bracket, round: m.round, partidos: [] });
    porId.get(id).partidos.push(m);
  }
  const rondas = [...porId.values()].map((r) => {
    const delaRonda = ordenarPor(r.partidos, 'position');
    return { ...r, partidos: delaRonda, label: delaRonda[0].label ?? `Ronda ${r.round}` };
  });
  return ordenarPor(rondas, (r) => idxDe.get(r.stage_id) ?? 0, (r) => ORDEN_CUADRO[r.bracket] ?? 9, 'round');
}

/**
 * `jugada` si todos sus partidos están cerrados; si no, `abierta` cuando el
 * staff ya fijó las fechas (`docRonda`) y `sin_fechas` cuando no.
 */
export function estadoDeRonda(ronda, docRonda) {
  if (ronda.partidos.every(terminado)) return 'jugada';
  return docRonda ? 'abierta' : 'sin_fechas';
}

/** Las rondas en las que ese equipo tiene un partido sin cerrar. Sin equipo, ninguna. */
export function misRondas(partidos, etapas, equipoId) {
  if (!equipoId) return [];
  const pendientes = partidos.filter((m) => !terminado(m) && (m.team_a_id === equipoId || m.team_b_id === equipoId));
  const ids = new Set(pendientes.map(rondaIdDe));
  return rondasDelCuadro(partidos, etapas).filter((r) => ids.has(r.id));
}
