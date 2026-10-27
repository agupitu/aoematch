// Reglas de Firestore para lo que la web escribe directo (plan Spark, T35):
// usuarios, torneos, etapas, inscripciones y equipos.
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

const perfil = (nombre, extra = {}) => ({
  display_name: nombre,
  display_name_lower: nombre.toLowerCase(),
  avatar_url: null,
  timezone: 'UTC',
  ...extra,
});

const torneo = (extra = {}) => ({
  slug: 'copa',
  name: 'Copa',
  organizer_id: 'org',
  admin_ids: ['adm'],
  status: 'inscripcion',
  team_size: 2,
  allow_solo: 1,
  best_of: 3,
  civ_bans: 0,
  ...extra,
});

const equipo = (captain, otros = [], extra = {}) => ({
  tournament_id: 'copa',
  name: `Equipo de ${captain}`,
  tag: null,
  logo_url: null,
  captain_id: captain,
  seed: null,
  auto_built: 0,
  created_at: '2026-10-26T00:00:00.000Z',
  members: [{ user_id: captain, role: 'capitan' }, ...otros.map((u) => ({ user_id: u, role: 'jugador' }))],
  member_ids: [captain, ...otros],
  ...extra,
});

const inscripcion = (uid, extra = {}) => ({
  user_id: uid,
  team_id: null,
  kind: 'solo',
  status: 'pendiente',
  paid: 0,
  paid_at: null,
  payment_ref: null,
  note: null,
  created_at: '2026-10-26T00:00:00.000Z',
  ...extra,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT,
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
  });
});

// Cada caso arranca de la misma base: así no dependen del orden.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('users/miembro').set(perfil('Miembro', { is_admin: 0, rating_1v1: 1200 }));
    await db.doc('tournaments/copa').set(torneo());
    await db.doc('tournaments/cerrado').set(torneo({ slug: 'cerrado', status: 'en_curso' }));
    await db.doc('teams/e1').set(equipo('cap'));
    await db.doc('teams/e2').set(equipo('cap2', ['jug2']));
    await db.doc('tournaments/copa/registrations/cap').set(inscripcion('cap', { team_id: 'e1', kind: 'equipo' }));
    await db.doc('tournaments/copa/registrations/cap2').set(inscripcion('cap2', { team_id: 'e2', kind: 'equipo' }));
    await db.doc('tournaments/copa/registrations/jug2').set(inscripcion('jug2', { team_id: 'e2', kind: 'equipo' }));
    await db.doc('tournaments/copa/registrations/suelto').set(inscripcion('suelto'));
    await db.doc('tournaments/copa/registrations/retirado').set(inscripcion('retirado', { status: 'retirada' }));
  });
});

after(() => env.cleanup());

describe('usuarios', () => {
  it('el perfil lo lee cualquiera, también sin sesión', async () => {
    await assertSucceeds(anonimo().doc('users/miembro').get());
    await assertSucceeds(anonimo().collection('users').where('display_name_lower', '>=', 'm').limit(20).get());
  });

  it('cada uno crea solo su perfil, sin ser admin', async () => {
    await assertSucceeds(como('nuevo').doc('users/nuevo').set(perfil('Nuevo')));
    await assertFails(como('nuevo').doc('users/otro').set(perfil('Otro')));
    await assertFails(anonimo().doc('users/x').set(perfil('X')));
    await assertFails(como('nuevo2').doc('users/nuevo2').set(perfil('Nuevo', { is_admin: 1 })));
  });

  it('el perfil ya no guarda horarios: van por ronda en el torneo', async () => {
    await assertFails(como('nuevo3').doc('users/nuevo3').set(perfil('Nuevo', { availability: [] })));
    await assertFails(como('nuevo3').doc('users/nuevo3').set(perfil('Nuevo', { exceptions: [] })));
    await assertFails(como('miembro').doc('users/miembro').update({ availability: [] }));
  });

  it('edita su perfil y su rating, no `is_admin` ni el perfil ajeno', async () => {
    const db = como('miembro');
    await assertSucceeds(db.doc('users/miembro').update({ display_name: 'Otro Nombre', display_name_lower: 'otro nombre' }));
    await assertSucceeds(db.doc('users/miembro').update({ rating_1v1: 1500 }));
    await assertFails(db.doc('users/miembro').update({ is_admin: 1 }));
    await assertFails(db.doc('users/miembro').update({ display_name: 'Sin Minúsculas' }));
    await assertFails(db.doc('users/miembro').update({ display_name: '', display_name_lower: '' }));
    await assertFails(como('otro').doc('users/miembro').update({ discord: 'x' }));
    await assertFails(db.doc('users/miembro').delete());
  });

  it('los datos privados los ve y escribe solo el dueño', async () => {
    await assertSucceeds(como('miembro').doc('users/miembro/privado/datos').set({ google_email: 'x@gmail.com' }));
    await assertSucceeds(como('miembro').doc('users/miembro/privado/datos').get());
    await assertFails(como('otro').doc('users/miembro/privado/datos').get());
    await assertFails(anonimo().doc('users/miembro/privado/datos').get());
  });
});

describe('torneos y etapas', () => {
  it('se leen sin sesión', async () => {
    await assertSucceeds(anonimo().doc('tournaments/copa').get());
    await assertSucceeds(anonimo().collection('tournaments').get());
  });

  it('con sesión se crea uno propio y válido', async () => {
    const db = como('nuevo');
    await assertSucceeds(db.doc('tournaments/liga').set(torneo({ slug: 'liga', organizer_id: 'nuevo', admin_ids: [] })));
    await assertFails(db.doc('tournaments/liga2').set(torneo({ slug: 'liga2', organizer_id: 'otro' })));
    await assertFails(db.doc('tournaments/liga3').set(torneo({ slug: 'otro-slug', organizer_id: 'nuevo' })));
    await assertFails(db.doc('tournaments/liga4').set(torneo({ slug: 'liga4', organizer_id: 'nuevo', team_size: 5 })));
    await assertFails(db.doc('tournaments/liga5').set(torneo({ slug: 'liga5', organizer_id: 'nuevo', civ_bans: 4 })));
    await assertFails(anonimo().doc('tournaments/liga6').set(torneo({ slug: 'liga6', organizer_id: 'nuevo' })));
  });

  it('pisar un torneo ajeno con set no pasa', async () => {
    await assertFails(como('nuevo').doc('tournaments/copa').set(torneo({ organizer_id: 'nuevo' })));
  });

  it('lo edita el staff; los admins no tocan la lista de admins ni el organizador', async () => {
    await assertSucceeds(como('adm').doc('tournaments/copa').update({ name: 'Copa Otoño' }));
    await assertSucceeds(como('org').doc('tournaments/copa').update({ admin_ids: ['adm', 'adm2'] }));
    await assertFails(como('adm').doc('tournaments/copa').update({ admin_ids: ['adm', 'amigo'] }));
    await assertFails(como('adm').doc('tournaments/copa').update({ organizer_id: 'adm' }));
    await assertFails(como('org').doc('tournaments/copa').update({ organizer_id: 'adm' }));
    await assertFails(como('cap').doc('tournaments/copa').update({ name: 'Mío' }));
  });

  it('lo borra el staff', async () => {
    await assertFails(como('cap').doc('tournaments/copa').delete());
    await assertSucceeds(como('adm').doc('tournaments/copa').delete());
  });

  it('las etapas las escribe el staff', async () => {
    const etapa = { idx: 0, name: 'Grupos', type: 'grupos', groups: [] };
    await assertSucceeds(como('org').doc('tournaments/copa/stages/s1').set(etapa));
    await assertFails(como('cap').doc('tournaments/copa/stages/s2').set(etapa));
    await assertSucceeds(anonimo().doc('tournaments/copa/stages/s1').get());
  });
});

describe('inscripciones', () => {
  const ref = (db, uid, slug = 'copa') => db.doc(`tournaments/${slug}/registrations/${uid}`);

  it('se inscribe suelto, solo él y con la inscripción abierta', async () => {
    await assertSucceeds(ref(como('nuevo'), 'nuevo').set(inscripcion('nuevo')));
    await assertFails(ref(como('nuevo'), 'otro').set(inscripcion('otro')));
    await assertFails(ref(como('nuevo'), 'nuevo', 'cerrado').set(inscripcion('nuevo')));
    await assertFails(anonimo().doc('tournaments/copa/registrations/x').set(inscripcion('x')));
  });

  it('no se inscribe pagado, confirmado ni suelto donde no se acepta', async () => {
    await assertFails(ref(como('nuevo'), 'nuevo').set(inscripcion('nuevo', { paid: 1 })));
    await assertFails(ref(como('nuevo'), 'nuevo').set(inscripcion('nuevo', { status: 'confirmada' })));
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('tournaments/copa').update({ allow_solo: 0 }));
    await assertFails(ref(como('nuevo'), 'nuevo').set(inscripcion('nuevo')));
  });

  it('se inscribe con un equipo nuevo en el mismo batch', async () => {
    const db = como('nuevo');
    const batch = db.batch();
    batch.set(db.doc('teams/nuevo1'), equipo('nuevo'));
    batch.set(ref(db, 'nuevo'), inscripcion('nuevo', { team_id: 'nuevo1', kind: 'equipo' }));
    await assertSucceeds(batch.commit());
  });

  it('no se anota en un equipo del que no es miembro', async () => {
    await assertFails(ref(como('nuevo'), 'nuevo').set(inscripcion('nuevo', { team_id: 'e1', kind: 'equipo' })));
  });

  it('se suma a un equipo con lugar, no a uno completo', async () => {
    const db = como('nuevo');
    const e1 = equipo('cap', ['nuevo']);
    const sumarse = db.batch();
    sumarse.update(db.doc('teams/e1'), { members: e1.members, member_ids: e1.member_ids });
    sumarse.set(ref(db, 'nuevo'), inscripcion('nuevo', { team_id: 'e1', kind: 'equipo' }));
    await assertSucceeds(sumarse.commit());

    const e2 = equipo('cap2', ['jug2', 'otro']);
    const otro = como('otro');
    const lleno = otro.batch();
    lleno.update(otro.doc('teams/e2'), { members: e2.members, member_ids: e2.member_ids });
    lleno.set(ref(otro, 'otro'), inscripcion('otro', { team_id: 'e2', kind: 'equipo' }));
    await assertFails(lleno.commit());
  });

  it('se retira y vuelve; no se marca pagado', async () => {
    await assertSucceeds(ref(como('suelto'), 'suelto').update({ status: 'retirada' }));
    await assertSucceeds(ref(como('retirado'), 'retirado').update({ status: 'pendiente' }));
    await assertFails(ref(como('suelto'), 'suelto').update({ paid: 1 }));
    await assertFails(ref(como('suelto'), 'suelto').update({ status: 'confirmada' }));
    await assertFails(ref(como('otro'), 'suelto').update({ status: 'retirada' }));
  });

  it('un retirado no vuelve con la inscripción cerrada', async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('tournaments/copa').update({ status: 'en_curso' }));
    await assertFails(ref(como('retirado'), 'retirado').update({ status: 'pendiente' }));
  });

  it('el último del equipo se retira y se lleva el equipo', async () => {
    const db = como('cap');
    const batch = db.batch();
    batch.delete(db.doc('teams/e1'));
    batch.update(ref(db, 'cap'), { status: 'retirada', team_id: null, kind: 'solo' });
    await assertSucceeds(batch.commit());
  });

  it('pago y estado los marca el staff', async () => {
    await assertSucceeds(ref(como('org'), 'suelto').update({ paid: 1, paid_at: '2026-10-26T00:00:00.000Z', status: 'confirmada' }));
    await assertSucceeds(ref(como('adm'), 'suelto').update({ note: 'pagó por transferencia' }));
    await assertFails(ref(como('cap'), 'suelto').update({ status: 'rechazada' }));
  });

  it('se leen sin sesión; las borra solo el staff', async () => {
    await assertSucceeds(anonimo().collection('tournaments/copa/registrations').get());
    await assertFails(ref(como('suelto'), 'suelto').delete());
    await assertSucceeds(ref(como('org'), 'suelto').delete());
  });
});

describe('equipos', () => {
  it('el capitán edita nombre y capitán; seed y armado solo el staff', async () => {
    await assertSucceeds(como('cap').doc('teams/e1').update({ name: 'Los Primeros', tag: 'LP' }));
    await assertFails(como('cap').doc('teams/e1').update({ seed: 1 }));
    await assertFails(como('cap').doc('teams/e1').update({ tag: 'DEMASIADO_LARGO' }));
    await assertSucceeds(como('adm').doc('teams/e1').update({ seed: 1 }));
    await assertFails(como('otro').doc('teams/e1').update({ name: 'Robado' }));
  });

  it('el capitán no queda fuera de su propio equipo', async () => {
    await assertFails(como('cap2').doc('teams/e2').update({ captain_id: 'nadie' }));
    const e2 = equipo('jug2');
    await assertSucceeds(como('cap2').doc('teams/e2').update({ captain_id: 'jug2', members: e2.members, member_ids: e2.member_ids }));
  });

  it('un jugador crea su equipo solo con él, como capitán', async () => {
    await assertSucceeds(como('nuevo').doc('teams/n1').set(equipo('nuevo')));
    await assertFails(como('nuevo').doc('teams/n2').set(equipo('nuevo', ['amigo'])));
    await assertFails(como('nuevo').doc('teams/n3').set(equipo('otro')));
    await assertFails(como('nuevo').doc('teams/n4').set(equipo('nuevo', [], { seed: 1 })));
    await assertFails(como('nuevo').doc('teams/n5').set(equipo('nuevo', [], { tournament_id: 'cerrado' })));
  });

  it('el staff arma equipos con cualquiera', async () => {
    await assertSucceeds(como('org').doc('teams/a1').set(equipo('x', ['y'], { auto_built: 1 })));
    await assertFails(como('org').doc('teams/a2').set(equipo('x', ['y', 'z'])));
  });

  it('un jugador se va de su equipo; otro no lo saca', async () => {
    const e2 = equipo('cap2');
    await assertFails(como('otro').doc('teams/e2').update({ members: e2.members, member_ids: e2.member_ids }));
    await assertSucceeds(como('jug2').doc('teams/e2').update({ members: e2.members, member_ids: e2.member_ids }));
  });

  it('el capitán saca a un jugador y le deja la inscripción suelta', async () => {
    const db = como('cap2');
    const e2 = equipo('cap2');
    const batch = db.batch();
    batch.update(db.doc('teams/e2'), { members: e2.members, member_ids: e2.member_ids });
    batch.update(db.doc('tournaments/copa/registrations/jug2'), { team_id: null, kind: 'solo' });
    await assertSucceeds(batch.commit());
  });

  it('el capitán no toca inscripciones de otros equipos', async () => {
    await assertFails(como('cap').doc('tournaments/copa/registrations/jug2').update({ team_id: null, kind: 'solo' }));
  });

  it('se borra con el staff o al irse el último', async () => {
    await assertFails(como('cap2').doc('teams/e2').delete());
    await assertSucceeds(como('cap').doc('teams/e1').delete());
    await assertSucceeds(como('org').doc('teams/e2').delete());
  });
});
