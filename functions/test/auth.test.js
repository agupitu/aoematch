// Sesión con Firebase Auth en la API, contra los emuladores de Auth y Firestore.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, cuentaConGoogle, levantarApi, vaciarAuth } from './apoyo.js';

const { guardarUsuario, leerUsuario } = await import('../src/data/usuarios.js');

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

  it('el login de prueba solo se anuncia en el emulador de Functions', async () => {
    const antes = process.env.FUNCTIONS_EMULATOR;
    delete process.env.FUNCTIONS_EMULATOR;
    assert.equal((await pedir('GET', '/auth/providers')).datos.dev_login, false);
    process.env.FUNCTIONS_EMULATOR = 'true';
    assert.equal((await pedir('GET', '/auth/providers')).datos.dev_login, true);
    if (antes === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = antes;
  });

  it('un nombre vacío no borra el que había', async () => {
    const { token } = await cuentaConEmail('fifty@demo.aoematch');
    await pedir('PATCH', '/auth/me', { token, body: { display_name: 'Fifty' } });
    const { datos } = await pedir('PATCH', '/auth/me', { token, body: { display_name: '', xbox_tag: 'Fifty50' } });
    assert.equal(datos.user.display_name, 'Fifty');
    assert.equal(datos.user.xbox_tag, 'Fifty50');
  });
});

describe('buscador de usuarios', () => {
  it('el alta y el PATCH guardan display_name_lower, y solo matchea el prefijo', async () => {
    const { uid, token } = await cuentaConEmail('kaisert13@demo.aoematch');
    await pedir('GET', '/auth/me', { token });
    assert.equal((await leerUsuario(uid)).display_name_lower, 'kaisert13');

    await pedir('PATCH', '/auth/me', { token, body: { display_name: 'KaiserT13' } });
    assert.equal((await leerUsuario(uid)).display_name_lower, 'kaisert13');

    const si = await pedir('GET', `/auth/users?q=${encodeURIComponent('  KAISERT ')}`, { token });
    assert.equal(si.status, 200);
    assert.ok(si.datos.some((u) => u.id === uid && u.display_name === 'KaiserT13'));

    const no = await pedir('GET', '/auth/users?q=isert1', { token });
    assert.equal(no.datos.some((u) => u.id === uid), false);
  });

  it('sin avatar_url cae en steam_avatar, y no devuelve más de 20', async () => {
    const { token } = await cuentaConEmail('testigo-t13@demo.aoematch');
    await pedir('GET', '/auth/me', { token });

    await guardarUsuario('t13-avatar', {
      display_name: 'AvatarT13',
      avatar_url: null,
      steam_avatar: 'https://steam.example/a.png',
      steam_name: 'steam-avatar',
      rating_1v1: 1600,
    });
    const { datos } = await pedir('GET', '/auth/users?q=avatart13', { token });
    const avatar = datos.find((u) => u.id === 't13-avatar');
    assert.deepEqual(avatar, {
      id: 't13-avatar',
      display_name: 'AvatarT13',
      avatar_url: 'https://steam.example/a.png',
      steam_avatar: 'https://steam.example/a.png',
      steam_name: 'steam-avatar',
      rating_1v1: 1600,
      rating_team: null,
    });

    for (let i = 0; i < 21; i++) {
      const n = String(i).padStart(2, '0');
      await guardarUsuario(`t13tope${n}`, { display_name: `T13Tope${n}` });
    }
    const tope = await pedir('GET', '/auth/users?q=t13tope', { token });
    assert.equal(tope.datos.length, 20);
    assert.equal(tope.datos.some((u) => u.id === 't13tope20'), false);
    assert.ok(tope.datos.every((u) => u.display_name.toLowerCase().startsWith('t13tope')));

    const vacia = await pedir('GET', '/auth/users', { token });
    assert.ok(Array.isArray(vacia.datos));
    assert.ok(vacia.datos.length <= 20);
  });
});
