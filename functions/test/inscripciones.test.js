// Inscripciones y equipos sobre Firestore, contra los emuladores.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, levantarApi } from './apoyo.js';

const api = await levantarApi();
after(() => api.cerrar());

const { leerTorneo } = await import('../src/data/torneos.js');
const { leerInscripcion } = await import('../src/data/inscripciones.js');
const { leerEquipo } = await import('../src/data/equipos.js');
const { leerSala, publicarMensaje, historial } = await import('../src/data/salas.js');
const { actualizarUsuario } = await import('../src/data/usuarios.js');

const c = {};

before(async () => {
  const nombres = ['org', 'ana', 'beto', 'ciro', 'dani'];
  const cuentas = await Promise.all(nombres.map((n) => cuentaConEmail(`insc-${n}@demo.aoematch`)));
  nombres.forEach((n, i) => { c[n] = cuentas[i]; });
  for (const n of nombres) {
    await api.pedir('GET', '/auth/me', { token: c[n].token });
    await actualizarUsuario(c[n].uid, { display_name: n[0].toUpperCase() + n.slice(1) });
  }
  const crear = (body) => api.pedir('POST', '/tournaments', { token: c.org.token, body });
  await crear({ name: 'Copa equipos', team_size: 2, status: 'inscripcion' });
  await crear({ name: 'Ladder', team_size: 1, status: 'inscripcion' });
  await crear({ name: 'Cerrado', team_size: 2 });
  await crear({ name: 'Sin sueltos', team_size: 2, status: 'inscripcion', allow_solo: 0 });
});

const anotar = (quien, slug, body = {}) => api.pedir('POST', `/tournaments/${slug}/register`, { token: c[quien].token, body });
const retirar = (quien, slug) => api.pedir('POST', `/tournaments/${slug}/withdraw`, { token: c[quien].token });
const contadores = async (slug) => {
  const t = await leerTorneo(slug);
  return [t.inscriptos, t.pagos, t.equipos];
};

describe('inscribirse', () => {
  it('pide inscripciones abiertas y un torneo que exista', async () => {
    assert.equal((await anotar('ana', 'cerrado')).status, 400);
    assert.equal((await anotar('ana', 'no-existe')).status, 404);
    assert.equal((await api.pedir('POST', '/tournaments/ladder/register')).status, 401);
  });

  it('en 1v1 crea el equipo con el nombre del jugador y no repite', async () => {
    const { status, datos } = await anotar('ana', 'ladder');
    assert.equal(status, 200);
    const r = datos.registrations[0];
    assert.deepEqual([r.user_id, r.kind, r.team_name], [c.ana.uid, 'equipo', 'Ana']);
    assert.deepEqual(await contadores('ladder'), [1, 0, 1]);
    assert.equal(await leerSala(`equipo_${r.team_id}`), null);
    assert.equal((await anotar('ana', 'ladder')).status, 409);
  });

  it('con equipo nuevo: capitán y sala privada con el staff', async () => {
    assert.equal((await anotar('ana', 'copa-equipos', { kind: 'equipo' })).status, 400);
    const { datos } = await anotar('ana', 'copa-equipos', { kind: 'equipo', team_name: 'Rojos' });
    const equipo = datos.teams.find((t) => t.name === 'Rojos');
    assert.equal(equipo.captain_id, c.ana.uid);
    assert.equal(equipo.members[0].role, 'capitan');
    const sala = await leerSala(`equipo_${equipo.id}`);
    assert.deepEqual([sala.public_read, [...sala.readers].sort()], [false, [c.ana.uid, c.org.uid].sort()]);
    assert.deepEqual(await contadores('copa-equipos'), [1, 0, 1]);
  });

  it('sumarse a un equipo actualiza la sala; lleno no entra nadie más', async () => {
    const t = (await api.pedir('GET', '/tournaments/copa-equipos')).datos;
    const rojos = t.teams.find((e) => e.name === 'Rojos').id;
    assert.equal((await anotar('beto', 'copa-equipos', { kind: 'equipo', team_id: 'otro' })).status, 404);
    await anotar('beto', 'copa-equipos', { kind: 'equipo', team_id: rojos });
    assert.ok((await leerSala(`equipo_${rojos}`)).readers.includes(c.beto.uid));
    assert.deepEqual((await leerEquipo(rojos)).member_ids, [c.ana.uid, c.beto.uid]);
    const lleno = await anotar('ciro', 'copa-equipos', { kind: 'equipo', team_id: rojos });
    assert.deepEqual([lleno.status, lleno.datos.error], [400, 'El equipo ya está completo.']);
  });

  it('suelto, salvo que el torneo no los acepte', async () => {
    const { datos } = await anotar('ciro', 'copa-equipos');
    const r = datos.registrations.find((x) => x.user_id === c.ciro.uid);
    assert.deepEqual([r.kind, r.team_id], ['solo', null]);
    assert.equal((await anotar('ciro', 'sin-sueltos')).status, 400);
    assert.deepEqual(await contadores('copa-equipos'), [3, 0, 1]);
  });
});

describe('retirarse y pagos', () => {
  it('el staff marca pagos; los contadores siguen a las no retiradas', async () => {
    const pagar = (quien, body) => api.pedir('PATCH', `/tournaments/copa-equipos/registrations/${c[quien].uid}`, { token: c.org.token, body });
    assert.equal((await api.pedir('PATCH', `/tournaments/copa-equipos/registrations/${c.ana.uid}`, { token: c.beto.token, body: { paid: true } })).status, 403);
    assert.equal((await pagar('dani', { paid: true })).status, 404);

    await pagar('ana', { paid: true, payment_ref: 'MP-1' });
    await pagar('beto', { paid: true });
    const r = await leerInscripcion('copa-equipos', c.ana.uid);
    assert.deepEqual([r.paid, r.payment_ref, !!r.paid_at], [1, 'MP-1', true]);
    assert.deepEqual(await contadores('copa-equipos'), [3, 2, 1]);

    await pagar('beto', { status: 'confirmada' });
    assert.deepEqual(await contadores('copa-equipos'), [3, 2, 1]);
  });

  it('retirarse saca al jugador del equipo y de la sala, y resta lo que sumaba', async () => {
    const { datos } = await retirar('beto', 'copa-equipos');
    const r = datos.registrations.find((x) => x.user_id === c.beto.uid);
    assert.deepEqual([r.status, r.team_id], ['retirada', null]);
    const rojos = datos.teams.find((e) => e.name === 'Rojos');
    assert.deepEqual(rojos.members.map((m) => m.id), [c.ana.uid]);
    assert.ok(!(await leerSala(`equipo_${rojos.id}`)).readers.includes(c.beto.uid));
    assert.deepEqual(await contadores('copa-equipos'), [2, 1, 1]);
  });

  it('el último en irse se lleva el equipo y su sala', async () => {
    const rojos = (await api.pedir('GET', '/tournaments/copa-equipos')).datos.teams.find((e) => e.name === 'Rojos').id;
    await publicarMensaje(`equipo_${rojos}`, { body: 'nos vemos' });
    const { datos } = await retirar('ana', 'copa-equipos');
    assert.equal(datos.teams.length, 0);
    assert.equal(await leerEquipo(rojos), null);
    assert.equal(await leerSala(`equipo_${rojos}`), null);
    assert.deepEqual(await historial(`equipo_${rojos}`), []);
    assert.deepEqual(await contadores('copa-equipos'), [1, 0, 0]);
  });

  it('volver después de retirarse recupera el pago', async () => {
    await anotar('beto', 'copa-equipos');
    assert.equal((await leerInscripcion('copa-equipos', c.beto.uid)).status, 'pendiente');
    assert.deepEqual(await contadores('copa-equipos'), [2, 1, 0]);
  });
});

describe('equipos', () => {
  let azules;

  it('a mano: solo el staff puede elegir integrantes', async () => {
    const intento = await api.pedir('POST', '/tournaments/copa-equipos/teams', {
      token: c.ciro.token, body: { name: 'Azules', members: [c.ciro.uid, c.beto.uid] },
    });
    assert.equal(intento.status, 403);
    assert.equal((await api.pedir('POST', '/tournaments/copa-equipos/teams', { token: c.org.token, body: {} })).status, 400);

    const { datos } = await api.pedir('POST', '/tournaments/copa-equipos/teams', {
      token: c.org.token, body: { name: 'Azules', tag: 'AZULESXXX', members: [c.ciro.uid, c.beto.uid, c.ciro.uid] },
    });
    azules = datos.id;
    assert.equal(datos.tag, 'AZULESXX');
    assert.deepEqual(datos.members.map((m) => [m.id, m.role]), [[c.ciro.uid, 'capitan'], [c.beto.uid, 'jugador']]);
    assert.equal((await leerInscripcion('copa-equipos', c.ciro.uid)).team_id, azules);
    assert.deepEqual(await contadores('copa-equipos'), [2, 1, 1]);
  });

  it('un jugador crea el suyo y queda de capitán', async () => {
    const { datos } = await api.pedir('POST', '/tournaments/copa-equipos/teams', { token: c.dani.token, body: { name: 'Verdes' } });
    assert.deepEqual(datos.members.map((m) => [m.id, m.role]), [[c.dani.uid, 'capitan']]);
  });

  it('editar: capitán u organizador; la siembra solo el staff', async () => {
    const editar = (quien, body) => api.pedir('PATCH', `/tournaments/copa-equipos/teams/${azules}`, { token: c[quien].token, body });
    assert.equal((await editar('beto', { name: 'Robado' })).status, 403);
    assert.equal((await api.pedir('PATCH', '/tournaments/copa-equipos/teams/no-existe', { token: c.org.token, body: {} })).status, 404);

    let { datos } = await editar('ciro', { name: 'Azules FC', seed: 1 });
    assert.deepEqual([datos.name, datos.seed], ['Azules FC', null]);
    ({ datos } = await editar('org', { seed: 3, captain_id: c.beto.uid }));
    assert.equal(datos.seed, 3);
    assert.deepEqual(datos.members.map((m) => [m.id, m.role]), [[c.beto.uid, 'capitan'], [c.ciro.uid, 'jugador']]);
  });

  it('sumar integrantes: el capitán o el staff, con cupo', async () => {
    const sumar = (quien, user_id) => api.pedir('POST', `/tournaments/copa-equipos/teams/${azules}/members`, { token: c[quien].token, body: { user_id } });
    assert.equal((await sumar('ciro', c.dani.uid)).status, 403);
    assert.equal((await sumar('beto', c.dani.uid)).status, 400);
    const { datos } = await sumar('org', c.dani.uid);
    assert.equal(datos.members.length, 3);
    assert.ok((await leerSala(`equipo_${azules}`)).readers.includes(c.dani.uid));
  });

  it('sacar integrantes: uno mismo, el capitán o el staff; vacío se borra', async () => {
    const sacar = (quien, uid) => api.pedir('DELETE', `/tournaments/copa-equipos/teams/${azules}/members/${uid}`, { token: c[quien].token });
    assert.equal((await sacar('ciro', c.dani.uid)).status, 403);
    assert.deepEqual((await sacar('dani', c.dani.uid)).datos, { ok: true });
    const r = await leerInscripcion('copa-equipos', c.ciro.uid);
    await sacar('beto', c.ciro.uid);
    assert.deepEqual([r.team_id, (await leerInscripcion('copa-equipos', c.ciro.uid)).team_id], [azules, null]);
    await sacar('beto', c.beto.uid);
    assert.equal(await leerEquipo(azules), null);
    assert.equal(await leerSala(`equipo_${azules}`), null);
  });
});
