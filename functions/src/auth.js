import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getAuth } from 'firebase-admin/auth';
import { get, run } from './db.js';
import { guardarUsuario, leerUsuario } from './data/usuarios.js';

// ------------------------------------------------------------ Firebase Auth

/**
 * Usuario de users/{uid} a partir del ID token de Firebase del header
 * `Authorization: Bearer ...`, o null si no hay token o no es válido (vencido
 * o trucho cuenta como anónimo, igual que una cookie vieja). La primera vez
 * que entra crea su documento.
 */
export async function usuarioDelToken(header) {
  const token = /^Bearer\s+(\S+)$/i.exec(header || '')?.[1];
  if (!token) return null;
  let claims;
  try {
    claims = await getAuth().verifyIdToken(token);
  } catch {
    return null;
  }
  return (await leerUsuario(claims.uid)) ?? altaDesdeToken(claims);
}

/** Perfil inicial con lo que trae el token, según con qué entró. */
function datosDelToken(claims) {
  const datos = {
    display_name: claims.name || claims.email?.split('@')[0] || 'Jugador',
    avatar_url: claims.picture ?? null,
  };
  const proveedor = claims.firebase?.sign_in_provider;
  if (proveedor === 'google.com') {
    datos.google_sub = claims.firebase.identities?.['google.com']?.[0] ?? null;
    datos.google_email = claims.email ?? null;
  } else if (proveedor === 'password') {
    // Solo las cuentas de demo del emulador entran con email y contraseña.
    datos.email = claims.email ?? null;
  }
  return datos;
}

async function altaDesdeToken(claims) {
  try {
    await guardarUsuario(claims.uid, datosDelToken(claims));
  } catch (err) {
    // Dos pedidos a la vez de un usuario nuevo: el otro ya lo creó.
    if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS
  }
  return leerUsuario(claims.uid);
}

// ------------------------------------------- sesión por cookie (hasta T33)
//
// Puente mientras la web no entra con Firebase (T09 a T12): sin token, el
// usuario sale de la cookie y de las tablas SQLite de siempre.

const SESSION_DAYS = 30;
export const COOKIE = 'aoem_session';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function checkPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  run(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    token,
    userId,
    expires.toISOString()
  );
  return { token, expires };
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

export function userForToken(token) {
  if (!token) return null;
  const row = get(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now')`,
    token
  );
  return row || null;
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    display_name: u.display_name,
    avatar_url: u.avatar_url || u.steam_avatar || null,
    timezone: u.timezone,
    discord: u.discord,
    steam_id64: u.steam_id64,
    steam_name: u.steam_name,
    google_sub: u.google_sub,
    google_email: u.google_email,
    xbox_tag: u.xbox_tag,
    aoe3_profile: u.aoe3_profile,
    rating_1v1: u.rating_1v1,
    rating_team: u.rating_team,
    is_admin: !!u.is_admin,
  };
}

export function setSessionCookie(res, token, expires) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
    path: '/',
  });
}

/**
 * Middleware: deja req.user (puede ser null). Primero el token de Firebase; sin
 * token válido, la cookie vieja. `req.usuarioFirebase` dice de cuál salió.
 */
export async function attachUser(req, _res, next) {
  const deFirebase = await usuarioDelToken(req.get('authorization'));
  req.user = deFirebase ?? userForToken(req.cookies?.[COOKIE]);
  req.usuarioFirebase = !!deFirebase;
  next();
}

/** Middleware: corta con 401 si no hay sesión. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Necesitás iniciar sesión.' });
  next();
}
