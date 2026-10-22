// rooms/{roomId} y rooms/{roomId}/messages (docs/firestore-modelo.md).
//
// Los nombres de sala que usa hoy la web ('tournament:<slug>', 'match:<id>',
// 'team:<id>') se guardan como 'torneo_<slug>', 'partido_<id>', 'equipo_<id>'.

import { FieldValue, ahora, consultar, escritor, firestore, leer } from './base.js';

const salas = firestore.collection('rooms');

const PREFIJOS = { tournament: 'torneo', match: 'partido', team: 'equipo' };

/** 'team:abc' -> 'equipo_abc'; null si no es un nombre de sala válido. */
export function idDeSala(room) {
  const [tipo, ...resto] = String(room).split(':');
  const id = resto.join(':');
  if (!PREFIJOS[tipo] || !id || id.includes('/')) return null;
  return `${PREFIJOS[tipo]}_${id}`;
}

export const refSala = (roomId) => salas.doc(String(roomId));

export function leerSala(roomId, tx) {
  return leer(refSala(roomId), tx);
}

/** Alta de una sala. Falla si ya existe. */
export function guardarSala(roomId, datos, w) {
  return escritor(w).create(refSala(roomId), {
    tournament_id: null,
    match_id: null,
    team_id: null,
    public_read: true,
    readers: [],
    created_at: ahora(),
    ...datos,
  });
}

/** Quién puede leer una sala privada (la de equipo): miembros y staff del torneo. */
export function actualizarLectores(roomId, readers, w) {
  return escritor(w).update(refSala(roomId), { readers: [...new Set(readers.map(String))] });
}

// --------------------------------------------------------------- mensajes

const mensajes = (roomId) => refSala(roomId).collection('messages');

/**
 * Agrega un mensaje con la hora del servidor. `user` va copiado (id, nombre y
 * avatar) porque el cliente lee los mensajes directo y no puede leer `users`.
 * Devuelve el id.
 */
export async function publicarMensaje(roomId, { user = null, body, system = 0 }, w) {
  const ref = mensajes(roomId).doc();
  await escritor(w).set(ref, {
    body: String(body),
    system: system ? 1 : 0,
    user: user
      ? { id: String(user.id), display_name: user.display_name, avatar_url: user.avatar_url ?? null }
      : null,
    created_at: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/** Los últimos `limite` mensajes, del más viejo al más nuevo, con `created_at` en ISO. */
export async function historial(roomId, limite = 80, tx) {
  const q = mensajes(roomId).orderBy('created_at', 'desc').limit(limite);
  const filas = await consultar(q, tx);
  return filas.reverse().map((m) => ({ ...m, created_at: m.created_at?.toDate().toISOString() ?? null }));
}
