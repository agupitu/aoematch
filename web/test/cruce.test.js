// Recorte de horarios y ventanas en común de una ronda (web/src/logica/cruce.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cruceDeRonda, recortarBloques } from '../src/logica/cruce.js';

// Cuartos de la maqueta: del 14 al 16 de noviembre, en Buenos Aires.
const RANGO = { starts_at: '2026-11-14T03:00:00.000Z', ends_at: '2026-11-17T03:00:00.000Z' };
const ANTES = new Date('2026-11-01T00:00:00.000Z');

/** Bloque en UTC: `bloque('14', '20:00', '15', '00:00')` es del 14 a las 20:00 al 15 a las 00:00. */
const bloque = (diaIni, ini, diaFin, fin) => ({
  starts_at: `2026-11-${diaIni}T${ini}:00.000Z`,
  ends_at: `2026-11-${diaFin}T${fin}:00.000Z`,
});

const ana = { id: 'ana', blocks: [bloque('14', '20:00', '14', '23:00')] };
const beto = { id: 'beto', blocks: [bloque('14', '21:00', '15', '00:00')] };

const ventana = (diaIni, ini, diaFin, fin, count, missing = []) => ({ ...bloque(diaIni, ini, diaFin, fin), count, missing });

describe('recorte de bloques', () => {
  it('corta lo que empieza antes del rango o termina después', () => {
    assert.deepEqual(
      recortarBloques([bloque('14', '02:00', '14', '05:00'), bloque('16', '23:00', '17', '06:00')], RANGO.starts_at, RANGO.ends_at),
      [bloque('14', '03:00', '14', '05:00'), bloque('16', '23:00', '17', '03:00')]
    );
  });

  it('lo que cae afuera del rango desaparece', () => {
    assert.deepEqual(recortarBloques([bloque('01', '20:00', '01', '23:00')], RANGO.starts_at, RANGO.ends_at), []);
  });

  it('ordena, fusiona los que se tocan o se pisan y descarta los vacíos', () => {
    const desordenados = [bloque('14', '22:00', '14', '23:00'), bloque('14', '20:00', '14', '21:00'), bloque('14', '21:00', '14', '22:30'), bloque('14', '23:30', '14', '23:30')];
    assert.deepEqual(recortarBloques(desordenados, RANGO.starts_at, RANGO.ends_at), [bloque('14', '20:00', '14', '23:00')]);
  });

  it('alinea a la grilla de 30 minutos en UTC: lo que no ocupa una barra entera no cuenta', () => {
    assert.deepEqual(recortarBloques([bloque('14', '12:15', '14', '12:45')], RANGO.starts_at, RANGO.ends_at), []);
    assert.deepEqual(
      recortarBloques([bloque('14', '12:10', '14', '13:50')], RANGO.starts_at, RANGO.ends_at),
      [bloque('14', '12:30', '14', '13:30')]
    );
  });
});

describe('ventanas de una ronda', () => {
  it('con todos los jugadores: el tramo en común de al menos la duración', () => {
    assert.deepEqual(cruceDeRonda([ana, beto], RANGO, { ahora: ANTES }), {
      windows: [ventana('14', '21:00', '14', '23:00', 2)],
      partial: [],
    });
  });

  it('sin tramo para todos, los que dejan afuera a uno, diciendo quién', () => {
    const ciro = { id: 'ciro', blocks: [bloque('15', '10:00', '15', '12:00')] };
    assert.deepEqual(cruceDeRonda([ana, beto, ciro], RANGO, { ahora: ANTES }), {
      windows: [],
      partial: [ventana('14', '21:00', '14', '23:00', 2, ['ciro'])],
    });
  });

  it('un jugador que no cargó nada cuenta como que no puede', () => {
    const sinCargar = { id: 'dani' };
    assert.deepEqual(cruceDeRonda([ana, beto, sinCargar], RANGO, { ahora: ANTES }).partial, [
      ventana('14', '21:00', '14', '23:00', 2, ['dani']),
    ]);
  });

  it('con menos de dos jugadores no hay nada que cruzar', () => {
    assert.deepEqual(cruceDeRonda([ana], RANGO, { ahora: ANTES }), { windows: [], partial: [] });
    assert.deepEqual(cruceDeRonda([], RANGO, { ahora: ANTES }), { windows: [], partial: [] });
  });

  it('falta uno quiere decir uno solo en toda la ventana, no uno distinto en cada barra', () => {
    const a = { id: 'a', blocks: [bloque('14', '20:00', '14', '21:00')] };
    const b = { id: 'b', blocks: [bloque('14', '20:30', '14', '21:30')] };
    const c = { id: 'c', blocks: [bloque('14', '21:00', '14', '22:00')] };
    assert.deepEqual(cruceDeRonda([a, b, c], RANGO, { ahora: ANTES, duracionMin: 60 }), { windows: [], partial: [] });
  });

  it('lo que ya pasó se corta en la próxima barra y se tira lo que queda corto', () => {
    const ambos = [{ id: 'a', blocks: [bloque('14', '20:00', '14', '23:00')] }, { id: 'b', blocks: [bloque('14', '20:00', '14', '23:00')] }];
    assert.deepEqual(
      cruceDeRonda(ambos, RANGO, { ahora: new Date('2026-11-14T21:10:00.000Z') }).windows,
      [ventana('14', '21:30', '14', '23:00', 2)]
    );
    assert.deepEqual(cruceDeRonda(ambos, RANGO, { ahora: new Date('2026-11-14T21:40:00.000Z') }), { windows: [], partial: [] });
  });

  it('ordena las más largas primero y, a igual largo, las más tempranas', () => {
    const dias = [bloque('14', '20:00', '14', '21:30'), bloque('15', '20:00', '15', '22:30'), bloque('16', '20:00', '16', '21:30')];
    const a = { id: 'a', blocks: dias };
    const b = { id: 'b', blocks: dias };
    assert.deepEqual(
      cruceDeRonda([a, b], RANGO, { ahora: ANTES }).windows.map((w) => [w.starts_at, w.ends_at]),
      [['2026-11-15T20:00:00.000Z', '2026-11-15T22:30:00.000Z'], ['2026-11-14T20:00:00.000Z', '2026-11-14T21:30:00.000Z'], ['2026-11-16T20:00:00.000Z', '2026-11-16T21:30:00.000Z']]
    );
  });

  it('respeta el límite de ventanas', () => {
    const dias = [bloque('14', '20:00', '14', '21:30'), bloque('15', '20:00', '15', '21:30'), bloque('16', '20:00', '16', '21:30')];
    const a = { id: 'a', blocks: dias };
    const b = { id: 'b', blocks: dias };
    assert.equal(cruceDeRonda([a, b], RANGO, { ahora: ANTES, limite: 2 }).windows.length, 2);
  });
});
