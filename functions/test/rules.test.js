// Reglas de seguridad de Firestore y Realtime Database, contra los emuladores.
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
  await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('live/p1').set({ draft: 1 }));
});

after(() => env.cleanup());

const anonimo = () => env.unauthenticatedContext();
const como = (uid) => env.authenticatedContext(uid);

describe('reglas de Firestore', () => {
  // Usuarios, torneos y equipos: reglas-torneos.test.js. Partidos, draft y
  // chat: reglas-partidos.test.js.
  it('cualquiera lee los avisos live, nadie los escribe', async () => {
    await assertSucceeds(anonimo().firestore().doc('live/p1').get());
    await assertFails(como('miembro').firestore().doc('live/p1').set({ draft: 2 }));
  });
});

describe('reglas de Realtime Database', () => {
  const presencia = { display_name: 'Miembro', avatar_url: 'https://example.com/a.png', at: 1 };

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

  it('solo nombre, avatar y hora', async () => {
    const db = como('miembro').database();
    await assertFails(db.ref('presence/torneo_copa/miembro').set({ ...presencia, google_email: 'x@gmail.com' }));
    await assertFails(db.ref('presence/torneo_copa/miembro').set({ avatar_url: null, at: 1 }));
    await assertFails(db.ref('presence/torneo_copa/miembro').set({ ...presencia, display_name: 'x'.repeat(61) }));
  });

  it('fuera de presence no se lee ni se escribe', async () => {
    await assertFails(como('miembro').database().ref('/').get());
    await assertFails(como('miembro').database().ref('otra/cosa').set(1));
  });
});
