// Horarios: cruce de disponibilidades y rutas /api/availability y /api/overlap.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, levantarApi } from './apoyo.js';

const horarios = await import('../src/availability.js');
const { leerUsuario } = await import('../src/data/usuarios.js');

// Lunes 20:00 a 23:00 UTC = minutos 1200 a 1380 de la semana.
const LUNES_20 = 1200;
const usuario = (id, availability) => ({ id, availability });

describe('cruce de horarios', () => {
  const ana = usuario('ana', [{ start_min: LUNES_20, end_min: LUNES_20 + 180 }]);
  const beto = usuario('beto', [{ start_min: LUNES_20 + 60, end_min: LUNES_20 + 240 }]);
  const ciro = usuario('ciro', []);

  it('minutos en común entre los que están', () => {
    assert.equal(horarios.minutosEnComun([ana, beto]), 120);
    assert.equal(horarios.minutosEnComun([ana, beto, ciro]), 0);
    assert.equal(horarios.minutosEnComun([]), 0);
  });

  it('ventanas con todos y ventanas en las que falta uno, diciendo quién', () => {
    const todos = horarios.ventanas([ana, beto], { duracionMin: 90 });
    assert.deepEqual(todos.map((v) => [v.start_min, v.end_min, v.count]), [[LUNES_20 + 60, LUNES_20 + 180, 2]]);

    const casi = horarios.ventanas([ana, beto, ciro], { duracionMin: 60, minimo: 2 });
    assert.equal(casi[0].count, 2);
    assert.deepEqual(casi[0].missing, ['ciro']);
  });

  it('próxima fecha real de un minuto de semana', () => {
    const miercoles = new Date('2026-10-21T12:00:00.000Z');
    assert.equal(horarios.proximaFecha(LUNES_20, miercoles).toISOString(), '2026-10-26T20:00:00.000Z');
  });
});

describe('rutas de horarios', () => {
  let api;
  let yo;
  let otro;

  before(async () => {
    api = await levantarApi();
    yo = await cuentaConEmail('horarios-a@demo.aoematch');
    otro = await cuentaConEmail('horarios-b@demo.aoematch');
    // Crea los dos usuarios en Firestore.
    await api.pedir('GET', '/auth/me', { token: yo.token });
    await api.pedir('GET', '/auth/me', { token: otro.token });
  });

  after(() => api.cerrar());

  it('guardar la semana limpia bloques inválidos y la ordena', async () => {
    const { status, datos } = await api.pedir('PUT', '/availability', {
      token: yo.token,
      body: { blocks: [
        { start_min: LUNES_20 + 60, end_min: LUNES_20 + 120 },
        { start_min: LUNES_20, end_min: LUNES_20 + 60 },
        { start_min: 500, end_min: 400 },
        { start_min: 'x', end_min: 10 },
        { start_min: 10000, end_min: 20000 },
      ] },
    });
    assert.equal(status, 200);
    assert.equal(datos.count, 5);

    const leidos = (await api.pedir('GET', `/availability/${yo.uid}`)).datos;
    assert.equal(leidos.block_min, 30);
    assert.deepEqual(leidos.blocks, [
      { start_min: LUNES_20, end_min: LUNES_20 + 60 },
      { start_min: LUNES_20 + 60, end_min: LUNES_20 + 120 },
      { start_min: 10000, end_min: 10080 },
    ]);
  });

  it('guardar pide sesión', async () => {
    assert.equal((await api.pedir('PUT', '/availability', { body: { blocks: [] } })).status, 401);
  });

  it('de un usuario que no existe vuelve vacío', async () => {
    const { datos } = await api.pedir('GET', '/availability/nadie');
    assert.deepEqual([datos.blocks, datos.exceptions], [[], []]);
  });

  it('excepciones: alta, solo las que no pasaron y baja por id', async () => {
    assert.equal((await api.pedir('POST', '/availability/exception', { token: yo.token, body: { day: 'mañana' } })).status, 400);
    const { datos } = await api.pedir('POST', '/availability/exception', {
      token: yo.token, body: { day: '2099-01-02', start_min: 600, end_min: 900, available: 0 },
    });
    await api.pedir('POST', '/availability/exception', { token: yo.token, body: { day: '2099-01-01' } });

    const { exceptions } = (await api.pedir('GET', `/availability/${yo.uid}`)).datos;
    assert.deepEqual(exceptions.map((e) => e.day), ['2099-01-01', '2099-01-02']);
    assert.deepEqual(exceptions[0], { id: exceptions[0].id, day: '2099-01-01', start_min: 0, end_min: 1440, available: 1 });

    await api.pedir('DELETE', `/availability/exception/${datos.id}`, { token: yo.token });
    const quedan = (await leerUsuario(yo.uid)).exceptions;
    assert.deepEqual(quedan.map((e) => e.day), ['2099-01-01']);
  });

  it('cruce entre usuarios por uid, contando a los que no existen', async () => {
    await api.pedir('PUT', '/availability', {
      token: otro.token, body: { blocks: [{ start_min: LUNES_20 + 30, end_min: LUNES_20 + 150 }] },
    });
    const { datos } = await api.pedir('GET', `/overlap?users=${yo.uid},${otro.uid}&duration=60`);
    assert.deepEqual(datos.users.map((u) => u.id).sort(), [yo.uid, otro.uid].sort());
    assert.equal(datos.windows[0].count, 2);
    assert.deepEqual([datos.windows[0].start_min, datos.windows[0].end_min], [LUNES_20 + 30, LUNES_20 + 120]);
    assert.match(datos.windows[0].next_utc, /T20:30:00\.000Z$/);

    const conFantasma = (await api.pedir('GET', `/overlap?users=${yo.uid},fantasma&duration=60&min=1`)).datos;
    assert.equal(conFantasma.users.length, 1);
    assert.deepEqual(conFantasma.windows[0].missing, ['fantasma']);

    assert.equal((await api.pedir('GET', '/overlap?users=')).status, 400);
  });
});
