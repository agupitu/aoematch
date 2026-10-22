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
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('rooms/torneo_copa').set({ kind: 'torneo', public_read: true, readers: [] });
    await db.doc('rooms/torneo_copa/messages/m1').set({ body: 'hola a todos' });
    await db.doc('rooms/equipo_e1').set({ kind: 'equipo', public_read: false, readers: ['miembro', 'staff'] });
    await db.doc('rooms/equipo_e1/messages/m1').set({ body: 'banean Alaska' });
    await db.doc('live/p1').set({ draft: 1 });
    await db.doc('users/miembro').set({ display_name: 'Miembro', google_email: 'privado@gmail.com' });
    await db.doc('tournaments/copa').set({ name: 'Copa' });
    await db.doc('matches/p1').set({ tournament_id: 'copa' });
  });
});

after(() => env.cleanup());

const anonimo = () => env.unauthenticatedContext();
const como = (uid) => env.authenticatedContext(uid);

describe('reglas de Firestore', () => {
  it('cualquiera lee los avisos live, nadie los escribe', async () => {
    await assertSucceeds(anonimo().firestore().doc('live/p1').get());
    await assertFails(como('miembro').firestore().doc('live/p1').set({ draft: 2 }));
  });

  it('el chat general se lee sin sesión, de a uno y en consulta', async () => {
    const db = anonimo().firestore();
    await assertSucceeds(db.doc('rooms/torneo_copa/messages/m1').get());
    await assertSucceeds(db.collection('rooms/torneo_copa/messages').orderBy('created_at', 'desc').limit(80).get());
  });

  it('el chat de equipo lo leen los de readers', async () => {
    for (const uid of ['miembro', 'staff']) {
      const db = como(uid).firestore();
      await assertSucceeds(db.doc('rooms/equipo_e1/messages/m1').get());
      await assertSucceeds(db.collection('rooms/equipo_e1/messages').limit(80).get());
    }
  });

  it('el chat de equipo no lo lee el rival ni un anónimo', async () => {
    await assertFails(como('rival').firestore().doc('rooms/equipo_e1/messages/m1').get());
    await assertFails(como('rival').firestore().collection('rooms/equipo_e1/messages').get());
    await assertFails(anonimo().firestore().doc('rooms/equipo_e1/messages/m1').get());
  });

  it('una sala que no existe no se lee', async () => {
    await assertFails(anonimo().firestore().collection('rooms/no_existe/messages').get());
  });

  it('nadie escribe mensajes desde el cliente, ni en su sala', async () => {
    await assertFails(como('miembro').firestore().collection('rooms/equipo_e1/messages').add({ body: 'hola' }));
    await assertFails(como('miembro').firestore().collection('rooms/torneo_copa/messages').add({ body: 'hola' }));
  });

  it('el resto no se lee: usuarios, torneos, partidos, salas', async () => {
    const db = como('miembro').firestore();
    await assertFails(db.doc('users/miembro').get());
    await assertFails(db.doc('tournaments/copa').get());
    await assertFails(db.doc('matches/p1').get());
    await assertFails(db.doc('rooms/equipo_e1').get());
    await assertFails(anonimo().firestore().collection('users').get());
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
