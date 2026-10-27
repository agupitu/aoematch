// matches/{matchId}/drafts/{gameNo} y sus picks/{uid} (plan Spark). El
// documento es lo que arma `planDeDraft` (web/src/logica/draft.js); acá solo
// se guarda, para la demo y las pruebas. En la web escribe datos/drafts.ts.

import { leer, escritor } from './base.js';
import { refPartido } from './partidos.js';

export const refDraft = (matchId, gameNo) => refPartido(matchId).collection('drafts').doc(String(gameNo));

export const refPick = (matchId, gameNo, uid) => refDraft(matchId, gameNo).collection('picks').doc(String(uid));

export function leerDraft(matchId, gameNo, tx) {
  return leer(refDraft(matchId, gameNo), tx);
}

/** Guarda el draft de una partida tal como viene. */
export function guardarDraft(matchId, gameNo, datos, w) {
  return escritor(w).set(refDraft(matchId, gameNo), { picked: [], ...datos, game_no: Number(gameNo) });
}

/** Pick ciego de un jugador. */
export function guardarPick(matchId, gameNo, uid, civId, w) {
  return escritor(w).set(refPick(matchId, gameNo, uid), { civ_id: civId });
}
