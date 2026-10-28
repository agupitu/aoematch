// Asignación de costo mínimo (método húngaro), sin dependencias. La usa la
// siembra de los playoffs para ubicar a cada equipo en un lugar del cuadro.

/**
 * Dada una matriz cuadrada `costo[fila][columna]`, la columna que le toca a cada
 * fila (todas distintas) para que la suma de costos sea la menor posible. Con
 * costos iguales gana la columna más baja. No modifica la matriz.
 * @param {number[][]} costo
 * @returns {number[]}
 */
export function asignacionMinima(costo) {
  const n = costo.length;
  // Potenciales de filas (u) y de columnas (v); p[j] es la fila asignada a la columna j (1..n).
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const camino = new Array(n + 1).fill(0);

  for (let fila = 1; fila <= n; fila++) {
    p[0] = fila;
    let columna = 0;
    const minimo = new Array(n + 1).fill(Infinity);
    const usada = new Array(n + 1).fill(false);
    do {
      usada[columna] = true;
      const i0 = p[columna];
      let delta = Infinity;
      let siguiente = 0;
      for (let j = 1; j <= n; j++) {
        if (usada[j]) continue;
        const actual = costo[i0 - 1][j - 1] - u[i0] - v[j];
        if (actual < minimo[j]) {
          minimo[j] = actual;
          camino[j] = columna;
        }
        if (minimo[j] < delta) {
          delta = minimo[j];
          siguiente = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (usada[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minimo[j] -= delta;
        }
      }
      columna = siguiente;
    } while (p[columna] !== 0);
    do {
      const anterior = camino[columna];
      p[columna] = p[anterior];
      columna = anterior;
    } while (columna);
  }

  const columnas = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) columnas[p[j] - 1] = j - 1;
  return columnas;
}
