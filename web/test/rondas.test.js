// Rondas de un cuadro: ids, orden, estado y "mis rondas" (web/src/logica/rondas.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cerrarEnMemoria, cuadroDePlayoffs, generarCuadro } from '../src/logica/llaves.js';
import { estadoDeRonda, misRondas, rondaIdDe, rondasDelCuadro } from '../src/logica/rondas.js';

const equipos = (n) => Array.from({ length: n }, (_, i) => ({ id: `E${i + 1}`, name: `E${i + 1}`, seed: null }));

/** Ids repetibles: p1, p2... para partidos y s1, s2... para etapas. */
function ids() {
  let k = 0;
  return { nuevoId: () => `p${++k}`, nuevoIdEtapa: () => `s${++k}` };
}

const torneo = (extra = {}) => ({ id: 't', format: 'eliminacion_simple', best_of: 3, ...extra });

/** Los partidos como Map, para cerrarlos en memoria sin tocar los originales. */
const mapaDe = (partidos) => new Map(partidos.map((p) => [p.id, { ...p }]));

describe('rondas del cuadro', () => {
  it('eliminación simple de 8: Cuartos, Semifinal y Final, con un id por ronda', () => {
    const c = generarCuadro(torneo(), equipos(8), ids());
    const rondas = rondasDelCuadro(c.partidos, c.etapas);
    const etapa = c.etapas[0].id;
    assert.deepEqual(rondas.map((r) => [r.label, r.partidos.length]), [['Cuartos', 4], ['Semifinal', 2], ['Final', 1]]);
    assert.deepEqual(rondas.map((r) => r.id), [`${etapa}_W1`, `${etapa}_W2`, `${etapa}_W3`]);
    assert.ok(c.partidos.filter((p) => p.round === 1).every((p) => rondaIdDe(p) === `${etapa}_W1`));
  });

  it('el tercer puesto comparte ronda con la final', () => {
    const c = generarCuadro(torneo({ third_place: 1 }), equipos(8), ids());
    const final = rondasDelCuadro(c.partidos, c.etapas).find((r) => r.label === 'Final');
    assert.deepEqual(final.partidos.map((p) => p.label), ['Final', 'Tercer puesto']);
    assert.equal(new Set(final.partidos.map(rondaIdDe)).size, 1);
  });

  it('doble eliminación: ganadores, perdedores y gran final, con ids distintos aunque el número se repita', () => {
    const c = generarCuadro(torneo({ format: 'eliminacion_doble' }), equipos(4), ids());
    const rondas = rondasDelCuadro(c.partidos, c.etapas);
    assert.deepEqual(rondas.map((r) => r.id.split('_')[1]), ['W1', 'W2', 'L1', 'L2', 'F3']);
    assert.equal(new Set(rondas.map((r) => r.id)).size, rondas.length);
  });

  it('grupos + playoff: cada fecha junta a los dos grupos y los playoffs vienen después', () => {
    const t = torneo({ format: 'grupos_playoff', group_count: 2, group_advance: 2 });
    const generador = ids();
    const grupos = generarCuadro(t, equipos(6), generador);
    const playoffs = cuadroDePlayoffs(t, grupos.etapas, equipos(6), grupos.partidos, generador);
    const rondas = rondasDelCuadro(
      [...playoffs.partidos, ...grupos.partidos],
      [...playoffs.etapas, ...grupos.etapas]
    );
    assert.deepEqual(
      rondas.map((r) => [r.label, r.partidos.length]),
      [['Fecha 1', 2], ['Fecha 2', 2], ['Fecha 3', 2], ['Semifinal', 2], ['Final', 1]]
    );
  });
});

describe('estado de una ronda', () => {
  const c = generarCuadro(torneo(), equipos(4), ids());
  const [semis] = rondasDelCuadro(c.partidos, c.etapas);

  it('sin fechas mientras el staff no las fijó', () => {
    assert.equal(estadoDeRonda(semis, undefined), 'sin_fechas');
  });

  it('abierta con fechas y partidos sin cerrar', () => {
    assert.equal(estadoDeRonda(semis, { id: semis.id }), 'abierta');
  });

  it('jugada cuando todos sus partidos están cerrados, tenga fechas o no', () => {
    const mapa = mapaDe(c.partidos);
    for (const p of semis.partidos) cerrarEnMemoria(mapa, p.id, p.team_a_id, 2, 0);
    const [cerradas] = rondasDelCuadro([...mapa.values()], c.etapas);
    assert.equal(estadoDeRonda(cerradas, undefined), 'jugada');
    assert.equal(estadoDeRonda(cerradas, { id: cerradas.id }), 'jugada');
  });
});

describe('mis rondas', () => {
  const c = generarCuadro(torneo(), equipos(8), ids());
  const cuartosDe = (equipoId) => c.partidos.find((p) => p.round === 1 && [p.team_a_id, p.team_b_id].includes(equipoId));

  it('sin equipo no hay rondas', () => {
    assert.deepEqual(misRondas(c.partidos, c.etapas, null), []);
  });

  it('antes de jugar, la primera ronda; el que gana pasa a la siguiente y el que pierde se queda sin rondas', () => {
    assert.deepEqual(misRondas(c.partidos, c.etapas, 'E1').map((r) => r.label), ['Cuartos']);
    const mapa = mapaDe(c.partidos);
    cerrarEnMemoria(mapa, cuartosDe('E1').id, 'E1', 2, 0);
    const despues = [...mapa.values()];
    assert.deepEqual(misRondas(despues, c.etapas, 'E1').map((r) => r.label), ['Semifinal']);
    assert.deepEqual(misRondas(despues, c.etapas, 'E8'), []);
  });

  it('con bye no lista la primera ronda: el partido se cierra solo', () => {
    const seis = generarCuadro(torneo(), equipos(6), ids());
    assert.deepEqual(misRondas(seis.partidos, seis.etapas, 'E1').map((r) => r.label), ['Semifinal']);
  });
});
