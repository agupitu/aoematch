// Draft de una partida sin base de datos (web/src/logica/draft.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { civs, maps } from '../src/logica/catalogo.js';
import {
  banear, civsPermitidas, elegirMapa, eligieronTodos, planDeDraft, revelar, turnoDeBan, validarPick,
} from '../src/logica/draft.js';

const MAPAS = maps().slice(0, 5).map((m) => m.id);
const CIVS = civs().slice(0, 6).map((c) => c.id);

const torneo = (extra = {}) => ({
  team_size: 1, map_ids: MAPAS, civ_ids: CIVS, first_map_id: null, map_repeat: 0, civ_bans: 0, civ_repeat_series: 1, ...extra,
});

const equipo = (id, member_ids) => ({ id, captain_id: member_ids[0], member_ids });

const partido = (games = [], id = 'p1') => ({ id, team_a_id: 'A', team_b_id: 'B', games });

const jugada = (game_no, winner_team_id, map_id, civs = []) => ({ game_no, winner_team_id, map_id, civs });

const unoContraUno = { a: equipo('A', ['a1']), b: equipo('B', ['b1']) };
const dosContraDos = { a: equipo('A', ['a1', 'a2', 'a3']), b: equipo('B', ['b2', 'b1']) };

describe('crear el draft', () => {
  it('primera partida: mapa fijo del torneo, sin elegir', () => {
    const d = planDeDraft(torneo({ first_map_id: MAPAS[2] }), partido(), unoContraUno);
    assert.deepEqual([d.state, d.map_id, d.map_chooser_team_id], ['picks', MAPAS[2], null]);
  });

  it('primera partida sin mapa fijo: al azar, igual en todos los navegadores y distinto por partido', () => {
    const uno = planDeDraft(torneo(), partido([], 'p1'), unoContraUno).map_id;
    assert.ok(MAPAS.includes(uno));
    assert.equal(planDeDraft(torneo(), partido([], 'p1'), unoContraUno).map_id, uno);
    const distintos = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((id) => planDeDraft(torneo(), partido([], id), unoContraUno).map_id));
    assert.ok(distintos.size > 1);
  });

  it('desde la segunda: elige mapa el que perdió la anterior, sin los ya jugados', () => {
    const d = planDeDraft(torneo(), partido([jugada(1, 'A', MAPAS[0])]), unoContraUno, 2);
    assert.deepEqual([d.state, d.map_chooser_team_id, d.map_id], ['mapa', 'B', null]);
    assert.deepEqual(d.map_pool, MAPAS.slice(1));
    const repetir = planDeDraft(torneo({ map_repeat: 1 }), partido([jugada(1, 'A', MAPAS[0])]), unoContraUno, 2);
    assert.deepEqual(repetir.map_pool, MAPAS);
  });

  it('no arranca si la partida anterior no tiene ganador', () => {
    assert.throws(() => planDeDraft(torneo(), partido(), unoContraUno, 2), /no tiene ganador/);
    assert.throws(() => planDeDraft(torneo(), partido([jugada(1, null, MAPAS[0])]), unoContraUno, 2), /no tiene ganador/);
  });

  it('juegan los primeros de cada equipo, capitán primero', () => {
    const d = planDeDraft(torneo({ team_size: 2 }), partido(), dosContraDos);
    assert.deepEqual(d.player_ids, ['a1', 'a2', 'b2', 'b1']);
    assert.deepEqual(d.team_of, { a1: 'A', a2: 'A', b2: 'B', b1: 'B' });
  });

  it('hasta 4 por equipo y con los dos equipos', () => {
    assert.throws(() => planDeDraft(torneo({ team_size: 5 }), partido(), unoContraUno), /hasta 4/);
    assert.throws(() => planDeDraft(torneo(), { id: 'p', team_a_id: 'A', team_b_id: null, games: [] }, unoContraUno), /Faltan equipos/);
  });
});

describe('mapa y bans', () => {
  const segunda = (extra) => planDeDraft(torneo({ civ_bans: 2, ...extra }), partido([jugada(1, 'A', MAPAS[0])]), unoContraUno, 2);

  it('el perdedor elige mapa; el otro no, ni uno jugado', () => {
    const d = segunda();
    assert.throws(() => elegirMapa(d, 'A', MAPAS[1]), /perdió la partida anterior/);
    assert.throws(() => elegirMapa(d, 'B', MAPAS[0]), /no se puede elegir/);
    const conMapa = elegirMapa(d, 'B', MAPAS[1]);
    assert.deepEqual([conMapa.map_id, conMapa.state], [MAPAS[1], 'bans']);
    assert.throws(() => elegirMapa(conMapa, 'B', MAPAS[2]), /No es momento/);
  });

  it('bans alternados, arranca el que no eligió mapa', () => {
    let d = elegirMapa(segunda(), 'B', MAPAS[1]);
    assert.deepEqual(d.ban_order, ['A', 'B', 'A', 'B']);
    assert.throws(() => banear(d, 'B', CIVS[0]), /No es el turno/);
    d = banear(d, 'A', CIVS[0]);
    assert.equal(turnoDeBan(d), 'B');
    assert.throws(() => banear(d, 'B', CIVS[0]), /ya está baneada/);
    assert.throws(() => banear(d, 'B', -1), /no está en el torneo/);
    d = banear(banear(banear(d, 'B', CIVS[1]), 'A', CIVS[2]), 'B', CIVS[3]);
    assert.deepEqual([d.state, d.banned_civ_ids, turnoDeBan(d)], ['picks', CIVS.slice(0, 4), null]);
  });

  it('en la primera partida arranca a banear el equipo A', () => {
    const d = planDeDraft(torneo({ civ_bans: 1 }), partido(), unoContraUno);
    assert.deepEqual([d.state, d.ban_order], ['bans', ['A', 'B']]);
  });
});

describe('picks ciegos', () => {
  const picks = (extra = {}) => planDeDraft(torneo({ team_size: 2, ...extra }), partido(), dosContraDos);

  it('cada jugador elige del pool; se permite espejo y repetir en el equipo (D6)', () => {
    const d = picks();
    for (const uid of d.player_ids) validarPick(d, uid, CIVS[0]);
    assert.throws(() => validarPick(d, 'a3', CIVS[0]), /No jugás/);
    assert.throws(() => validarPick(d, 'a1', -1), /No podés elegir/);
  });

  it('sin repetir en la serie: cada uno pierde las civs que ya usó', () => {
    const previa = jugada(1, 'A', MAPAS[0], [{ user_id: 'a1', team_id: 'A', civ_id: CIVS[0] }]);
    const d = planDeDraft(torneo({ civ_repeat_series: 0 }), partido([previa]), unoContraUno, 2);
    const conMapa = elegirMapa(d, 'B', MAPAS[1]);
    assert.ok(!civsPermitidas(conMapa, 'a1').includes(CIVS[0]));
    assert.ok(civsPermitidas(conMapa, 'b1').includes(CIVS[0]));
    assert.throws(() => validarPick(conMapa, 'a1', CIVS[0]), /No podés elegir/);

    const conRepetir = planDeDraft(torneo(), partido([previa]), unoContraUno, 2);
    assert.deepEqual(conRepetir.civs_usadas, {});
  });

  it('las baneadas no se eligen', () => {
    const d = banear(banear(picks({ civ_bans: 1 }), 'A', CIVS[0]), 'B', CIVS[1]);
    assert.throws(() => validarPick(d, 'a1', CIVS[1]), /No podés elegir/);
  });

  it('se revela cuando eligieron todos, con las civs listas para la partida', () => {
    const d = picks();
    const parciales = { a1: CIVS[0], a2: CIVS[0], b2: CIVS[1] };
    assert.equal(eligieronTodos(d, parciales), false);
    assert.throws(() => revelar(d, parciales), /Falta que elijan todos/);

    const { draft, civs: elegidas } = revelar(d, { ...parciales, b1: CIVS[0] });
    assert.deepEqual([draft.revealed, draft.state], [true, 'listo']);
    assert.deepEqual(elegidas, [
      { user_id: 'a1', team_id: 'A', civ_id: CIVS[0] },
      { user_id: 'a2', team_id: 'A', civ_id: CIVS[0] },
      { user_id: 'b2', team_id: 'B', civ_id: CIVS[1] },
      { user_id: 'b1', team_id: 'B', civ_id: CIVS[0] },
    ]);
    assert.throws(() => validarPick(draft, 'a1', CIVS[2]), /No es momento/);
  });
});
