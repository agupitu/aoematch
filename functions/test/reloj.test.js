// Reloj del draft: qué se encola, la tarea que vence el paso y el respaldo
// cuando una tarea se pierde. Contra el emulador de Firestore; la cola se
// reemplaza por una lista para ver qué se programó.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Falta FIRESTORE_EMULATOR_HOST: corré las pruebas con `npm test` desde la raíz.');
}

const draft = await import('../src/draft.js');
const { usarEncolador } = await import('../src/relojes.js');
const { firestore } = await import('../src/data/base.js');
const { guardarUsuario } = await import('../src/data/usuarios.js');
const { guardarTorneo } = await import('../src/data/torneos.js');
const { guardarEquipo } = await import('../src/data/equipos.js');
const { guardarPartido } = await import('../src/data/partidos.js');
const { leerDraft } = await import('../src/data/drafts.js');

const encolados = [];
usarEncolador(async (datos, cuando) => { encolados.push({ ...datos, cuando: cuando.toISOString() }); });

const T0 = Date.parse('2026-10-25T20:00:00.000Z');
const OPC = { rnd: () => 0.1, ahora: T0 };
const SLUG = 'copa-reloj';
let partido;

before(async () => {
  for (const uid of ['ra1', 'rb1']) await guardarUsuario(uid, { display_name: uid }).catch(() => {});
  await guardarTorneo(SLUG, { name: 'Reloj', organizer_id: 'rorg', team_size: 1, map_ids: [1, 2, 3, 4], civ_ids: [1, 2, 3], draft_timer_s: 60 });
  const a = await guardarEquipo({ tournament_id: SLUG, name: 'A', captain_id: 'ra1', members: [{ user_id: 'ra1', role: 'capitan' }] });
  const b = await guardarEquipo({ tournament_id: SLUG, name: 'B', captain_id: 'rb1', members: [{ user_id: 'rb1', role: 'capitan' }] });
  partido = await guardarPartido({ tournament_id: SLUG, team_a_id: a, team_b_id: b });
  await draft.crearDraft(partido, 1, OPC);
});

after(() => {
  usarEncolador();
  return firestore.terminate();
});

describe('reloj del draft', () => {
  it('crear el draft no programa nada; arrancar programa el primer paso', async () => {
    assert.equal(encolados.length, 0);
    await draft.marcarListo(partido, { id: 'ra1' }, OPC);
    assert.equal(encolados.length, 0);
    await draft.marcarListo(partido, { id: 'rb1' }, OPC);
    assert.deepEqual(encolados, [{ matchId: partido, step: 0, deadline: '2026-10-25T20:01:00.000Z', cuando: '2026-10-25T20:01:00.000Z' }]);
  });

  it('cada acción que estrena plazo programa el paso siguiente', async () => {
    await draft.aplicarAccion(partido, { id: 'ra1' }, { kind: 'ban_mapa', targetId: 1 }, { ...OPC, ahora: T0 + 10_000 });
    assert.deepEqual(encolados.at(-1), { matchId: partido, step: 1, deadline: '2026-10-25T20:01:10.000Z', cuando: '2026-10-25T20:01:10.000Z' });
  });

  it('una tarea adelantada falla para que Cloud Tasks reintente; a tiempo resuelve', async () => {
    const aviso = encolados.at(-1);
    await assert.rejects(draft.porTimeout(partido, aviso, { ...OPC, ahora: T0 + 30_000 }), /Todavía no venció/);
    assert.equal((await leerDraft(partido, 1)).current_step, 1);

    const st = await draft.porTimeout(partido, aviso, { ...OPC, ahora: T0 + 71_000 });
    assert.equal(st.current_step, 2);
    const accion = (await leerDraft(partido, 1)).actions.at(-1);
    assert.deepEqual([accion.kind, accion.auto, accion.team_id !== null], ['ban_mapa', 1, true]);
    assert.deepEqual(encolados.at(-1), { matchId: partido, step: 2, deadline: '2026-10-25T20:02:11.000Z', cuando: '2026-10-25T20:02:11.000Z' });
  });

  it('la misma tarea repetida no hace nada', async () => {
    const cuantos = encolados.length;
    assert.equal(await draft.porTimeout(partido, encolados.at(-2), { ...OPC, ahora: T0 + 999_000 }), null);
    assert.equal((await leerDraft(partido, 1)).current_step, 2);
    assert.equal(encolados.length, cuantos);
  });

  it('respaldo: sin vencer no toca nada; vencido resuelve un paso', async () => {
    assert.equal(await draft.resolverVencidos(partido, { ...OPC, ahora: T0 + 120_000 }), null);
    const st = await draft.resolverVencidos(partido, { ...OPC, ahora: T0 + 132_000 });
    // Era el último ban: el pick del mapa (paso 3) se resuelve solo y queda en el 4.
    assert.equal(st.current_step, 4);
    assert.ok(st.map_picked);
    assert.equal(await draft.resolverVencidos('sin-draft', OPC), null);
  });

  it('la función de la tarea llama a porTimeout con lo encolado', async () => {
    const d = await leerDraft(partido, 1);
    // Plazo ya pasado en el reloj real: alVencer usa la hora de verdad.
    await firestore.doc(`matches/${partido}/drafts/1`).update({ deadline_at: '2000-01-01T00:00:00.000Z' });
    await draft.alVencer({ matchId: partido, step: d.current_step, deadline: '2000-01-01T00:00:00.000Z' });
    assert.equal((await leerDraft(partido, 1)).current_step, d.current_step + 1);
    await draft.alVencer({ matchId: 'sin-draft', step: 0, deadline: 'x' });
  });

  it('al terminar el draft no programa nada más', async () => {
    let d = await leerDraft(partido, 1);
    const cuantos = encolados.length;
    while (d.state === 'en_curso') {
      await draft.resolverVencidos(partido, { ...OPC, ahora: Date.parse(d.deadline_at) + 1 });
      d = await leerDraft(partido, 1);
    }
    assert.equal(d.state, 'finalizado');
    assert.ok(encolados.slice(cuantos).every((e) => e.step < d.steps.length));
    const despues = encolados.length;
    await draft.resolverVencidos(partido, { ...OPC, ahora: Date.now() });
    assert.equal(encolados.length, despues);
  });
});
