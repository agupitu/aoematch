// Ayuda común para probar la API contra los emuladores: levanta la app en un
// puerto libre, crea cuentas en el emulador de Auth y hace pedidos con token.
//
//   const api = await levantarApi();   // en before()
//   const { uid, token } = await cuentaConEmail('x@demo.aoematch');
//   const { status, datos } = await api.pedir('GET', '/auth/me', { token });
//   await api.cerrar();                 // en after()

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROYECTO = process.env.GCLOUD_PROJECT;

// Nunca contra un proyecto real: las pruebas borran cuentas y datos.
if (!AUTH || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Faltan los emuladores: corré las pruebas con `npm test` desde la raíz.');
}

/** Levanta la API con una base SQLite descartable (la app todavía la abre al cargar). */
export async function levantarApi() {
  const baseSqlite = join(tmpdir(), `aoe3draft-test-${process.pid}.db`);
  process.env.AOEMATCH_DB = baseSqlite;

  const { app } = await import('../src/app.js');
  const { db } = await import('../src/db.js');
  const { firestore } = await import('../src/data/base.js');

  const servidor = app.listen(0);
  await new Promise((ok) => servidor.once('listening', ok));
  const base = `http://127.0.0.1:${servidor.address().port}/api`;

  return {
    /** URL de la API, para pedidos a mano (por ejemplo sin seguir redirecciones). */
    base,
    /** Pedido a la API; `token` va como Bearer y `body` como JSON. */
    async pedir(metodo, ruta, { token, body } = {}) {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const r = await fetch(base + ruta, { method: metodo, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const texto = await r.text();
      return { status: r.status, datos: texto ? JSON.parse(texto) : null };
    },
    async cerrar() {
      await new Promise((ok) => servidor.close(ok));
      await firestore.terminate();
      db.close();
      for (const sufijo of ['', '-wal', '-shm']) rmSync(baseSqlite + sufijo, { force: true });
    },
  };
}

/** Borra todas las cuentas del emulador de Auth. */
export async function vaciarAuth() {
  const r = await fetch(`http://${AUTH}/emulator/v1/projects/${PROYECTO}/accounts`, { method: 'DELETE' });
  assert.ok(r.ok, `no se pudo vaciar el emulador de Auth: ${r.status}`);
}

async function pedirToken(metodo, cuerpo) {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${metodo}?key=demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...cuerpo, returnSecureToken: true }),
  });
  const datos = await r.json();
  assert.ok(r.ok, JSON.stringify(datos));
  // signInWithCustomToken no devuelve localId: el uid sale del propio token.
  const uid = datos.localId ?? JSON.parse(Buffer.from(datos.idToken.split('.')[1], 'base64url')).user_id;
  return { uid, token: datos.idToken };
}

/** Cuenta de email y contraseña, como las de demo. */
export const cuentaConEmail = (email) => pedirToken('signUp', { email, password: 'demo1234' });

/** Canjea un token propio (createCustomToken) por un ID token, como hace la web. */
export const tokenDeCustom = (token) => pedirToken('signInWithCustomToken', { token });

/** Cuenta de Google: el emulador acepta un id_token sin firmar. */
export function cuentaConGoogle(claims) {
  const idToken = encodeURIComponent(JSON.stringify({ email_verified: true, ...claims }));
  return pedirToken('signInWithIdp', {
    postBody: `id_token=${idToken}&providerId=google.com`,
    requestUri: 'http://localhost',
  });
}
