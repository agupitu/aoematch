// Mapa y civs de una partida cargados a mano por el staff: los lugares de civ
// de cada equipo (uno por jugador) y cómo pasan de la lista guardada en
// `games[].civs` a esos lugares y de vuelta. Sin base de datos ni DOM.
//
// Una civ guardada es { user_id, team_id, civ_id }. Si el equipo no tiene a
// todos sus jugadores cargados, el lugar queda sin jugador (`user_id` null).

/**
 * Los lugares de civ de un equipo: un jugador por lugar, empezando por los que
 * tiene, y hasta `cantidad` (el tamaño del equipo, o más si ya hay más civs
 * cargadas). `equipo` es `{ id, roster: [{ id, display_name }] }`.
 * @returns {{ user_id: string | null, nombre: string }[]}
 */
export function lugaresDelEquipo(equipo, cantidad) {
  const roster = equipo.roster ?? [];
  const n = Math.max(cantidad, roster.length);
  return Array.from({ length: n }, (_, i) => ({
    user_id: roster[i]?.id ?? null,
    nombre: roster[i]?.display_name ?? `Jugador ${i + 1}`,
  }));
}

/** Cuántas civs de ese equipo hay en una lista de partidas: sirve de mínimo de lugares. */
export const civsDelEquipo = (partidas, equipoId) =>
  Math.max(0, ...partidas.map((g) => (g.civs ?? []).filter((c) => c.team_id === equipoId).length));

/**
 * Las civs guardadas de un equipo, puestas en sus lugares: cada una donde está
 * su jugador y las demás en los lugares que quedan. Devuelve el id de la civ
 * como texto por lugar ('' si no hay), listo para un `<select>`.
 */
export function civsALugares(civs, equipo, lugares) {
  const delEquipo = (civs ?? []).filter((c) => c.team_id === equipo.id);
  const valores = lugares.map(() => '');
  const usadas = new Set();

  lugares.forEach((lugar, i) => {
    if (!lugar.user_id) return;
    const k = delEquipo.findIndex((c, j) => !usadas.has(j) && c.user_id === lugar.user_id);
    if (k >= 0) {
      valores[i] = String(delEquipo[k].civ_id);
      usadas.add(k);
    }
  });
  delEquipo.forEach((c, k) => {
    if (usadas.has(k)) return;
    const libre = valores.indexOf('');
    if (libre >= 0) valores[libre] = String(c.civ_id);
  });
  return valores;
}

/** Lo contrario: de los valores elegidos por lugar a las civs que se guardan; los lugares vacíos no cuentan. */
export function lugaresACivs(valores, equipo, lugares) {
  return valores.flatMap((v, i) => (v ? [{ user_id: lugares[i].user_id, team_id: equipo.id, civ_id: Number(v) }] : []));
}
