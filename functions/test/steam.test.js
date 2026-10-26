// Ingreso y vinculación con Steam (token propio), contra los emuladores. Las
// llamadas a Steam se responden acá: las pruebas no salen a internet.
//
//   npm test        (desde la raíz)

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, cuentaConGoogle, levantarApi, tokenDeCustom } from './apoyo.js';

// ------------------------------------------------------------ Steam falso

let steamValida = true;
const perfiles = new Map();
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, opciones) => {
  const u = String(url);
  if (u.startsWith('https://steamcommunity.com/openid/login')) {
    return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${steamValida}\n`);
  }
  if (u.startsWith('https://api.steampowered.com/')) {
    const id = new URL(u).searchParams.get('steamids');
    return Response.json({ response: { players: perfiles.has(id) ? [perfiles.get(id)] : [] } });
  }
  return fetchReal(url, opciones);
};
process.env.STEAM_API_KEY = 'clave-de-prueba';

const api = await levantarApi();
after(() => api.cerrar());

const { firestore } = await import('../src/data/base.js');
const { leerUsuario, uidDeSteam } = await import('../src/data/usuarios.js');

const STEAM_A = '76561198000000001';
const STEAM_B = '76561198000000002';
perfiles.set(STEAM_A, { personaname: 'Kaiser', avatarfull: 'https://avatars.steam/kaiser.jpg' });

beforeEach(() => { steamValida = true; });

/** Pide la salida a Steam y devuelve el return_to que Steam usaría para volver. */
async function salir({ token, link = false } = {}) {
  const { status, datos } = await api.pedir('POST', '/auth/steam/start', { token, body: { link } });
  assert.equal(status, 200);
  const url = new URL(datos.url);
  assert.equal(url.origin + url.pathname, 'https://steamcommunity.com/openid/login');
  return url.searchParams.get('openid.return_to');
}

/** Simula la vuelta de Steam y devuelve a dónde redirige la API. */
async function volver(returnTo, steamId, extra = {}) {
  const url = new URL(returnTo);
  url.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0');
  url.searchParams.set('openid.mode', 'id_res');
  url.searchParams.set('openid.return_to', returnTo);
  url.searchParams.set('openid.claimed_id', `https://steamcommunity.com/openid/id/${steamId}`);
  url.searchParams.set('openid.identity', `https://steamcommunity.com/openid/id/${steamId}`);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const r = await fetchReal(url, { redirect: 'manual' });
  assert.equal(r.status, 302);
  return r.headers.get('location');
}

/** De la redirección con #token=..., el ID token de Firebase. */
async function entrar(destino) {
  const token = new URLSearchParams(destino.split('#')[1]).get('token');
  assert.ok(token, `sin token en ${destino}`);
  return tokenDeCustom(token);
}

describe('entrar con Steam', () => {
  let primero;

  it('la primera vez crea la cuenta con nombre y avatar de Steam', async () => {
    const destino = await volver(await salir(), STEAM_A);
    assert.match(destino, /^\/entrar#token=/);
    primero = await entrar(destino);
    const { datos } = await api.pedir('GET', '/auth/me', { token: primero.token });
    assert.deepEqual(
      [datos.user.id, datos.user.display_name, datos.user.avatar_url, datos.user.steam_id64, datos.user.steam_name],
      [primero.uid, 'Kaiser', 'https://avatars.steam/kaiser.jpg', STEAM_A, 'Kaiser']
    );
    assert.equal(await uidDeSteam(STEAM_A), primero.uid);
  });

  it('la segunda vez entra a la misma cuenta', async () => {
    perfiles.set(STEAM_A, { personaname: 'Kaiser II', avatarfull: 'https://avatars.steam/k2.jpg' });
    const otra = await entrar(await volver(await salir(), STEAM_A));
    assert.equal(otra.uid, primero.uid);
    assert.equal((await leerUsuario(primero.uid)).steam_name, 'Kaiser II');
  });

  it('sin perfil de Steam usa un nombre genérico', async () => {
    const nueva = await entrar(await volver(await salir(), STEAM_B));
    assert.equal((await leerUsuario(nueva.uid)).display_name, 'Jugador 00002');
  });

  it('el estado sirve una sola vez', async () => {
    const returnTo = await salir();
    await volver(returnTo, STEAM_A);
    assert.equal(await volver(returnTo, STEAM_A), '/entrar?steam=error');
  });

  it('un estado vencido o inventado no sirve', async () => {
    const returnTo = await salir();
    const nonce = new URL(returnTo).searchParams.get('state');
    await firestore.collection('authStates').doc(nonce).update({ expiresAt: new Date(Date.now() - 1000) });
    assert.equal(await volver(returnTo, STEAM_A), '/entrar?steam=error');
    const inventado = returnTo.replace(/state=\w+/, `state=${'a'.repeat(32)}`);
    assert.equal(await volver(inventado, STEAM_A), '/entrar?steam=error');
  });

  it('si Steam no confirma, o la respuesta era para otro sitio, no entra', async () => {
    steamValida = false;
    assert.equal(await volver(await salir(), STEAM_A), '/entrar?steam=error');
    steamValida = true;
    const returnTo = await salir();
    assert.equal(await volver(returnTo, STEAM_A, { 'openid.return_to': 'https://otro.sitio/vuelta' }), '/entrar?steam=error');
  });

  it('el enlace viejo ya no arranca el ingreso', async () => {
    const entra = await fetchReal(`${api.base}/auth/steam`, { redirect: 'manual' });
    assert.equal(entra.status, 404);
    const vincula = await fetchReal(`${api.base}/auth/steam?link=1`, { redirect: 'manual' });
    assert.equal(vincula.status, 404);
  });
});

describe('vincular Steam', () => {
  let google;

  before(async () => {
    google = await cuentaConGoogle({ sub: 'g-steam-1', email: 'vincula@gmail.com', name: 'Vincula' });
    await api.pedir('GET', '/auth/me', { token: google.token });
  });

  it('pide sesión de Firebase', async () => {
    assert.equal((await api.pedir('POST', '/auth/steam/start', { body: { link: true } })).status, 401);
  });

  it('una cuenta de Steam ya usada queda ocupada', async () => {
    const returnTo = await salir({ token: google.token, link: true });
    assert.equal(await volver(returnTo, STEAM_A), '/perfil?steam=ocupado');
    assert.equal((await leerUsuario(google.uid)).steam_id64, null);
  });

  it('una libre se pega a la cuenta con sesión, sin cambiar de usuario', async () => {
    const STEAM_C = '76561198000000003';
    const returnTo = await salir({ token: google.token, link: true });
    assert.equal(await volver(returnTo, STEAM_C), '/perfil?steam=ok');
    assert.equal((await leerUsuario(google.uid)).steam_id64, STEAM_C);
    assert.equal(await uidDeSteam(STEAM_C), google.uid);

    // Cambiar de cuenta de Steam suelta la anterior.
    const STEAM_D = '76561198000000004';
    assert.equal(await volver(await salir({ token: google.token, link: true }), STEAM_D), '/perfil?steam=ok');
    assert.equal(await uidDeSteam(STEAM_C), null);
    assert.equal(await uidDeSteam(STEAM_D), google.uid);
  });

  it('desvincular: no si es el único acceso', async () => {
    const soloSteam = await entrar(await volver(await salir(), '76561198000000005'));
    await api.pedir('GET', '/auth/me', { token: soloSteam.token });
    const { status, datos } = await api.pedir('POST', '/auth/steam/unlink', { token: soloSteam.token });
    assert.deepEqual([status, datos.error], [400, 'Es tu único acceso: vinculá Google antes de soltar Steam.']);
  });

  it('desvincular con Google: suelta la cuenta de Steam', async () => {
    const { status, datos } = await api.pedir('POST', '/auth/steam/unlink', { token: google.token });
    assert.equal(status, 200);
    assert.equal(datos.user.steam_id64, null);
    assert.equal(await uidDeSteam('76561198000000004'), null);
  });
});
