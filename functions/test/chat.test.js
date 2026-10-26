// Chat sobre Firestore: abrir salas, quién lee y quién escribe, y avisos del
// sistema. Contra los emuladores.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, levantarApi } from './apoyo.js';

const api = await levantarApi();
after(() => api.cerrar());

const { avisoSistema } = await import('../src/chat.js');
const { guardarPartido } = await import('../src/data/partidos.js');
const { historial, leerSala } = await import('../src/data/salas.js');
const { actualizarUsuario } = await import('../src/data/usuarios.js');

const c = {};
const SLUG = 'chat-copa';
let rojos;
let azules;
let partido;

const abrir = (room, quien) => api.pedir('GET', `/rooms/${encodeURIComponent(room)}`, { token: quien && c[quien].token });
const escribir = (room, quien, body) =>
  api.pedir('POST', `/rooms/${encodeURIComponent(room)}/messages`, { token: quien && c[quien].token, body: { body } });

before(async () => {
  for (const n of ['org', 'ana', 'beto', 'ciro']) {
    c[n] = await cuentaConEmail(`chat-${n}@demo.aoematch`);
    await api.pedir('GET', '/auth/me', { token: c[n].token });
    await actualizarUsuario(c[n].uid, { display_name: n[0].toUpperCase() + n.slice(1), avatar_url: `https://img/${n}.png` });
  }
  await api.pedir('POST', '/tournaments', { token: c.org.token, body: { name: 'Chat copa', team_size: 2, status: 'inscripcion' } });
  let t = (await api.pedir('POST', `/tournaments/${SLUG}/register`, { token: c.ana.token, body: { kind: 'equipo', team_name: 'Rojos' } })).datos;
  rojos = t.teams.find((e) => e.name === 'Rojos').id;
  t = (await api.pedir('POST', `/tournaments/${SLUG}/register`, { token: c.beto.token, body: { kind: 'equipo', team_name: 'Azules' } })).datos;
  azules = t.teams.find((e) => e.name === 'Azules').id;
  partido = await guardarPartido({ tournament_id: SLUG, team_a_id: rojos, team_b_id: azules, label: 'Final' });
});

describe('abrir salas', () => {
  it('la general del torneo la abre cualquiera; escribe quien está inscripto', async () => {
    assert.deepEqual((await abrir(`tournament:${SLUG}`)).datos, { room: `tournament:${SLUG}`, id: `torneo_${SLUG}`, puede_escribir: false });
    assert.equal((await abrir(`tournament:${SLUG}`, 'ana')).datos.puede_escribir, true);
    assert.equal((await abrir(`tournament:${SLUG}`, 'ciro')).datos.puede_escribir, false);
    assert.equal((await abrir(`tournament:${SLUG}`, 'org')).datos.puede_escribir, true);
  });

  it('la del partido se crea la primera vez; escriben los dos equipos y el staff', async () => {
    assert.equal(await leerSala(`partido_${partido}`), null);
    const { datos } = await abrir(`match:${partido}`);
    assert.equal(datos.id, `partido_${partido}`);
    const sala = await leerSala(`partido_${partido}`);
    assert.deepEqual([sala.kind, sala.public_read, sala.name, sala.tournament_id], ['partido', true, 'Final', SLUG]);
    for (const [quien, puede] of [['ana', true], ['beto', true], ['org', true], ['ciro', false]]) {
      assert.equal((await abrir(`match:${partido}`, quien)).datos.puede_escribir, puede, quien);
    }
  });

  it('la del equipo solo la abren sus miembros y el staff', async () => {
    assert.equal((await abrir(`team:${rojos}`)).status, 403);
    assert.equal((await abrir(`team:${rojos}`, 'beto')).status, 403);
    assert.equal((await abrir(`team:${rojos}`, 'ana')).datos.puede_escribir, true);
    assert.equal((await abrir(`team:${rojos}`, 'org')).datos.puede_escribir, true);
  });

  it('una sala que no existe o un nombre inválido dan 404', async () => {
    assert.equal((await abrir('match:no-existe')).status, 404);
    assert.equal((await abrir('otra:cosa')).status, 404);
    assert.equal((await abrir('tournament:no-existe')).status, 404);
  });
});

describe('escribir', () => {
  it('pide sesión y permiso', async () => {
    assert.equal((await escribir(`tournament:${SLUG}`, null, 'hola')).status, 401);
    assert.equal((await escribir(`tournament:${SLUG}`, 'ciro', 'hola')).status, 403);
    assert.equal((await escribir(`team:${rojos}`, 'beto', 'espío')).status, 403);
    assert.equal((await escribir(`match:${partido}`, 'ciro', 'hola')).status, 403);
  });

  it('el mensaje vuelve con el autor copiado y la hora del servidor', async () => {
    const { status, datos } = await escribir(`team:${rojos}`, 'ana', '  banean Alaska  ');
    assert.equal(status, 200);
    const m = datos.message;
    assert.deepEqual([m.body, m.system, m.user], ['banean Alaska', false, { id: c.ana.uid, display_name: 'Ana', avatar_url: 'https://img/ana.png' }]);
    assert.match(m.created_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('vacío no; largo se corta en 2000', async () => {
    assert.equal((await escribir(`match:${partido}`, 'ana', '   ')).status, 400);
    const { datos } = await escribir(`match:${partido}`, 'beto', 'x'.repeat(2500));
    assert.equal(datos.message.body.length, 2000);
  });
});

describe('avisos del sistema', () => {
  it('van sin autor y crean la sala si hace falta', async () => {
    const otro = await guardarPartido({ tournament_id: SLUG, team_a_id: rojos, team_b_id: azules, round: 2 });
    const m = await avisoSistema(`match:${otro}`, 'Draft cerrado. Mapa: Alaska.');
    assert.deepEqual([m.system, m.user, m.body], [true, null, 'Draft cerrado. Mapa: Alaska.']);
    assert.equal((await leerSala(`partido_${otro}`)).name, 'Ronda 2 · #1');
    assert.deepEqual((await historial(`partido_${otro}`)).map((x) => x.body), ['Draft cerrado. Mapa: Alaska.']);
    assert.equal(await avisoSistema('match:no-existe', 'nada'), null);
  });
});
