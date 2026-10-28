// Mapa y civs cargados a mano en una partida (web/src/logica/detallePartida.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { civsALugares, civsDelEquipo, lugaresACivs, lugaresDelEquipo } from '../src/logica/detallePartida.js';

const equipo = (id, jugadores) => ({ id, roster: jugadores.map((u) => ({ id: u, display_name: `Nombre ${u}` })) });

describe('lugares de civ de un equipo', () => {
  it('uno por jugador y los que faltan hasta el tamaño del equipo', () => {
    assert.deepEqual(lugaresDelEquipo(equipo('A', ['u1']), 2), [
      { user_id: 'u1', nombre: 'Nombre u1' },
      { user_id: null, nombre: 'Jugador 2' },
    ]);
    assert.deepEqual(lugaresDelEquipo(equipo('A', []), 1), [{ user_id: null, nombre: 'Jugador 1' }]);
  });

  it('con más jugadores que el tamaño, hay un lugar por jugador', () => {
    assert.equal(lugaresDelEquipo(equipo('A', ['u1', 'u2', 'u3']), 2).length, 3);
  });

  it('el mínimo es la mayor cantidad de civs ya cargadas del equipo', () => {
    const partidas = [{ civs: [{ team_id: 'A' }, { team_id: 'B' }] }, { civs: [{ team_id: 'A' }, { team_id: 'A' }, { team_id: 'A' }] }];
    assert.equal(civsDelEquipo(partidas, 'A'), 3);
    assert.equal(civsDelEquipo(partidas, 'B'), 1);
    assert.equal(civsDelEquipo([], 'A'), 0);
  });
});

describe('civs guardadas y lugares', () => {
  const a = equipo('A', ['u1', 'u2']);
  const lugares = lugaresDelEquipo(a, 2);

  it('cada civ va al lugar de su jugador, sin importar el orden guardado', () => {
    const civs = [{ user_id: 'u2', team_id: 'A', civ_id: 7 }, { user_id: 'u1', team_id: 'A', civ_id: 3 }, { user_id: 'x', team_id: 'B', civ_id: 9 }];
    assert.deepEqual(civsALugares(civs, a, lugares), ['3', '7']);
  });

  it('una civ sin jugador conocido ocupa el primer lugar libre', () => {
    const civs = [{ user_id: null, team_id: 'A', civ_id: 5 }, { user_id: 'u2', team_id: 'A', civ_id: 7 }];
    assert.deepEqual(civsALugares(civs, a, lugares), ['5', '7']);
  });

  it('sin civs, lugares vacíos', () => {
    assert.deepEqual(civsALugares(undefined, a, lugares), ['', '']);
  });

  it('de los lugares a lo que se guarda: solo los elegidos, con su jugador', () => {
    assert.deepEqual(lugaresACivs(['3', ''], a, lugares), [{ user_id: 'u1', team_id: 'A', civ_id: 3 }]);
    const sinJugador = lugaresDelEquipo(equipo('B', []), 2);
    assert.deepEqual(lugaresACivs(['', '8'], equipo('B', []), sinJugador), [{ user_id: null, team_id: 'B', civ_id: 8 }]);
  });
});
