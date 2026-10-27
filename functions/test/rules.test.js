// Reglas de Realtime Database (presencia), contra los emuladores. Las de
// Firestore están en reglas-torneos.test.js y reglas-partidos.test.js.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  throw new Error('Faltan los emuladores: corré las pruebas con `npm test` desde la raíz.');
}

const raiz = (archivo) => readFileSync(new URL(`../../${archivo}`, import.meta.url), 'utf8');
const hostYPuerto = (variable) => {
  const [host, port] = process.env[variable].split(':');
  return { host, port: Number(port) };
};

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT,
    firestore: { rules: raiz('firestore.rules'), ...hostYPuerto('FIRESTORE_EMULATOR_HOST') },
    database: { rules: raiz('database.rules.json'), ...hostYPuerto('FIREBASE_DATABASE_EMULATOR_HOST') },
  });
  await env.clearFirestore();
});

after(() => env.cleanup());

const anonimo = () => env.unauthenticatedContext();
const como = (uid) => env.authenticatedContext(uid);

describe('reglas de Realtime Database', () => {
  const presencia = { display_name: 'Miembro', avatar_url: 'https://example.com/a.png' };

  it('la presencia se lee sin sesión', async () => {
    await assertSucceeds(anonimo().database().ref('presence/torneo_copa').get());
  });

  it('cada uno escribe y borra solo la suya', async () => {
    const db = como('miembro').database();
    await assertSucceeds(db.ref('presence/torneo_copa/miembro').set(presencia));
    await assertFails(db.ref('presence/torneo_copa/otro').set(presencia));
    await assertSucceeds(db.ref('presence/torneo_copa/miembro').remove());
    await assertFails(anonimo().database().ref('presence/torneo_copa/miembro').set(presencia));
  });

  it('solo nombre y avatar, los dos de texto', async () => {
    const db = como('miembro').database();
    await assertFails(db.ref('presence/torneo_copa/miembro').set({ ...presencia, at: 1 }));
    await assertFails(db.ref('presence/torneo_copa/miembro').set({ ...presencia, google_email: 'x@gmail.com' }));
    await assertFails(db.ref('presence/torneo_copa/miembro').set({ display_name: 'Miembro' }));
    await assertFails(db.ref('presence/torneo_copa/miembro').set({ ...presencia, avatar_url: null }));
    await assertFails(db.ref('presence/torneo_copa/miembro').set({ ...presencia, display_name: 'x'.repeat(61) }));
    await assertSucceeds(db.ref('presence/torneo_copa/miembro').set({ display_name: 'Miembro', avatar_url: '' }));
  });

  it('fuera de presence no se lee ni se escribe', async () => {
    await assertFails(como('miembro').database().ref('/').get());
    await assertFails(como('miembro').database().ref('otra/cosa').set(1));
  });
});
