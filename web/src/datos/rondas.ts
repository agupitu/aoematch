// tournaments/{slug}/rondas/{rondaId} y sus horarios/{uid}: las fechas que fija
// el staff para cada ronda y los horarios que carga cada jugador
// (docs/superpowers/specs/2026-10-27-horarios-por-ronda-design.md).
// Quién puede escribir qué lo deciden las reglas de firestore.rules.

import { collection, doc, setDoc } from 'firebase/firestore';
import { firestore } from '../firebase';
import { cantidadDeDias, rangoDeDias } from '../logica/calendario.js';
import { recortarBloques } from '../logica/cruce.js';
import type { Bloque, Ronda, RondaDoc } from '../types';
import { ahora, conMensaje, consultar, leer } from './base';

/** Un rango de fechas no pasa de un mes. */
export const MAX_DIAS_DE_RONDA = 31;

const rondas = (slug: string) => collection(firestore, 'tournaments', slug, 'rondas');
const refRonda = (slug: string, rondaId: string) => doc(rondas(slug), rondaId);
const refHorario = (slug: string, rondaId: string, uid: string) => doc(refRonda(slug, rondaId), 'horarios', uid);

/** Las rondas que ya tienen fechas: Map rondaId -> documento. */
export async function listarRondas(slug: string): Promise<Map<string, RondaDoc>> {
  const filas = await conMensaje(() => consultar(rondas(slug)));
  return new Map(filas.map((r) => [r.id, r as RondaDoc]));
}

/**
 * El staff fija o cambia las fechas de una ronda: de 00:00 de `desdeDia` a
 * 24:00 de `hastaDia` ('YYYY-MM-DD') en `zona`, la suya.
 */
export function guardarFechasDeRonda(slug: string, ronda: Ronda, desdeDia: string, hastaDia: string, zona: string) {
  const dias = cantidadDeDias(desdeDia, hastaDia);
  if (!(dias >= 1)) throw new Error('"Hasta" no puede ser anterior a "desde".');
  if (dias > MAX_DIAS_DE_RONDA) throw new Error(`El rango no puede pasar de ${MAX_DIAS_DE_RONDA} días.`);
  const { starts_at, ends_at } = rangoDeDias(desdeDia, hastaDia, zona);
  return conMensaje(() =>
    setDoc(refRonda(slug, ronda.id), {
      stage_id: ronda.stage_id,
      bracket: ronda.bracket,
      round: ronda.round,
      label: ronda.label,
      from_day: desdeDia,
      to_day: hastaDia,
      zone: zona,
      starts_at,
      ends_at,
      updated_at: ahora(),
    })
  );
}

/** Mis horarios de una ronda ([] si todavía no cargué). */
export async function horarioPropio(slug: string, rondaId: string, uid: string): Promise<Bloque[]> {
  const h = await conMensaje(() => leer(refHorario(slug, rondaId, uid)));
  return (h?.blocks ?? []) as Bloque[];
}

/** Guarda mis horarios de una ronda, recortados a su rango de fechas. */
export function guardarHorarioPropio(slug: string, ronda: RondaDoc, uid: string, bloques: Bloque[]) {
  return conMensaje(() =>
    setDoc(refHorario(slug, ronda.id, uid), {
      user_id: uid,
      blocks: recortarBloques(bloques, ronda.starts_at, ronda.ends_at),
      updated_at: ahora(),
    })
  );
}

/** Horarios de varios jugadores en una ronda: Map uid -> bloques ([] si no cargaron). */
export async function horariosDeLaRonda(slug: string, rondaId: string, uids: string[]): Promise<Map<string, Bloque[]>> {
  const unicos = [...new Set(uids)];
  const filas = await conMensaje(() => Promise.all(unicos.map((uid) => leer(refHorario(slug, rondaId, uid)))));
  return new Map(unicos.map((uid, i) => [uid, (filas[i]?.blocks ?? []) as Bloque[]]));
}
