// matches/{matchId}/drafts/{gameNo} (docs/firestore-modelo.md). El id es el
// número de partida: reemplaza el UNIQUE (match_id, game_no). Las acciones van
// adentro del draft.

import { ahora, consultar, escritor, leer } from './base.js';
import { refPartido } from './partidos.js';

const drafts = (matchId) => refPartido(matchId).collection('drafts');

export const refDraft = (matchId, gameNo) => drafts(matchId).doc(String(gameNo));

export function leerDraft(matchId, gameNo, tx) {
  return leer(refDraft(matchId, gameNo), tx);
}

/** El draft de la partida más alta del partido, o null. */
export async function ultimoDraft(matchId, tx) {
  const q = drafts(matchId).orderBy('game_no', 'desc').limit(1);
  return (await consultar(q, tx))[0] ?? null;
}

/**
 * Alta con los valores por defecto de la tabla `drafts`. Falla si esa partida
 * ya tiene draft.
 */
export function guardarDraft(matchId, gameNo, datos, w) {
  return escritor(w).create(refDraft(matchId, gameNo), {
    state: 'espera',
    steps: [],
    current_step: 0,
    first_team_id: null,
    deadline_at: null,
    ready_a: 0,
    ready_b: 0,
    actions: [],
    created_at: ahora(),
    finished_at: null,
    ...datos,
    game_no: Number(gameNo),
  });
}

export function actualizarDraft(matchId, gameNo, cambios, w) {
  return escritor(w).update(refDraft(matchId, gameNo), cambios);
}
