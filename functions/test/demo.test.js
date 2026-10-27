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
const { leerEquipo, listarEquipos } = await import('../src/data/equipos.js');
const { listarPartidos } = await import('../src/data/partidos.js');
const { leerHorarios, listarRondas } = await import('../src/data/rondas.js');
const { cruceDeRonda } = await import('../../web/src/logica/cruce.js');
const { rondaIdDe } = await import('../../web/src/logica/rondas.js');
const { leerDraft } = await import('../src/data/drafts.js');
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

  it('cada torneo queda en su estado, con sus inscriptos y equipos', async () => {
    const t = Object.fromEntries((await listarTorneos()).map((x) => [x.id, x]));
    assert.deepEqual(
      Object.keys(t).sort(),
      ['clan-wars-2v2', 'copa-aoematch-mockup', 'copa-sudamericana-3v3', 'ladder-1v1-de-otono']
    );
    const cuantos = async (slug) => [(await listarInscripciones(slug)).length, (await listarEquipos(slug)).length];
    assert.equal(t['copa-sudamericana-3v3'].status, 'inscripcion');
    assert.deepEqual(await cuantos('copa-sudamericana-3v3'), [15, 0]);
    assert.equal(t['ladder-1v1-de-otono'].status, 'en_curso');
    assert.deepEqual(await cuantos('ladder-1v1-de-otono'), [8, 8]);
    assert.equal(t['clan-wars-2v2'].status, 'armado');
    assert.deepEqual(await cuantos('clan-wars-2v2'), [12, 6]);
    assert.deepEqual(await cuantos('copa-aoematch-mockup'), [16, 8]);
    assert.equal((await listarPartidos('ladder-1v1-de-otono')).length, 7);
    assert.equal((await listarInscripciones('copa-sudamericana-3v3')).filter((r) => r.kind === 'solo').length, 15);
  });

  it('la copa de muestra: cuartos jugados con drafts ciegos, semis agendadas y una con el draft abierto', async () => {
    const partidos = await listarPartidos('copa-aoematch-mockup');
    const cuartos = partidos.filter((m) => m.bracket === 'W' && m.round === 1);
    assert.equal(cuartos.length, 4);
    for (const m of cuartos) {
      assert.equal(m.status, 'finalizado');
      assert.ok(m.games.length >= 2);
      assert.ok(m.games.every((g) => g.map_id && g.civs.length === 4));
      // Cada partida dejó su draft revelado, con los picks de los cuatro.
      const d = await leerDraft(m.id, m.games.length);
      assert.deepEqual([d.state, d.revealed, d.picked.length], ['listo', true, 4]);
    }
    const semis = partidos.filter((m) => m.bracket === 'W' && m.round === 2).sort((a, b) => a.position - b.position);
    assert.ok(semis.every((m) => m.status === 'agendado' && m.team_a_id && m.team_b_id && m.scheduled_at));
    // Mapa fijo (Decán) en la primera: arranca por los bans.
    assert.equal((await leerDraft(semis[0].id, 1)).state, 'bans');
    assert.equal(await leerDraft(semis[1].id, 1), null);
    // La primera partida de cada serie se jugó en Decán.
    assert.ok(cuartos.every((m) => m.games[0].map_id === cuartos[0].games[0].map_id));
  });

  it('la copa de muestra tiene fechas para las semis y la final, y horarios para cruzar', async () => {
    const slug = 'copa-aoematch-mockup';
    const partidos = await listarPartidos(slug);
    const semis = partidos.filter((m) => m.bracket === 'W' && m.round === 2).sort((a, b) => a.position - b.position);
    const final = partidos.find((m) => m.label === 'Final');
    const rondas = new Map((await listarRondas(slug)).map((r) => [r.id, r]));
    assert.deepEqual([...rondas.keys()].sort(), [...new Set([rondaIdDe(semis[0]), rondaIdDe(final)])].sort());
    assert.equal(rondaIdDe(semis[0]), rondaIdDe(semis[1]));
    assert.ok(rondas.get(rondaIdDe(semis[0])).starts_at < rondas.get(rondaIdDe(final)).starts_at);

    const cruce = async (m) => {
      const ronda = rondas.get(rondaIdDe(m));
      const uids = [...(await leerEquipo(m.team_a_id)).member_ids, ...(await leerEquipo(m.team_b_id)).member_ids];
      const horarios = await leerHorarios(slug, ronda.id, uids);
      return cruceDeRonda(uids.map((id) => ({ id, blocks: horarios.get(id) })), ronda, { duracionMin: 90 });
    };
    // Semi 1: cargaron los cuatro. Semi 2: falta uno.
    const primera = await cruce(semis[0]);
    assert.ok(primera.windows.length >= 1);
    assert.ok(primera.windows.every((w) => w.count === 4 && w.missing.length === 0));
    const segunda = await cruce(semis[1]);
    assert.deepEqual(segunda.windows, []);
    assert.equal(segunda.partial[0].missing.length, 1);
  });

  it('hay charla en la general y en la primera semi, con su hora', async () => {
    const general = await historial('torneo_copa-aoematch-mockup');
    assert.equal(general.length, 4);
    assert.ok(general[0].created_at < general[3].created_at);
    const semi = (await listarPartidos('copa-aoematch-mockup')).find((m) => m.round === 2 && m.position === 1);
    assert.deepEqual((await historial(`partido_${semi.id}`)).map((m) => m.body), ['Arrancamos el draft, ¿listos?', 'Dale, baneamos y elegimos a ciegas.']);
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
