// Draft de una partida, sin base de datos (plan Spark, decisiones D6 y D9–D11).
//
//   1. Mapa: lo elige el equipo que perdió la partida anterior. En la primera
//      no elige nadie: es `first_map_id` del torneo o uno al azar que sale del
//      id del partido, así todos los navegadores calculan el mismo.
//   2. Bans de civ: `civ_bans` por equipo, alternados; arranca el equipo que
//      no eligió mapa (en la primera, el equipo A).
//   3. Picks ciegos: cada jugador elige su civ sin ver las demás; se muestran
//      todas cuando eligieron todos. Se puede repetir civ, también en espejo y
//      dentro del mismo equipo (D6). Con `civ_repeat_series` en 0, nadie repite
//      una civ que ya usó en la serie.
//   Sin reloj: se espera a que elijan todos.
//
// El documento drafts/{gameNo} guarda lo que devuelve `planDeDraft` y lo van
// cambiando `elegirMapa` y `banear`. Los picks van aparte, en
// drafts/{gameNo}/picks/{uid}, y las reglas de Firestore no dejan leer el
// ajeno hasta que `revealed` es verdadero. Las mismas validaciones de acá las
// repiten las reglas: lo de acá es para avisar en pantalla antes de escribir.

import { civs as catalogoCivs, maps as catalogoMapas } from './catalogo.js';

/** Máximo de jugadores por equipo: las reglas revisan hasta 8 picks por draft. */
export const MAX_POR_EQUIPO = 4;

// ------------------------------------------------------------------- pools

/** Mapas del torneo, en el orden del catálogo (por nombre). */
export function poolMapas(torneo) {
  const ids = new Set(torneo.map_ids ?? []);
  return catalogoMapas().filter((m) => ids.has(m.id));
}

/** Civilizaciones del torneo, en el orden del catálogo (por nombre). */
export function poolCivs(torneo) {
  const ids = new Set(torneo.civ_ids ?? []);
  return catalogoCivs().filter((c) => ids.has(c.id));
}

const anteriores = (partido, gameNo) => (partido.games ?? []).filter((g) => g.game_no < gameNo);

/** Número de 32 bits estable a partir de un texto (FNV-1a). */
export function hash(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// ------------------------------------------------------------- crear draft

/**
 * Draft de la partida `gameNo` de un partido.
 *   torneo   doc del torneo (`map_ids`, `civ_ids`, `first_map_id`, `map_repeat`,
 *            `civ_bans`, `civ_repeat_series`, `team_size`)
 *   partido  doc del partido con su `id` (`team_a_id`, `team_b_id`, `games`)
 *   equipos  { a, b }: docs de los dos equipos (`captain_id`, `member_ids`)
 * Juegan los primeros `team_size` de cada equipo, capitán primero.
 */
export function planDeDraft(torneo, partido, equipos, gameNo = 1) {
  const { team_a_id: a, team_b_id: b } = partido;
  if (!a || !b) throw new Error('Faltan equipos en el partido.');
  if (torneo.team_size > MAX_POR_EQUIPO) throw new Error(`El draft admite hasta ${MAX_POR_EQUIPO} jugadores por equipo.`);

  const previas = anteriores(partido, gameNo);
  if (previas.length !== gameNo - 1 || previas.some((g) => !g.winner_team_id)) {
    throw new Error('La partida anterior todavía no tiene ganador.');
  }

  const mapas = poolMapas(torneo);
  if (!mapas.length) throw new Error('El torneo no tiene mapas.');
  const usados = new Set(previas.map((g) => g.map_id).filter((id) => id != null));
  const disponibles = torneo.map_repeat ? mapas : mapas.filter((m) => !usados.has(m.id));
  if (!disponibles.length) throw new Error('No quedan mapas sin jugar en la serie.');

  let eligeMapa = null;
  let mapa = null;
  if (gameNo === 1) {
    const fijo = mapas.find((m) => m.id === torneo.first_map_id);
    mapa = fijo ? fijo.id : mapas[hash(`${partido.id}#1`) % mapas.length].id;
  } else {
    const ganador = previas.find((g) => g.game_no === gameNo - 1).winner_team_id;
    eligeMapa = ganador === a ? b : a;
  }

  // Bans alternados; arranca el que no elige mapa.
  const primero = eligeMapa === a ? b : a;
  const segundo = primero === a ? b : a;
  const bans = Math.max(0, torneo.civ_bans ?? 0);
  const ordenDeBans = Array.from({ length: bans * 2 }, (_, i) => (i % 2 === 0 ? primero : segundo));

  const jugadores = (equipo) => {
    const ids = equipo?.member_ids ?? [];
    return [...ids.filter((id) => id === equipo.captain_id), ...ids.filter((id) => id !== equipo.captain_id)]
      .slice(0, torneo.team_size);
  };
  const deA = jugadores(equipos.a);
  const deB = jugadores(equipos.b);
  if (!deA.length || !deB.length) throw new Error('Algún equipo no tiene jugadores.');

  // Civs que cada jugador ya usó en la serie, si el torneo no deja repetir.
  const civsUsadas = {};
  if (torneo.civ_repeat_series === 0) {
    for (const g of previas) {
      for (const c of g.civs ?? []) (civsUsadas[c.user_id] ??= []).push(c.civ_id);
    }
  }

  return {
    game_no: gameNo,
    state: eligeMapa ? 'mapa' : ordenDeBans.length ? 'bans' : 'picks',
    team_a_id: a,
    team_b_id: b,
    map_chooser_team_id: eligeMapa,
    map_pool: disponibles.map((m) => m.id),
    map_id: mapa,
    civ_pool: poolCivs(torneo).map((c) => c.id),
    ban_order: ordenDeBans,
    banned_civ_ids: [],
    player_ids: [...deA, ...deB],
    team_of: Object.fromEntries([...deA.map((u) => [u, a]), ...deB.map((u) => [u, b])]),
    civs_usadas: civsUsadas,
    revealed: false,
  };
}

// ---------------------------------------------------------------- acciones

/** El equipo que tiene que elegir mapa elige uno del pool. */
export function elegirMapa(draft, teamId, mapId) {
  if (draft.state !== 'mapa') throw new Error('No es momento de elegir mapa.');
  if (teamId !== draft.map_chooser_team_id) throw new Error('El mapa lo elige el equipo que perdió la partida anterior.');
  if (!draft.map_pool.includes(mapId)) throw new Error('Ese mapa no se puede elegir.');
  return { ...draft, map_id: mapId, state: draft.ban_order.length ? 'bans' : 'picks' };
}

/** Equipo al que le toca banear, o null si ya no hay bans. */
export function turnoDeBan(draft) {
  return draft.state === 'bans' ? draft.ban_order[draft.banned_civ_ids.length] ?? null : null;
}

/** El equipo del turno banea una civ del pool que no esté baneada. */
export function banear(draft, teamId, civId) {
  if (draft.state !== 'bans') throw new Error('No es momento de banear.');
  if (teamId !== turnoDeBan(draft)) throw new Error('No es el turno de tu equipo.');
  if (!draft.civ_pool.includes(civId)) throw new Error('Esa civ no está en el torneo.');
  if (draft.banned_civ_ids.includes(civId)) throw new Error('Esa civ ya está baneada.');
  const banned = [...draft.banned_civ_ids, civId];
  return { ...draft, banned_civ_ids: banned, state: banned.length === draft.ban_order.length ? 'picks' : 'bans' };
}

/** Civs que un jugador puede elegir: el pool, sin baneadas ni las que ya usó en la serie. */
export function civsPermitidas(draft, uid) {
  const fuera = new Set([...draft.banned_civ_ids, ...(draft.civs_usadas[uid] ?? [])]);
  return draft.civ_pool.filter((id) => !fuera.has(id));
}

/** Tira un error si el pick no vale. Se puede cambiar mientras no se reveló. */
export function validarPick(draft, uid, civId) {
  if (draft.state !== 'picks' || draft.revealed) throw new Error('No es momento de elegir civ.');
  if (!draft.player_ids.includes(uid)) throw new Error('No jugás esta partida.');
  if (!civsPermitidas(draft, uid).includes(civId)) throw new Error('No podés elegir esa civ.');
}

/** ¿Ya eligieron todos? `picks` es { uid: civId }. */
export function eligieronTodos(draft, picks) {
  return draft.player_ids.every((uid) => picks[uid] != null);
}

/**
 * Draft revelado y cerrado, con las civs de cada uno listas para copiar a
 * `games[].civs` del partido. Tira un error si falta alguien.
 */
export function revelar(draft, picks) {
  if (draft.state !== 'picks') throw new Error('No es momento de revelar.');
  if (!eligieronTodos(draft, picks)) throw new Error('Falta que elijan todos.');
  return {
    draft: { ...draft, revealed: true, state: 'listo' },
    civs: draft.player_ids.map((uid) => ({ user_id: uid, team_id: draft.team_of[uid], civ_id: picks[uid] })),
  };
}
