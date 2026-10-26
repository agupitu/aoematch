import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { get, run, all } from '../db.js';
import {
  checkPassword, createSession, destroySession,
  publicUser, setSessionCookie, requireAuth, COOKIE,
} from '../auth.js';
import { getAuth } from 'firebase-admin/auth';
import { enTransaccion } from '../data/base.js';
import {
  actualizarUsuario, borrarIngreso, buscarPorPrefijo, guardarIngreso, guardarUsuario, leerIngreso, leerUsuario,
  liberarSteam, reservarSteam, uidDeSteam,
} from '../data/usuarios.js';

export const router = Router();

// La app y la API comparten origen (en dev porque Vite proxea, en producción
// porque es el mismo proceso). Si no hay PUBLIC_URL lo deducimos del pedido,
// así un deploy funciona sin configurar nada.
function origen(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  // Detrás del proxy de Vite (dev) o del hosting (producción) el Host llega
  // reescrito, así que miramos primero el x-forwarded-host.
  const host = req.headers['x-forwarded-host']?.split(',')[0].trim() || req.get('host');
  if (!host) return 'http://localhost:5173';
  const proto = req.headers['x-forwarded-proto']?.split(',')[0].trim() || req.protocol || 'http';
  return `${proto}://${host}`;
}

// Las cuentas se crean con Steam o con Google. El login por email queda solo
// para desarrollo (la demo sembrada), nunca en producción salvo que se pida.
const DEV_LOGIN =
  process.env.DEV_LOGIN === '1' ||
  (process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN !== '0');

router.get('/providers', (_req, res) => {
  // La web muestra el formulario de demo solo en DEV; acá el flag es solo del emulador.
  res.json({ steam: true, google: true, dev_login: process.env.FUNCTIONS_EMULATOR === 'true' });
});

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

router.patch('/me', requireAuth, async (req, res) => {
  const cambios = {};
  for (const c of ['display_name', 'avatar_url', 'timezone', 'discord', 'xbox_tag', 'aoe3_profile']) {
    if (req.body?.[c] !== undefined) {
      cambios[c] = req.body[c] === '' ? null : String(req.body[c]).slice(0, 200);
    }
  }
  for (const c of ['rating_1v1', 'rating_team']) {
    if (req.body?.[c] !== undefined) {
      const n = parseInt(req.body[c], 10);
      cambios[c] = Number.isFinite(n) ? n : null;
    }
  }
  // El nombre no puede quedar vacío: en la tabla era NOT NULL.
  if (cambios.display_name === null) delete cambios.display_name;
  const claves = Object.keys(cambios);

  if (req.usuarioFirebase) {
    if (claves.length) await actualizarUsuario(req.user.id, cambios);
    return res.json({ user: publicUser(await leerUsuario(req.user.id)) });
  }
  // Usuario de la sesión por cookie (hasta T33).
  if (claves.length) {
    run(`UPDATE users SET ${claves.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(cambios), req.user.id);
  }
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

// --------------------------------------------------------------- Steam (OpenID 2.0)
//
// Steam no es un proveedor de Firebase: su OpenID se verifica acá y se entra
// con un token propio (createCustomToken). El ida y vuelta pasa por el
// navegador sin el ID token, así que la salida guarda en authStates/{nonce}
// quién la pidió y si es para vincular; la vuelta lo usa una sola vez.

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const RETORNO_STEAM = '/api/auth/steam/return';

/** Guarda un estado nuevo y devuelve la URL de Steam que vuelve con él. */
async function salidaASteam(req, { uid = null, link = false } = {}) {
  const nonce = randomBytes(16).toString('hex');
  await guardarIngreso(nonce, { uid, link });
  const API_URL = origen(req);
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${API_URL}${RETORNO_STEAM}?state=${nonce}`,
    'openid.realm': API_URL,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID}?${params}`;
}

/** Arranca el ingreso o, con `link`, la vinculación de la cuenta con sesión. Devuelve { url }. */
router.post('/steam/start', async (req, res) => {
  const link = !!req.body?.link;
  if (link && !req.usuarioFirebase) return res.status(401).json({ error: 'Necesitás iniciar sesión.' });
  res.json({ url: await salidaASteam(req, { uid: link ? req.user.id : null, link }) });
});

/** Lee y borra el estado de un ida y vuelta: sirve una sola vez. null si no está o venció. */
function tomarIngreso(nonce) {
  if (!/^[0-9a-f]{32}$/.test(nonce)) return null;
  return enTransaccion(async (tx) => {
    const estado = await leerIngreso(nonce, tx);
    if (!estado) return null;
    borrarIngreso(nonce, tx);
    return estado.expiresAt.toMillis() < Date.now() ? null : estado;
  });
}

/**
 * Le pregunta a Steam si la respuesta es suya y si era para volver acá.
 * Devuelve el SteamID64, o null.
 */
async function verificarSteam(query, retornoEsperado) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (k.startsWith('openid.')) params.set(k, String(v));
  if (params.get('openid.return_to') !== retornoEsperado) return null;
  params.set('openid.mode', 'check_authentication');

  const verif = await fetch(STEAM_OPENID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const texto = await verif.text();
  if (!/is_valid\s*:\s*true/.test(texto)) return null;
  return String(params.get('openid.claimed_id') || '').match(/\/id\/(\d{17})$/)?.[1] ?? null;
}

/** Pega la cuenta de Steam al usuario. 'ocupado' si ya es de otro. */
function vincularSteam(uid, steamId, datos) {
  return enTransaccion(async (tx) => {
    const dueno = await uidDeSteam(steamId, tx);
    if (dueno && dueno !== uid) return 'ocupado';
    const u = await leerUsuario(uid, tx);
    if (!u) throw new Error('El usuario que pidió vincular no existe.');
    if (!dueno) reservarSteam(steamId, uid, tx);
    // Si tenía otra cuenta de Steam, la suelta.
    if (u.steam_id64 && u.steam_id64 !== steamId) liberarSteam(u.steam_id64, tx);
    actualizarUsuario(uid, datos, tx);
    return 'ok';
  });
}

/** El uid de la cuenta de Steam; la primera vez la crea en Firebase Auth y en users. */
async function cuentaDeSteam(steamId, datos, perfil) {
  const existente = await uidDeSteam(steamId);
  if (existente) {
    await actualizarUsuario(existente, { steam_name: datos.steam_name, steam_avatar: datos.steam_avatar });
    return existente;
  }

  const nombre = perfil?.personaname || `Jugador ${steamId.slice(-5)}`;
  const { uid } = await getAuth().createUser({ displayName: nombre, photoURL: perfil?.avatarfull || undefined });
  let final;
  try {
    final = await enTransaccion(async (tx) => {
      // Otro pedido pudo crearla en el medio: gana el primero.
      const dueno = await uidDeSteam(steamId, tx);
      if (dueno) return dueno;
      reservarSteam(steamId, uid, tx);
      guardarUsuario(uid, { display_name: nombre, avatar_url: perfil?.avatarfull ?? null, ...datos }, tx);
      return uid;
    });
  } finally {
    if (final !== uid) await getAuth().deleteUser(uid).catch(() => {});
  }
  return final;
}

router.get('/steam/return', async (req, res) => {
  const nonce = String(req.query.state || '');
  let estado = null;
  try {
    estado = await tomarIngreso(nonce);
    if (!estado) return res.redirect('/entrar?steam=error');

    const steamId = await verificarSteam(req.query, `${origen(req)}${RETORNO_STEAM}?state=${nonce}`);
    if (!steamId) return res.redirect(estado.link ? '/perfil?steam=error' : '/entrar?steam=error');

    const perfil = await perfilSteam(steamId);
    const datos = { steam_id64: steamId, steam_name: perfil?.personaname ?? null, steam_avatar: perfil?.avatarfull ?? null };

    if (estado.link) {
      const r = await vincularSteam(estado.uid, steamId, datos);
      return res.redirect(r === 'ocupado' ? '/perfil?steam=ocupado' : '/perfil?steam=ok');
    }
    // El token va en el hash: el navegador no lo manda a ningún servidor.
    const token = await getAuth().createCustomToken(await cuentaDeSteam(steamId, datos, perfil));
    res.redirect(`/entrar#token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('steam', err);
    res.redirect(estado?.link ? '/perfil?steam=error' : '/entrar?steam=error');
  }
});

router.post('/steam/unlink', requireAuth, async (req, res) => {
  if (!req.user.google_sub && !req.user.email) {
    return res.status(400).json({ error: 'Es tu único acceso: vinculá Google antes de soltar Steam.' });
  }
  if (req.usuarioFirebase) {
    await enTransaccion(async (tx) => {
      const u = await leerUsuario(req.user.id, tx);
      if (u?.steam_id64) liberarSteam(u.steam_id64, tx);
      actualizarUsuario(req.user.id, { steam_id64: null, steam_name: null, steam_avatar: null }, tx);
    });
    return res.json({ user: publicUser(await leerUsuario(req.user.id)) });
  }
  // Usuario de la sesión por cookie (hasta T33).
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

// ------------------------------------------------------------------ Google
//
// Entrar y vincular los hace la web con Firebase Auth (signInWithPopup y
// linkWithPopup). La API se entera por el token: el alta y el google_sub /
// google_email del perfil los mantiene auth.js.

router.post('/google/unlink', requireAuth, async (req, res) => {
  if (!req.user.steam_id64 && !req.user.email) {
    return res.status(400).json({ error: 'Es tu único acceso: vinculá Steam antes de soltar Google.' });
  }
  if (req.usuarioFirebase) {
    if (req.user.google_sub) await getAuth().updateUser(req.user.id, { providersToUnlink: ['google.com'] });
    await actualizarUsuario(req.user.id, { google_sub: null, google_email: null, google_unlinked_at: Date.now() });
    return res.json({ user: publicUser(await leerUsuario(req.user.id)) });
  }
  // Usuario de la sesión por cookie (hasta T33).
  run('UPDATE users SET google_sub = NULL, google_email = NULL WHERE id = ?', req.user.id);
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

// ----------------------------------------------------------- búsqueda de usuarios

function filaDeBusqueda(u) {
  return {
    id: u.id,
    display_name: u.display_name,
    avatar_url: u.avatar_url || u.steam_avatar,
    steam_avatar: u.steam_avatar ?? null,
    steam_name: u.steam_name ?? null,
    rating_1v1: u.rating_1v1 ?? null,
    rating_team: u.rating_team ?? null,
  };
}

router.get('/users', async (req, res) => {
  // Sesión por cookie (hasta T33): sigue el "contiene" de SQLite.
  if (req.user && !req.usuarioFirebase) {
    const q = `%${String(req.query.q || '').trim()}%`;
    const filas = all(
      `SELECT id, display_name, avatar_url, steam_avatar, steam_name, rating_1v1, rating_team
         FROM users WHERE display_name LIKE ? OR steam_name LIKE ? ORDER BY display_name LIMIT 20`,
      q, q
    );
    return res.json(filas.map((u) => ({ ...u, avatar_url: u.avatar_url || u.steam_avatar })));
  }

  const q = String(req.query.q || '').trim().toLowerCase();
  const filas = await buscarPorPrefijo(q);
  res.json(filas.map(filaDeBusqueda));
});
