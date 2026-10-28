// Vista previa de un torneo según su configuración (web/src/logica/previa.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_EQUIPOS_PREVIA, armarPrevia, equiposPorDefecto } from '../src/logica/previa.js';

/** El borrador del formulario: los campos de formato, con los valores que trae la pantalla. */
const borrador = (extra = {}) => ({
  format: 'eliminacion_simple',
  team_size: 1,
  max_teams: '',
  best_of: 3,
  best_of_final: '',
  series_mode: 'mejor_de',
  group_count: 2,
  group_advance: 2,
  swiss_rounds: 5,
  third_place: false,
  ...extra,
});

const nombres = (m) => [m.team_a_name, m.team_b_name];

describe('cantidad de equipos de la vista previa', () => {
  it('el tope del torneo si lo hay, acotado a lo que se puede dibujar', () => {
    assert.equal(equiposPorDefecto(borrador({ max_teams: '12' })), 12);
    assert.equal(equiposPorDefecto(borrador({ max_teams: '500' })), MAX_EQUIPOS_PREVIA);
  });

  it('sin tope, una cantidad típica del formato', () => {
    assert.equal(equiposPorDefecto(borrador()), 8);
    assert.equal(equiposPorDefecto(borrador({ format: 'liga' })), 6);
    assert.equal(equiposPorDefecto(borrador({ format: 'grupos_playoff', group_count: 4 })), 16);
  });

  it('la cantidad se acota entre 2 y el máximo', () => {
    assert.equal(armarPrevia(borrador(), 0).cantidad, 2);
    assert.equal(armarPrevia(borrador(), 1000).cantidad, MAX_EQUIPOS_PREVIA);
  });
});

describe('vista previa por formato', () => {
  it('eliminación simple de 8: 7 partidos y la final con su propio largo de serie', () => {
    const p = armarPrevia(borrador({ best_of_final: '5' }), 8);
    assert.equal(p.partidos.length, 7);
    assert.deepEqual(p.fases.map((f) => [f.nombre, f.partidos]), [['Eliminatoria', 7]]);
    assert.equal(p.partidos.find((m) => m.label === 'Final').best_of, 5);
    const r1 = p.partidos.filter((m) => m.round === 1).sort((a, b) => a.position - b.position);
    assert.deepEqual(r1.map(nombres)[0], ['Equipo 1', 'Equipo 8']);
  });

  it('con 6 equipos, los dos primeros pasan libres y esos partidos no cuentan como partidos a jugar', () => {
    const p = armarPrevia(borrador(), 6);
    assert.equal(p.fases[0].partidos, 5);
    const libres = p.partidos.filter((m) => m.status === 'walkover');
    assert.deepEqual(libres.map((m) => m.team_a_name).sort(), ['Equipo 1', 'Equipo 2']);
  });

  it('eliminación doble de 4: ganadores, perdedores y gran final, sin partidos fantasma', () => {
    const p = armarPrevia(borrador({ format: 'eliminacion_doble' }), 4);
    const por = (b) => p.partidos.filter((m) => m.bracket === b).length;
    assert.deepEqual([por('W'), por('L'), por('F')], [3, 2, 1]);
    assert.ok(p.partidos.every((m) => m.status !== 'walkover' || m.team_a_id || m.team_b_id));
  });

  it('liga de 6: todos contra todos, 15 partidos en 5 fechas', () => {
    const p = armarPrevia(borrador({ format: 'liga' }), 6);
    assert.equal(p.partidos.length, 15);
    assert.equal(new Set(p.partidos.map((m) => m.round)).size, 5);
    assert.equal(p.fases[0].partidos, 15);
  });

  it('suizo de 8: arma la primera ronda', () => {
    const p = armarPrevia(borrador({ format: 'suizo', swiss_rounds: 5 }), 8);
    assert.equal(p.partidos.length, 4);
    assert.deepEqual(p.partidos.map(nombres)[0], ['Equipo 1', 'Equipo 5']);
  });

  it('grupos + playoff de 16 en 4 grupos: 24 partidos de grupos y 7 de playoffs con los clasificados', () => {
    const p = armarPrevia(borrador({ format: 'grupos_playoff', group_count: 4, group_advance: 2 }), 16);
    assert.deepEqual(p.fases.map((f) => [f.nombre, f.partidos]), [['Fase de grupos', 24], ['Playoffs', 7]]);
    assert.deepEqual(p.etapas[0].groups.map((g) => g.team_ids.length), [4, 4, 4, 4]);
    assert.deepEqual(p.etapas[0].groups[0].team_ids, ['e1', 'e8', 'e9', 'e16']);

    const playoffs = p.partidos.filter((m) => m.stage_id === p.etapas[1].id && m.round === 1)
      .sort((a, b) => a.position - b.position);
    // Los primeros juegan contra segundos de otro grupo, y los dos de un grupo quedan en mitades opuestas.
    assert.deepEqual(playoffs.map(nombres), [
      ['1º Grupo A', '2º Grupo B'],
      ['1º Grupo D', '2º Grupo C'],
      ['1º Grupo B', '2º Grupo A'],
      ['1º Grupo C', '2º Grupo D'],
    ]);
  });

  it('grupos con pocos equipos no inventa clasificados', () => {
    const p = armarPrevia(borrador({ format: 'grupos_playoff', group_count: 4, group_advance: 2 }), 5);
    const equipos = new Set(p.partidos.flatMap((m) => [m.team_a_name, m.team_b_name]).filter((n) => n?.includes('Grupo')));
    assert.ok(equipos.size <= 8);
    assert.doesNotThrow(() => armarPrevia(borrador({ format: 'grupos_playoff', group_count: 8 }), 2));
  });
});

describe('vista previa: serie y nombres', () => {
  it('todos los partidos llevan el tipo de serie del formulario', () => {
    const p = armarPrevia(borrador({ series_mode: 'fijas', best_of: 3, best_of_final: '5' }), 4);
    assert.ok(p.partidos.every((m) => m.series_mode === 'fijas'));
    assert.equal(p.partidos.find((m) => m.label === 'Final').best_of, 5);
    assert.equal(p.partidos.find((m) => m.label === 'Semifinal').best_of, 3);
  });

  it('usa los nombres que le pasan para los primeros equipos y completa con Equipo N', () => {
    const p = armarPrevia(borrador(), 4, ['Los Tercios', 'Halcones']);
    assert.deepEqual(p.equipos.map((e) => e.name), ['Los Tercios', 'Halcones', 'Equipo 3', 'Equipo 4']);
    assert.deepEqual(nombres(p.partidos.find((m) => m.round === 1 && m.position === 1)), ['Los Tercios', 'Equipo 4']);
  });
});
