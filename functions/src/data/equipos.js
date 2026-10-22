// teams/{teamId} (docs/firestore-modelo.md). Los miembros van adentro del
// equipo; `member_ids` repite los uid para poder buscar con array-contains.

import { ahora, consultar, escritor, firestore, leer, leerVarios, ordenarPor } from './base.js';

const equipos = firestore.collection('teams');

/** Ref de un equipo; sin id, uno nuevo (para conocer el id antes de escribir). */
export const refEquipo = (id) => (id ? equipos.doc(String(id)) : equipos.doc());

export function leerEquipo(id, tx) {
  return leer(refEquipo(id), tx);
}

export function leerEquipos(ids, tx) {
  return leerVarios(ids.map(refEquipo), tx);
}

/** Equipos del torneo como el ORDER BY COALESCE(seed, 9999), id de antes. */
export async function listarEquipos(slug, tx) {
  const filas = await consultar(equipos.where('tournament_id', '==', String(slug)), tx);
  return ordenarPor(filas, (e) => e.seed ?? 9999, 'created_at', 'id');
}

/** El equipo de un usuario en un torneo, o null. */
export async function equipoDelUsuario(slug, uid, tx) {
  const q = equipos
    .where('tournament_id', '==', String(slug))
    .where('member_ids', 'array-contains', String(uid))
    .limit(1);
  return (await consultar(q, tx))[0] ?? null;
}

/** `members` y su `member_ids`, siempre juntos. */
export function conMiembros(members) {
  const limpios = members.map((m) => ({ user_id: String(m.user_id), role: m.role ?? 'jugador' }));
  return { members: limpios, member_ids: limpios.map((m) => m.user_id) };
}

/** Alta con los valores por defecto de la tabla `teams`. Devuelve el id. */
export async function guardarEquipo(datos, w, ref = refEquipo()) {
  const { members = [], ...resto } = datos;
  await escritor(w).set(ref, {
    tag: null,
    logo_url: null,
    captain_id: null,
    seed: null,
    auto_built: 0,
    created_at: ahora(),
    ...resto,
    ...conMiembros(members),
  });
  return ref.id;
}

/** Cambios parciales; si cambian los miembros, también `member_ids`. */
export function actualizarEquipo(id, cambios, w) {
  const { members, ...resto } = cambios;
  const datos = members ? { ...resto, ...conMiembros(members) } : resto;
  return escritor(w).update(refEquipo(id), datos);
}

export function borrarEquipo(id, w) {
  return escritor(w).delete(refEquipo(id));
}
