// Equipos del organizador y pedidos de ingreso, sin base de datos. Un equipo del
// organizador (`staff_made`) lo crea el staff vacío; los jugadores piden lugar
// y el staff aprueba (docs/firestore-modelo.md). Lo usan la capa de datos y las
// pruebas.

const conIds = (members) => ({ members, member_ids: members.map((m) => m.user_id) });

/** Largo máximo del nombre de un equipo: más no entra en las tablas y los cruces. */
export const MAX_NOMBRE_EQUIPO = 30;

/** El nombre de un equipo sin espacios de más y cortado al máximo. */
export const nombreDeEquipo = (nombre) => String(nombre ?? '').trim().slice(0, MAX_NOMBRE_EQUIPO);

/**
 * Capitán, miembros y `member_ids` del equipo una vez que entra `uid`. En un
 * equipo sin capitán, el primero que entra pasa a serlo. No toca `equipo`.
 */
export function conMiembro(equipo, uid, tamanio) {
  const members = equipo.members ?? [];
  if (members.some((m) => m.user_id === uid)) throw new Error('Ya está en el equipo.');
  if (members.length >= tamanio) throw new Error('El equipo ya está completo.');
  const captain_id = equipo.captain_id ?? uid;
  const nuevos = [...members, { user_id: uid, role: 'jugador' }].map((m) => ({
    ...m,
    role: m.user_id === captain_id ? 'capitan' : 'jugador',
  }));
  return { captain_id, ...conIds(nuevos) };
}

/**
 * Los campos del equipo sin `uid`. Si se iba el capitán, el primero que queda
 * pasa a serlo (las reglas no dejan un capitán fuera de su equipo). Un equipo
 * que queda vacío es `null` y se borra, salvo que sea del organizador: ese
 * queda como lugar libre.
 */
export function sinMiembro(equipo, uid) {
  const quedan = (equipo.members ?? []).filter((m) => m.user_id !== uid);
  if (!quedan.length) return equipo.staff_made ? { captain_id: null, ...conIds([]) } : null;
  if (equipo.captain_id !== uid) return conIds(quedan);
  const capitan = quedan[0].user_id;
  return {
    captain_id: capitan,
    ...conIds(quedan.map((m) => ({ ...m, role: m.user_id === capitan ? 'capitan' : 'jugador' }))),
  };
}

/** Inscripciones con un pedido de ingreso sin resolver, la más vieja primero. */
export function pedidosPendientes(inscripciones) {
  return inscripciones
    .filter((r) => r.status !== 'retirada' && !r.team_id && r.join_request?.status === 'pendiente')
    .sort((a, b) => String(a.join_request.created_at ?? '').localeCompare(String(b.join_request.created_at ?? '')));
}
