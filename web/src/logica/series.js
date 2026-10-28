// Series de un partido, sin base de datos: al mejor de N (se corta cuando un
// equipo tiene la mayoría) o a N partidas (se juegan todas y gana el que más
// ganó). Las usan las llaves, la sala del partido, el formulario y la demo.
//
// A N partidas con N par puede terminar empatada: ahí se juega una partida más
// que desempata. No hay empates en el resultado de un partido.

export const MODOS_DE_SERIE = ['mejor_de', 'fijas'];

/** Lo guardado antes de que existiera el modo no lo trae: es al mejor de. */
export const modoDeSerie = (x) => (x && x.series_mode === 'fijas' ? 'fijas' : 'mejor_de');

/** Partidas que tiene que ganar un equipo para cerrar una serie al mejor de `bestOf`. */
export const paraGanar = (bestOf) => Math.floor(bestOf / 2) + 1;

/** Cantidades que ofrece el formulario para cada modo. */
export const opcionesDeSerie = (modo) => (modo === 'fijas' ? [2, 3, 4, 5, 6, 7, 8, 9] : [1, 3, 5, 7]);

/** "BO3" o "A 3 partidas". A una sola partida es lo mismo que un BO1. */
export function etiquetaDeSerie(x) {
  const n = x.best_of;
  return modoDeSerie(x) === 'fijas' && n > 1 ? `A ${n} partidas` : `BO${n}`;
}

/**
 * Cómo va una serie, con `a` y `b` las partidas ganadas por cada equipo.
 * `ganador` es 'a', 'b' o null; `maximo` las partidas que puede llegar a tener
 * (con el desempate) y `desempate` dice si toca jugar esa partida extra.
 * @returns {{ ganador: 'a' | 'b' | null, maximo: number, desempate: boolean }}
 */
export function estadoDeSerie(x, a, b) {
  const n = x.best_of;
  if (modoDeSerie(x) === 'fijas') {
    const completa = a + b >= n;
    return {
      ganador: completa && a !== b ? (a > b ? 'a' : 'b') : null,
      maximo: n % 2 === 0 ? n + 1 : n,
      desempate: completa && a === b,
    };
  }
  const necesarias = paraGanar(n);
  return { ganador: a >= necesarias ? 'a' : b >= necesarias ? 'b' : null, maximo: n, desempate: false };
}

/** Partidas que puede tener la serie como mucho, con el desempate incluido. */
export const partidasMaximas = (x) => estadoDeSerie(x, 0, 0).maximo;

/**
 * Qué partidas de la serie se pueden cargar según los ganadores ya elegidos
 * (`ganadores[i]` es 'a', 'b' o null para la partida i + 1). Al mejor de N, una
 * partida se habilita mientras las anteriores no hayan definido la serie; a N
 * partidas se habilitan las N, y la extra de una serie par solo si empataron.
 * @returns {boolean[]} una entrada por partida posible, con el desempate incluido
 */
export function partidasJugables(x, ganadores) {
  const fija = modoDeSerie(x) === 'fijas';
  let a = 0;
  let b = 0;
  return Array.from({ length: partidasMaximas(x) }, (_, i) => {
    const { ganador, desempate } = estadoDeSerie(x, a, b);
    const habilitada = fija ? i < x.best_of || desempate : !ganador;
    if (habilitada) {
      if (ganadores[i] === 'a') a++;
      else if (ganadores[i] === 'b') b++;
    }
    return habilitada;
  });
}

/** Número de la partida que se juega ahora; null si la serie ya tiene ganador. */
export const proximaPartida = (x, a, b) => (estadoDeSerie(x, a, b).ganador ? null : a + b + 1);

/** Partidas que se le dan al ganador por walkover: las que necesita, o todas si la serie es fija. */
export const victoriasDeWalkover = (x) => (modoDeSerie(x) === 'fijas' ? x.best_of : paraGanar(x.best_of));
