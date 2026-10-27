// Armador de equipos y catálogo sin base de datos (web/src/logica/).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { proponerEquipos } from '../src/logica/armador.js';
import { civPorId, civs, mapaPorId, maps } from '../src/logica/catalogo.js';

// Horarios semanales de antes (minutos de la semana: lunes 20:00 UTC y martes
// 20:00 UTC). El armador ya no los mira; las pruebas se los pasan para comprobarlo.
const LUNES_20 = 1200;
const MARTES_20 = LUNES_20 + 24 * 60;
const usuario = (id, availability = [], extra = {}) => ({ id, availability, ...extra });

/** Azar repetible (generador congruencial). */
function azar(semilla = 7) {
  let x = semilla;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

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
