// tournaments/{slug}/rondas/{rondaId} y sus horarios/{uid}: las fechas de cada
// ronda y lo que cargan los jugadores (docs/firestore-modelo.md). La web tiene
// su propio módulo (web/src/datos/rondas.ts); este lo usan la demo y las pruebas.

import { ahora, consultar, escritor, leer, leerVarios } from './base.js';
import { refTorneo } from './torneos.js';

const rondas = (slug) => refTorneo(slug).collection('rondas');

/** La clave de la ronda es `{stage_id}_{bracket}{round}` (web/src/logica/rondas.js). */
export const refRonda = (slug, rondaId) => rondas(slug).doc(String(rondaId));

const refHorario = (slug, rondaId, uid) => refRonda(slug, rondaId).collection('horarios').doc(String(uid));

export function leerRonda(slug, rondaId, tx) {
  return leer(refRonda(slug, rondaId), tx);
}

/** Las rondas que ya tienen fechas. */
export function listarRondas(slug, tx) {
  return consultar(rondas(slug), tx);
}

/** Alta o cambio de las fechas de una ronda (reemplaza el documento). */
export function guardarRonda(slug, rondaId, datos, w) {
  return escritor(w).set(refRonda(slug, rondaId), { ...datos, updated_at: ahora() });
}

/** Horarios de un jugador en una ronda: `blocks` son `{ starts_at, ends_at }` en ISO UTC. */
export function guardarHorario(slug, rondaId, uid, blocks, w) {
  return escritor(w).set(refHorario(slug, rondaId, uid), { user_id: String(uid), blocks, updated_at: ahora() });
}

/** Horarios de varios jugadores en una ronda: Map uid -> bloques (`[]` si no cargó). */
export async function leerHorarios(slug, rondaId, uids, tx) {
  const unicos = [...new Set(uids.map(String))];
  const filas = await leerVarios(unicos.map((uid) => refHorario(slug, rondaId, uid)), tx);
  return new Map(unicos.map((uid, i) => [uid, filas[i]?.blocks ?? []]));
}
