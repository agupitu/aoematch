// Aviso de cambios de cada partido: live/{matchId} lleva un contador por tipo
// de cambio. El cliente lo escucha (las reglas lo dejan leer a cualquiera) y,
// cuando cambia, le vuelve a pedir el estado a la API. No lleva datos: así los
// picks ciegos del draft siguen ocultos y la API decide qué ve cada uno.
// Reemplaza el publish() de bus.js.

import { FieldValue, firestore } from './data/base.js';

/** draft: el draft avanzó · match: resultado, horario o estado · votes: votos de horario */
export const TIPOS = ['draft', 'match', 'votes'];

/**
 * Suma uno al contador `tipo` del partido. Va siempre después del commit de la
 * transacción que hizo el cambio (con `despues` de enTransaccion), porque una
 * transacción se puede reintentar.
 */
export function avisar(matchId, tipo) {
  if (!TIPOS.includes(tipo)) throw new Error(`Aviso desconocido: ${tipo}`);
  return firestore
    .collection('live')
    .doc(String(matchId))
    .set({ [tipo]: FieldValue.increment(1), at: FieldValue.serverTimestamp() }, { merge: true });
}
