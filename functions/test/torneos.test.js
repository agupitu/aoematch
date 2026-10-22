// Torneos sobre Firestore: rutas de listado, alta, detalle, edición, borrado y
// horarios, contra los emuladores.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, levantarApi } from './apoyo.js';

const { firestore } = await import('../src/data/base.js');
const { actualizarUsuario } = await import('../src/data/usuarios.js');
const { sumarContadores, guardarEtapa, leerTorneo } = await import('../src/data/torneos.js');
const { guardarInscripcion } = await import('../src/data/inscripciones.js');
const { guardarEquipo, refEquipo } = await import('../src/data/equipos.js');
const { guardarPartido } = await import('../src/data/partidos.js');
const { publicarMensaje, leerSala } = await import('../src/data/salas.js');

let api;
let org;
let jugador;
let otro;

before(async () => {
  api = await levantarApi();
  [org, jugador, otro] = await Promise.all([
    cuentaConEmail('torneos-org@demo.aoematch'),
    cuentaConEmail('torneos-jugador@demo.aoematch'),
    cuentaConEmail('torneos-otro@demo.aoematch'),
  ]);
  for (const c of [org, jugador, otro]) await api.pedir('GET', '/auth/me', { token: c.token });
  await actualizarUsuario(org.uid, { display_name: 'Organizador' });
});

after(() => api.cerrar());

const crear = (body, token = org.token) => api.pedir('POST', '/tournaments', { token, body });

describe('alta de torneos', () => {
  it('pide sesión y nombre', async () => {
    assert.equal((await api.pedir('POST', '/tournaments', { body: { name: 'X' } })).status, 401);
    assert.equal((await crear({})).status, 400);
  });

  it('crea con el slug como id, todas las civs y la sala general', async () => {
    const { status, datos } = await crear({
      name: 'Copa Ñandú 2v2', team_size: 2, map_ids: [3, 1, '2', 'x', 1], third_place: true,
      prizes: [{ label: '', kind: 'porcentaje', percent: 70 }, { label: 'Segundo', kind: 'fijo', amount_cents: 5000 }],
    });
    assert.equal(status, 200);
    assert.equal(datos.id, 'copa-nandu-2v2');
    assert.equal(datos.slug, 'copa-nandu-2v2');
    assert.equal(datos.organizer.display_name, 'Organizador');
    assert.equal(datos.civs.length, 24);
    assert.deepEqual(datos.maps.map((m) => m.id).sort(), [1, 2, 3]);
    assert.equal(datos.third_place, 1);
    assert.equal(datos.civ_pattern_efectivo, '1-2-1');
    assert.deepEqual(datos.prizes.map((p) => [p.position, p.label, p.kind]), [[1, '1º puesto', 'porcentaje'], [2, 'Segundo', 'fijo']]);
    assert.equal(datos.me.is_staff, true);
    assert.ok(await leerSala('torneo_copa-nandu-2v2'));
  });

  it('con el mismo nombre suma -2', async () => {
    assert.equal((await crear({ name: 'Copa Ñandú 2v2' })).datos.id, 'copa-nandu-2v2-2');
  });
});

describe('listado', () => {
  it('más nuevo primero, con organizador y contadores, y filtra por estado', async () => {
    await crear({ name: 'Liga futura', status: 'inscripcion', starts_at: '2099-01-01T00:00:00.000Z' });
    const todos = (await api.pedir('GET', '/tournaments')).datos;
    assert.equal(todos[0].id, 'liga-futura');
    assert.equal(todos[0].organizer_name, 'Organizador');
    assert.deepEqual([todos[0].inscriptos, todos[0].pagos, todos[0].equipos], [0, 0, 0]);
    const abiertos = (await api.pedir('GET', '/tournaments?status=inscripcion')).datos;
    assert.deepEqual(abiertos.map((t) => t.id), ['liga-futura']);
  });
});

describe('edición y borrado', () => {
  it('solo el staff edita', async () => {
    const { status } = await api.pedir('PATCH', '/tournaments/copa-nandu-2v2', { token: jugador.token, body: { name: 'Hackeado' } });
    assert.equal(status, 403);
    assert.equal((await api.pedir('PATCH', '/tournaments/no-existe', { token: org.token, body: {} })).status, 404);
  });

  it('edita campos, pools y premios; los vacíos se respetan', async () => {
    const { datos } = await api.pedir('PATCH', '/tournaments/copa-nandu-2v2', {
      token: org.token,
      body: {
        description: 'Copa de prueba', best_of: '5', max_teams: '', team_size: '', civ_ids: [1, 2],
        starts_at: '2098-05-05T20:00:00.000Z', prize_pool_mode: 'inscripciones', entry_fee_cents: 1000, prize_pool_pct: 80,
      },
    });
    assert.equal(datos.description, 'Copa de prueba');
    assert.equal(datos.best_of, 5);
    assert.equal(datos.max_teams, null);
    assert.equal(datos.team_size, 2);
    assert.deepEqual(datos.civs.map((c) => c.id).sort(), [1, 2]);
    assert.equal((await leerTorneo('copa-nandu-2v2')).orden, '2098-05-05T20:00:00.000Z');
  });

  it('la bolsa sale de las inscripciones pagas', async () => {
    await sumarContadores('copa-nandu-2v2', { pagos: 3 });
    const { datos } = await api.pedir('GET', '/tournaments/copa-nandu-2v2');
    assert.deepEqual(
      [datos.prize_pool.collected_cents, datos.prize_pool.total_cents, datos.prize_pool.paid_count],
      [3000, 2400, 3]
    );
    assert.deepEqual(datos.prizes.map((p) => p.value_cents), [1680, 5000]);
    assert.equal(datos.prize_pool.assigned_pct, 70);
  });

  it('el staff borra el torneo con todo lo suyo', async () => {
    await crear({ name: 'Para borrar' });
    await publicarMensaje('torneo_para-borrar', { body: 'hola' });
    assert.equal((await api.pedir('DELETE', '/tournaments/para-borrar', { token: jugador.token })).status, 403);
    assert.deepEqual((await api.pedir('DELETE', '/tournaments/para-borrar', { token: org.token })).datos, { ok: true });
    assert.equal((await api.pedir('GET', '/tournaments/para-borrar')).status, 404);
    assert.equal(await leerSala('torneo_para-borrar'), null);
  });
});

describe('detalle', () => {
  const SLUG = 'liga-detalle';
  let rojos;
  let azules;

  before(async () => {
    await crear({ name: 'Liga detalle', format: 'liga', team_size: 2 });
    await actualizarUsuario(jugador.uid, { display_name: 'Zeta', availability: [{ start_min: 1200, end_min: 1380 }] });
    await actualizarUsuario(otro.uid, { display_name: 'Alfa', availability: [{ start_min: 1260, end_min: 1500 }] });

    rojos = refEquipo().id;
    azules = refEquipo().id;
    await guardarEquipo({
      tournament_id: SLUG, name: 'Rojos', captain_id: jugador.uid, seed: 2,
      members: [{ user_id: otro.uid, role: 'jugador' }, { user_id: jugador.uid, role: 'capitan' }],
    }, null, firestore.collection('teams').doc(rojos));
    await guardarEquipo({ tournament_id: SLUG, name: 'Azules', seed: 1, members: [] }, null, firestore.collection('teams').doc(azules));

    await guardarInscripcion(SLUG, jugador.uid, { kind: 'equipo', team_id: rojos, paid: 1, created_at: '2026-01-01T00:00:00.000Z' });
    await guardarInscripcion(SLUG, otro.uid, { status: 'retirada', created_at: '2026-01-02T00:00:00.000Z' });

    const etapa = await guardarEtapa(SLUG, {
      idx: 0, name: 'Grupos', type: 'grupos', groups: [{ id: 'B', name: 'Grupo B', team_ids: [] }, { id: 'A', name: 'Grupo A', team_ids: [rojos, azules] }],
    });
    await guardarPartido({ tournament_id: SLUG, stage_id: etapa, group_id: 'A', team_a_id: rojos, team_b_id: azules, score_a: 2, score_b: 1, winner_team_id: rojos, status: 'finalizado' });
    await guardarPartido({ tournament_id: SLUG, stage_id: etapa, group_id: 'A', round: 2, team_a_id: azules, team_b_id: rojos, status: 'pendiente' });
  });

  it('equipos con jugadores, capitán primero y horas en común', async () => {
    const { datos } = await api.pedir('GET', `/tournaments/${SLUG}`);
    assert.deepEqual(datos.teams.map((t) => t.name), ['Azules', 'Rojos']);
    const r = datos.teams[1];
    assert.deepEqual(r.members.map((m) => m.display_name), ['Zeta', 'Alfa']);
    assert.equal(r.overlap_min, 120);
    assert.equal(r.member_ids, undefined);
    assert.equal(datos.teams[0].overlap_min, null);
  });

  it('inscripciones con datos del usuario y su equipo', async () => {
    const { datos } = await api.pedir('GET', `/tournaments/${SLUG}`);
    assert.deepEqual(datos.registrations.map((r) => r.display_name), ['Zeta', 'Alfa']);
    assert.equal(datos.registrations[0].team_name, 'Rojos');
    assert.equal(datos.registrations[0].paid, true);
    assert.equal(datos.registrations[0].id, jugador.uid);
  });

  it('partidos con nombres, grupos con su tabla y tabla general de liga', async () => {
    const { datos } = await api.pedir('GET', `/tournaments/${SLUG}`);
    assert.deepEqual(datos.matches.map((m) => [m.round, m.team_a_name, m.team_b_name]), [[1, 'Rojos', 'Azules'], [2, 'Azules', 'Rojos']]);
    const grupos = datos.stages[0].groups;
    assert.deepEqual(grupos.map((g) => g.name), ['Grupo A', 'Grupo B']);
    assert.deepEqual(grupos[0].standings.map((f) => [f.team.name, f.pts, f.pj]), [['Rojos', 3, 1], ['Azules', 0, 1]]);
    assert.equal(grupos[0].standings[0].team.members, undefined);
    assert.deepEqual(datos.standings.map((f) => f.team.name), ['Rojos', 'Azules']);
  });

  it('me: staff, inscripción y equipo de quien mira', async () => {
    assert.equal((await api.pedir('GET', `/tournaments/${SLUG}`)).datos.me, null);
    const delJugador = (await api.pedir('GET', `/tournaments/${SLUG}`, { token: jugador.token })).datos.me;
    assert.deepEqual([delJugador.is_staff, delJugador.registration.user_id, delJugador.team_id], [false, jugador.uid, rojos]);
    assert.equal((await api.pedir('GET', `/tournaments/${SLUG}`, { token: org.token })).datos.me.is_staff, true);
  });

  it('horarios del torneo con los inscriptos no retirados', async () => {
    const { datos } = await api.pedir('GET', `/tournaments/${SLUG}/schedule?duration=60`);
    assert.equal(datos.total, 1);
    assert.equal(datos.windows[0].start_min, 1200);
    assert.equal((await api.pedir('GET', '/tournaments/no-existe/schedule')).status, 404);
  });
});
