// Capa de datos contra el emulador de Firestore.
//
//   npm test        (desde la raíz: levanta auth y firestore, corre esto y los apaga)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
// Nunca contra una base real: estas pruebas borran todo.
if (!HOST) throw new Error('Falta FIRESTORE_EMULATOR_HOST: corré las pruebas con `npm test` desde la raíz.');

const { enTransaccion, firestore } = await import('../src/data/base.js');
const usuarios = await import('../src/data/usuarios.js');
const torneos = await import('../src/data/torneos.js');
const inscripciones = await import('../src/data/inscripciones.js');
const equipos = await import('../src/data/equipos.js');
const partidos = await import('../src/data/partidos.js');
const drafts = await import('../src/data/drafts.js');
const salas = await import('../src/data/salas.js');

async function vaciarBase() {
  const proyecto = process.env.GCLOUD_PROJECT;
  const r = await fetch(`http://${HOST}/emulator/v1/projects/${proyecto}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  assert.ok(r.ok, `no se pudo vaciar el emulador: ${r.status}`);
}

before(vaciarBase);
after(() => firestore.terminate());

describe('usuarios', () => {
  it('alta con valores por defecto y nombre en minúsculas', async () => {
    await usuarios.guardarUsuario('u1', { display_name: 'Kaiser', timezone: 'Europe/Berlin' });
    const u = await usuarios.leerUsuario('u1');
    assert.equal(u.id, 'u1');
    assert.equal(u.display_name_lower, 'kaiser');
    assert.equal(u.timezone, 'Europe/Berlin');
    assert.equal(u.is_admin, 0);
    assert.deepEqual(u.availability, []);
  });

  it('no pisa un usuario existente', async () => {
    await assert.rejects(usuarios.guardarUsuario('u1', { display_name: 'Otro' }));
  });

  it('actualizar mantiene display_name_lower', async () => {
    await usuarios.actualizarUsuario('u1', { display_name: 'KAISER-2' });
    assert.equal((await usuarios.leerUsuario('u1')).display_name_lower, 'kaiser-2');
  });

  it('mapaDeUsuarios saca repetidos y omite los que no existen', async () => {
    await usuarios.guardarUsuario('u2', { display_name: 'Mitoe' });
    const mapa = await usuarios.mapaDeUsuarios(['u1', 'u2', 'u1', 'nadie', null]);
    assert.deepEqual([...mapa.keys()].sort(), ['u1', 'u2']);
  });

  it('una cuenta de Steam queda en un solo usuario', async () => {
    await usuarios.reservarSteam('76561198000000001', 'u1');
    assert.equal(await usuarios.uidDeSteam('76561198000000001'), 'u1');
    await assert.rejects(usuarios.reservarSteam('76561198000000001', 'u2'));
    await usuarios.liberarSteam('76561198000000001');
    assert.equal(await usuarios.uidDeSteam('76561198000000001'), null);
  });
});

describe('torneos', () => {
  it('alta con valores por defecto; el slug es el id', async () => {
    await torneos.guardarTorneo('copa-a', { name: 'Copa A', organizer_id: 'u1' });
    const t = await torneos.leerTorneo('copa-a');
    assert.equal(t.id, 'copa-a');
    assert.equal(t.slug, 'copa-a');
    assert.equal(t.status, 'borrador');
    assert.equal(t.best_of, 3);
    assert.equal(t.orden, t.created_at);
    await assert.rejects(torneos.guardarTorneo('copa-a', { name: 'Repetido' }));
  });

  it('el listado va por fecha de inicio, más nuevo primero, y filtra por estado', async () => {
    await torneos.guardarTorneo('copa-b', { name: 'B', status: 'inscripcion', starts_at: '2030-01-01T00:00:00.000Z' });
    await torneos.guardarTorneo('copa-c', { name: 'C', status: 'inscripcion', starts_at: '2029-01-01T00:00:00.000Z' });
    assert.deepEqual((await torneos.listarTorneos()).map((t) => t.id), ['copa-b', 'copa-c', 'copa-a']);
    assert.deepEqual((await torneos.listarTorneos({ status: 'inscripcion' })).map((t) => t.id), ['copa-b', 'copa-c']);
  });

  it('cambiar starts_at recalcula orden; sacarlo vuelve a created_at', async () => {
    const t = await torneos.leerTorneo('copa-a');
    await torneos.actualizarTorneo(t, { starts_at: '2031-01-01T00:00:00.000Z' });
    assert.equal((await torneos.leerTorneo('copa-a')).orden, '2031-01-01T00:00:00.000Z');
    await torneos.actualizarTorneo(t, { starts_at: null });
    assert.equal((await torneos.leerTorneo('copa-a')).orden, t.created_at);
  });

  it('los contadores suman y restan', async () => {
    await torneos.sumarContadores('copa-a', { inscriptos: 2, pagos: 1 });
    await torneos.sumarContadores('copa-a', { inscriptos: -1, equipos: 0 });
    const t = await torneos.leerTorneo('copa-a');
    assert.deepEqual([t.inscriptos, t.pagos, t.equipos], [1, 1, 0]);
  });

  it('las etapas salen en orden de idx, con sus grupos', async () => {
    await torneos.guardarEtapa('copa-a', { idx: 1, name: 'Playoff', type: 'eliminacion_simple' });
    await torneos.guardarEtapa('copa-a', {
      idx: 0, name: 'Grupos', type: 'grupos', groups: [{ id: 'A', name: 'Grupo A', team_ids: ['e1'] }],
    });
    const etapas = await torneos.listarEtapas('copa-a');
    assert.deepEqual(etapas.map((e) => e.name), ['Grupos', 'Playoff']);
    assert.equal(etapas[0].groups[0].team_ids[0], 'e1');
  });
});

describe('inscripciones', () => {
  it('una por usuario, en orden de llegada', async () => {
    await inscripciones.guardarInscripcion('copa-a', 'u2', { created_at: '2026-01-02T00:00:00.000Z' });
    await inscripciones.guardarInscripcion('copa-a', 'u1', { kind: 'equipo', created_at: '2026-01-01T00:00:00.000Z' });
    const lista = await inscripciones.listarInscripciones('copa-a');
    assert.deepEqual(lista.map((r) => r.user_id), ['u1', 'u2']);
    assert.equal(lista[0].id, 'u1');
    assert.equal(lista[1].status, 'pendiente');
  });

  it('actualizar y vigente', async () => {
    await inscripciones.actualizarInscripcion('copa-a', 'u2', { status: 'retirada' });
    assert.equal(inscripciones.vigente(await inscripciones.leerInscripcion('copa-a', 'u2')), false);
    assert.equal(inscripciones.vigente(await inscripciones.leerInscripcion('copa-a', 'u1')), true);
  });
});

describe('equipos', () => {
  let rojos;
  let azules;

  it('alta con miembros y member_ids', async () => {
    rojos = await equipos.guardarEquipo({
      tournament_id: 'copa-a', name: 'Rojos', captain_id: 'u1',
      members: [{ user_id: 'u1', role: 'capitan' }, { user_id: 'u2' }],
    });
    const e = await equipos.leerEquipo(rojos);
    assert.deepEqual(e.member_ids, ['u1', 'u2']);
    assert.equal(e.members[1].role, 'jugador');
  });

  it('listado por seed, sin seed al final', async () => {
    azules = await equipos.guardarEquipo({ tournament_id: 'copa-a', name: 'Azules', seed: 1, members: [] });
    await equipos.guardarEquipo({ tournament_id: 'copa-b', name: 'De otro torneo', members: [] });
    assert.deepEqual((await equipos.listarEquipos('copa-a')).map((e) => e.name), ['Azules', 'Rojos']);
  });

  it('el equipo de un usuario en un torneo', async () => {
    assert.equal((await equipos.equipoDelUsuario('copa-a', 'u2')).id, rojos);
    assert.equal(await equipos.equipoDelUsuario('copa-b', 'u2'), null);
  });

  it('cambiar miembros recalcula member_ids', async () => {
    await equipos.actualizarEquipo(azules, { members: [{ user_id: 'u3', role: 'capitan' }] });
    assert.deepEqual((await equipos.leerEquipo(azules)).member_ids, ['u3']);
    const [a, b, nada] = await equipos.leerEquipos([azules, rojos, 'nada']);
    assert.deepEqual([a.name, b.name, nada], ['Azules', 'Rojos', null]);
  });
});

describe('partidos', () => {
  let final;

  it('alta con ids generados antes y listado por llave, ronda y posición', async () => {
    const ref = partidos.refPartido();
    final = ref.id;
    await partidos.guardarPartido({ tournament_id: 'copa-a', round: 2, position: 1 }, null, ref);
    await partidos.guardarPartido({ tournament_id: 'copa-a', round: 1, position: 2, next_match_id: final, next_slot: 'b' });
    await partidos.guardarPartido({ tournament_id: 'copa-a', round: 1, position: 1, next_match_id: final, next_slot: 'a' });
    await partidos.guardarPartido({ tournament_id: 'copa-a', bracket: 'L', round: 1, position: 1 });
    const lista = await partidos.listarPartidos('copa-a');
    assert.deepEqual(lista.map((m) => `${m.bracket}${m.round}.${m.position}`), ['L1.1', 'W1.1', 'W1.2', 'W2.1']);
    assert.equal(lista[1].next_match_id, final);
    assert.equal((await partidos.leerPartido(final)).status, 'pendiente');
  });

  it('conPartida agrega o completa la partida de la serie', () => {
    let games = partidos.conPartida([], { game_no: 2, map_id: 5 });
    games = partidos.conPartida(games, { game_no: 1, winner_team_id: 'e1' });
    games = partidos.conPartida(games, { game_no: 2, winner_team_id: 'e2' });
    assert.deepEqual(games.map((g) => [g.game_no, g.map_id, g.winner_team_id]), [[1, null, 'e1'], [2, 5, 'e2']]);
  });

  it('conVoto reemplaza el voto del mismo usuario y horario', () => {
    let votos = partidos.conVoto([], { user_id: 'u1', slot_utc: '2026-10-25T20:00:00.000Z', vote: true });
    votos = partidos.conVoto(votos, { user_id: 'u2', slot_utc: '2026-10-25T20:00:00.000Z', vote: true });
    votos = partidos.conVoto(votos, { user_id: 'u1', slot_utc: '2026-10-25T20:00:00.000Z', vote: false });
    assert.deepEqual(votos.map((v) => `${v.user_id}:${v.vote}`).sort(), ['u1:0', 'u2:1']);
  });

  it('las partidas se guardan dentro del partido', async () => {
    await partidos.actualizarPartido(final, { games: partidos.conPartida([], { game_no: 1, map_id: 3 }) });
    assert.equal((await partidos.leerPartido(final)).games[0].map_id, 3);
  });
});

describe('drafts', () => {
  it('uno por partida y el último es el de la partida más alta', async () => {
    await drafts.guardarDraft('m1', 1, { steps: [{ idx: 0, kind: 'ban_mapa' }] });
    await drafts.guardarDraft('m1', 2, {});
    await assert.rejects(drafts.guardarDraft('m1', 2, {}));
    const d = await drafts.ultimoDraft('m1');
    assert.deepEqual([d.id, d.game_no, d.state], ['2', 2, 'espera']);
    assert.equal(await drafts.ultimoDraft('sin-drafts'), null);
  });

  it('las acciones van dentro del draft', async () => {
    await drafts.actualizarDraft('m1', 1, { actions: [{ step_idx: 0, kind: 'ban_mapa', target_id: 7 }], current_step: 1 });
    const d = await drafts.leerDraft('m1', 1);
    assert.equal(d.actions[0].target_id, 7);
    assert.equal(d.steps[0].kind, 'ban_mapa');
  });
});

describe('salas', () => {
  it('traduce los nombres de sala de la web', () => {
    assert.equal(salas.idDeSala('tournament:copa-a'), 'torneo_copa-a');
    assert.equal(salas.idDeSala('match:abc'), 'partido_abc');
    assert.equal(salas.idDeSala('team:xyz'), 'equipo_xyz');
    assert.equal(salas.idDeSala('otra:1'), null);
    assert.equal(salas.idDeSala('team:'), null);
    assert.equal(salas.idDeSala('team:a/b'), null);
  });

  it('mensajes con hora del servidor, del más viejo al más nuevo', async () => {
    await salas.guardarSala('equipo_e1', { kind: 'equipo', tournament_id: 'copa-a', public_read: false });
    await salas.actualizarLectores('equipo_e1', ['u1', 'u2', 'u1']);
    assert.deepEqual((await salas.leerSala('equipo_e1')).readers, ['u1', 'u2']);

    const autor = { id: 'u1', display_name: 'Kaiser', avatar_url: null, google_email: 'no@debe.ir' };
    for (const body of ['uno', 'dos', 'tres']) await salas.publicarMensaje('equipo_e1', { user: autor, body });
    await salas.publicarMensaje('equipo_e1', { body: 'Draft cerrado.', system: 1 });

    const todos = await salas.historial('equipo_e1');
    assert.deepEqual(todos.map((m) => m.body), ['uno', 'dos', 'tres', 'Draft cerrado.']);
    assert.match(todos[0].created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(Object.keys(todos[0].user).sort(), ['avatar_url', 'display_name', 'id']);
    assert.equal(todos[3].user, null);
    assert.deepEqual((await salas.historial('equipo_e1', 2)).map((m) => m.body), ['tres', 'Draft cerrado.']);
  });
});

describe('enTransaccion', () => {
  it('los efectos corren después del commit, con el resultado', async () => {
    const vistos = [];
    const r = await enTransaccion(async (tx, despues) => {
      const t = await torneos.leerTorneo('copa-c', tx);
      torneos.sumarContadores('copa-c', { equipos: 1 }, tx);
      despues(async (res) => vistos.push(['efecto', res, (await torneos.leerTorneo('copa-c')).equipos]));
      return t.equipos + 1;
    });
    assert.equal(r, 1);
    assert.deepEqual(vistos, [['efecto', 1, 1]]);
  });

  it('si falla no escribe ni corre efectos', async () => {
    let corrio = false;
    await assert.rejects(
      enTransaccion(async (tx, despues) => {
        torneos.sumarContadores('copa-c', { equipos: 5 }, tx);
        despues(() => { corrio = true; });
        throw new Error('regla rota');
      }),
      /regla rota/
    );
    assert.equal(corrio, false);
    assert.equal((await torneos.leerTorneo('copa-c')).equipos, 1);
  });

  it('leer después de escribir corta la transacción', async () => {
    await assert.rejects(
      enTransaccion(async (tx) => {
        torneos.sumarContadores('copa-c', { equipos: 1 }, tx);
        await torneos.leerTorneo('copa-b', tx);
      }),
      /reads to be executed before all writes/
    );
  });
});

describe('borrarTorneo', () => {
  it('borra el torneo y todo lo suyo, sin tocar otros torneos', async () => {
    const slug = 'copa-borrar';
    await torneos.guardarTorneo(slug, { name: 'Para borrar' });
    await inscripciones.guardarInscripcion(slug, 'u1', {});
    await torneos.guardarEtapa(slug, { idx: 0, name: 'Única', type: 'liga' });
    const equipo = await equipos.guardarEquipo({ tournament_id: slug, name: 'E', members: [{ user_id: 'u1' }] });
    const partido = await partidos.guardarPartido({ tournament_id: slug });
    await drafts.guardarDraft(partido, 1, {});
    await firestore.collection('live').doc(partido).set({ draft: 1 });
    await salas.guardarSala(`partido_${partido}`, { kind: 'partido', tournament_id: slug });
    await salas.publicarMensaje(`partido_${partido}`, { body: 'hola' });

    await torneos.borrarTorneo(slug);

    assert.equal(await torneos.leerTorneo(slug), null);
    assert.deepEqual(await inscripciones.listarInscripciones(slug), []);
    assert.deepEqual(await torneos.listarEtapas(slug), []);
    assert.equal(await equipos.leerEquipo(equipo), null);
    assert.equal(await partidos.leerPartido(partido), null);
    assert.equal(await drafts.leerDraft(partido, 1), null);
    assert.equal((await firestore.collection('live').doc(partido).get()).exists, false);
    assert.equal(await salas.leerSala(`partido_${partido}`), null);
    assert.deepEqual(await salas.historial(`partido_${partido}`), []);

    assert.ok(await torneos.leerTorneo('copa-a'));
    assert.equal((await partidos.listarPartidos('copa-a')).length, 4);
  });
});
