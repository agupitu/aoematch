// Calendario del torneo (web/src/logica/calendarioTorneo.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fasesDelCalendario, mesesDelCalendario, rangoEnTexto, tipoDeRonda } from '../src/logica/calendarioTorneo.js';

const etapas = [
  { id: 's1', name: 'Fase de grupos', type: 'grupos' },
  { id: 's2', name: 'Eliminatoria', type: 'eliminacion_simple' },
];
const ronda = (id, stage_id, label) => ({ id, stage_id, label });
const docs = (obj) => new Map(Object.entries(obj).map(([id, [from_day, to_day]]) => [id, { from_day, to_day }]));

describe('tipo de fase de una ronda', () => {
  it('los grupos, la liga y el suizo son "grupos"; las eliminatorias van por el nombre', () => {
    assert.equal(tipoDeRonda({ label: 'Fecha 1' }, etapas[0]), 'grupos');
    assert.equal(tipoDeRonda({ label: 'Ronda 1' }, { type: 'suizo' }), 'grupos');
    const elim = etapas[1];
    assert.equal(tipoDeRonda({ label: 'Octavos' }, elim), 'octavos');
    assert.equal(tipoDeRonda({ label: 'Cuartos' }, elim), 'cuartos');
    assert.equal(tipoDeRonda({ label: 'Semifinal' }, elim), 'semifinal');
    assert.equal(tipoDeRonda({ label: 'Final' }, elim), 'final');
    assert.equal(tipoDeRonda({ label: 'Gran final' }, elim), 'final');
    assert.equal(tipoDeRonda({ label: 'Perdedores · Final' }, elim), 'perdedores');
    assert.equal(tipoDeRonda({ label: 'Ronda 3' }, elim), 'ronda');
  });
});

describe('fases del calendario', () => {
  const torneo = {
    reg_opens_at: '2026-11-01T15:00:00Z',
    reg_closes_at: '2026-11-05T23:00:00Z',
    starts_at: '2026-11-07T18:00:00Z',
  };
  const rondas = [ronda('s1_W1', 's1', 'Fecha 1'), ronda('s1_W2', 's1', 'Fecha 2'), ronda('s2_W1', 's2', 'Cuartos')];

  it('inscripción, arranque y las rondas, con sus fechas', () => {
    const fases = fasesDelCalendario(torneo, rondas, docs({ s1_W1: ['2026-11-08', '2026-11-10'], s2_W1: ['2026-11-20', '2026-11-22'] }), etapas, 'UTC');
    assert.deepEqual(fases.map((f) => [f.label, f.tipo, f.desde, f.hasta]), [
      ['Inscripción', 'inscripcion', '2026-11-01', '2026-11-05'],
      ['Arranca', 'arranque', '2026-11-07', '2026-11-07'],
      ['Fase de grupos · Fecha 1', 'grupos', '2026-11-08', '2026-11-10'],
      ['Fase de grupos · Fecha 2', 'grupos', null, null],
      ['Cuartos', 'cuartos', '2026-11-20', '2026-11-22'],
    ]);
  });

  it('los días se cuentan en la zona de quien mira', () => {
    const fases = fasesDelCalendario({ reg_closes_at: '2026-11-05T01:30:00Z' }, [], new Map(), etapas, 'America/Argentina/Buenos_Aires');
    assert.deepEqual(fases.map((f) => [f.desde, f.hasta]), [['2026-11-04', '2026-11-04']]);
  });

  it('sin apertura, la inscripción es el día del cierre; sin fechas, no hay fase', () => {
    const solo = fasesDelCalendario({ reg_closes_at: '2026-11-05T12:00:00Z' }, [], new Map(), etapas, 'UTC');
    assert.deepEqual(solo.map((f) => [f.id, f.desde, f.hasta]), [['inscripcion', '2026-11-05', '2026-11-05']]);
    assert.deepEqual(fasesDelCalendario({}, [], new Map(), etapas, 'UTC'), []);
  });
});

describe('meses del calendario', () => {
  const fases = [
    { id: 'a', desde: '2026-10-29', hasta: '2026-11-02' },
    { id: 'b', desde: '2026-11-02', hasta: '2026-11-03' },
    { id: 'sin', desde: null, hasta: null },
  ];

  it('cubre del mes de la primera fase al de la última, semanas desde el lunes', () => {
    const meses = mesesDelCalendario(fases);
    assert.deepEqual(meses.map((m) => [m.anio, m.mes]), [[2026, 10], [2026, 11]]);
    // 1 de octubre de 2026 es jueves: tres huecos antes (lun, mar, mié).
    assert.deepEqual(meses[0].dias.slice(0, 4).map((d) => d && d.dia), [null, null, null, '2026-10-01']);
    assert.equal(meses[0].dias.length, 3 + 31);
    // 1 de noviembre de 2026 es domingo: seis huecos.
    assert.equal(meses[1].dias.filter((d) => d === null).length, 6);
  });

  it('cada día lista las fases que lo incluyen', () => {
    const dias = mesesDelCalendario(fases).flatMap((m) => m.dias).filter(Boolean);
    const de = (dia) => dias.find((d) => d.dia === dia).fases;
    assert.deepEqual(de('2026-10-28'), []);
    assert.deepEqual(de('2026-10-29'), ['a']);
    assert.deepEqual(de('2026-11-02'), ['a', 'b']);
    assert.deepEqual(de('2026-11-03'), ['b']);
    assert.deepEqual(de('2026-11-04'), []);
  });

  it('sin fases con fechas no hay meses; cruza el cambio de año; corta a 12 meses', () => {
    assert.deepEqual(mesesDelCalendario([{ id: 'x', desde: null, hasta: null }]), []);
    assert.deepEqual(mesesDelCalendario([{ id: 'x', desde: '2026-12-30', hasta: '2027-01-02' }]).map((m) => [m.anio, m.mes]), [[2026, 12], [2027, 1]]);
    assert.equal(mesesDelCalendario([{ id: 'x', desde: '2026-01-01', hasta: '2030-01-01' }]).length, 12);
  });
});

describe('rango en texto', () => {
  it('un día o un rango; sin fechas, null', () => {
    assert.match(rangoEnTexto({ desde: '2026-11-03', hasta: '2026-11-03' }), /^3 nov/i);
    assert.match(rangoEnTexto({ desde: '2026-11-03', hasta: '2026-11-05' }), /^3 nov.* – 5 nov/i);
    assert.equal(rangoEnTexto({ desde: null, hasta: null }), null);
  });
});
