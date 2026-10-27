// Resultados: los carga el staff (pedido del 2026-10-26). Cada partida de la
// serie va a `games` del partido; con la serie definida se cierra y la llave
// avanza, y una corrección la reabre (web/src/logica/llaves.js). Todo en una
// transacción que relee los partidos del torneo: dos cargas a la vez no se
// pisan.

import { collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { firestore } from '../firebase';
import { cargarPartidas, darWalkover } from '../logica/llaves.js';
import { type Doc, Rechazo, conMensaje } from './base';

type Resultado = { cambios: Doc[]; terminado: boolean };

/**
 * Lee todos los partidos del torneo dentro de una transacción, calcula con
 * `calcular` y escribe los que cambian. El torneo pasa a 'finalizado' cuando
 * no queda nada por jugar, y vuelve a 'en_curso' si una corrección reabre algo.
 */
async function enLaLlave(matchId: string, calcular: (partidos: Doc[]) => Resultado) {
  const m = await getDoc(doc(firestore, 'matches', matchId));
  if (!m.exists()) throw new Rechazo('Partido inexistente.');
  const slug = m.data().tournament_id as string;
  const ids = (await getDocs(query(collection(firestore, 'matches'), where('tournament_id', '==', slug)))).docs.map((d) => d.id);

  await runTransaction(firestore, async (tx) => {
    const refTorneo = doc(firestore, 'tournaments', slug);
    const [torneo, ...snaps] = await Promise.all([
      tx.get(refTorneo),
      ...ids.map((id) => tx.get(doc(firestore, 'matches', id))),
    ]);
    const partidos = snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }) as Doc);
    const { cambios, terminado } = calcular(partidos);
    for (const { id, ...campos } of cambios) tx.update(doc(firestore, 'matches', id), campos);
    const estado = torneo.data()?.status;
    if (terminado && estado !== 'finalizado') tx.update(refTorneo, { status: 'finalizado' });
    if (!terminado && estado === 'finalizado') tx.update(refTorneo, { status: 'en_curso' });
  });
}

export type Partida = {
  winner_team_id: string | null;
  map_id?: number | null;
  civs?: { user_id: string; team_id: string; civ_id: number }[];
  replay_url?: string | null;
};

/**
 * Carga o corrige la partida `gameNo`. Lo que no viene se conserva de la carga
 * anterior. Sin ganador, la partida queda sin contar (sirve para borrar una
 * carga equivocada).
 */
export function cargarPartida(matchId: string, gameNo: number, datos: Partida) {
  const replay = datos.replay_url?.trim() || null;
  if (replay && !/^https?:\/\//i.test(replay)) throw new Error('El link del replay tiene que empezar con http:// o https://.');
  return conMensaje(() =>
    enLaLlave(matchId, (partidos) => {
      const m = partidos.find((p) => p.id === matchId)!;
      const games: Doc[] = m.games ?? [];
      const previa = games.find((g) => g.game_no === gameNo);
      const nueva = {
        game_no: gameNo,
        map_id: datos.map_id ?? previa?.map_id ?? null,
        winner_team_id: datos.winner_team_id,
        replay_url: replay ?? previa?.replay_url ?? null,
        notes: previa?.notes ?? null,
        civs: datos.civs ?? previa?.civs ?? [],
      };
      return cargarPartidas(partidos, matchId, [...games.filter((g) => g.game_no !== gameNo), nueva]);
    })
  );
}

/** Walkover: el rival no se presentó. */
export function walkover(matchId: string, winnerTeamId: string) {
  return conMensaje(() => enLaLlave(matchId, (partidos) => darWalkover(partidos, matchId, winnerTeamId)));
}
