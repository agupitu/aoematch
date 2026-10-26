// Armador de equipos sobre Firestore: propuesta, confirmación y rutas.
//
//   npm test        (desde la raíz)

import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, levantarApi } from './apoyo.js';

const api = await levantarApi();
after(() => api.cerrar());

const { proponerEquipos, confirmarEquipos } = await import('../src/teambuilder.js');
const { guardarTorneo, leerTorneo } = await import('../src/data/torneos.js');
const { guardarInscripcion, leerInscripcion } = await import('../src/data/inscripciones.js');
const { guardarUsuario } = await import('../src/data/usuarios.js');
const { leerEquipo } = await import('../src/data/equipos.js');
const { leerSala } = await import('../src/data/salas.js');

/** Azar repetible (generador congruencial). */
function azar(semilla = 7) {
  let x = semilla;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

const LUNES = 1200;
const MARTES = LUNES + 24 * 60;

async function jugador(id, rating, availability = []) {
  await guardarUsuario(id, { display_name: id.toUpperCase(), rating_team: rating, availability }).catch(() => {});
}

describe('propuesta', () => {
  before(async () => {
    await guardarTorneo('armador-1v1', { name: '1v1', team_size: 1, organizer_id: 'org' });
    await guardarTorneo('armador-pocos', { name: 'Pocos', team_size: 3, organizer_id: 'org' });
    await guardarTorneo('armador-2v2', { name: '2v2', team_size: 2, organizer_id: 'org' });
    for (const [id, r] of [['ar1', 2000], ['ar2', 1800], ['ar3', 1600], ['ar4', 1400], ['ar5', 1200]]) {
      await jugador(id, r);
      await guardarInscripcion('armador-2v2', id, {});
    }
    await guardarInscripcion('armador-pocos', 'ar1', {});
    // Retirado y con equipo: no entran.
    await jugador('ar6', 3000);
    await guardarInscripcion('armador-2v2', 'ar6', { status: 'retirada' });
    await jugador('ar7', 3000);
    await guardarInscripcion('armador-2v2', 'ar7', { team_id: 'otro' });
  });

  it('es para torneos por equipos y avisa si no alcanzan', async () => {
    await assert.rejects(proponerEquipos('armador-1v1'), /para torneos por equipos/);
    await assert.rejects(proponerEquipos('no-existe'), /Torneo inexistente/);
    const p = await proponerEquipos('armador-pocos');
    assert.deepEqual([p.teams.length, p.leftovers.map((u) => u.id), p.note], [0, ['ar1'], 'No alcanzan los jugadores para un equipo.']);
  });

  it('serpiente por rating: equipos parejos y el más bajo afuera', async () => {
    const p = await proponerEquipos('armador-2v2', { iteraciones: 0 });
    assert.deepEqual(p.teams.map((t) => t.members.map((m) => m.id)), [['ar1', 'ar4'], ['ar2', 'ar3']]);
    assert.deepEqual(p.teams.map((t) => t.avg_rating), [1700, 1700]);
    assert.deepEqual(p.leftovers.map((u) => u.id), ['ar5']);
  });

  it('con el mismo nivel, junta a los que comparten horario', async () => {
    await guardarTorneo('armador-horarios', { name: 'Horarios', team_size: 2, organizer_id: 'org' });
    for (const [id, dia] of [['ah1', LUNES], ['ah2', MARTES], ['ah3', LUNES], ['ah4', MARTES]]) {
      await jugador(id, 1500, [{ start_min: dia, end_min: dia + 180 }]);
      await guardarInscripcion('armador-horarios', id, {});
    }
    const p = await proponerEquipos('armador-horarios', { rnd: azar() });
    const parejas = p.teams.map((t) => t.members.map((m) => m.id).sort().join('+')).sort();
    assert.deepEqual(parejas, ['ah1+ah3', 'ah2+ah4']);
    assert.deepEqual(p.teams.map((t) => t.overlap_min), [180, 180]);
  });
});

describe('confirmar', () => {
  it('crea equipos con capitán, sala e inscripciones, y suma al contador', async () => {
    await guardarTorneo('armador-confirma', { name: 'Confirma', team_size: 2, organizer_id: 'org', admin_ids: ['adm'] });
    for (const id of ['ac1', 'ac2', 'ac3']) {
      await jugador(id, 1500);
      await guardarInscripcion('armador-confirma', id, {});
    }
    const [id] = await confirmarEquipos('armador-confirma', {
      teams: [
        { name: 'Equipo 1', members: [{ id: 'ac2' }, { id: 'ac1' }, { id: 'ac2' }] },
        { name: 'Vacío', members: [] },
      ],
    });
    const e = await leerEquipo(id);
    assert.deepEqual([e.name, e.captain_id, e.auto_built, e.member_ids], ['Equipo 1', 'ac2', 1, ['ac2', 'ac1']]);
    assert.deepEqual(e.members.map((m) => m.role), ['capitan', 'jugador']);
    assert.equal((await leerInscripcion('armador-confirma', 'ac1')).team_id, id);
    assert.equal((await leerInscripcion('armador-confirma', 'ac3')).team_id, null);
    assert.deepEqual([...(await leerSala(`equipo_${id}`)).readers].sort(), ['ac1', 'ac2', 'adm', 'org']);
    assert.equal((await leerTorneo('armador-confirma')).equipos, 1);
  });
});

describe('rutas del armador', () => {
  let org;
  let otro;

  before(async () => {
    [org, otro] = await Promise.all([cuentaConEmail('armador-org@demo.aoematch'), cuentaConEmail('armador-otro@demo.aoematch')]);
    await api.pedir('GET', '/auth/me', { token: org.token });
    await api.pedir('GET', '/auth/me', { token: otro.token });
    await api.pedir('POST', '/tournaments', { token: org.token, body: { name: 'Armador por ruta', team_size: 2 } });
    for (const id of ['rt1', 'rt2']) {
      await jugador(id, 1500);
      await guardarInscripcion('armador-por-ruta', id, {});
    }
  });

  it('solo el staff propone y confirma', async () => {
    assert.equal((await api.pedir('POST', '/tournaments/armador-por-ruta/autoteams', { token: otro.token })).status, 403);
    const { status, datos } = await api.pedir('POST', '/tournaments/armador-por-ruta/autoteams', { token: org.token, body: { weight_overlap: 0 } });
    assert.equal(status, 200);
    assert.equal(datos.teams.length, 1);

    assert.equal((await api.pedir('POST', '/tournaments/armador-por-ruta/autoteams/confirm', { token: org.token, body: {} })).status, 400);
    const r = await api.pedir('POST', '/tournaments/armador-por-ruta/autoteams/confirm', { token: org.token, body: { proposal: datos } });
    assert.equal(r.status, 200);
    assert.equal(r.datos.teams.length, 1);
    assert.equal(r.datos.teams[0].auto_built, 1);
    assert.equal(r.datos.equipos, 1);
  });
});
