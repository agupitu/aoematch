// Google con Firebase Auth: la API anota la cuenta vinculada y la suelta al
// desvincular. Contra los emuladores de Auth y Firestore.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, cuentaConGoogle, levantarApi, tokenDeCustom } from './apoyo.js';

const api = await levantarApi();
after(() => api.cerrar());

const { getAuth } = await import('firebase-admin/auth');
const { leerUsuario, guardarUsuario, reservarSteam } = await import('../src/data/usuarios.js');

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;

/** Vincula una cuenta de Google a la cuenta del token, como linkWithPopup. Devuelve el token nuevo. */
async function vincularGoogle(token, claims) {
  const idTokenGoogle = encodeURIComponent(JSON.stringify({ email_verified: true, ...claims }));
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: token,
      postBody: `id_token=${idTokenGoogle}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnSecureToken: true,
    }),
  });
  const datos = await r.json();
  assert.ok(r.ok, JSON.stringify(datos));
  return datos.idToken;
}

const proveedores = async (uid) => (await getAuth().getUser(uid)).providerData.map((p) => p.providerId).sort();

describe('Google con Firebase Auth', () => {
  it('Google siempre está disponible para entrar', async () => {
    assert.equal((await api.pedir('GET', '/auth/providers')).datos.google, true);
  });

  it('vincular desde una cuenta de Steam anota sub y email en el perfil', async () => {
    // Cuenta creada por Steam: usuario de Auth sin proveedores, como la crea la API.
    const { uid } = await getAuth().createUser({ displayName: 'Steamer' });
    await guardarUsuario(uid, { display_name: 'Steamer', steam_id64: '76561198000000077' });
    await reservarSteam('76561198000000077', uid);
    const { token } = await tokenDeCustom(await getAuth().createCustomToken(uid));

    const nuevo = await vincularGoogle(token, { sub: 'g-vinc-1', email: 'steamer@gmail.com', name: 'Steamer G' });
    const { datos } = await api.pedir('GET', '/auth/me', { token: nuevo });
    assert.deepEqual([datos.user.id, datos.user.google_sub, datos.user.google_email], [uid, 'g-vinc-1', 'steamer@gmail.com']);
    assert.equal(datos.user.display_name, 'Steamer');
    assert.deepEqual(await proveedores(uid), ['google.com']);

    // Desvincular: tiene Steam, así que puede.
    const r = await api.pedir('POST', '/auth/google/unlink', { token: nuevo });
    assert.equal(r.status, 200);
    assert.deepEqual([r.datos.user.google_sub, r.datos.user.google_email], [null, null]);
    assert.deepEqual(await proveedores(uid), []);

    // El token de antes todavía trae Google: no lo vuelve a anotar.
    await api.pedir('GET', '/auth/me', { token: nuevo });
    assert.equal((await leerUsuario(uid)).google_sub, null);
  });

  it('no se suelta Google si es el único acceso', async () => {
    const g = await cuentaConGoogle({ sub: 'g-solo-1', email: 'solo@gmail.com', name: 'Solo Google' });
    await api.pedir('GET', '/auth/me', { token: g.token });
    const { status, datos } = await api.pedir('POST', '/auth/google/unlink', { token: g.token });
    assert.deepEqual([status, datos.error], [400, 'Es tu único acceso: vinculá Steam antes de soltar Google.']);
    assert.equal((await leerUsuario(g.uid)).google_sub, 'g-solo-1');
  });

  it('una cuenta de demo puede soltar Google: le queda el email', async () => {
    const demo = await cuentaConEmail('google-demo@demo.aoematch');
    await api.pedir('GET', '/auth/me', { token: demo.token });
    const nuevo = await vincularGoogle(demo.token, { sub: 'g-demo-1', email: 'demo@gmail.com', name: 'Demo' });
    assert.equal((await api.pedir('GET', '/auth/me', { token: nuevo })).datos.user.google_sub, 'g-demo-1');
    assert.equal((await api.pedir('POST', '/auth/google/unlink', { token: nuevo })).status, 200);
    assert.deepEqual(await proveedores(demo.uid), ['password']);
  });

  it('las rutas viejas de Google por servidor ya no existen', async () => {
    for (const ruta of ['/auth/google', '/auth/google/return']) {
      assert.equal((await fetch(api.base + ruta, { redirect: 'manual' })).status, 404);
    }
  });
});
