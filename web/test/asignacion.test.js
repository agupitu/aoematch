// Asignación de costo mínimo (web/src/logica/asignacion.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asignacionMinima } from '../src/logica/asignacion.js';

const costoTotal = (costo, columnas) => columnas.reduce((suma, c, i) => suma + costo[i][c], 0);

/** Todas las permutaciones de 0..n-1. */
function permutaciones(n) {
  if (n === 0) return [[]];
  return permutaciones(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

describe('asignación de costo mínimo', () => {
  it('con una matriz de 1x1 o vacía no hay nada que elegir', () => {
    assert.deepEqual(asignacionMinima([]), []);
    assert.deepEqual(asignacionMinima([[7]]), [0]);
  });

  it('un caso conocido', () => {
    const costo = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    assert.deepEqual(asignacionMinima(costo), [1, 0, 2]);
  });

  it('sin diferencias de costo devuelve la identidad: cada fila con su columna', () => {
    assert.deepEqual(asignacionMinima(Array.from({ length: 5 }, () => Array(5).fill(0))), [0, 1, 2, 3, 4]);
  });

  it('da el mismo costo que probar todas las combinaciones, con costos repetidos y todo', () => {
    let semilla = 12345;
    const azar = () => {
      semilla = (semilla * 1664525 + 1013904223) % 4294967296;
      return semilla / 4294967296;
    };
    for (let n = 2; n <= 6; n++) {
      for (let prueba = 0; prueba < 20; prueba++) {
        const costo = Array.from({ length: n }, () => Array.from({ length: n }, () => Math.floor(azar() * 6)));
        const elegida = asignacionMinima(costo);
        assert.equal(new Set(elegida).size, n, 'cada columna una sola vez');
        const mejor = Math.min(...permutaciones(n).map((p) => costoTotal(costo, p)));
        assert.equal(costoTotal(costo, elegida), mejor);
      }
    }
  });

  it('no modifica la matriz que recibe', () => {
    const costo = [[1, 2], [2, 1]];
    const copia = structuredClone(costo);
    asignacionMinima(costo);
    assert.deepEqual(costo, copia);
  });
});
