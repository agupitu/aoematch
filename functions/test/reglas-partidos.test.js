// Reglas de Firestore para partidos, votos, draft con pick ciego y chat
// (plan Spark, T36). Los drafts se arman con la misma lógica que usa la web.
//
//   npm test        (desde la raíz)

import { after, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { civs, maps } from '../../web/src/logica/catalogo.js';
import { banear, elegirMapa, planDeDraft } from '../../web/src/logica/draft.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Faltan los emuladores: corré las pruebas con `npm test` desde la raíz.');
}

const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
let env;

const anonimo = () => env.unauthenticatedContext().firestore();
const como = (uid) => env.authenticatedContext(uid).firestore();
const ahora = () => firebase.firestore.FieldValue.serverTimestamp();

const MAPAS = maps().slice(0, 4).map((m) => m.id);
const CIVS = civs().slice(0, 5).map((c) => c.id);

const torneo = {
  slug: 'copa', name: 'Copa', organizer_id: 'org', admin_ids: ['adm'], status: 'en_curso', team_size: 2,
  map_ids: MAPAS, civ_ids: CIVS, first_map_id: null, map_repeat: 0, civ_bans: 0, civ_repeat_series: 1,
};

const equipo = (id, miembros) => ({
  tournament_id: 'copa', name: id, captain_id: miembros[0], member_ids: miembros,
  members: miembros.map((u, i) => ({ user_id: u, role: i === 0 ? 'capitan' : 'jugador' })),
});
const equipos = { a: equipo('ta', ['a1', 'a2']), b: equipo('tb', ['b1', 'b2']) };

const partido = (id, games = []) => ({
  id, tournament_id: 'copa', team_a_id: 'ta', team_b_id: 'tb', status: 'pendiente', score_a: 0, score_b: 0,
  winner_team_id: null, scheduled_at: null, games,
});
const jugada = (game_no, winner_team_id, map_id) => ({ game_no, winner_team_id, map_id, civs: [] });

const perfil = (nombre) => ({ display_name: nombre, display_name_lower: nombre.toLowerCase(), avatar_url: null });

/** Draft armado como lo arma la web, sin el `id` del partido. */
const draft = (t, m, gameNo) => planDeDraft(t, m, equipos, gameNo);

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
    await db.doc('teams/ta').set(equipos.a);
    await db.doc('teams/tb').set(equipos.b);
    await db.doc('teams/tc').set(equipo('tc', ['c1']));
    const { id: _a, ...m1 } = partido('m1');
    const { id: _b, ...m2 } = partido('m2', [jugada(1, 'ta', MAPAS[0])]);
    await db.doc('matches/m1').set(m1);
    await db.doc('matches/m2').set(m2);
    for (const uid of ['a1', 'a2', 'b1', 'c1', 'ret', 'adm']) await db.doc(`users/${uid}`).set(perfil(uid.toUpperCase()));
    await db.doc('tournaments/copa/registrations/a1').set({ user_id: 'a1', status: 'pendiente' });
    await db.doc('tournaments/copa/registrations/ret').set({ user_id: 'ret', status: 'retirada' });
    await db.doc('rooms/torneo_copa').set({ kind: 'torneo', tournament_id: 'copa', public_read: true, readers: [] });
    await db.doc('rooms/torneo_copa/messages/x').set({ body: 'hola a todos' });
    await db.doc('rooms/equipo_ta').set({ kind: 'equipo', tournament_id: 'copa', team_id: 'ta', public_read: false, readers: [] });
    await db.doc('rooms/equipo_ta/messages/x').set({ body: 'banean Alaska' });
  });
});

after(() => env.cleanup());

/** Escribe un draft sin reglas, para probar los pasos que siguen. */
const sembrarDraft = (matchId, gameNo, datos) =>
  env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`matches/${matchId}/drafts/${gameNo}`).set(datos));

describe('partidos', () => {
  it('se leen sin sesión; los crea y borra el staff', async () => {
    await assertSucceeds(anonimo().doc('matches/m1').get());
    const { id, ...nuevo } = partido('m3');
    await assertSucceeds(como('adm').doc('matches/m3').set(nuevo));
    await assertFails(como('a1').doc('matches/m4').set(nuevo));
    await assertFails(como('a1').doc('matches/m3').delete());
    await assertSucceeds(como('org').doc('matches/m3').delete());
  });

  it('resultados y llave solo el staff', async () => {
    await assertSucceeds(como('org').doc('matches/m1').update({ score_a: 2, winner_team_id: 'ta', status: 'finalizado' }));
    await assertFails(como('a1').doc('matches/m2').update({ winner_team_id: 'ta' }));
    await assertFails(como('c1').doc('matches/m2').update({ score_a: 1 }));
    await assertFails(como('org').doc('matches/m2').update({ tournament_id: 'otro' }));
  });

  it('los capitanes agendan; los demás jugadores no', async () => {
    const agenda = { scheduled_at: '2026-11-02T22:00:00.000Z', status: 'agendado' };
    await assertSucceeds(como('b1').doc('matches/m1').update(agenda));
    await assertSucceeds(como('a1').doc('matches/m1').update({ scheduled_at: null }));
    await assertFails(como('a2').doc('matches/m2').update(agenda));
    await assertFails(como('a1').doc('matches/m2').update({ status: 'finalizado' }));
  });

  it('cada jugador del partido vota solo lo suyo', async () => {
    const votos = { votes: [{ slot_utc: '2026-11-02T22:00:00.000Z', vote: 1 }] };
    await assertSucceeds(como('a2').doc('matches/m1/votos/a2').set(votos));
    await assertFails(como('a2').doc('matches/m1/votos/b1').set(votos));
    await assertFails(como('c1').doc('matches/m1/votos/c1').set(votos));
    await assertSucceeds(anonimo().collection('matches/m1/votos').get());
  });
});

describe('draft: crear, mapa y bans', () => {
  it('lo crea un jugador del partido; uno de afuera no', async () => {
    const d = draft(torneo, partido('m1'), 1);
    await assertFails(como('c1').doc('matches/m1/drafts/1').set(d));
    await assertSucceeds(como('a2').doc('matches/m1/drafts/1').set(d));
    await assertSucceeds(anonimo().doc('matches/m1/drafts/1').get());
  });

  it('no arranca sin ganador en la partida anterior, ni con un número que no corresponde', async () => {
    const d = draft(torneo, partido('m2', [jugada(1, 'ta', MAPAS[0])]), 2);
    await assertFails(como('a1').doc('matches/m1/drafts/2').set(d));
    await assertFails(como('a1').doc('matches/m2/drafts/3').set(d));
    await assertSucceeds(como('a1').doc('matches/m2/drafts/2').set(d));
  });

  it('no se crea ya revelado ni con picks anotados', async () => {
    const d = draft(torneo, partido('m1'), 1);
    await assertFails(como('a1').doc('matches/m1/drafts/1').set({ ...d, revealed: true }));
    await assertFails(como('a1').doc('matches/m1/drafts/1').set({ ...d, picked: ['a1'] }));
  });

  it('el mapa lo elige el que perdió la anterior, del pool', async () => {
    const d = draft(torneo, partido('m2', [jugada(1, 'ta', MAPAS[0])]), 2);
    await sembrarDraft('m2', 2, d);
    await assertFails(como('a1').doc('matches/m2/drafts/2').update({ map_id: MAPAS[1], state: 'picks' }));
    await assertFails(como('b1').doc('matches/m2/drafts/2').update({ map_id: MAPAS[0], state: 'picks' }));
    await assertFails(como('b1').doc('matches/m2/drafts/2').update({ map_id: MAPAS[1], state: 'mapa' }));
    await assertSucceeds(como('b1').doc('matches/m2/drafts/2').update({ map_id: MAPAS[1], state: 'picks' }));
  });

  it('bans por turno, una civ del pool sin repetir', async () => {
    const t = { ...torneo, civ_bans: 1 };
    const d = elegirMapa(draft(t, partido('m2', [jugada(1, 'ta', MAPAS[0])]), 2), 'tb', MAPAS[1]);
    await sembrarDraft('m2', 2, d);
    const ref = (uid) => como(uid).doc('matches/m2/drafts/2');
    await assertFails(ref('b1').update({ banned_civ_ids: [CIVS[0]], state: 'bans' }));
    await assertFails(ref('a1').update({ banned_civ_ids: [-1], state: 'bans' }));
    await assertSucceeds(ref('a1').update({ banned_civ_ids: [CIVS[0]], state: 'bans' }));
    await assertFails(ref('a2').update({ banned_civ_ids: [CIVS[0], CIVS[1]], state: 'picks' }));
    await assertFails(ref('b1').update({ banned_civ_ids: [CIVS[0], CIVS[0]], state: 'picks' }));
    await assertFails(ref('b1').update({ banned_civ_ids: [CIVS[0], CIVS[1]], state: 'bans' }));
    await assertSucceeds(ref('b1').update({ banned_civ_ids: [CIVS[0], CIVS[1]], state: 'picks' }));
  });

  it('el staff lo reinicia; un jugador no lo borra ni lo cambia a mano', async () => {
    await sembrarDraft('m1', 1, draft(torneo, partido('m1'), 1));
    await assertFails(como('a1').doc('matches/m1/drafts/1').update({ map_id: MAPAS[3] }));
    await assertFails(como('a1').doc('matches/m1/drafts/1').delete());
    await assertSucceeds(como('adm').doc('matches/m1/drafts/1').delete());
  });
});

describe('draft: pick ciego', () => {
  const ruta = 'matches/m1/drafts/1';
  const jugadores = ['a1', 'a2', 'b1', 'b2'];

  /** Guarda el pick y se anota, en un batch, como lo hace la web. */
  function elegir(uid, civ) {
    const db = como(uid);
    const batch = db.batch();
    batch.set(db.doc(`${ruta}/picks/${uid}`), { civ_id: civ });
    batch.update(db.doc(ruta), { picked: firebase.firestore.FieldValue.arrayUnion(uid) });
    return batch.commit();
  }

  beforeEach(async () => {
    const t = { ...torneo, civ_bans: 1 };
    const d = banear(banear(draft(t, partido('m1'), 1), 'ta', CIVS[4]), 'tb', CIVS[3]);
    await sembrarDraft('m1', 1, { ...d, picked: [] });
  });

  it('cada uno elige la suya, del pool y sin baneadas; se permite repetir', async () => {
    await assertSucceeds(elegir('a1', CIVS[0]));
    await assertSucceeds(elegir('b1', CIVS[0]));
    await assertFails(elegir('a2', CIVS[4]));
    await assertFails(elegir('c1', CIVS[0]));
    await assertFails(como('a2').doc(`${ruta}/picks/b2`).set({ civ_id: CIVS[1] }));
  });

  it('nadie lee el pick ajeno antes de revelar; el propio sí, y lo puede cambiar', async () => {
    await assertSucceeds(elegir('a1', CIVS[0]));
    await assertSucceeds(como('a1').doc(`${ruta}/picks/a1`).get());
    await assertFails(como('a2').doc(`${ruta}/picks/a1`).get());
    await assertFails(como('b1').doc(`${ruta}/picks/a1`).get());
    await assertFails(anonimo().collection(`${ruta}/picks`).get());
    await assertSucceeds(como('a1').doc(`${ruta}/picks/a1`).set({ civ_id: CIVS[1] }));
  });

  it('no se anota sin haber guardado el pick, ni dos veces', async () => {
    await assertFails(como('a1').doc(ruta).update({ picked: ['a1'] }));
    await assertSucceeds(elegir('a1', CIVS[0]));
    await assertFails(como('a1').doc(ruta).update({ picked: ['a1', 'a1'] }));
    await assertFails(como('a1').doc(ruta).update({ picked: ['a1', 'b1'] }));
  });

  it('revelar con alguno sin elegir falla; con todos, se ven todos', async () => {
    for (const uid of jugadores.slice(0, 3)) await assertSucceeds(elegir(uid, CIVS[0]));
    await assertFails(como('a1').doc(ruta).update({ revealed: true, state: 'listo' }));

    await assertSucceeds(elegir('b2', CIVS[2]));
    await assertFails(como('c1').doc(ruta).update({ revealed: true, state: 'listo' }));
    await assertSucceeds(como('b2').doc(ruta).update({ revealed: true, state: 'listo' }));

    await assertSucceeds(como('b1').doc(`${ruta}/picks/a1`).get());
    await assertSucceeds(anonimo().collection(`${ruta}/picks`).get());
    await assertFails(como('a1').doc(`${ruta}/picks/a1`).set({ civ_id: CIVS[1] }));
  });
});

describe('chat', () => {
  const mensaje = (uid, extra = {}) => ({
    body: 'gg', system: 0, created_at: ahora(),
    user: { id: uid, display_name: uid.toUpperCase(), avatar_url: null }, ...extra,
  });
  const escribir = (uid, sala, extra) => como(uid).collection(`rooms/${sala}/messages`).add(mensaje(uid, extra));

  it('la general se lee sin sesión; la de equipo, sus miembros y el staff', async () => {
    await assertSucceeds(anonimo().collection('rooms/torneo_copa/messages').orderBy('created_at', 'desc').limit(80).get());
    await assertSucceeds(como('a2').collection('rooms/equipo_ta/messages').limit(80).get());
    await assertSucceeds(como('adm').doc('rooms/equipo_ta/messages/x').get());
    await assertFails(como('b1').doc('rooms/equipo_ta/messages/x').get());
    await assertFails(anonimo().collection('rooms/equipo_ta/messages').get());
    await assertFails(anonimo().collection('rooms/no_existe/messages').get());
  });

  it('en la general escriben los inscriptos no retirados y el staff', async () => {
    await assertSucceeds(escribir('a1', 'torneo_copa'));
    await assertSucceeds(escribir('adm', 'torneo_copa'));
    await assertFails(escribir('ret', 'torneo_copa'));
    await assertFails(escribir('c1', 'torneo_copa'));
    await assertFails(anonimo().collection('rooms/torneo_copa/messages').add(mensaje('x')));
  });

  it('el autor tiene que ser el de su perfil, y nada del sistema', async () => {
    await assertFails(escribir('a1', 'torneo_copa', { user: { id: 'a1', display_name: 'ORG', avatar_url: null } }));
    await assertFails(escribir('a1', 'torneo_copa', { user: { id: 'org', display_name: 'A1', avatar_url: null } }));
    await assertFails(escribir('a1', 'torneo_copa', { system: 1 }));
    await assertFails(escribir('a1', 'torneo_copa', { body: '' }));
    await assertFails(escribir('a1', 'torneo_copa', { created_at: new Date('2020-01-01') }));
  });

  it('en la de equipo escriben sus miembros; el rival no', async () => {
    await assertSucceeds(escribir('a2', 'equipo_ta'));
    await assertFails(escribir('b1', 'equipo_ta'));
  });

  it('la sala del partido la abre cualquiera; escriben los dos equipos', async () => {
    const sala = { kind: 'partido', tournament_id: 'copa', match_id: 'm1', name: 'Final', public_read: true, readers: [] };
    await assertFails(como('c1').doc('rooms/partido_m2').set(sala));
    await assertFails(como('c1').doc('rooms/partido_m1').set({ ...sala, tournament_id: 'otro' }));
    await assertSucceeds(como('c1').doc('rooms/partido_m1').set(sala));
    await assertSucceeds(escribir('b1', 'partido_m1'));
    await assertFails(escribir('c1', 'partido_m1'));
    await assertSucceeds(anonimo().collection('rooms/partido_m1/messages').get());
  });

  it('una sala de equipo nace privada y no se cambia', async () => {
    const sala = { kind: 'equipo', tournament_id: 'copa', team_id: 'tb', name: 'tb', public_read: false, readers: [] };
    await assertFails(como('b1').doc('rooms/equipo_tb').set({ ...sala, public_read: true }));
    await assertSucceeds(como('b1').doc('rooms/equipo_tb').set(sala));
    await assertFails(como('b1').doc('rooms/equipo_tb').update({ public_read: true }));
  });

  it('los mensajes no se editan; los borra el staff', async () => {
    await assertFails(como('a1').doc('rooms/torneo_copa/messages/x').update({ body: 'otro' }));
    await assertFails(como('a1').doc('rooms/torneo_copa/messages/x').delete());
    await assertSucceeds(como('org').doc('rooms/torneo_copa/messages/x').delete());
  });
});
