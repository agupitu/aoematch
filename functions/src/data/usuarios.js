// users/{uid}, steamIds/{steam_id64} y authStates/{nonce} (docs/firestore-modelo.md).

import { Timestamp, ahora, consultar, escritor, firestore, leer, leerVarios } from './base.js';

const usuarios = firestore.collection('users');
const steamIds = firestore.collection('steamIds');

export const refUsuario = (uid) => usuarios.doc(String(uid));

export function leerUsuario(uid, tx) {
  return leer(refUsuario(uid), tx);
}

/** Usuarios por uid, sin repetidos: Map uid -> usuario (los que no existen no aparecen). */
export async function mapaDeUsuarios(uids, tx) {
  const unicos = [...new Set(uids.filter(Boolean).map(String))];
  const filas = await leerVarios(unicos.map(refUsuario), tx);
  return new Map(filas.filter(Boolean).map((u) => [u.id, u]));
}

/** Alta con los mismos valores por defecto que la tabla `users`. Falla si ya existe. */
export function guardarUsuario(uid, datos, w) {
  const display_name = String(datos.display_name || 'Jugador');
  return escritor(w).create(refUsuario(uid), {
    avatar_url: null,
    timezone: 'UTC',
    discord: null,
    steam_id64: null,
    steam_name: null,
    steam_avatar: null,
    google_sub: null,
    google_email: null,
    email: null,
    xbox_tag: null,
    rating_1v1: null,
    rating_team: null,
    is_admin: 0,
    availability: [],
    exceptions: [],
    created_at: ahora(),
    ...datos,
    display_name,
    display_name_lower: display_name.toLowerCase(),
  });
}

/** Cambios parciales; mantiene `display_name_lower` al día. */
export function actualizarUsuario(uid, cambios, w) {
  const datos = { ...cambios };
  if (datos.display_name !== undefined) datos.display_name_lower = String(datos.display_name).toLowerCase();
  return escritor(w).update(refUsuario(uid), datos);
}

// ------------------------------------------------------------------ Steam

export const refSteamId = (steamId64) => steamIds.doc(String(steamId64));

/** uid dueño de una cuenta de Steam, o null. */
export async function uidDeSteam(steamId64, tx) {
  return (await leer(refSteamId(steamId64), tx))?.uid ?? null;
}

/** Reserva la cuenta de Steam para un uid. Falla si ya es de alguien. */
export function reservarSteam(steamId64, uid, w) {
  return escritor(w).create(refSteamId(steamId64), { uid: String(uid), created_at: ahora() });
}

export function liberarSteam(steamId64, w) {
  return escritor(w).delete(refSteamId(steamId64));
}

// ------------------------------------------- ida y vuelta con Steam

const ingresos = firestore.collection('authStates');
const refIngreso = (nonce) => ingresos.doc(String(nonce));

/**
 * Estado de una salida a Steam: quién la pidió (`uid`, solo para vincular) y
 * para qué. Vence a los 10 minutos; la política TTL de Firestore sobre
 * `expiresAt` borra los que quedan (firestore.indexes.json).
 */
export function guardarIngreso(nonce, { uid = null, link = false }, w) {
  return escritor(w).create(refIngreso(nonce), {
    uid: uid === null ? null : String(uid),
    link: !!link,
    expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000),
  });
}

export function leerIngreso(nonce, tx) {
  return leer(refIngreso(nonce), tx);
}

export function borrarIngreso(nonce, w) {
  return escritor(w).delete(refIngreso(nonce));
}

/** Todos los usuarios (para scripts y el seed; en la API no se usa). */
export function listarUsuarios(tx) {
  return consultar(usuarios, tx);
}

/**
 * Hasta 20 usuarios cuyo nombre empieza con `q` (ya en minúsculas).
 * `q` vacío: los primeros 20 por nombre, no la colección entera.
 * Quien no tenga `display_name_lower` no entra: Firestore no indexa el campo ausente.
 */
export function buscarPorPrefijo(q, tx) {
  const prefijo = String(q || '');
  return consultar(
    usuarios
      .where('display_name_lower', '>=', prefijo)
      .where('display_name_lower', '<', `${prefijo}\uf8ff`)
      .orderBy('display_name_lower')
      .limit(20),
    tx,
  );
}
