// Llaves sin base de datos (web/src/logica/llaves.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cerrarEnMemoria, cerrarPartido, cuadroDePlayoffs, generarCuadro, ordenSiembra, rondaSuiza, tablaDesde,
} from '../src/logica/llaves.js';

const equipos = (n) => Array.from({ length: n }, (_, i) => ({ id: `E${i + 1}`, name: `E${i + 1}`, seed: null }));

/** Ids repetibles: p1, p2... para partidos y s1, s2... para etapas. */
function ids() {
  let k = 0;
  return { nuevoId: () => `p${++k}`, nuevoIdEtapa: () => `s${++k}` };
}

const torneo = (extra = {}) => ({ id: 't', format: 'eliminacion_simple', best_of: 3, ...extra });

/** Gana el de número más bajo: E1 le gana a todos. */
function resultado(m) {
  const numero = (id) => Number(id.slice(1));
  const ganaA = numero(m.team_a_id) < numero(m.team_b_id);
  return { ganador: ganaA ? m.team_a_id : m.team_b_id, a: ganaA ? 2 : 1, b: ganaA ? 1 : 2 };
}

const clave = (p) => `${p.bracket}${p.round}.${String(p.position).padStart(2, '0')}`;

/** Juega en memoria, en orden de llave, todo lo que se pueda jugar. */
function jugarTodo(partidos) {
  const mapa = new Map(partidos.map((p) => [p.id, { ...p }]));
  for (let i = 0; i < 300; i++) {
    const p = [...mapa.values()].sort((x, y) => (clave(x) < clave(y) ? -1 : 1))
      .find((m) => m.status === 'pendiente' && m.team_a_id && m.team_b_id);
    if (!p) break;
    const r = resultado(p);
    cerrarEnMemoria(mapa, p.id, r.ganador, r.a, r.b);
  }
  return mapa;
}

describe('cuadros', () => {
  it('siembra clásica', () => {
    assert.deepEqual(ordenSiembra(8), [1, 8, 4, 5, 2, 7, 3, 6]);
    assert.deepEqual(ordenSiembra(4), [1, 4, 2, 3]);
  });

  it('eliminación simple de 8: 7 partidos enlazados y final al mejor de la final', () => {
    const c = generarCuadro(torneo({ best_of_final: 5 }), equipos(8), ids());
    assert.equal(c.partidos.length, 7);
    assert.equal(c.etapas.length, 1);
    const final = c.partidos.find((p) => p.label === 'Final');
    assert.equal(final.best_of, 5);
    assert.equal(c.partidos.filter((p) => p.next_match_id === final.id).length, 2);
    const r1 = c.partidos.filter((p) => p.round === 1).sort((a, b) => a.position - b.position);
    assert.deepEqual(r1.map((p) => [p.team_a_id, p.team_b_id]), [['E1', 'E8'], ['E4', 'E5'], ['E2', 'E7'], ['E3', 'E6']]);
    assert.equal(c.seeds.length, 8);
  });

  it('eliminación simple de 6: los dos primeros pasan por bye', () => {
    const c = generarCuadro(torneo(), equipos(6), ids());
    const byes = c.partidos.filter((p) => p.status === 'walkover');
    assert.deepEqual(byes.map((p) => p.winner_team_id).sort(), ['E1', 'E2']);
    const semis = c.partidos.filter((p) => p.label === 'Semifinal');
    assert.deepEqual(semis.map((p) => p.team_a_id).sort(), ['E1', 'E2']);
  });

  it('tercer puesto con los perdedores de semis', () => {
    const c = generarCuadro(torneo({ third_place: 1 }), equipos(4), ids());
    const tercero = c.partidos.find((p) => p.label === 'Tercer puesto');
    assert.ok(tercero);
    assert.equal(c.partidos.filter((p) => p.loser_match_id === tercero.id).length, 2);
    const fin = jugarTodo(c.partidos);
    assert.equal(fin.get(tercero.id).winner_team_id, 'E3');
  });

  it('eliminación doble de 8: 7 de ganadores, 6 de perdedores y gran final', () => {
    const c = generarCuadro(torneo({ format: 'eliminacion_doble' }), equipos(8), ids());
    const por = (b) => c.partidos.filter((p) => p.bracket === b).length;
    assert.deepEqual([por('W'), por('L'), por('F')], [7, 6, 1]);
  });

  for (const cuantos of [3, 5, 6, 7, 9, 12]) {
    it(`eliminación doble de ${cuantos} con byes termina: E1 invicto, el resto con dos derrotas`, () => {
      const c = generarCuadro(torneo({ format: 'eliminacion_doble' }), equipos(cuantos), ids());
      const mapa = jugarTodo(c.partidos);
      assert.deepEqual([...mapa.values()].filter((m) => m.status === 'pendiente').map(clave), []);
      assert.equal([...mapa.values()].find((m) => m.bracket === 'F').winner_team_id, 'E1');

      const derrotas = new Map(equipos(cuantos).map((t) => [t.id, 0]));
      for (const m of mapa.values()) {
        if (m.status !== 'finalizado') continue;
        const perdedor = m.winner_team_id === m.team_a_id ? m.team_b_id : m.team_a_id;
        derrotas.set(perdedor, derrotas.get(perdedor) + 1);
      }
      assert.equal(derrotas.get('E1'), 0);
      for (const id of [...derrotas.keys()].slice(1)) assert.equal(derrotas.get(id), 2, id);
    });
  }

  it('liga de 5: todos contra todos una vez', () => {
    const c = generarCuadro(torneo({ format: 'liga' }), equipos(5), ids());
    assert.equal(c.partidos.length, 10);
    const cruces = new Set(c.partidos.map((p) => [p.team_a_id, p.team_b_id].sort().join('-')));
    assert.equal(cruces.size, 10);
  });

  it('formato desconocido', () => {
    assert.throws(() => generarCuadro(torneo({ format: 'raro' }), equipos(4), ids()), /Formato desconocido/);
  });
});

describe('resultados', () => {
  it('cerrarPartido devuelve solo lo que cambió y no toca la lista', () => {
    const c = generarCuadro(torneo(), equipos(4), ids());
    const semi = c.partidos.find((p) => p.round === 1 && p.team_a_id === 'E1');
    const copia = structuredClone(c.partidos);
    const { cambios, partido, terminado } = cerrarPartido(c.partidos, semi.id, 'E1', 2, 0);

    assert.deepEqual(c.partidos, copia);
    assert.equal(partido.status, 'finalizado');
    assert.equal(terminado, false);
    const final = c.partidos.find((p) => p.label === 'Final');
    assert.deepEqual(cambios, [
      { id: semi.id, winner_team_id: 'E1', score_a: 2, status: 'finalizado' },
      { id: final.id, team_a_id: 'E1' },
    ]);
  });

  it('cerrar el último partido termina el torneo', () => {
    const c = generarCuadro(torneo(), equipos(2), ids());
    assert.equal(cerrarPartido(c.partidos, c.partidos[0].id, 'E2', 1, 2).terminado, true);
  });

  it('tabla: 3 puntos por ganado, desempata por diferencia y por tantos a favor', () => {
    const t = equipos(3);
    const m = (a, b, sa, sb) => ({ team_a_id: a, team_b_id: b, score_a: sa, score_b: sb, winner_team_id: sa > sb ? a : b });
    const tabla = tablaDesde(t, [m('E1', 'E2', 2, 1), m('E2', 'E3', 2, 0), m('E3', 'E1', 2, 0)]);
    assert.deepEqual(tabla.map((f) => [f.team.id, f.pts]), [['E2', 3], ['E3', 3], ['E1', 3]]);
  });
});

describe('playoffs y suizo', () => {
  it('grupos de 7 en 2: playoffs con los dos primeros de cada grupo', () => {
    const t = torneo({ format: 'grupos_playoff', group_count: 2, group_advance: 2 });
    const c = generarCuadro(t, equipos(7), ids());
    const etapa = c.etapas[0];
    assert.deepEqual(etapa.groups.map((g) => g.team_ids.length), [3, 4]);
    assert.throws(() => cuadroDePlayoffs(t, [{ ...etapa, type: 'liga' }], equipos(7), [], ids()), /no tiene fase de grupos/);

    const jugados = [...jugarTodo(c.partidos).values()];
    const p = cuadroDePlayoffs(t, c.etapas, equipos(7), jugados, ids());
    assert.equal(p.partidos.length, 3);
    assert.deepEqual(p.seeds.map((s) => s.id), ['E1', 'E2', 'E4', 'E3']); // primeros de grupo, después segundos
    assert.throws(() => cuadroDePlayoffs(t, [...c.etapas, ...p.etapas], equipos(7), jugados, ids()), /ya estaban generados/);
  });

  it('suizo de 6 con 3 rondas, sin revanchas', () => {
    const t = torneo({ format: 'suizo', swiss_rounds: 3 });
    const c = generarCuadro(t, equipos(6), ids());
    let partidos = c.partidos;
    assert.throws(() => rondaSuiza(t, c.etapas, equipos(6), partidos, ids()), /Faltan partidos/);

    for (let ronda = 2; ronda <= 3; ronda++) {
      partidos = [...jugarTodo(partidos).values()];
      const r = rondaSuiza(t, c.etapas, equipos(6), partidos, ids());
      assert.equal(r.ronda, ronda);
      assert.equal(r.partidos.length, 3);
      assert.equal(r.bye, null);
      partidos = [...partidos, ...r.partidos];
    }
    const cruces = partidos.map((p) => [p.team_a_id, p.team_b_id].sort().join('-'));
    assert.equal(new Set(cruces).size, cruces.length);

    partidos = [...jugarTodo(partidos).values()];
    assert.throws(() => rondaSuiza(t, c.etapas, equipos(6), partidos, ids()), /completó todas sus rondas/);
  });

  it('suizo impar: uno queda libre', () => {
    const t = torneo({ format: 'suizo' });
    const c = generarCuadro(t, equipos(5), ids());
    const r = rondaSuiza(t, c.etapas, equipos(5), [...jugarTodo(c.partidos).values()], ids());
    assert.equal(r.partidos.length, 2);
    assert.ok(r.bye);
  });
});
