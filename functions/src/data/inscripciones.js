// tournaments/{slug}/registrations/{uid} (docs/firestore-modelo.md). El id del
// documento es el uid del inscripto: reemplaza el UNIQUE (tournament_id, user_id).

import { ahora, consultar, escritor, leer, ordenarPor } from './base.js';
import { refTorneo } from './torneos.js';

const inscripciones = (slug) => refTorneo(slug).collection('registrations');

export const refInscripcion = (slug, uid) => inscripciones(slug).doc(String(uid));

export function leerInscripcion(slug, uid, tx) {
  return leer(refInscripcion(slug, uid), tx);
}

/** Todas las inscripciones del torneo, en orden de llegada. */
export async function listarInscripciones(slug, tx) {
  return ordenarPor(await consultar(inscripciones(slug), tx), 'created_at');
}

/**
 * Alta o reemplazo de la inscripción de un usuario, con los valores por
 * defecto de la tabla `registrations`.
 */
export function guardarInscripcion(slug, uid, datos, w) {
  return escritor(w).set(refInscripcion(slug, uid), {
    team_id: null,
    kind: 'solo',
    status: 'pendiente',
    paid: 0,
    paid_at: null,
    payment_ref: null,
    note: null,
    created_at: ahora(),
    ...datos,
    user_id: String(uid),
  });
}

export function actualizarInscripcion(slug, uid, cambios, w) {
  return escritor(w).update(refInscripcion(slug, uid), cambios);
}

/** ¿Cuenta para los contadores del torneo? (no retirada) */
export const vigente = (r) => !!r && r.status !== 'retirada';
