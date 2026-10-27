// Ayudas comunes de la capa de datos de la web (plan Spark: sin API).
//
// Convenciones de los módulos de datos/:
//   - Leer devuelve objetos planos con `id` (el id del documento) o null.
//   - Fechas como texto ISO, igual que las guardaba la API
//     (docs/firestore-modelo.md, "Fechas").
//   - Quién puede escribir qué lo decide firestore.rules: acá solo se arma la
//     escritura. Un rechazo de las reglas sale como error con mensaje propio.

import {
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  collection,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { firestore } from '../firebase';

// Los documentos tienen forma libre; cada pantalla los lee con su tipo de types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Doc = { id: string } & Record<string, any>;

export { ordenarPor } from '../logica/orden.js';

/** Ahora, en texto ISO 8601 UTC. */
export const ahora = () => new Date().toISOString();

export function aObjeto(snap: DocumentSnapshot): Doc | null {
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Un documento, o null si no existe. */
export async function leer(ref: DocumentReference): Promise<Doc | null> {
  return aObjeto(await getDoc(ref));
}

/** Todos los documentos que devuelve una consulta. */
export async function consultar(q: Query): Promise<Doc[]> {
  const qs = await getDocs(q);
  return qs.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Documentos de una colección por id (de a 30, el máximo de `in`): Map id -> doc. */
export async function leerPorIds(coleccion: string, ids: (string | null | undefined)[]): Promise<Map<string, Doc>> {
  const unicos = [...new Set(ids.filter((id): id is string => !!id))];
  const tandas: string[][] = [];
  for (let i = 0; i < unicos.length; i += 30) tandas.push(unicos.slice(i, i + 30));
  const filas = await Promise.all(
    tandas.map((t) => consultar(query(collection(firestore, coleccion), where(documentId(), 'in', t))))
  );
  return new Map(filas.flat().map((d) => [d.id, d]));
}

/** Error de una regla de negocio, con su mensaje para la pantalla. */
export class Rechazo extends Error {}

/** Mensaje en castellano para un error de Firestore (o el del Rechazo). */
export function mensajeDeError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  if (code === 'permission-denied') return 'No tenés permiso para hacer esto.';
  if (code === 'unavailable') return 'Sin conexión con la base. Probá de nuevo en un rato.';
  if (code === 'not-found') return 'Ya no existe.';
  return (err as Error)?.message || 'Algo falló. Probá de nuevo.';
}

/** Corre `fn` y, si falla, tira un Error con el mensaje de `mensajeDeError`. */
export async function conMensaje<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(mensajeDeError(err));
  }
}
