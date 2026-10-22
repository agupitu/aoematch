// Conexión a Firestore y ayudas comunes de la capa de datos.
//
// Convenciones de todos los módulos de data/:
//   - Leer devuelve objetos planos con `id` (el id del documento) o null.
//   - Las funciones de lectura aceptan una transacción opcional `tx`.
//   - Las de escritura aceptan un escritor opcional `w` (transacción o batch);
//     sin él escriben directo. Con `w` la escritura queda en cola hasta el
//     commit; sin él devuelven la promesa de Firestore. Siempre se puede
//     hacer `await`.
//   - Fechas como texto ISO, salvo donde Firestore pide Timestamp
//     (docs/firestore-modelo.md, "Fechas").

import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

// En Cloud Functions y en los emuladores el proyecto llega por el entorno.
if (!getApps().length) initializeApp();

export const firestore = getFirestore();
// Un campo undefined se omite en vez de cortar la escritura, como hacía SQLite
// con las columnas que no se mandaban.
firestore.settings({ ignoreUndefinedProperties: true });

export { FieldValue, Timestamp };

/** Ahora, en texto ISO 8601 UTC. */
export function ahora() {
  return new Date().toISOString();
}

/** Documento leído a objeto plano con su id, o null si no existe. */
export function aObjeto(snap) {
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** Un documento, dentro de la transacción si viene una. */
export async function leer(ref, tx) {
  return aObjeto(await (tx ? tx.get(ref) : ref.get()));
}

/** Varios documentos de una vez, en el mismo orden; los que faltan quedan en null. */
export async function leerVarios(refs, tx) {
  if (!refs.length) return [];
  const snaps = await (tx ? tx.getAll(...refs) : firestore.getAll(...refs));
  return snaps.map(aObjeto);
}

/** Todos los documentos que devuelve una consulta. */
export async function consultar(query, tx) {
  const qs = await (tx ? tx.get(query) : query.get());
  return qs.docs.map(aObjeto);
}

const DIRECTO = {
  create: (ref, datos) => ref.create(datos),
  set: (ref, datos, opciones) => (opciones ? ref.set(datos, opciones) : ref.set(datos)),
  update: (ref, datos) => ref.update(datos),
  delete: (ref) => ref.delete(),
};

/** El escritor a usar: el que vino (transacción o batch) o uno que escribe directo. */
export function escritor(w) {
  return w ?? DIRECTO;
}

/**
 * Corre `fn(tx, despues)` en una transacción de Firestore.
 *
 * Firestore exige leer todo antes de escribir (si no, tira "Firestore
 * transactions require all reads to be executed before all writes") y puede
 * reintentar `fn` si otro escribió en el medio. Por eso lo que no es la base
 * (encolar el reloj del draft, avisar en live/*) se registra con
 * `despues(efecto)` y corre una sola vez, después del commit.
 */
export async function enTransaccion(fn) {
  let efectos;
  const resultado = await firestore.runTransaction(async (tx) => {
    efectos = [];
    return fn(tx, (efecto) => efectos.push(efecto));
  });
  for (const efecto of efectos) await efecto(resultado);
  return resultado;
}

/** Ordena por varios criterios; `null`/`undefined` van al final. */
export function ordenarPor(lista, ...claves) {
  const valor = (x, k) => (typeof k === 'function' ? k(x) : x[k]);
  return [...lista].sort((a, b) => {
    for (const k of claves) {
      const va = valor(a, k);
      const vb = valor(b, k);
      if (va === vb) continue;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va < vb ? -1 : 1;
    }
    return 0;
  });
}
