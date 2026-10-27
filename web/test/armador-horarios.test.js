// Horarios, armador y catálogo sin base de datos (web/src/logica/).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as horarios from '../src/logica/horarios.js';
import { proponerEquipos } from '../src/logica/armador.js';
import { civPorId, civs, mapaPorId, maps } from '../src/logica/catalogo.js';

// Lunes 20:00 a 23:00 UTC = minutos 1200 a 1380 de la semana.
const LUNES_20 = 1200;
const MARTES_20 = LUNES_20 + 24 * 60;
const usuario = (id, availability = [], extra = {}) => ({ id, availability, ...extra });

/** Azar repetible (generador congruencial). */
function azar(semilla = 7) {
  let x = semilla;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe('cruce de horarios', () => {
  const ana = usuario('ana', [{ start_min: LUNES_20, end_min: LUNES_20 + 180 }]);
  const beto = usuario('beto', [{ start_min: LUNES_20 + 60, end_min: LUNES_20 + 240 }]);
  const ciro = usuario('ciro');

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

describe('armador', () => {
  const t2v2 = { team_size: 2 };
  const nivel = (id, rating_team, availability) => usuario(id, availability, { display_name: id.toUpperCase(), rating_team });

  it('es para torneos por equipos y avisa si no alcanzan', () => {
    assert.throws(() => proponerEquipos({ team_size: 1 }, []), /para torneos por equipos/);
    const p = proponerEquipos({ team_size: 3 }, [nivel('ar1', 2000)]);
    assert.deepEqual([p.teams.length, p.leftovers.map((u) => u.id), p.note], [0, ['ar1'], 'No alcanzan los jugadores para un equipo.']);
  });

  it('serpiente por rating: equipos parejos y el más bajo afuera', () => {
    const sueltos = [['ar1', 2000], ['ar2', 1800], ['ar3', 1600], ['ar4', 1400], ['ar5', 1200]].map(([id, r]) => nivel(id, r));
    const p = proponerEquipos(t2v2, sueltos, { iteraciones: 0 });
    assert.deepEqual(p.teams.map((t) => t.members.map((m) => m.id)), [['ar1', 'ar4'], ['ar2', 'ar3']]);
    assert.deepEqual(p.teams.map((t) => t.avg_rating), [1700, 1700]);
    assert.deepEqual(p.leftovers.map((u) => u.id), ['ar5']);
  });

  it('sin rating cuenta 1000, y usa el de 1v1 si no tiene el de equipo', () => {
    const p = proponerEquipos(t2v2, [usuario('a'), usuario('b', [], { rating_1v1: 1400 })], { iteraciones: 0 });
    assert.equal(p.teams[0].avg_rating, 1200);
  });

  it('con el mismo nivel reparte en serpiente sin mirar horarios', () => {
    const sueltos = [['ah1', LUNES_20], ['ah2', MARTES_20], ['ah3', LUNES_20], ['ah4', MARTES_20]]
      .map(([id, dia]) => nivel(id, 1500, [{ start_min: dia, end_min: dia + 180 }]));
    const p = proponerEquipos(t2v2, sueltos, { rnd: azar() });
    assert.deepEqual(p.teams.map((t) => t.members.map((m) => m.id)), [['ah1', 'ah4'], ['ah2', 'ah3']]);
    assert.equal(p.teams[0].overlap_min, undefined);
  });

  it('no cambia los perfiles que recibe', () => {
    const sueltos = [nivel('a', 1000), nivel('b', 1100)];
    const copia = structuredClone(sueltos);
    proponerEquipos(t2v2, sueltos, { rnd: azar() });
    assert.deepEqual(sueltos, copia);
  });
});

describe('catálogo', () => {
  it('civs y mapas ordenados por nombre, y búsqueda por id', () => {
    assert.ok(civs().length > 10 && maps().length > 10);
    const nombres = civs().map((c) => c.name_es);
    assert.deepEqual(nombres, [...nombres].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const c = civs()[0];
    assert.equal(civPorId(String(c.id)), c);
    assert.equal(mapaPorId(maps()[0].id), maps()[0]);
    assert.equal(civPorId(-1), null);
  });
});
