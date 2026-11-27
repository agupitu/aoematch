// Pool de mapas por fase (web/src/logica/pools-por-fase.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maps } from '../src/logica/catalogo.js';
import { planDeDraft } from '../src/logica/draft.js';
import {
  faltaDeMapas, faseDelPartido, fasesDelFormato, mapasDelPartido, poolsLimpios, todosLosMapas, usaPoolPorFase,
} from '../src/logica/pools-por-fase.js';

const M = maps().slice(0, 8).map((m) => m.id);

describe('fases del formato', () => {
  it('eliminación simple con y sin tercer puesto', () => {
    assert.deepEqual(fasesDelFormato({ format: 'eliminacion_simple' }), ['ronda', 'octavos', 'cuartos', 'semifinal', 'final']);
    assert.ok(fasesDelFormato({ format: 'eliminacion_simple', third_place: 1 }).includes('tercer'));
  });

  it('doble eliminación tiene cuadro de perdedores; grupos + playoff arranca con grupos', () => {
    assert.ok(fasesDelFormato({ format: 'eliminacion_doble' }).includes('perdedores'));
    assert.equal(fasesDelFormato({ format: 'grupos_playoff' })[0], 'grupos');
  });

  it('liga y suizo no tienen fases: siempre un solo pool', () => {
    assert.deepEqual(fasesDelFormato({ format: 'liga' }), []);
    assert.equal(usaPoolPorFase({ format: 'suizo', map_pool_mode: 'por_fase' }), false);
  });
});

describe('fase de un partido', () => {
  const casos = [
    [{ group_id: 'A', label: 'Fecha 1' }, 'grupos'],
    [{ label: 'Ronda 1' }, 'ronda'],
    [{ label: 'Octavos' }, 'octavos'],
    [{ label: 'Cuartos' }, 'cuartos'],
    [{ label: 'Semifinal' }, 'semifinal'],
    [{ label: 'Final' }, 'final'],
    [{ label: 'Gran final' }, 'final'],
    [{ label: 'Tercer puesto' }, 'tercer'],
    [{ label: 'Perdedores · Final' }, 'perdedores'],
    [{ label: 'Perdedores · Ronda 2' }, 'perdedores'],
  ];
  for (const [partido, fase] of casos) {
    it(`${partido.label} → ${fase}`, () => assert.equal(faseDelPartido(partido), fase));
  }
});

describe('mapas de un partido', () => {
  const torneo = {
    format: 'eliminacion_simple',
    map_pool_mode: 'por_fase',
    map_ids: [M[0], M[1], M[2]],
    map_pools: { final: [M[5], M[6]] },
  };

  it('la fase con pool propio usa el suyo', () => {
    assert.deepEqual(mapasDelPartido(torneo, { label: 'Final' }), [M[5], M[6]]);
  });

  it('la fase sin pool propio usa el pool base', () => {
    assert.deepEqual(mapasDelPartido(torneo, { label: 'Semifinal' }), [M[0], M[1], M[2]]);
  });

  it('con un solo pool, los pools por fase guardados no cuentan', () => {
    assert.deepEqual(mapasDelPartido({ ...torneo, map_pool_mode: 'unico' }, { label: 'Final' }), [M[0], M[1], M[2]]);
  });

  it('todos los mapas del torneo, sin repetir', () => {
    assert.deepEqual(todosLosMapas({ ...torneo, map_pools: { final: [M[1], M[5]] } }).sort(), [M[0], M[1], M[2], M[5]].sort());
  });

  it('el draft de la final sale del pool de la final', () => {
    const equipo = (id, uid) => ({ id, captain_id: uid, member_ids: [uid] });
    const d = planDeDraft(
      { ...torneo, team_size: 1, civ_ids: [1, 2], first_map_id: null, map_repeat: 0, civ_bans: 0 },
      { id: 'f1', label: 'Final', team_a_id: 'A', team_b_id: 'B', games: [] },
      { a: equipo('A', 'a1'), b: equipo('B', 'b1') }
    );
    assert.deepEqual([...d.map_pool].sort(), [M[5], M[6]].sort());
    assert.ok([M[5], M[6]].includes(d.map_id));
  });
});

describe('limpiar para guardar', () => {
  it('saca claves desconocidas, fases vacías y repetidos', () => {
    assert.deepEqual(poolsLimpios({ final: [3, '3', 4], nada: [1], cuartos: [], grupos: 'x' }), { final: [3, 4] });
    assert.deepEqual(poolsLimpios(null), {});
  });
});

describe('falta de mapas', () => {
  it('un solo pool vacío falta; con mapas, no', () => {
    assert.ok(faltaDeMapas({ format: 'liga', map_ids: [] }));
    assert.equal(faltaDeMapas({ format: 'liga', map_ids: [M[0]] }), null);
  });

  it('por fase sin pool base: cada fase necesita los suyos', () => {
    const t = { format: 'eliminacion_simple', map_pool_mode: 'por_fase', map_ids: [], map_pools: { final: [M[0]] } };
    assert.match(faltaDeMapas(t), /Semifinal/);
    assert.equal(faltaDeMapas({ ...t, map_ids: [M[1]] }), null);
  });
});
