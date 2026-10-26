// La demo de los emuladores (src/demo.js): se siembra entera, no se duplica y
// las cuentas de prueba entran con email y contraseña.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!AUTH || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Faltan los emuladores: corré las pruebas con `npm test` desde la raíz.');
}

const { CLAVE_DEMO, sembrarDemo, vaciarEmuladores } = await import('../src/demo.js');
const { firestore } = await import('../src/data/base.js');
const { listarTorneos, leerTorneo } = await import('../src/data/torneos.js');
const { listarEquipos } = await import('../src/data/equipos.js');
const { listarPartidos } = await import('../src/data/partidos.js');
const { ultimoDraft } = await import('../src/data/drafts.js');
const { historial } = await import('../src/data/salas.js');
const { listarInscripciones } = await import('../src/data/inscripciones.js');

let resultado;

before(async () => {
  await vaciarEmuladores();
  resultado = await sembrarDemo();
});

after(() => firestore.terminate());

describe('demo', () => {
  it('crea los cuatro torneos y el organizador', () => {
    assert.equal(resultado.creada, true);
    assert.equal(resultado.organizador.email, 'kaiser@demo.aoematch');
    assert.deepEqual(resultado.torneos, ['copa-aoematch-mockup', 'copa-sudamericana-3v3', 'ladder-1v1-de-otono', 'clan-wars-2v2']);
  });

  it('las cuentas de prueba entran con email y contraseña', async () => {
    const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'kaiser@demo.aoematch', password: CLAVE_DEMO, returnSecureToken: true }),
    });
    const datos = await r.json();
    assert.ok(r.ok, JSON.stringify(datos));
    assert.equal(datos.localId, 'demo-kaiser');
  });

  it('cada torneo queda en su estado, con sus contadores', async () => {
    const t = Object.fromEntries((await listarTorneos()).map((x) => [x.id, x]));
    assert.deepEqual(
      Object.keys(t).sort(),
      ['clan-wars-2v2', 'copa-aoematch-mockup', 'copa-sudamericana-3v3', 'ladder-1v1-de-otono']
    );
    assert.deepEqual([t['copa-sudamericana-3v3'].status, t['copa-sudamericana-3v3'].inscriptos], ['inscripcion', 15]);
    assert.deepEqual([t['ladder-1v1-de-otono'].status, t['ladder-1v1-de-otono'].equipos], ['en_curso', 8]);
    assert.deepEqual([t['clan-wars-2v2'].status, t['clan-wars-2v2'].equipos, t['clan-wars-2v2'].inscriptos], ['armado', 6, 12]);
    assert.deepEqual([t['copa-aoematch-mockup'].equipos, t['copa-aoematch-mockup'].pagos], [8, 16]);
    assert.equal((await listarPartidos('ladder-1v1-de-otono')).length, 7);
    assert.equal((await listarInscripciones('copa-sudamericana-3v3')).filter((r) => r.kind === 'solo').length, 15);
  });

  it('la copa de muestra: cuartos jugados con drafts, semis agendadas y una con el draft abierto', async () => {
    const partidos = await listarPartidos('copa-aoematch-mockup');
    const cuartos = partidos.filter((m) => m.bracket === 'W' && m.round === 1);
    assert.equal(cuartos.length, 4);
    for (const m of cuartos) {
      assert.equal(m.status, 'finalizado');
      assert.ok(m.games.length >= 2);
      assert.ok(m.games.every((g) => g.map_id && g.civs.length === 4));
    }
    const semis = partidos.filter((m) => m.bracket === 'W' && m.round === 2).sort((a, b) => a.position - b.position);
    assert.ok(semis.every((m) => m.status === 'agendado' && m.team_a_id && m.team_b_id && m.scheduled_at));
    assert.equal((await ultimoDraft(semis[0].id)).state, 'espera');
    assert.equal(await ultimoDraft(semis[1].id), null);
    // La primera partida de cada serie se jugó en Decán.
    assert.ok(cuartos.every((m) => m.games[0].map_id === cuartos[0].games[0].map_id));
  });

  it('hay charla en la general y en la primera semi, con su hora', async () => {
    const general = await historial('torneo_copa-aoematch-mockup');
    assert.equal(general.length, 4);
    assert.ok(general[0].created_at < general[3].created_at);
    const semi = (await listarPartidos('copa-aoematch-mockup')).find((m) => m.round === 2 && m.position === 1);
    assert.deepEqual((await historial(`partido_${semi.id}`)).map((m) => m.body), ['Arrancamos el draft, ¿listos?', 'Dale, baneamos y vamos.']);
  });

  it('los equipos por equipos tienen su sala privada', async () => {
    const [equipo] = await listarEquipos('clan-wars-2v2');
    const sala = (await firestore.doc(`rooms/equipo_${equipo.id}`).get()).data();
    assert.equal(sala.public_read, false);
    assert.ok(sala.readers.includes('demo-kaiser'));
  });

  it('correrla de nuevo no duplica nada', async () => {
    assert.deepEqual(await sembrarDemo(), { creada: false });
    assert.equal((await listarTorneos()).length, 4);
    assert.ok(await leerTorneo('copa-aoematch-mockup'));
  });
});
