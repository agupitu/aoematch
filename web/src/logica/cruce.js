// Horarios de una ronda: recorte al rango y ventanas en las que pueden jugar
// los jugadores de un partido (docs/superpowers/specs/2026-10-27-horarios-por-ronda-design.md).
//
// Mismo criterio que el cruce semanal de antes: tramos donde pueden todos y,
// si no hay, donde falta uno solo, diciendo quién. Cambia la base: ahora es el
// rango de fechas de la ronda y las ventanas traen fecha real. Sin base de
// datos: trabaja sobre los horarios ya leídos (`blocks` en ISO UTC).

const MS_BARRA = 30 * 60000;

const iso = (ms) => new Date(ms).toISOString();

/**
 * Bloques `{ starts_at, ends_at }` recortados a `[starts_at, ends_at)` y
 * alineados a la grilla de 30 minutos de UTC (el inicio hacia arriba y el fin
 * hacia abajo: nunca cuentan más de lo que el jugador marcó), ordenados y
 * fusionados. Lo que queda vacío se descarta.
 */
export function recortarBloques(bloques, starts_at, ends_at) {
  const desde = Date.parse(starts_at);
  const hasta = Date.parse(ends_at);
  const intervalos = [];
  for (const b of bloques ?? []) {
    const ini = Math.ceil(Math.max(Date.parse(b.starts_at), desde) / MS_BARRA) * MS_BARRA;
    const fin = Math.floor(Math.min(Date.parse(b.ends_at), hasta) / MS_BARRA) * MS_BARRA;
    if (fin > ini) intervalos.push([ini, fin]);
  }
  intervalos.sort((x, y) => x[0] - y[0]);
  const fusionados = [];
  for (const [ini, fin] of intervalos) {
    const ultimo = fusionados[fusionados.length - 1];
    if (ultimo && ini <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], fin);
    else fusionados.push([ini, fin]);
  }
  return fusionados.map(([ini, fin]) => ({ starts_at: iso(ini), ends_at: iso(fin) }));
}

/**
 * Ventanas de al menos `duracionMin` minutos dentro del rango de la ronda.
 * `windows` son las que sirven a todos; `partial`, las que dejan afuera a uno
 * solo en toda la ventana, y solo se calcula si no hay ninguna para todos.
 * Con menos de dos jugadores no hay nada que cruzar. Lo que ya pasó (antes de
 * `ahora`) se corta en la próxima barra y se tira lo que queda más corto que
 * la duración. Orden: las más largas primero y, a igual largo, las más
 * tempranas.
 * @param {{ id: string, blocks?: { starts_at: string, ends_at: string }[] }[]} jugadores
 * @param {{ starts_at: string, ends_at: string }} rango
 * @returns {{ windows: Ventana[], partial: Ventana[] }} con `Ventana = { starts_at, ends_at, count, missing: string[] }`
 */
export function cruceDeRonda(jugadores, rango, { duracionMin = 90, ahora = new Date(), limite = 20 } = {}) {
  const vacio = { windows: [], partial: [] };
  if (jugadores.length < 2) return vacio;

  const inicio = Math.ceil(Math.max(Date.parse(rango.starts_at), ahora.getTime()) / MS_BARRA) * MS_BARRA;
  const fin = Math.floor(Date.parse(rango.ends_at) / MS_BARRA) * MS_BARRA;
  const barras = Math.floor((fin - inicio) / MS_BARRA);
  if (!(barras > 0)) return vacio;

  const libres = new Map(jugadores.map((j) => {
    const libre = new Array(barras).fill(false);
    for (const b of recortarBloques(j.blocks, iso(inicio), iso(fin))) {
      const desde = (Date.parse(b.starts_at) - inicio) / MS_BARRA;
      const hasta = (Date.parse(b.ends_at) - inicio) / MS_BARRA;
      for (let i = desde; i < hasta; i++) libre[i] = true;
    }
    return [j.id, libre];
  }));

  const largo = Math.max(1, Math.ceil(duracionMin / 30));

  /** Ventanas en las que como mucho `maxFaltan` jugadores no están libres durante toda la ventana. */
  function ventanas(maxFaltan) {
    const crudas = [];
    for (let i = 0; i + largo <= barras; i++) {
      const faltan = [];
      for (const [id, libre] of libres) {
        let todo = true;
        for (let k = 0; k < largo; k++) if (!libre[i + k]) { todo = false; break; }
        if (!todo) faltan.push(id);
      }
      if (faltan.length <= maxFaltan) crudas.push({ i, fin: i + largo, faltan });
    }

    // Las que se tocan y dejan afuera a los mismos son una sola.
    const fusionadas = [];
    for (const v of crudas) {
      const previa = fusionadas[fusionadas.length - 1];
      if (previa && previa.fin >= v.i && previa.faltan.join() === v.faltan.join()) previa.fin = Math.max(previa.fin, v.fin);
      else fusionadas.push({ ...v });
    }

    return fusionadas
      .sort((x, y) => (y.fin - y.i) - (x.fin - x.i) || x.i - y.i)
      .slice(0, limite)
      .map((v) => ({
        starts_at: iso(inicio + v.i * MS_BARRA),
        ends_at: iso(inicio + v.fin * MS_BARRA),
        count: jugadores.length - v.faltan.length,
        missing: v.faltan,
      }));
  }

  const windows = ventanas(0);
  return { windows, partial: windows.length ? [] : ventanas(1) };
}
