// Sesión con Firebase Auth en la API, contra los emuladores de Auth y Firestore.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, cuentaConGoogle, levantarApi, vaciarAuth } from './apoyo.js';

const { leerUsuario } = await import('../src/data/usuarios.js');

let api;

before(async () => {
  await vaciarAuth();
  api = await levantarApi();
});

after(() => api.cerrar());

const pedir = (...args) => api.pedir(...args);

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
