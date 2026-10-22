// Draft guardado en Firestore, contra el emulador.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Falta FIRESTORE_EMULATOR_HOST: corré las pruebas con `npm test` desde la raíz.');
}

const draft = await import('../src/draft.js');
const { firestore } = await import('../src/data/base.js');
const { guardarUsuario } = await import('../src/data/usuarios.js');
const { guardarTorneo } = await import('../src/data/torneos.js');
const { guardarEquipo } = await import('../src/data/equipos.js');
const { guardarPartido, leerPartido } = await import('../src/data/partidos.js');
const { leerDraft } = await import('../src/data/drafts.js');
const { avisar } = await import('../src/live.js');

/** Contadores de live/{matchId}. */
async function avisos(matchId) {
  const d = (await firestore.collection('live').doc(matchId).get()).data() ?? {};
  return { draft: d.draft ?? 0, match: d.match ?? 0 };
}

const OPC = { rnd: () => 0.1 };
const SLUG = 'copa-draft-prueba';
let partido;

before(async () => {
  for (const uid of ['da1', 'da2', 'db1', 'db2', 'dorg']) {
    await guardarUsuario(uid, { display_name: uid.toUpperCase() }).catch(() => {});
  }
  await guardarTorneo(SLUG, {
    name: 'Copa draft', organizer_id: 'dorg', team_size: 2, map_ids: [1, 2, 3], civ_ids: [1, 2, 3, 4, 5, 6],
  }).catch(() => {});
  const a = await guardarEquipo({
    tournament_id: SLUG, name: 'A', captain_id: 'da1',
    members: [{ user_id: 'da2', role: 'jugador' }, { user_id: 'da1', role: 'capitan' }],
  });
  const b = await guardarEquipo({
    tournament_id: SLUG, name: 'B', captain_id: 'db1',
    members: [{ user_id: 'db1', role: 'capitan' }, { user_id: 'db2', role: 'jugador' }],
  });
  partido = await guardarPartido({ tournament_id: SLUG, team_a_id: a, team_b_id: b, status: 'agendado' });
});

after(() => firestore.terminate());

describe('draft en Firestore', () => {
  it('crear devuelve el estado, con el capitán primero, y no duplica', async () => {
    const st = await draft.crearDraft(partido, 1, OPC);
    assert.equal(st.state, 'espera');
    assert.equal(st.id, `${partido}_1`);
    assert.deepEqual(st.teams.a.roster.map((p) => p.id), ['da1', 'da2']);
    assert.equal(st.teams.a.roster[0].display_name, 'DA1');
    assert.deepEqual(st.pools.maps.map((m) => m.id).sort(), [1, 2, 3]);

    const otra = await draft.crearDraft(partido, 1, { rnd: () => 0.9 });
    assert.equal(otra.first_team_id, st.first_team_id);
    // Crear avisa una vez; devolver el existente no avisa.
    assert.deepEqual(await avisos(partido), { draft: 1, match: 0 });
    assert.equal((await draft.estadoDelPartido(partido)).game_no, 1);
  });

  it('con los dos listos arranca y el partido pasa a draft', async () => {
    await draft.marcarListo(partido, { id: 'da2' }, OPC);
    const st = await draft.marcarListo(partido, { id: 'db1' }, OPC);
    assert.equal(st.state, 'en_curso');
    assert.ok(st.deadline_at);
    assert.equal((await leerPartido(partido)).status, 'draft');
    // Dos listos: dos avisos de draft y uno de partido (pasó a 'draft').
    assert.deepEqual(await avisos(partido), { draft: 3, match: 1 });
  });

  it('dos acciones a la vez del mismo paso: entra una sola', async () => {
    const intentos = await Promise.allSettled([
      draft.aplicarAccion(partido, { id: 'da1' }, { kind: 'ban_mapa', targetId: 1 }, OPC),
      draft.aplicarAccion(partido, { id: 'da1' }, { kind: 'ban_mapa', targetId: 1 }, OPC),
    ]);
    assert.deepEqual(intentos.map((i) => i.status).sort(), ['fulfilled', 'rejected']);
    const d = await leerDraft(partido, 1);
    assert.equal(d.actions.length, 1);
    assert.equal(d.current_step, 1);
    // Solo avisa la que entró.
    assert.equal((await avisos(partido)).draft, 4);
  });

  it('un error de regla no guarda nada', async () => {
    await assert.rejects(draft.aplicarAccion(partido, { id: 'da1' }, { kind: 'ban_mapa', targetId: 2 }, OPC), /Solo el capitán/);
    assert.equal((await leerDraft(partido, 1)).current_step, 1);
  });

  it('el aviso viejo del reloj no hace nada', async () => {
    assert.equal(await draft.porTimeout(partido, { step: 0, deadline: 'viejo' }, OPC), null);
  });

  it('al terminar guarda mapa y civs en la partida y el partido pasa a en_juego', async () => {
    await draft.aplicarAccion(partido, { id: 'db1' }, { kind: 'ban_mapa', targetId: 2 }, OPC);
    await draft.aplicarAccion(partido, { id: 'da1' }, { kind: 'pick_civ', targetId: 1 }, OPC);
    await draft.aplicarAccion(partido, { id: 'db1' }, { kind: 'pick_civ', targetId: 2 }, OPC);
    await draft.aplicarAccion(partido, { id: 'db1' }, { kind: 'pick_civ', targetId: 3 }, OPC);
    const st = await draft.aplicarAccion(partido, { id: 'da1' }, { kind: 'pick_civ', targetId: 4 }, { ...OPC, viewerTeamId: 'x' });
    assert.equal(st.state, 'finalizado');

    const p = await leerPartido(partido);
    assert.equal(p.status, 'en_juego');
    assert.equal(p.games.length, 1);
    assert.equal(p.games[0].map_id, 3);
    assert.deepEqual(p.games[0].civs.map((c) => c.civ_id).sort(), [1, 2, 3, 4]);
    assert.equal((await avisos(partido)).match, 2);
  });

  it('avisar solo acepta los tipos conocidos', async () => {
    await avisar('p-suelto', 'votes');
    const d = (await firestore.collection('live').doc('p-suelto').get()).data();
    assert.equal(d.votes, 1);
    assert.ok(d.at);
    assert.throws(() => avisar('p-suelto', 'cualquiera'), /Aviso desconocido/);
  });

  it('sin draft abierto avisa', async () => {
    const otro = await guardarPartido({ tournament_id: SLUG });
    await assert.rejects(draft.marcarListo(otro, { id: 'da1' }), /No hay draft abierto/);
    await assert.rejects(draft.crearDraft(otro, 1), /Faltan equipos/);
    await assert.rejects(draft.crearDraft('no-existe', 1), /El partido no existe/);
  });
});
