// users/{uid} (docs/firestore-modelo.md): perfil público, horario semanal y
// excepciones. Cada uno escribe solo el suyo (firestore.rules).

import { type User as FirebaseUser } from 'firebase/auth';
import { doc, runTransaction, updateDoc } from 'firebase/firestore';
import { firestore } from '../firebase';
import { steamUrlValida } from '../lib';
import type { User } from '../types';
import { type Doc, ahora, conMensaje, leer, leerPorIds, ordenarPor } from './base';

const refUsuario = (uid: string) => doc(firestore, 'users', uid);

/** El perfil como lo usa la web (lo que antes devolvía /api/auth/me). */
export function comoUsuario(u: Doc): User {
  return {
    id: u.id,
    display_name: u.display_name ?? 'Jugador',
    avatar_url: u.avatar_url ?? null,
    timezone: u.timezone ?? 'UTC',
    discord: u.discord ?? null,
    steam_id64: u.steam_id64 ?? null,
    steam_name: u.steam_name ?? null,
    steam_url: u.steam_url ?? null,
    google_sub: u.google_sub ?? null,
    google_email: u.google_email ?? null,
    xbox_tag: u.xbox_tag ?? null,
    aoe3_profile: u.aoe3_profile ?? null,
    rating_1v1: u.rating_1v1 ?? null,
    rating_team: u.rating_team ?? null,
    is_admin: !!u.is_admin,
  };
}

export async function leerPerfil(uid: string): Promise<User | null> {
  const u = await leer(refUsuario(uid));
  return u && comoUsuario(u);
}

/**
 * El perfil de quien entró; si es la primera vez, lo crea con el nombre y la
 * foto de su cuenta (Google) o con la primera parte del email (demo).
 */
export async function asegurarPerfil(cuenta: FirebaseUser): Promise<User> {
  const ya = await leerPerfil(cuenta.uid);
  if (ya) return ya;
  const nombre = (cuenta.displayName || cuenta.email?.split('@')[0] || 'Jugador').slice(0, 60);
  let zona = 'UTC';
  try {
    zona = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // Navegador sin zona horaria: queda UTC.
  }
  // En una transacción: al entrar, el login y el aviso de Firebase piden el
  // perfil a la vez, y el segundo no tiene que pisar al primero.
  await conMensaje(() =>
    runTransaction(firestore, async (tx) => {
      if ((await tx.get(refUsuario(cuenta.uid))).exists()) return;
      tx.set(refUsuario(cuenta.uid), {
      display_name: nombre,
      display_name_lower: nombre.toLowerCase(),
      avatar_url: cuenta.photoURL ?? null,
      timezone: zona,
      discord: null,
      xbox_tag: null,
      aoe3_profile: null,
      steam_url: null,
      rating_1v1: null,
      rating_team: null,
      availability: [],
      exceptions: [],
      is_admin: 0,
      created_at: ahora(),
      });
    })
  );
  return (await leerPerfil(cuenta.uid))!;
}

const TEXTOS = ['display_name', 'avatar_url', 'timezone', 'discord', 'xbox_tag', 'aoe3_profile'] as const;
const RATINGS = ['rating_1v1', 'rating_team'] as const;

/** Cambios del perfil propio, limpios como los dejaba PATCH /api/auth/me. */
export async function actualizarPerfil(uid: string, campos: Partial<User>): Promise<User> {
  const cambios: Record<string, unknown> = {};
  for (const c of TEXTOS) {
    const v = campos[c];
    if (v !== undefined) cambios[c] = v === '' || v === null ? null : String(v).slice(0, 200);
  }
  for (const c of RATINGS) {
    const v = campos[c];
    if (v !== undefined) {
      const n = parseInt(String(v), 10);
      cambios[c] = Number.isFinite(n) ? n : null;
    }
  }
  // El nombre no puede quedar vacío.
  if (campos.steam_url !== undefined) {
    const url = campos.steam_url === '' || campos.steam_url === null ? null : String(campos.steam_url).trim();
    if (url !== null && !steamUrlValida(url)) {
      throw new Error('El link tiene que ser un perfil de steamcommunity.com (id o profiles).');
    }
    cambios.steam_url = url;
  }
  if (cambios.display_name === null) delete cambios.display_name;
  if (typeof cambios.display_name === 'string') {
    const nombre = cambios.display_name.slice(0, 60);
    cambios.display_name = nombre;
    cambios.display_name_lower = nombre.toLowerCase();
  }
  if (Object.keys(cambios).length) await conMensaje(() => updateDoc(refUsuario(uid), cambios));
  return (await leerPerfil(uid))!;
}

/** Perfiles por uid: Map uid -> doc (los que no existen no aparecen). */
export const mapaDeUsuarios = (uids: (string | null | undefined)[]) => leerPorIds('users', uids);

export type Bloque = { start_min: number; end_min: number };

/** Horario semanal de un usuario, en orden (vacío si no existe). */
export async function horarioDe(uid: string): Promise<Bloque[]> {
  const u = await leer(refUsuario(uid));
  return ordenarPor(u?.availability ?? [], 'start_min');
}

/** Guarda la semana propia: descarta bloques inválidos y la ordena. */
export async function guardarHorario(uid: string, bloques: Bloque[]): Promise<void> {
  const limpios: Bloque[] = [];
  for (const b of bloques) {
    const s = Math.max(0, Math.min(10080, parseInt(String(b.start_min), 10)));
    const e = Math.max(0, Math.min(10080, parseInt(String(b.end_min), 10)));
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    limpios.push({ start_min: s, end_min: e });
  }
  await conMensaje(() => updateDoc(refUsuario(uid), { availability: ordenarPor(limpios, 'start_min') }));
}
