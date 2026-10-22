// matches/{matchId} (docs/firestore-modelo.md). Las partidas de la serie
// (`games`) y los votos de horario (`schedule_votes`) van adentro del partido.

import { ahora, consultar, escritor, firestore, leer, leerVarios, ordenarPor } from './base.js';

const partidos = firestore.collection('matches');

/** Ref de un partido; sin id, uno nuevo (las llaves necesitan los ids antes de escribir). */
export const refPartido = (id) => (id ? partidos.doc(String(id)) : partidos.doc());

export function leerPartido(id, tx) {
  return leer(refPartido(id), tx);
}

export function leerPartidos(ids, tx) {
  return leerVarios(ids.map(refPartido), tx);
}

/** Partidos del torneo como el ORDER BY bracket, round, position de antes. */
export async function listarPartidos(slug, tx) {
  const filas = await consultar(partidos.where('tournament_id', '==', String(slug)), tx);
  return ordenarPor(filas, 'bracket', 'round', 'position');
}

/** Alta con los valores por defecto de la tabla `matches`. Devuelve el id. */
export async function guardarPartido(datos, w, ref = refPartido()) {
  await escritor(w).set(ref, {
    stage_id: null,
    group_id: null,
    bracket: 'W',
    round: 1,
    position: 1,
    label: null,
    team_a_id: null,
    team_b_id: null,
    winner_team_id: null,
    score_a: 0,
    score_b: 0,
    best_of: 3,
    status: 'pendiente',
    scheduled_at: null,
    next_match_id: null,
    next_slot: null,
    loser_match_id: null,
    loser_slot: null,
    games: [],
    schedule_votes: [],
    created_at: ahora(),
    ...datos,
  });
  return ref.id;
}

export function actualizarPartido(id, cambios, w) {
  return escritor(w).update(refPartido(id), cambios);
}

export function borrarPartido(id, w) {
  return escritor(w).delete(refPartido(id));
}

// ------------------------------------------------- partidas y votos (puros)

/**
 * `games` con la partida `game_no` agregada o actualizada (solo los campos que
 * vienen), en orden. Reemplaza el INSERT / UPDATE de match_games.
 */
export function conPartida(games, partida) {
  const otras = games.filter((g) => g.game_no !== partida.game_no);
  const previa = games.find((g) => g.game_no === partida.game_no);
  const nueva = {
    map_id: null,
    winner_team_id: null,
    replay_url: null,
    notes: null,
    civs: [],
    ...previa,
    ...partida,
  };
  return ordenarPor([...otras, nueva], 'game_no');
}

/**
 * `schedule_votes` con el voto del usuario para ese horario reemplazado, como
 * el INSERT OR REPLACE de match_schedule_votes.
 */
export function conVoto(votos, { user_id, slot_utc, vote }) {
  const otros = votos.filter((v) => !(v.user_id === String(user_id) && v.slot_utc === slot_utc));
  return [...otros, { user_id: String(user_id), slot_utc, vote: vote ? 1 : 0 }];
}
