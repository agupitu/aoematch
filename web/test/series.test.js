// Series de un partido: al mejor de N o a N partidas (web/src/logica/series.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoDeSerie, etiquetaDeSerie, modoDeSerie, opcionesDeSerie, paraGanar, partidasJugables, partidasMaximas,
  proximaPartida, victoriasDeWalkover,
} from '../src/logica/series.js';

const mejorDe = (n) => ({ series_mode: 'mejor_de', best_of: n });
const fijas = (n) => ({ series_mode: 'fijas', best_of: n });

describe('modo de la serie', () => {
  it('lo que se guardó sin modo es al mejor de', () => {
    assert.equal(modoDeSerie({ best_of: 3 }), 'mejor_de');
    assert.equal(modoDeSerie(null), 'mejor_de');
    assert.equal(modoDeSerie({ series_mode: 'raro' }), 'mejor_de');
    assert.equal(modoDeSerie(fijas(3)), 'fijas');
  });

  it('etiqueta: BO3 o "A 3 partidas"; a una sola partida es un BO1', () => {
    assert.equal(etiquetaDeSerie({ best_of: 5 }), 'BO5');
    assert.equal(etiquetaDeSerie(mejorDe(3)), 'BO3');
    assert.equal(etiquetaDeSerie(fijas(3)), 'A 3 partidas');
    assert.equal(etiquetaDeSerie(fijas(1)), 'BO1');
  });

  it('el formulario ofrece cantidades distintas según el modo', () => {
    assert.deepEqual(opcionesDeSerie('mejor_de'), [1, 3, 5, 7]);
    assert.deepEqual(opcionesDeSerie('fijas'), [2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('estado de la serie', () => {
  it('al mejor de: cierra cuando alguien tiene la mayoría, sin esperar al resto', () => {
    assert.equal(paraGanar(3), 2);
    assert.equal(paraGanar(5), 3);
    assert.equal(estadoDeSerie(mejorDe(3), 1, 1).ganador, null);
    assert.equal(estadoDeSerie(mejorDe(3), 2, 0).ganador, 'a');
    assert.equal(estadoDeSerie(mejorDe(5), 2, 3).ganador, 'b');
    assert.equal(partidasMaximas(mejorDe(5)), 5);
  });

  it('a N partidas impar: se juegan todas y gana el que más ganó', () => {
    assert.equal(estadoDeSerie(fijas(3), 2, 0).ganador, null);
    assert.equal(estadoDeSerie(fijas(3), 2, 1).ganador, 'a');
    assert.equal(estadoDeSerie(fijas(3), 0, 3).ganador, 'b');
    assert.equal(partidasMaximas(fijas(3)), 3);
  });

  it('a N partidas par: si empatan al final, una partida más desempata', () => {
    assert.equal(estadoDeSerie(fijas(2), 1, 0).ganador, null);
    assert.deepEqual(estadoDeSerie(fijas(2), 1, 1), { ganador: null, maximo: 3, desempate: true });
    assert.equal(estadoDeSerie(fijas(2), 2, 0).ganador, 'a');
    assert.equal(estadoDeSerie(fijas(2), 2, 1).ganador, 'a');
    assert.equal(estadoDeSerie(fijas(4), 2, 2).desempate, true);
    assert.equal(partidasMaximas(fijas(4)), 5);
  });

  it('próxima partida: la siguiente a las jugadas, o ninguna con la serie definida', () => {
    assert.equal(proximaPartida(mejorDe(3), 0, 0), 1);
    assert.equal(proximaPartida(mejorDe(3), 1, 1), 3);
    assert.equal(proximaPartida(mejorDe(3), 2, 0), null);
    assert.equal(proximaPartida(fijas(3), 2, 0), 3);
    assert.equal(proximaPartida(fijas(3), 2, 1), null);
    assert.equal(proximaPartida(fijas(2), 1, 1), 3);
    assert.equal(proximaPartida(fijas(2), 2, 1), null);
  });

  it('walkover: las que necesita para ganar, o todas si la serie es fija', () => {
    assert.equal(victoriasDeWalkover(mejorDe(3)), 2);
    assert.equal(victoriasDeWalkover(mejorDe(7)), 4);
    assert.equal(victoriasDeWalkover(fijas(3)), 3);
    assert.equal(victoriasDeWalkover(fijas(2)), 2);
  });
});

describe('partidas que se pueden cargar', () => {
  it('al mejor de: se cierran las que vienen después de definida la serie', () => {
    assert.deepEqual(partidasJugables(mejorDe(3), []), [true, true, true]);
    assert.deepEqual(partidasJugables(mejorDe(3), ['a', 'a', null]), [true, true, false]);
    assert.deepEqual(partidasJugables(mejorDe(3), ['a', 'b', null]), [true, true, true]);
    assert.deepEqual(partidasJugables(mejorDe(5), ['b', 'b', 'b', null, null]), [true, true, true, false, false]);
    assert.deepEqual(partidasJugables(mejorDe(1), ['a']), [true]);
  });

  it('a N partidas: se habilitan todas, y la extra solo si empatan', () => {
    assert.deepEqual(partidasJugables(fijas(3), ['a', 'a', null]), [true, true, true]);
    assert.deepEqual(partidasJugables(fijas(2), []), [true, true, false]);
    assert.deepEqual(partidasJugables(fijas(2), ['a', 'a', null]), [true, true, false]);
    assert.deepEqual(partidasJugables(fijas(2), ['a', 'b', null]), [true, true, true]);
    assert.deepEqual(partidasJugables(fijas(4), ['a', 'a', 'b', 'b', null]), [true, true, true, true, true]);
    assert.deepEqual(partidasJugables(fijas(4), ['a', 'a', 'a', 'b', null]), [true, true, true, true, false]);
  });

  it('una partida cerrada no cuenta para las que siguen', () => {
    // Si la tercera quedó cerrada, su ganador no mueve la cuenta de las demás.
    assert.deepEqual(partidasJugables(mejorDe(5), ['a', 'a', 'a', 'b', 'b']), [true, true, true, false, false]);
  });
});
