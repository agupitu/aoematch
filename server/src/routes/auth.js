import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { get, run, all } from '../db.js';
import {
  checkPassword, createSession, destroySession,
  publicUser, setSessionCookie, requireAuth, COOKIE,
} from '../auth.js';

export const router = Router();

// La app y la API comparten origen (en dev porque Vite proxea, en producción
// porque es el mismo proceso). Si no hay PUBLIC_URL lo deducimos del pedido,
// así un deploy funciona sin configurar nada.
function origen(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  const host = req.get('host');
  if (!host) return 'http://localhost:5173';
  const proto = req.headers['x-forwarded-proto']?.split(',')[0] || req.protocol || 'http';
  return `${proto}://${host}`;
}

const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

// Las cuentas se crean con Steam o con Google. El login por email queda solo
// para desarrollo (la demo sembrada), nunca en producción salvo que se pida.
const DEV_LOGIN =
  process.env.DEV_LOGIN === '1' ||
  (process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN !== '0');

router.get('/providers', (_req, res) => {
  res.json({ steam: true, google: !!(GOOGLE_ID && GOOGLE_SECRET), dev_login: DEV_LOGIN });
});

/** Inicia sesión con una cuenta ya existente, o la crea a partir del proveedor. */
function entrarCon({ req, res, columna, valor, datos }) {
  const existente = get(`SELECT * FROM users WHERE ${columna} = ?`, valor);
  let user = req.user;

  if (user) {
    if (existente && existente.id !== user.id) return { estado: 'ocupado', user };
    run(
      `UPDATE users SET ${columna} = ?, ${datos.sets} WHERE id = ?`,
      valor, ...datos.valores, user.id
    );
  } else if (existente) {
    user = existente;
    run(`UPDATE users SET ${datos.sets} WHERE id = ?`, ...datos.valores, user.id);
  } else {
    const info = run(
      `INSERT INTO users (display_name, avatar_url, ${columna}) VALUES (?, ?, ?)`,
      datos.nombre, datos.avatar ?? null, valor
    );
    user = get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
    run(`UPDATE users SET ${datos.sets} WHERE id = ?`, ...datos.valores, user.id);
  }

  const { token, expires } = createSession(user.id);
  setSessionCookie(res, token, expires);
  return { estado: 'ok', user };
}

// ------------------------------------------------------- login de desarrollo

if (DEV_LOGIN) {
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
}

// ------------------------------------------------------------------ sesión

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
  const API_URL = origen(req);
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
  const APP_URL = origen(req);
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
      return res.redirect(`${APP_URL}/entrar?steam=error`);
    }

    const claimed = String(req.query['openid.claimed_id'] || '');
    const steamId = claimed.match(/\/id\/(\d{17})$/)?.[1];
    if (!steamId) return res.redirect(`${APP_URL}/entrar?steam=error`);

    const perfil = await perfilSteam(steamId);
    const { estado } = entrarCon({
      req,
      res,
      columna: 'steam_id64',
      valor: steamId,
      datos: {
        nombre: perfil?.personaname || `Jugador ${steamId.slice(-5)}`,
        avatar: perfil?.avatarfull ?? null,
        sets: 'steam_name = ?, steam_avatar = ?',
        valores: [perfil?.personaname ?? null, perfil?.avatarfull ?? null],
      },
    });
    if (estado === 'ocupado') return res.redirect(`${APP_URL}/perfil?steam=ocupado`);
    res.redirect(`${APP_URL}/perfil?steam=ok`);
  } catch (err) {
    console.error('steam', err);
    res.redirect(`${APP_URL}/entrar?steam=error`);
  }
});

router.post('/steam/unlink', requireAuth, (req, res) => {
  if (!req.user.google_sub && !req.user.email) {
    return res.status(400).json({ error: 'Es tu único acceso: vinculá Google antes de soltar Steam.' });
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

// -------------------------------------------------------- Google (OAuth 2.0)

const OAUTH_COOKIE = 'aoem_oauth';

router.get('/google', (req, res) => {
  const APP_URL = origen(req);
  const API_URL = origen(req);
  if (!GOOGLE_ID || !GOOGLE_SECRET) return res.redirect(`${APP_URL}/entrar?google=sin_config`);
  const state = randomBytes(16).toString('hex');
  res.cookie(OAUTH_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
  const params = new URLSearchParams({
    client_id: GOOGLE_ID,
    redirect_uri: `${API_URL}/api/auth/google/return`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/return', async (req, res) => {
  const APP_URL = origen(req);
  const API_URL = origen(req);
  try {
    if (!GOOGLE_ID || !GOOGLE_SECRET) return res.redirect(`${APP_URL}/entrar?google=sin_config`);

    const esperado = req.cookies?.[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { path: '/' });
    if (!esperado || esperado !== String(req.query.state || '')) {
      return res.redirect(`${APP_URL}/entrar?google=error`);
    }
    const code = String(req.query.code || '');
    if (!code) return res.redirect(`${APP_URL}/entrar?google=error`);

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_ID,
        client_secret: GOOGLE_SECRET,
        redirect_uri: `${API_URL}/api/auth/google/return`,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!r.ok) return res.redirect(`${APP_URL}/entrar?google=error`);

    // El id_token llega del propio Google por TLS en este intercambio
    // servidor-a-servidor, así que alcanza con leer sus claims.
    const { id_token } = await r.json();
    const claims = JSON.parse(Buffer.from(String(id_token).split('.')[1], 'base64url').toString('utf8'));
    if (!claims?.sub) return res.redirect(`${APP_URL}/entrar?google=error`);

    const { estado } = entrarCon({
      req,
      res,
      columna: 'google_sub',
      valor: String(claims.sub),
      datos: {
        nombre: claims.name || claims.email?.split('@')[0] || 'Jugador',
        avatar: claims.picture ?? null,
        sets: 'google_email = ?',
        valores: [claims.email ?? null],
      },
    });
    if (estado === 'ocupado') return res.redirect(`${APP_URL}/perfil?google=ocupado`);
    res.redirect(`${APP_URL}/perfil?google=ok`);
  } catch (err) {
    console.error('google', err);
    res.redirect(`${APP_URL}/entrar?google=error`);
  }
});

router.post('/google/unlink', requireAuth, (req, res) => {
  if (!req.user.steam_id64 && !req.user.email) {
    return res.status(400).json({ error: 'Es tu único acceso: vinculá Steam antes de soltar Google.' });
  }
  run('UPDATE users SET google_sub = NULL, google_email = NULL WHERE id = ?', req.user.id);
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

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
