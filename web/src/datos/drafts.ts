// matches/{matchId}/drafts/{gameNo} y sus picks/{uid}: el draft de cada partida
// (plan Spark, decisiones D6 y D9–D11). La lógica de cada paso está en
// web/src/logica/draft.js; acá se lee, se escucha y se escribe. Las reglas
// de firestore.rules repiten cada validación: un paso fuera de turno falla
// aunque alguien se saltee la pantalla.

import { useEffect, useRef, useState } from 'react';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { firestore } from '../firebase';
import { banear, elegirMapa, eligieronTodos, planDeDraft, revelar, validarPick } from '../logica/draft.js';
import { proximaPartida } from '../logica/series.js';
import { type Doc, Rechazo, conMensaje } from './base';

export type Draft = Omit<ReturnType<typeof planDeDraft>, 'banned_civ_ids' | 'map_id' | 'map_chooser_team_id'> & {
  id: string;
  map_id: number | null;
  map_chooser_team_id: string | null;
  banned_civ_ids: number[];
  /** Los que ya eligieron civ (sin decir cuál). */
  picked?: string[];
};

const refDraft = (matchId: string, gameNo: number) =>
  doc(firestore, 'matches', matchId, 'drafts', String(gameNo));
const refPick = (matchId: string, gameNo: number, uid: string) =>
  doc(firestore, 'matches', matchId, 'drafts', String(gameNo), 'picks', uid);
const picksDe = (matchId: string, gameNo: number) =>
  collection(firestore, 'matches', matchId, 'drafts', String(gameNo), 'picks');

/**
 * Número de la partida que se juega ahora: la siguiente a las que ya tienen
 * ganador. null si la serie está cerrada o ya se jugaron todas.
 */
export function partidaActual(m: {
  status: string;
  best_of: number;
  series_mode?: string;
  games?: { winner_team_id: string | null }[];
}) {
  if (['finalizado', 'walkover'].includes(m.status)) return null;
  const ganadas = new Map<string, number>();
  for (const g of m.games ?? []) {
    if (g.winner_team_id) ganadas.set(g.winner_team_id, (ganadas.get(g.winner_team_id) ?? 0) + 1);
  }
  const [a = 0, b = 0] = [...ganadas.values()];
  return proximaPartida(m, a, b);
}

/**
 * Abre el draft de la partida `gameNo`. Lee torneo, partido y equipos al
 * momento, así el plan sale de lo guardado y no de lo que muestra la pantalla.
 * Si ya estaba abierto, no hace nada.
 */
export function abrirDraft(matchId: string, gameNo: number) {
  return conMensaje(() =>
    runTransaction(firestore, async (tx) => {
      if ((await tx.get(refDraft(matchId, gameNo))).exists()) return;
      const ms = await tx.get(doc(firestore, 'matches', matchId));
      if (!ms.exists()) throw new Rechazo('Partido inexistente.');
      const m = { id: ms.id, ...ms.data() } as Doc;
      const [ts, as, bs] = await Promise.all([
        tx.get(doc(firestore, 'tournaments', m.tournament_id)),
        tx.get(doc(firestore, 'teams', m.team_a_id)),
        tx.get(doc(firestore, 'teams', m.team_b_id)),
      ]);
      const plan = planDeDraft(ts.data(), m, { a: as.data(), b: bs.data() }, gameNo);
      tx.set(refDraft(matchId, gameNo), { ...plan, picked: [] });
    })
  );
}

/** El equipo que perdió la anterior elige el mapa. */
export function elegirMapaDelDraft(matchId: string, gameNo: number, teamId: string, mapId: number) {
  return conMensaje(() =>
    runTransaction(firestore, async (tx) => {
      const s = await tx.get(refDraft(matchId, gameNo));
      if (!s.exists()) throw new Rechazo('El draft no está abierto.');
      const d = elegirMapa(s.data(), teamId, mapId);
      tx.update(refDraft(matchId, gameNo), { map_id: d.map_id, state: d.state });
    })
  );
}

/** Ban de civ del equipo al que le toca. Relee el draft: dos clics a la vez no banean dos. */
export function banearCiv(matchId: string, gameNo: number, teamId: string, civId: number) {
  return conMensaje(() =>
    runTransaction(firestore, async (tx) => {
      const s = await tx.get(refDraft(matchId, gameNo));
      if (!s.exists()) throw new Rechazo('El draft no está abierto.');
      const d = banear(s.data(), teamId, civId);
      tx.update(refDraft(matchId, gameNo), { banned_civ_ids: d.banned_civ_ids, state: d.state });
    })
  );
}

/**
 * Pick propio. Va en un batch con `picked`, que anota que ya eligió sin decir
 * qué (las reglas no dejan anotarse sin el pick guardado). Se puede cambiar
 * mientras no se reveló. `companeros` son los picks que ya ven de su equipo,
 * para avisar antes de escribir si el torneo no deja repetir civ en el equipo.
 */
export function elegirCiv(
  draft: Draft,
  matchId: string,
  uid: string,
  civId: number,
  companeros: Record<string, number> = {}
) {
  validarPick(draft, uid, civId, companeros);
  const batch = writeBatch(firestore);
  batch.set(refPick(matchId, draft.game_no, uid), { civ_id: civId });
  if (!(draft.picked ?? []).includes(uid)) {
    batch.update(refDraft(matchId, draft.game_no), { picked: arrayUnion(uid) });
  }
  return conMensaje(async () => {
    try {
      await batch.commit();
    } catch (err) {
      // Dos compañeros pueden elegir la misma a la vez: las reglas dejan pasar solo a uno.
      if (draft.civ_repeat_team === 0 && (err as { code?: string }).code === 'permission-denied') {
        throw new Rechazo('Un compañero ya eligió esa civ.');
      }
      throw err;
    }
  });
}

/**
 * Revela el draft si ya eligieron todos. Lo intenta cualquiera de los que
 * juegan cuando ve la lista completa; si otro se adelantó, no pasa nada.
 */
export async function revelarSiEstanTodos(draft: Draft, matchId: string, uid: string) {
  if (draft.revealed || draft.state !== 'picks' || !draft.player_ids.includes(uid)) return;
  if (!draft.player_ids.every((p) => (draft.picked ?? []).includes(p))) return;
  try {
    await updateDoc(refDraft(matchId, draft.game_no), { revealed: true, state: 'listo' });
  } catch {
    // Otro jugador lo reveló primero.
  }
}

/** Reinicia el draft (sin reloj, D11): borra los picks y el draft. Solo el staff. */
export function reiniciarDraft(matchId: string, gameNo: number) {
  return conMensaje(async () => {
    const picks = await getDocs(picksDe(matchId, gameNo));
    const batch = writeBatch(firestore);
    picks.docs.forEach((p) => batch.delete(p.ref));
    await batch.commit();
    await deleteDoc(refDraft(matchId, gameNo));
  });
}

/** Civs de una partida revelada, listas para `games[].civs` (T40). */
export function civsDeLaPartida(draft: Draft, picks: Record<string, number>) {
  return revelar(draft, picks).civs;
}

export type EstadoDraft = {
  /** El draft de la partida actual, null si no se abrió, undefined mientras carga. */
  draft: Draft | null | undefined;
  /** Mi civ elegida (solo la veo yo hasta que se revela). */
  mio: number | null;
  /** Todos los picks, una vez revelado. */
  picks: Record<string, number> | null;
  /** Los picks de mis compañeros, antes de revelar: solo si el torneo no deja repetir civ en el equipo. */
  companeros: Record<string, number>;
  error: string;
};

/**
 * Escucha el draft de la partida `gameNo`, el pick propio y, revelado, todos
 * los picks. Si quien mira juega y ya eligieron todos, revela.
 */
export function useDraft(matchId: string | undefined, gameNo: number | null, uid: string | null): EstadoDraft {
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  // `revealed` ya guardado en el servidor: con la escritura local todavía
  // pendiente, las reglas rechazarían leer los picks ajenos.
  const [revelado, setRevelado] = useState(false);
  const [mio, setMio] = useState<number | null>(null);
  const [picks, setPicks] = useState<Record<string, number> | null>(null);
  const [companeros, setCompaneros] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const revelando = useRef(false);

  useEffect(() => {
    setDraft(undefined);
    if (!matchId || !gameNo) {
      setDraft(null);
      return;
    }
    return onSnapshot(
      refDraft(matchId, gameNo),
      { includeMetadataChanges: true },
      (s) => {
        const d = s.exists() ? ({ id: s.id, ...s.data() } as Draft) : null;
        setDraft(d);
        setRevelado(!!d?.revealed && !s.metadata.hasPendingWrites);
      },
      (err) => setError(err.message)
    );
  }, [matchId, gameNo]);

  const juego = !!uid && !!draft?.player_ids?.includes(uid);
  useEffect(() => {
    setMio(null);
    if (!matchId || !gameNo || !uid || !juego) return;
    return onSnapshot(
      refPick(matchId, gameNo, uid),
      (s) => setMio(s.exists() ? (s.data().civ_id as number) : null),
      () => setMio(null)
    );
  }, [matchId, gameNo, uid, juego]);

  // Sin repetir civ en el equipo, los compañeros se ven el pick (las reglas lo dejan solo entre ellos).
  const deMiEquipo =
    draft && draft.civ_repeat_team === 0 && uid && Array.isArray(draft.player_ids) && draft.team_of?.[uid]
      ? draft.player_ids.filter((p) => p !== uid && draft.team_of[p] === draft.team_of[uid])
      : [];
  const claveCompaneros = deMiEquipo.join(',');
  useEffect(() => {
    setCompaneros({});
    if (!matchId || !gameNo || !claveCompaneros || revelado) return;
    const bajas = claveCompaneros.split(',').map((p) =>
      onSnapshot(
        refPick(matchId, gameNo, p),
        (s) =>
          setCompaneros((c) => {
            const { [p]: _antes, ...resto } = c;
            return s.exists() ? { ...resto, [p]: s.data().civ_id as number } : resto;
          }),
        () => undefined
      )
    );
    return () => bajas.forEach((baja) => baja());
  }, [matchId, gameNo, claveCompaneros, revelado]);

  useEffect(() => {
    setPicks(null);
    if (!matchId || !gameNo || !revelado) return;
    return onSnapshot(
      picksDe(matchId, gameNo),
      (qs) => setPicks(Object.fromEntries(qs.docs.map((d) => [d.id, d.data().civ_id as number]))),
      (err) => setError(err.message)
    );
  }, [matchId, gameNo, revelado]);

  // Con todos anotados, el primero que lo ve revela.
  useEffect(() => {
    if (!draft || !Array.isArray(draft.player_ids) || !matchId || !uid || revelando.current) return;
    if (draft.revealed || !eligieronTodos(draft, Object.fromEntries((draft.picked ?? []).map((p) => [p, 1])))) return;
    revelando.current = true;
    void revelarSiEstanTodos(draft, matchId, uid).finally(() => {
      revelando.current = false;
    });
  }, [draft, matchId, uid]);

  return { draft, mio, picks, companeros, error };
}
