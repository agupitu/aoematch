// Reloj del draft con Cloud Tasks. Cada vez que un draft en curso estrena
// plazo, se encola una tarea para ese momento; al dispararse, la función
// `vencerPaso` (index.js) resuelve el paso al azar si el draft sigue ahí. Una
// tarea vieja o repetida no hace nada: el núcleo compara paso y plazo
// (draft-core.js, porTimeout). Reemplaza el setInterval de 1 s que corría en
// el servidor; la precisión pasa a ser de unos segundos.

import { getFunctions } from 'firebase-admin/functions';

export const REGION = 'southamerica-east1';
export const COLA = `locations/${REGION}/functions/vencerPaso`;

/**
 * Encola en Cloud Tasks (o en su emulador, si la función corre ahí). Fuera de
 * Cloud Functions, como en las pruebas y los scripts, no hay cola: queda el
 * respaldo de resolverVencidos (draft.js) al pedir el estado.
 */
async function encolarEnCloudTasks(datos, cuando) {
  if (!process.env.K_SERVICE && process.env.FUNCTIONS_EMULATOR !== 'true') return;
  await getFunctions().taskQueue(COLA).enqueue(datos, { scheduleTime: cuando });
}

let encolar = encolarEnCloudTasks;

/** Cambia cómo se encola: las pruebas lo usan para ver qué se programó. Sin argumento, vuelve al de verdad. */
export function usarEncolador(fn = encolarEnCloudTasks) {
  encolar = fn;
}

/** Programa el vencimiento del paso actual, si el draft está en curso y tiene reloj. */
export function programarVencimiento(matchId, draft) {
  if (draft.state !== 'en_curso' || !draft.deadline_at) return null;
  return encolar(
    { matchId: String(matchId), step: draft.current_step, deadline: draft.deadline_at },
    new Date(draft.deadline_at)
  );
}
