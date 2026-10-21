import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { get, run } from './db.js';

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

/** Middleware: deja req.user (puede ser null). */
export function attachUser(req, _res, next) {
  req.user = userForToken(req.cookies?.[COOKIE]);
  next();
}

/** Middleware: corta con 401 si no hay sesión. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Necesitás iniciar sesión.' });
  next();
}
