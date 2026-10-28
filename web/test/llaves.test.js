// Llaves sin base de datos (web/src/logica/llaves.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cargarPartidas, cerrarEnMemoria, cerrarPartido, cuadroDeClasificados, cuadroDePlayoffs, darWalkover, generarCuadro,
  ordenarManual, ordenSiembra, repartirEnGrupos, rondaSuiza, sembrarClasificados, tablaDesde,
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

describe('orden manual', () => {
  const grupal = torneo({ format: 'grupos_playoff', group_count: 2, group_advance: 2 });

  it('repartirEnGrupos: serpiente por siembra', () => {
    assert.deepEqual(repartirEnGrupos(equipos(6), 2), [['E1', 'E4', 'E5'], ['E2', 'E3', 'E6']]);
  });

  it('eliminación: la posición en la lista es la siembra', () => {
    const { teams, grupos } = ordenarManual(torneo(), equipos(4), { equipos: ['E3', 'E1', 'E4', 'E2'] });
    assert.equal(grupos, null);
    assert.deepEqual(teams.map((t) => t.id), ['E3', 'E1', 'E4', 'E2']);

    const c = generarCuadro(torneo(), teams, ids());
    const semi = (equipo) => c.partidos.find((p) => p.round === 1 && p.team_a_id === equipo);
    assert.equal(semi('E3').team_b_id, 'E2'); // 1.º contra el último
    assert.equal(semi('E1').team_b_id, 'E4');
    assert.deepEqual(c.seeds, [{ id: 'E3', seed: 1 }, { id: 'E1', seed: 2 }, { id: 'E4', seed: 3 }, { id: 'E2', seed: 4 }]);
  });

  it('la siembra anterior se pisa con el orden nuevo', () => {
    const viejos = equipos(2).map((e, i) => ({ ...e, seed: i + 1 }));
    const { teams } = ordenarManual(torneo(), viejos, { equipos: ['E2', 'E1'] });
    assert.deepEqual(generarCuadro(torneo(), teams, ids()).seeds, [{ id: 'E2', seed: 1 }, { id: 'E1', seed: 2 }]);
  });

  it('grupos: cada grupo lleva los equipos elegidos', () => {
    const orden = { grupos: [['E5', 'E1', 'E2'], ['E3', 'E4', 'E6']] };
    const { teams, grupos } = ordenarManual(grupal, equipos(6), orden);
    assert.deepEqual(grupos, orden.grupos);
    assert.deepEqual(teams.map((t) => t.id), ['E5', 'E1', 'E2', 'E3', 'E4', 'E6']);

    const c = generarCuadro(grupal, teams, ids(), { grupos });
    assert.deepEqual(c.etapas[0].groups.map((g) => [g.id, g.team_ids]), [['A', orden.grupos[0]], ['B', orden.grupos[1]]]);
    // Solo se juegan entre los del mismo grupo: 3 partidos por grupo.
    for (const g of c.etapas[0].groups) {
      const delGrupo = c.partidos.filter((p) => p.group_id === g.id);
      assert.equal(delGrupo.length, 3);
      assert.ok(delGrupo.every((p) => g.team_ids.includes(p.team_a_id) && g.team_ids.includes(p.team_b_id)));
    }
  });

  it('grupos de distinto tamaño', () => {
    const { teams, grupos } = ordenarManual(grupal, equipos(5), { grupos: [['E1', 'E2'], ['E3', 'E4', 'E5']] });
    const c = generarCuadro(grupal, teams, ids(), { grupos });
    assert.deepEqual(c.etapas[0].groups.map((g) => g.team_ids.length), [2, 3]);
    assert.equal(c.partidos.length, 1 + 3);
  });

  it('sin orden manual los grupos se reparten solos', () => {
    const c = generarCuadro(grupal, equipos(6), ids());
    assert.deepEqual(c.etapas[0].groups.map((g) => g.team_ids), repartirEnGrupos(equipos(6), 2));
  });

  it('valida que estén todos, una vez y en la cantidad de grupos', () => {
    const ok = [['E1', 'E2'], ['E3', 'E4']];
    assert.throws(() => ordenarManual(torneo(), equipos(4), { equipos: ['E1', 'E2', 'E3'] }), /Faltan equipos/);
    assert.throws(() => ordenarManual(torneo(), equipos(4), { equipos: ['E1', 'E1', 'E2', 'E3', 'E4'] }), /más de una vez/);
    assert.throws(() => ordenarManual(torneo(), equipos(4), { equipos: ['E1', 'E2', 'E3', 'E9'] }), /no es del torneo/);
    assert.throws(() => ordenarManual(torneo(), equipos(4), {}), /Falta el orden/);
    assert.throws(() => ordenarManual(grupal, equipos(4), { grupos: [ok[0]] }), /Hacen falta 2 grupos/);
    assert.throws(() => ordenarManual(grupal, equipos(5), { grupos: [['E1'], ['E2', 'E3', 'E4', 'E5']] }), /al menos dos equipos/);
    assert.throws(() => ordenarManual(grupal, equipos(5), { grupos: ok }), /Faltan equipos/);
    assert.doesNotThrow(() => ordenarManual(grupal, equipos(4), { grupos: ok }));
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

describe('partidas de una serie', () => {
  const partida = (game_no, winner_team_id, extra = {}) => ({ game_no, winner_team_id, map_id: 1, civs: [], ...extra });
  const semis = () => {
    const c = generarCuadro(torneo(), equipos(4), ids());
    const semi = c.partidos.find((p) => p.round === 1 && p.team_a_id === 'E1');
    const final = c.partidos.find((p) => p.label === 'Final');
    return { partidos: c.partidos, semi, final };
  };
  const aplicar = (partidos, cambios) => partidos.map((p) => ({ ...p, ...(cambios.find((c) => c.id === p.id) ?? {}) }));

  it('una partida suma al marcador y deja la serie en juego', () => {
    const { partidos, semi } = semis();
    const r = cargarPartidas(partidos, semi.id, [partida(1, 'E4')]);
    assert.deepEqual(r.cambios, [{ id: semi.id, score_b: 1, status: 'en_juego', games: [partida(1, 'E4')] }]);
  });

  it('al llegar a las necesarias cierra la serie y el ganador pasa a la final', () => {
    const { partidos, semi, final } = semis();
    const r = cargarPartidas(partidos, semi.id, [partida(2, 'E1'), partida(1, 'E1')]);
    assert.equal(r.partido.status, 'finalizado');
    assert.deepEqual([r.partido.score_a, r.partido.score_b, r.partido.winner_team_id], [2, 0, 'E1']);
    assert.deepEqual(r.partido.games.map((g) => g.game_no), [1, 2]);
    assert.equal(r.cambios.find((c) => c.id === final.id).team_a_id, 'E1');
  });

  it('corregir el ganador reabre, saca al equipo de la final y la vuelve a cerrar con el otro', () => {
    const { partidos, semi, final } = semis();
    const cerrada = aplicar(partidos, cargarPartidas(partidos, semi.id, [partida(1, 'E1'), partida(2, 'E1')]).cambios);
    const r = cargarPartidas(cerrada, semi.id, [partida(1, 'E4'), partida(2, 'E4')]);
    assert.equal(r.partido.winner_team_id, 'E4');
    assert.equal(r.cambios.find((c) => c.id === final.id).team_a_id, 'E4');

    const abierta = cargarPartidas(cerrada, semi.id, [partida(1, 'E1')]);
    assert.deepEqual([abierta.partido.status, abierta.partido.winner_team_id], ['en_juego', null]);
    assert.equal(abierta.cambios.find((c) => c.id === final.id).team_a_id, null);
  });

  it('no se reabre si el partido siguiente ya tiene resultado', () => {
    const { partidos, semi, final } = semis();
    let lista = aplicar(partidos, cargarPartidas(partidos, semi.id, [partida(1, 'E1'), partida(2, 'E1')]).cambios);
    const otra = lista.find((p) => p.round === 1 && p.id !== semi.id);
    lista = aplicar(lista, cargarPartidas(lista, otra.id, [partida(1, 'E2'), partida(2, 'E2')]).cambios);
    lista = aplicar(lista, cargarPartidas(lista, final.id, [partida(1, 'E1')]).cambios);
    assert.throws(() => cargarPartidas(lista, semi.id, [partida(1, 'E4'), partida(2, 'E4')]), /partido siguiente ya tiene resultado/);
  });

  it('valida equipos y largo de la serie', () => {
    const { partidos, semi, final } = semis();
    assert.throws(() => cargarPartidas(partidos, semi.id, [partida(1, 'E2')]), /no juega este partido/);
    assert.throws(() => cargarPartidas(partidos, semi.id, [1, 2, 3, 4].map((n) => partida(n, n % 2 ? 'E1' : 'E4'))), /mejor de 3/);
    assert.throws(() => cargarPartidas(partidos, final.id, [partida(1, 'E1')]), /Faltan equipos/);
  });

  it('cerrar la final termina el torneo', () => {
    const c = generarCuadro(torneo(), equipos(2), ids());
    assert.equal(cargarPartidas(c.partidos, c.partidos[0].id, [partida(1, 'E2'), partida(2, 'E2')]).terminado, true);
  });

  it('walkover: gana sin jugar con las necesarias', () => {
    const { partidos, semi, final } = semis();
    const r = darWalkover(partidos, semi.id, 'E4');
    assert.deepEqual([r.partido.status, r.partido.score_a, r.partido.score_b], ['walkover', 0, 2]);
    assert.equal(r.cambios.find((c) => c.id === final.id).team_a_id, 'E4');
    assert.throws(() => darWalkover(partidos, semi.id, 'E2'), /no juega/);
  });
});

describe('series a cantidad fija de partidas', () => {
  const partida = (game_no, winner_team_id) => ({ game_no, winner_team_id, map_id: 1, civs: [] });
  const semis = (n, extra = {}) => {
    const c = generarCuadro(torneo({ series_mode: 'fijas', best_of: n, ...extra }), equipos(4), ids());
    return {
      partidos: c.partidos,
      semi: c.partidos.find((p) => p.round === 1 && p.team_a_id === 'E1'),
      final: c.partidos.find((p) => p.label === 'Final'),
    };
  };
  const aplicar = (partidos, cambios) => partidos.map((p) => ({ ...p, ...(cambios.find((c) => c.id === p.id) ?? {}) }));
  const estado = (r) => [r.partido.status, r.partido.winner_team_id, r.partido.score_a, r.partido.score_b];

  it('los partidos heredan el modo y la cantidad; la final puede tener otra', () => {
    const c = generarCuadro(torneo({ series_mode: 'fijas', best_of: 3, best_of_final: 5 }), equipos(4), ids());
    assert.ok(c.partidos.every((p) => p.series_mode === 'fijas'));
    assert.equal(c.partidos.find((p) => p.label === 'Final').best_of, 5);
    assert.equal(c.partidos.find((p) => p.label === 'Semifinal').best_of, 3);
  });

  it('un torneo guardado sin modo genera series al mejor de', () => {
    const c = generarCuadro(torneo(), equipos(4), ids());
    assert.ok(c.partidos.every((p) => p.series_mode === 'mejor_de'));
  });

  it('con la mayoría no cierra: se juegan todas', () => {
    const { partidos, semi } = semis(3);
    const r = cargarPartidas(partidos, semi.id, [partida(1, 'E1'), partida(2, 'E1')]);
    assert.deepEqual(estado(r), ['en_juego', null, 2, 0]);
  });

  it('con la última partida cierra y el ganador pasa a la final', () => {
    const { partidos, semi, final } = semis(3);
    const r = cargarPartidas(partidos, semi.id, [partida(1, 'E1'), partida(2, 'E1'), partida(3, 'E4')]);
    assert.deepEqual(estado(r), ['finalizado', 'E1', 2, 1]);
    assert.equal(r.cambios.find((c) => c.id === final.id).team_a_id, 'E1');
  });

  it('a un número par, si empatan se juega una partida más; esa extra solo si empataron', () => {
    const { partidos, semi } = semis(2);
    const empatada = cargarPartidas(partidos, semi.id, [partida(1, 'E1'), partida(2, 'E4')]);
    assert.deepEqual(estado(empatada), ['en_juego', null, 1, 1]);

    const lista = aplicar(partidos, empatada.cambios);
    const r = cargarPartidas(lista, semi.id, [partida(1, 'E1'), partida(2, 'E4'), partida(3, 'E4')]);
    assert.deepEqual(estado(r), ['finalizado', 'E4', 1, 2]);

    assert.throws(
      () => cargarPartidas(partidos, semi.id, [partida(1, 'E1'), partida(2, 'E1'), partida(3, 'E4')]),
      /solo se juega si empatan/
    );
  });

  it('no admite más partidas que las de la serie', () => {
    const { partidos, semi } = semis(3);
    assert.throws(
      () => cargarPartidas(partidos, semi.id, [1, 2, 3, 4].map((n) => partida(n, n % 2 ? 'E1' : 'E4'))),
      /a 3 partidas/
    );
  });

  it('walkover: gana con todas las partidas', () => {
    const { partidos, semi, final } = semis(3);
    const r = darWalkover(partidos, semi.id, 'E4');
    assert.deepEqual([r.partido.status, r.partido.score_a, r.partido.score_b], ['walkover', 0, 3]);
    assert.equal(r.cambios.find((c) => c.id === final.id).team_a_id, 'E4');
  });

  it('borrar la última partida de una serie cerrada la reabre y saca al equipo de la final', () => {
    const { partidos, semi, final } = semis(3);
    const cerrada = aplicar(partidos, cargarPartidas(partidos, semi.id, [partida(1, 'E1'), partida(2, 'E1'), partida(3, 'E4')]).cambios);
    const abierta = cargarPartidas(cerrada, semi.id, [partida(1, 'E1'), partida(2, 'E1')]);
    assert.deepEqual(estado(abierta), ['en_juego', null, 2, 0]);
    assert.equal(abierta.cambios.find((c) => c.id === final.id).team_a_id, null);
  });
});

describe('playoffs de grupos: los clasificados se reparten por el cuadro', () => {
  /** Clasificados de `grupos` grupos con `porGrupo` cada uno: "1A", "1B"... primero, después "2A", "2B"... */
  const clasificados = (grupos, porGrupo) => {
    const letras = Array.from({ length: grupos }, (_, i) => String.fromCharCode(65 + i));
    const lista = [];
    for (let pos = 1; pos <= porGrupo; pos++) for (const g of letras) lista.push({ id: `${pos}${g}`, _pos: pos, _grupo: g });
    return lista;
  };
  const playoffs = (lista) => cuadroDeClasificados(torneo(), lista, ids());
  const cruces = (partidos) =>
    partidos.filter((p) => p.round === 1).sort((x, y) => x.position - y.position).map((p) => [p.team_a_id, p.team_b_id]);

  /** Ronda en la que pueden encontrarse dos equipos: la del primer partido que comparten camino a la final. */
  function rondaDeEncuentro(partidos, a, b) {
    const porId = new Map(partidos.map((p) => [p.id, p]));
    const camino = (equipo) => {
      let p = partidos.find((m) => m.round === 1 && (m.team_a_id === equipo || m.team_b_id === equipo));
      const recorrido = [];
      while (p) {
        recorrido.push(p.id);
        p = p.next_match_id ? porId.get(p.next_match_id) : null;
      }
      return recorrido;
    };
    const deB = camino(b);
    return porId.get(camino(a).find((id) => deB.includes(id))).round;
  }
  const rondaFinal = (partidos) => Math.max(...partidos.map((p) => p.round));

  it('4 grupos de 2: los primeros juegan contra segundos de otro grupo y los del mismo grupo van a mitades opuestas', () => {
    const { partidos } = playoffs(clasificados(4, 2));
    assert.deepEqual(cruces(partidos), [['1A', '2B'], ['1D', '2C'], ['1B', '2A'], ['1C', '2D']]);
    for (const g of 'ABCD') assert.equal(rondaDeEncuentro(partidos, `1${g}`, `2${g}`), rondaFinal(partidos), g);
  });

  it('de 2 a 9 grupos de 2, también con byes: los del mismo grupo solo se cruzan en la final', () => {
    for (let grupos = 2; grupos <= 9; grupos++) {
      const { partidos } = playoffs(clasificados(grupos, 2));
      const final = rondaFinal(partidos);
      for (let i = 0; i < grupos; i++) {
        const g = String.fromCharCode(65 + i);
        assert.equal(rondaDeEncuentro(partidos, `1${g}`, `2${g}`), final, `${grupos} grupos, grupo ${g}`);
      }
    }
  });

  it('con tres o cuatro por grupo, nadie se cruza con alguien de su grupo en la primera ronda', () => {
    for (const [grupos, porGrupo] of [[2, 4], [3, 3], [4, 3], [4, 4], [6, 3]]) {
      const { partidos } = playoffs(clasificados(grupos, porGrupo));
      for (const [a, b] of cruces(partidos)) {
        if (a && b) assert.notEqual(a.slice(1), b.slice(1), `${grupos} grupos de ${porGrupo}: ${a} contra ${b}`);
      }
    }
  });

  it('los primeros de grupo conservan las mejores siembras y la lista es una permutación de la que entra', () => {
    const lista = clasificados(4, 2);
    const sembrados = sembrarClasificados(lista);
    assert.deepEqual([...sembrados].map((t) => t.id).sort(), lista.map((t) => t.id).sort());
    assert.deepEqual(sembrados.slice(0, 4).map((t) => t._pos), [1, 1, 1, 1]);
    assert.deepEqual(sembrados.slice(4).map((t) => t._pos), [2, 2, 2, 2]);
    assert.deepEqual(playoffs(lista).seeds.map((s) => s.id), sembrados.map((t) => t.id));
  });

  it('con grupos que clasifican distinta cantidad no se rompe ni repite a nadie', () => {
    const lista = [
      { id: '1A', _pos: 1, _grupo: 'A' }, { id: '1B', _pos: 1, _grupo: 'B' }, { id: '1C', _pos: 1, _grupo: 'C' },
      { id: '2A', _pos: 2, _grupo: 'A' }, { id: '2C', _pos: 2, _grupo: 'C' },
    ];
    const { partidos, seeds } = playoffs(lista);
    assert.equal(new Set(seeds.map((s) => s.id)).size, 5);
    for (const [a, b] of cruces(partidos)) if (a && b) assert.notEqual(a.slice(1), b.slice(1));
  });

  it('lo que no trae grupo y puesto queda como vino', () => {
    const lista = [{ id: 'x' }, { id: 'y' }, { id: 'z' }, { id: 'w' }];
    assert.deepEqual(sembrarClasificados(lista), lista);
    assert.deepEqual(sembrarClasificados(clasificados(1, 2)), clasificados(1, 2));
  });

  it('es estable: la misma entrada da siempre el mismo cuadro', () => {
    const lista = clasificados(6, 2);
    assert.deepEqual(sembrarClasificados(lista).map((t) => t.id), sembrarClasificados(lista).map((t) => t.id));
  });

  it('con los grupos jugados, los playoffs de verdad también separan a los del mismo grupo', () => {
    const t = torneo({ format: 'grupos_playoff', group_count: 4, group_advance: 2 });
    const c = generarCuadro(t, equipos(16), ids());
    const jugados = [...jugarTodo(c.partidos).values()];
    const p = cuadroDePlayoffs(t, c.etapas, equipos(16), jugados, ids());
    const grupoDe = new Map(c.etapas[0].groups.flatMap((g) => g.team_ids.map((id) => [id, g.id])));
    const ids8 = p.seeds.map((s) => s.id);
    assert.equal(ids8.length, 8);
    for (const a of ids8) {
      for (const b of ids8) {
        if (a < b && grupoDe.get(a) === grupoDe.get(b)) assert.equal(rondaDeEncuentro(p.partidos, a, b), rondaFinal(p.partidos), `${a} y ${b}`);
      }
    }
  });
});
