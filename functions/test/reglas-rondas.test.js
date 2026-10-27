// Reglas de Firestore para las fechas de cada ronda y los horarios que cargan
// los jugadores (docs/superpowers/specs/2026-10-27-horarios-por-ronda-design.md).
//
//   npm test        (desde la raíz)

import { after, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Faltan los emuladores: corré las pruebas con `npm test` desde la raíz.');
}

const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
let env;

const anonimo = () => env.unauthenticatedContext().firestore();
const como = (uid) => env.authenticatedContext(uid).firestore();

const torneo = { slug: 'copa', name: 'Copa', organizer_id: 'org', admin_ids: ['adm'], status: 'en_curso', team_size: 2 };

const ronda = (extra = {}) => ({
  stage_id: 's1',
  bracket: 'W',
  round: 2,
  label: 'Semifinal',
  from_day: '2026-11-14',
  to_day: '2026-11-16',
  zone: 'America/Argentina/Buenos_Aires',
  starts_at: '2026-11-14T03:00:00.000Z',
  ends_at: '2026-11-17T03:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  ...extra,
});

const bloque = { starts_at: '2026-11-14T21:00:00.000Z', ends_at: '2026-11-14T23:00:00.000Z' };

const horario = (uid, extra = {}) => ({ user_id: uid, blocks: [bloque], updated_at: '2026-11-01T00:00:00.000Z', ...extra });

const RONDA = 'tournaments/copa/rondas/s1_W2';
const SIN_RONDA = 'tournaments/copa/rondas/s1_W9';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT,
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('tournaments/copa').set(torneo);
    await db.doc('tournaments/copa/registrations/a1').set({ user_id: 'a1', status: 'pendiente' });
    await db.doc('tournaments/copa/registrations/a2').set({ user_id: 'a2', status: 'confirmada' });
    await db.doc('tournaments/copa/registrations/ret').set({ user_id: 'ret', status: 'retirada' });
    await db.doc(RONDA).set(ronda());
    await db.doc(`${RONDA}/horarios/a2`).set(horario('a2'));
  });
});

after(() => env.cleanup());

describe('fechas de la ronda', () => {
  it('las lee cualquiera, también sin sesión', async () => {
    await assertSucceeds(anonimo().doc(RONDA).get());
    await assertSucceeds(anonimo().collection('tournaments/copa/rondas').get());
  });

  it('las crean y editan el organizador y sus admins; un jugador o un extraño no', async () => {
    const final = ronda({ round: 3, label: 'Final' });
    await assertSucceeds(como('org').doc('tournaments/copa/rondas/s1_W3').set(final));
    await assertSucceeds(como('adm').doc(RONDA).set(ronda({ to_day: '2026-11-18', ends_at: '2026-11-19T03:00:00.000Z' })));
    await assertFails(como('a1').doc('tournaments/copa/rondas/s1_W3').set(final));
    await assertFails(como('x').doc(RONDA).set(ronda()));
    await assertFails(anonimo().doc(RONDA).set(ronda()));
  });

  it('piden la forma de siempre: claves justas, cuadro W, L o F, número de ronda y rango con sentido', async () => {
    const nueva = (extra) => como('org').doc('tournaments/copa/rondas/s1_W3').set(ronda({ round: 3, ...extra }));
    await assertSucceeds(nueva({ bracket: 'L' }));
    await assertFails(nueva({ extra: 1 }));
    await assertFails(nueva({ bracket: 'Z' }));
    await assertFails(nueva({ round: 0 }));
    await assertFails(nueva({ round: 1.5 }));
    await assertFails(nueva({ starts_at: '2026-11-17T03:00:00.000Z', ends_at: '2026-11-17T03:00:00.000Z' }));
    await assertFails(nueva({ starts_at: '2026-11-18T03:00:00.000Z' }));
    await assertFails(nueva({ zone: 'x'.repeat(61) }));
  });

  it('las borra solo el staff', async () => {
    await assertFails(como('a1').doc(RONDA).delete());
    await assertFails(como('x').doc(RONDA).delete());
    await assertSucceeds(como('adm').doc(RONDA).delete());
  });
});

describe('horarios de la ronda', () => {
  it('los lee cualquiera, también sin sesión', async () => {
    await assertSucceeds(anonimo().doc(`${RONDA}/horarios/a2`).get());
    await assertSucceeds(anonimo().collection(`${RONDA}/horarios`).get());
  });

  it('cada inscripto escribe solo el suyo', async () => {
    await assertSucceeds(como('a1').doc(`${RONDA}/horarios/a1`).set(horario('a1')));
    await assertSucceeds(como('a1').doc(`${RONDA}/horarios/a1`).set(horario('a1', { blocks: [] })));
    await assertFails(como('a1').doc(`${RONDA}/horarios/a2`).set(horario('a2')));
    await assertFails(como('a1').doc(`${RONDA}/horarios/a2`).update({ blocks: [] }));
    await assertFails(anonimo().doc(`${RONDA}/horarios/a1`).set(horario('a1')));
  });

  it('el staff no escribe los de los jugadores, solo los borra', async () => {
    await assertFails(como('org').doc(`${RONDA}/horarios/a1`).set(horario('a1')));
  });

  it('solo en una ronda que tiene fechas', async () => {
    await assertFails(como('a1').doc(`${SIN_RONDA}/horarios/a1`).set(horario('a1')));
  });

  it('no los escribe quien se retiró ni quien no está inscripto', async () => {
    await assertFails(como('ret').doc(`${RONDA}/horarios/ret`).set(horario('ret')));
    await assertFails(como('x').doc(`${RONDA}/horarios/x`).set(horario('x')));
  });

  it('el documento trae solo user_id, blocks y updated_at, y el user_id es el del dueño', async () => {
    const mio = (extra) => como('a1').doc(`${RONDA}/horarios/a1`).set(horario('a1', extra));
    await assertFails(mio({ extra: 1 }));
    await assertFails(mio({ user_id: 'a2' }));
    await assertFails(mio({ blocks: 'todo el día' }));
  });

  it('hasta 800 bloques: 31 días de barras alternadas caben, uno más no', async () => {
    const bloques = (n) => Array.from({ length: n }, () => bloque);
    await assertSucceeds(como('a1').doc(`${RONDA}/horarios/a1`).set(horario('a1', { blocks: bloques(800) })));
    await assertFails(como('a1').doc(`${RONDA}/horarios/a1`).set(horario('a1', { blocks: bloques(801) })));
  });

  it('los borra el dueño o el staff; un ajeno no', async () => {
    await assertFails(como('a1').doc(`${RONDA}/horarios/a2`).delete());
    await assertFails(como('x').doc(`${RONDA}/horarios/a2`).delete());
    await assertSucceeds(como('a2').doc(`${RONDA}/horarios/a2`).delete());
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`${RONDA}/horarios/a2`).set(horario('a2')));
    await assertSucceeds(como('adm').doc(`${RONDA}/horarios/a2`).delete());
  });
});
