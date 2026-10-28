// Calendario de una ronda: los días del rango en la zona del jugador, sus
// barras de 30 minutos y la selección que pinta
// (docs/superpowers/specs/2026-10-27-horarios-por-ronda-design.md).
//
// JS puro y sin importar nada de `lib.ts`: lo usan también la demo y las
// pruebas en Node. Los límites de cada día se calculan con la zona para esa
// fecha, no con un desfase fijo: dentro de un rango puede haber un cambio de
// horario de verano. Los instantes caen siempre en la grilla de 30 minutos de
// UTC; una zona con desfase de 45 minutos (Katmandú) queda corrida 15.

export const MIN_BARRA = 30;
export const BARRAS_POR_DIA = 48;

const MS_BARRA = MIN_BARRA * 60000;
const MS_DIA = 24 * 3600000;

/** Hacia abajo, al múltiplo de 30 minutos en UTC. */
export const ajustarAGrilla = (ms) => Math.floor(ms / MS_BARRA) * MS_BARRA;

const formatos = new Map();

/**
 * Un solo `Intl.DateTimeFormat` por zona: un rango de 31 días son casi 1 500
 * llamadas. Una zona que el navegador no conoce se trata como UTC: mejor un
 * calendario corrido que una pantalla rota.
 */
function formato(zona) {
  let f = formatos.get(zona);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zona,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch {
      f = formato('UTC');
    }
    formatos.set(zona, f);
  }
  return f;
}

function partes(ms, zona) {
  const p = {};
  for (const x of formato(zona).formatToParts(ms)) p[x.type] = x.value;
  return p;
}

/** Hora local de ese instante menos el instante, en ms. */
function desfase(ms, zona) {
  const p = partes(ms, zona);
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return comoUtc - Math.floor(ms / 1000) * 1000;
}

const dosCifras = (n) => String(n).padStart(2, '0');

/** Fecha local ('YYYY-MM-DD') de un instante (ms desde 1970) en `zona`. */
export function diaLocal(ms, zona) {
  const p = partes(ms, zona);
  return `${p.year}-${p.month}-${p.day}`;
}

const aUtc = (dia) => {
  const [a, m, d] = dia.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
};

/** El día siguiente por calendario, no sumando 24 h de reloj. */
const diaSiguiente = (dia) => new Date(aUtc(dia) + MS_DIA).toISOString().slice(0, 10);

/**
 * Instante UTC (ms) de una hora local: `dia` es 'YYYY-MM-DD' y `minutos` los
 * minutos desde la medianoche local. `null` si esa hora no existe (salto de
 * verano); si se repite, el primer instante.
 */
export function instanteLocal(dia, minutos, zona) {
  const [a, m, d] = dia.split('-').map(Number);
  const local = Date.UTC(a, m - 1, d, 0, minutos);
  // Los desfases de la zona un día antes y un día después son los únicos
  // candidatos: el cambio de hora cae entre los dos.
  const validos = [];
  for (const off of new Set([desfase(local - MS_DIA, zona), desfase(local + MS_DIA, zona)])) {
    const instante = local - off;
    if (desfase(instante, zona) === off) validos.push(instante);
  }
  return validos.length ? ajustarAGrilla(Math.min(...validos)) : null;
}

/** El día empieza en la primera hora local que existe: la medianoche puede saltearse (Santiago). */
function inicioDeDia(dia, zona) {
  for (let min = 0; min < 24 * 60; min += MIN_BARRA) {
    const ms = instanteLocal(dia, min, zona);
    if (ms !== null) return ms;
  }
  throw new Error(`El día ${dia} no existe en ${zona}.`);
}

/**
 * Rango de fechas que fija el staff: de 00:00 de `desdeDia` a 24:00 de
 * `hastaDia` en su zona. `ends_at` es el inicio del día siguiente (excluyente).
 */
export function rangoDeDias(desdeDia, hastaDia, zona) {
  return {
    starts_at: new Date(inicioDeDia(desdeDia, zona)).toISOString(),
    ends_at: new Date(inicioDeDia(diaSiguiente(hastaDia), zona)).toISOString(),
  };
}

/** Días del rango, con los dos extremos incluidos. */
export const cantidadDeDias = (desdeDia, hastaDia) => Math.round((aUtc(hastaDia) - aUtc(desdeDia)) / MS_DIA) + 1;

/**
 * Un día por cada fecha local de `zona` que toca el rango, con sus 48 barras
 * de 30 minutos. `ms` es el instante de la barra (`null` si esa hora no existe
 * ese día) y `dentro` dice si la barra cae entera en `[starts_at, ends_at)`.
 * @returns {{ dia: string, barras: { ms: number | null, hora: string, dentro: boolean }[] }[]}
 */
export function diasDelCalendario(starts_at, ends_at, zona) {
  const inicio = Date.parse(starts_at);
  const fin = Date.parse(ends_at);
  const ultimo = diaLocal(fin - 1, zona);
  const dias = [];
  for (let dia = diaLocal(inicio, zona); ; dia = diaSiguiente(dia)) {
    const barras = Array.from({ length: BARRAS_POR_DIA }, (_, i) => {
      const minutos = i * MIN_BARRA;
      const ms = instanteLocal(dia, minutos, zona);
      return {
        ms,
        hora: `${dosCifras(Math.floor(minutos / 60))}:${dosCifras(minutos % 60)}`,
        dentro: ms !== null && ms >= inicio && ms + MS_BARRA <= fin,
      };
    });
    dias.push({ dia, barras });
    // Un día sin ninguna barra de adentro no se muestra: en una zona con
    // desfase de 45 minutos el rango arranca 15 minutos antes de la medianoche.
    if (dia >= ultimo) return dias.filter((d) => d.barras.some((b) => b.dentro));
  }
}

/**
 * Bloques `{ starts_at, ends_at }` (ISO UTC) de las barras marcadas: las
 * consecutivas se fusionan, también de un día al siguiente. `sel[d][i]` es la
 * barra `i` del día `d`; solo cuentan las de adentro del rango.
 */
export function bloquesDeSeleccion(dias, sel) {
  const instantes = [];
  dias.forEach((d, k) => d.barras.forEach((b, i) => {
    if (sel[k]?.[i] && b.dentro) instantes.push(b.ms);
  }));
  instantes.sort((x, y) => x - y);
  const bloques = [];
  for (const ms of instantes) {
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && ultimo.fin === ms) ultimo.fin = ms + MS_BARRA;
    else bloques.push({ ini: ms, fin: ms + MS_BARRA });
  }
  return bloques.map(({ ini, fin }) => ({ starts_at: new Date(ini).toISOString(), ends_at: new Date(fin).toISOString() }));
}

/** La selección que dibujan esos bloques; lo que cae fuera del rango se ignora. */
export function seleccionDeBloques(dias, bloques) {
  const intervalos = bloques.map((b) => [Date.parse(b.starts_at), Date.parse(b.ends_at)]);
  return dias.map((d) =>
    d.barras.map((b) => b.dentro && intervalos.some(([ini, fin]) => b.ms >= ini && b.ms + MS_BARRA <= fin))
  );
}

/**
 * Selección nueva con el rectángulo entre `ancla` y `actual` (`{ d, i }`)
 * puesto en `modo` (true marca, false borra). Solo toca barras de adentro del
 * rango y no muta `base`.
 */
export function rectangulo(base, dias, ancla, actual, modo) {
  const d0 = Math.min(ancla.d, actual.d);
  const d1 = Math.max(ancla.d, actual.d);
  const i0 = Math.min(ancla.i, actual.i);
  const i1 = Math.max(ancla.i, actual.i);
  return base.map((fila, d) =>
    fila.map((valor, i) => (d >= d0 && d <= d1 && i >= i0 && i <= i1 && dias[d].barras[i].dentro ? modo : valor))
  );
}
