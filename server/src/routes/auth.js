import { Router } from 'express';
import { get, run, all } from '../db.js';
import {
  hashPassword, checkPassword, createSession, destroySession,
  publicUser, setSessionCookie, requireAuth, COOKIE,
} from '../auth.js';

export const router = Router();

// En desarrollo Vite hace de proxy del backend, así que la app y la API
// comparten origen. PUBLIC_URL es ese origen (el que ve el navegador).
const APP_URL = process.env.PUBLIC_URL || 'http://localhost:5173';
const API_URL = process.env.PUBLIC_URL || 'http://localhost:5173';

// ------------------------------------------------------------ email + clave

router.post('/register', (req, res) => {
  const { email, password, display_name, timezone } = req.body || {};
  if (!email || !password || !display_name) {
    return res.status(400).json({ error: 'Faltan email, contraseña o nombre.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'La contraseña necesita al menos 8 caracteres.' });
  }
  if (get('SELECT 1 FROM users WHERE email = ?', String(email).toLowerCase())) {
    return res.status(409).json({ error: 'Ese email ya está registrado.' });
  }
  const info = run(
    'INSERT INTO users (email, pass_hash, display_name, timezone) VALUES (?, ?, ?, ?)',
    String(email).toLowerCase(),
    hashPassword(String(password)),
    String(display_name).slice(0, 40),
    timezone || 'UTC'
  );
  const user = get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
  const { token, expires } = createSession(user.id);
  setSessionCookie(res, token, expires);
  res.json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = get('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase());
  if (!user || !checkPassword(String(password || ''), user.pass_hash)) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  }
  const { token, expires } = createSession(user.id);
  setSessionCookie(res, token, expires);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch('/me', requireAuth, (req, res) => {
  const campos = ['display_name', 'avatar_url', 'timezone', 'discord', 'xbox_tag', 'aoe3_profile'];
  const sets = [];
  const valores = [];
  for (const c of campos) {
    if (req.body?.[c] !== undefined) {
      sets.push(`${c} = ?`);
      valores.push(req.body[c] === '' ? null : String(req.body[c]).slice(0, 200));
    }
  }
  for (const c of ['rating_1v1', 'rating_team']) {
    if (req.body?.[c] !== undefined) {
      sets.push(`${c} = ?`);
      const n = parseInt(req.body[c], 10);
      valores.push(Number.isFinite(n) ? n : null);
    }
  }
  if (sets.length) run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...valores, req.user.id);
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

// --------------------------------------------------------------- Steam (OpenID 2.0)

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';

router.get('/steam', (req, res) => {
  const returnTo = `${API_URL}/api/auth/steam/return`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': API_URL,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  res.redirect(`${STEAM_OPENID}?${params}`);
});

router.get('/steam/return', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query);
    params.set('openid.mode', 'check_authentication');

    const verif = await fetch(STEAM_OPENID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const texto = await verif.text();
    if (!/is_valid\s*:\s*true/.test(texto)) {
      return res.redirect(`${APP_URL}/perfil?steam=error`);
    }

    const claimed = String(req.query['openid.claimed_id'] || '');
    const steamId = claimed.match(/\/id\/(\d{17})$/)?.[1];
    if (!steamId) return res.redirect(`${APP_URL}/perfil?steam=error`);

    const perfil = await perfilSteam(steamId);

    // Si ya hay sesión, vinculamos. Si no, logueamos o creamos cuenta.
    let user = req.user;
    const existente = get('SELECT * FROM users WHERE steam_id64 = ?', steamId);

    if (user) {
      if (existente && existente.id !== user.id) {
        return res.redirect(`${APP_URL}/perfil?steam=ocupado`);
      }
      run(
        'UPDATE users SET steam_id64 = ?, steam_name = ?, steam_avatar = ? WHERE id = ?',
        steamId, perfil?.personaname ?? null, perfil?.avatarfull ?? null, user.id
      );
    } else if (existente) {
      user = existente;
      run(
        'UPDATE users SET steam_name = ?, steam_avatar = ? WHERE id = ?',
        perfil?.personaname ?? existente.steam_name, perfil?.avatarfull ?? existente.steam_avatar, existente.id
      );
    } else {
      const info = run(
        'INSERT INTO users (display_name, steam_id64, steam_name, steam_avatar) VALUES (?, ?, ?, ?)',
        perfil?.personaname || `Jugador ${steamId.slice(-5)}`,
        steamId,
        perfil?.personaname ?? null,
        perfil?.avatarfull ?? null
      );
      user = get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
    }

    const { token, expires } = createSession(user.id);
    setSessionCookie(res, token, expires);
    res.redirect(`${APP_URL}/perfil?steam=ok`);
  } catch (err) {
    console.error('steam', err);
    res.redirect(`${APP_URL}/perfil?steam=error`);
  }
});

router.post('/steam/unlink', requireAuth, (req, res) => {
  if (!req.user.email) {
    return res.status(400).json({ error: 'Es tu único método de acceso: primero poné un email y contraseña.' });
  }
  run('UPDATE users SET steam_id64 = NULL, steam_name = NULL, steam_avatar = NULL WHERE id = ?', req.user.id);
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

async function perfilSteam(steamId) {
  const key = process.env.STEAM_API_KEY;
  if (!key) return null;
  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamId}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return data?.response?.players?.[0] ?? null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------- búsqueda de usuarios

router.get('/users', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const filas = all(
    `SELECT id, display_name, avatar_url, steam_avatar, steam_name, rating_1v1, rating_team
       FROM users WHERE display_name LIKE ? OR steam_name LIKE ? ORDER BY display_name LIMIT 20`,
    q, q
  );
  res.json(filas.map((u) => ({ ...u, avatar_url: u.avatar_url || u.steam_avatar })));
});
