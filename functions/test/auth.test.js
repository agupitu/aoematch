// Sesión con Firebase Auth en la API, contra los emuladores de Auth y Firestore.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROYECTO = process.env.GCLOUD_PROJECT;
// Nunca contra un proyecto real: estas pruebas borran las cuentas.
if (!AUTH || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Faltan los emuladores: corré las pruebas con `npm test` desde la raíz.');
}

// La API todavía abre SQLite al cargar: que use una base descartable.
const BASE_SQLITE = join(tmpdir(), `aoe3draft-auth-test-${process.pid}.db`);
process.env.AOEMATCH_DB = BASE_SQLITE;

const { app } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { firestore } = await import('../src/data/base.js');
const { leerUsuario } = await import('../src/data/usuarios.js');

let api;
let servidor;

before(async () => {
  const r = await fetch(`http://${AUTH}/emulator/v1/projects/${PROYECTO}/accounts`, { method: 'DELETE' });
  assert.ok(r.ok, `no se pudo vaciar el emulador de Auth: ${r.status}`);
  servidor = app.listen(0);
  await new Promise((ok) => servidor.once('listening', ok));
  api = `http://127.0.0.1:${servidor.address().port}/api`;
});

after(async () => {
  await new Promise((ok) => servidor.close(ok));
  await firestore.terminate();
  db.close();
  for (const sufijo of ['', '-wal', '-shm']) rmSync(BASE_SQLITE + sufijo, { force: true });
});

const identitytoolkit = (metodo) => `http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${metodo}?key=demo`;

async function pedirToken(metodo, cuerpo) {
  const r = await fetch(identitytoolkit(metodo), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...cuerpo, returnSecureToken: true }),
  });
  const datos = await r.json();
  assert.ok(r.ok, JSON.stringify(datos));
  return { uid: datos.localId, token: datos.idToken };
}

/** Cuenta de email y contraseña, como las de demo. */
const cuentaConEmail = (email) => pedirToken('signUp', { email, password: 'demo1234' });

/** Cuenta de Google: el emulador acepta un id_token sin firmar. */
function cuentaConGoogle(claims) {
  const idToken = encodeURIComponent(JSON.stringify({ email_verified: true, ...claims }));
  return pedirToken('signInWithIdp', {
    postBody: `id_token=${idToken}&providerId=google.com`,
    requestUri: 'http://localhost',
  });
}

async function pedir(metodo, ruta, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(api + ruta, { method: metodo, headers, body: body && JSON.stringify(body) });
  return { status: r.status, datos: await r.json() };
}

describe('sesión con Firebase Auth', () => {
  it('sin token no hay usuario y lo que pide sesión da 401', async () => {
    assert.deepEqual((await pedir('GET', '/auth/me')).datos, { user: null });
    assert.equal((await pedir('PATCH', '/auth/me', { body: { discord: 'x' } })).status, 401);
  });

  it('un token trucho cuenta como anónimo', async () => {
    assert.deepEqual((await pedir('GET', '/auth/me', { token: 'no.es.un-token' })).datos, { user: null });
    assert.equal((await pedir('PATCH', '/auth/me', { token: 'no.es.un-token', body: {} })).status, 401);
  });

  it('la primera vez crea el usuario con lo que trae el token', async () => {
    const { uid, token } = await cuentaConEmail('kaiser@demo.aoematch');
    const { datos } = await pedir('GET', '/auth/me', { token });
    assert.equal(datos.user.id, uid);
    assert.equal(datos.user.display_name, 'kaiser');
    assert.equal(datos.user.is_admin, false);
    assert.equal(datos.user.timezone, 'UTC');

    const doc = await leerUsuario(uid);
    assert.equal(doc.email, 'kaiser@demo.aoematch');
    assert.equal(doc.google_sub, null);
    assert.equal(doc.display_name_lower, 'kaiser');
  });

  it('varios pedidos a la vez de un usuario nuevo crean uno solo', async () => {
    const { uid, token } = await cuentaConEmail('mitoe@demo.aoematch');
    const respuestas = await Promise.all([1, 2, 3, 4].map(() => pedir('GET', '/auth/me', { token })));
    for (const r of respuestas) assert.equal(r.datos.user.id, uid);
  });

  it('con Google guarda el sub, el email, el nombre y la foto', async () => {
    const { uid, token } = await cuentaConGoogle({
      sub: '1122334455',
      email: 'jugador@gmail.com',
      name: 'Jugador Google',
      picture: 'https://example.com/foto.png',
    });
    const { datos } = await pedir('GET', '/auth/me', { token });
    assert.equal(datos.user.display_name, 'Jugador Google');
    assert.equal(datos.user.avatar_url, 'https://example.com/foto.png');
    assert.equal(datos.user.google_sub, '1122334455');
    assert.equal(datos.user.google_email, 'jugador@gmail.com');
    assert.equal((await leerUsuario(uid)).email, null);
  });

  it('PATCH /me guarda el perfil en Firestore', async () => {
    const { uid, token } = await cuentaConEmail('garja@demo.aoematch');
    const { status, datos } = await pedir('PATCH', '/auth/me', {
      token,
      body: { display_name: 'Garja', timezone: 'America/Sao_Paulo', discord: '', rating_1v1: '1850', rating_team: 'mucho' },
    });
    assert.equal(status, 200);
    assert.equal(datos.user.display_name, 'Garja');
    assert.equal(datos.user.timezone, 'America/Sao_Paulo');
    assert.equal(datos.user.discord, null);
    assert.equal(datos.user.rating_1v1, 1850);
    assert.equal(datos.user.rating_team, null);
    assert.equal((await leerUsuario(uid)).display_name_lower, 'garja');
  });

  it('un nombre vacío no borra el que había', async () => {
    const { token } = await cuentaConEmail('fifty@demo.aoematch');
    await pedir('PATCH', '/auth/me', { token, body: { display_name: 'Fifty' } });
    const { datos } = await pedir('PATCH', '/auth/me', { token, body: { display_name: '', xbox_tag: 'Fifty50' } });
    assert.equal(datos.user.display_name, 'Fifty');
    assert.equal(datos.user.xbox_tag, 'Fifty50');
  });
});
