// Simulación de torneos de punta a punta, sin base de datos: para cada formato y
// cantidad de equipos arma las llaves, juega cada serie partida por partida con
// su draft (mapa, bans y picks), cierra con la misma lógica que usa el staff
// (cargarPartidas) y revisa que el torneo termine bien.
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { civs, maps } from '../src/logica/catalogo.js';
import { banear, civsPermitidas, elegirMapa, planDeDraft, revelar, turnoDeBan } from '../src/logica/draft.js';
import {
  cargarPartidas, cuadroDePlayoffs, darWalkover, generarCuadro, rondaSuiza, tablaDesde, terminado, torneoTerminado,
} from '../src/logica/llaves.js';
import { estadoDeSerie, partidasMaximas } from '../src/logica/series.js';

function rngSemilla(semilla) {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const alAzar = (lista, rnd) => lista[Math.floor(rnd() * lista.length)];

function idsNuevos() {
  let k = 0;
  return { nuevoId: () => `p${++k}`, nuevoIdEtapa: () => `s${++k}` };
}

/** Equipos de `tamanio` jugadores; sus jugadores se llaman `E3-j2`. */
function armarEquipos(n, tamanio) {
  return Array.from({ length: n }, (_, i) => {
    const members = Array.from({ length: tamanio }, (_, j) => ({ user_id: `E${i + 1}-j${j + 1}`, role: j === 0 ? 'capitan' : 'jugador' }));
    return {
      id: `E${i + 1}`, name: `Equipo ${i + 1}`, seed: null, captain_id: members[0].user_id,
      members, member_ids: members.map((m) => m.user_id),
    };
  });
}

function torneoBase(extra = {}) {
  return {
    id: 'sim', format: 'eliminacion_simple', team_size: 2, best_of: 3, best_of_final: null, series_mode: 'mejor_de',
    third_place: 0, group_count: 2, group_advance: 2, swiss_rounds: 3,
    map_ids: maps().slice(0, 12).map((m) => m.id), first_map_id: null, map_repeat: 0,
    civ_ids: civs().map((c) => c.id), civ_bans: 1, civ_repeat_series: 0, civ_repeat_team: 1,
    ...extra,
  };
}

/** Juega el draft de una partida como lo hace la web y devuelve lo que va a `games[]`. */
function jugarDraft(torneo, partido, equipos, gameNo, rnd) {
  const porId = new Map(equipos.map((e) => [e.id, e]));
  let d = planDeDraft(torneo, partido, { a: porId.get(partido.team_a_id), b: porId.get(partido.team_b_id) }, gameNo);
  if (d.state === 'mapa') d = elegirMapa(d, d.map_chooser_team_id, alAzar(d.map_pool, rnd));
  while (d.state === 'bans') {
    d = banear(d, turnoDeBan(d), alAzar(d.civ_pool.filter((c) => !d.banned_civ_ids.includes(c)), rnd));
  }
  const picks = {};
  for (const uid of d.player_ids) {
    const permitidas = civsPermitidas(d, uid, picks);
    assert.ok(permitidas.length > 0, `${partido.id}: ${uid} se quedó sin civs posibles en la partida ${gameNo}`);
    picks[uid] = alAzar(permitidas, rnd);
  }
  const { draft, civs: elegidas } = revelar(d, picks);
  assert.ok(draft.revealed);
  return { map_id: draft.map_id, civs: elegidas, banned: draft.banned_civ_ids };
}

function aplicar(partidos, cambios) {
  const porId = new Map(cambios.map(({ id, ...campos }) => [id, campos]));
  return partidos.map((p) => (porId.has(p.id) ? { ...p, ...porId.get(p.id) } : p));
}

/** Juega una serie completa (con drafts) y devuelve el nuevo estado de todos los partidos. */
function jugarSerie(torneo, partidos, equipos, matchId, rnd, { sesgo = 0.5 } = {}) {
  let actual = partidos;
  let m = actual.find((p) => p.id === matchId);
  let games = [];
  for (let g = 1; g <= partidasMaximas(m); g++) {
    if (terminado(m)) break;
    const delDraft = jugarDraft(torneo, { ...m, games }, equipos, g, rnd);
    const gana = rnd() < sesgo ? m.team_a_id : m.team_b_id;
    games = [...games, { game_no: g, winner_team_id: gana, replay_url: null, notes: null, map_id: delDraft.map_id, civs: delDraft.civs }];
    // Cada partida se carga en cuanto termina, como en la web.
    actual = aplicar(actual, cargarPartidas(actual, matchId, games).cambios);
    m = actual.find((p) => p.id === matchId);
  }
  assert.ok(terminado(m), `${matchId}: la serie no se cerró (BO${m.best_of} ${m.series_mode}, ${m.score_a}-${m.score_b})`);
  return actual;
}

const jugable = (m) => !terminado(m) && m.team_a_id && m.team_b_id;

/** Juega todo lo jugable (en orden de llave) hasta que no quede nada. */
function jugarTodo(torneo, partidos, equipos, rnd, { walkovers = 0.05 } = {}) {
  let actual = partidos;
  const orden = (p) => `${p.bracket === 'F' ? 'Z' : p.bracket}${String(p.round).padStart(3, '0')}${String(p.position).padStart(3, '0')}`;
  for (let vuelta = 0; vuelta < 2000; vuelta++) {
    const siguiente = actual.filter(jugable).sort((x, y) => (orden(x) < orden(y) ? -1 : 1))[0];
    if (!siguiente) return actual;
    if (rnd() < walkovers) {
      const ganador = rnd() < 0.5 ? siguiente.team_a_id : siguiente.team_b_id;
      actual = aplicar(actual, darWalkover(actual, siguiente.id, ganador).cambios);
    } else {
      actual = jugarSerie(torneo, actual, equipos, siguiente.id, rnd, { sesgo: 0.3 + rnd() * 0.4 });
    }
  }
  throw new Error('La simulación no terminó: demasiadas vueltas.');
}

/** Revisiones que valen para cualquier formato una vez terminado. */
function revisarCoherencia(partidos, equipos) {
  const ids = new Set(equipos.map((e) => e.id));
  for (const m of partidos) {
    assert.ok(terminado(m), `${m.id} (${m.label}) quedó sin cerrar: ${m.status}, ${m.team_a_id} vs ${m.team_b_id}`);
    if (m.team_a_id && m.team_b_id) {
      assert.ok(ids.has(m.team_a_id) && ids.has(m.team_b_id), `${m.id}: equipo inexistente`);
      assert.notEqual(m.team_a_id, m.team_b_id, `${m.id}: un equipo juega contra sí mismo`);
      assert.ok([m.team_a_id, m.team_b_id].includes(m.winner_team_id), `${m.id}: el ganador no juega el partido`);
      const ganaA = m.winner_team_id === m.team_a_id;
      assert.ok((ganaA ? m.score_a : m.score_b) > (ganaA ? m.score_b : m.score_a), `${m.id}: el ganador no tiene más victorias (${m.score_a}-${m.score_b})`);
      if (m.status === 'finalizado') {
        const ganadas = (t) => m.games.filter((g) => g.winner_team_id === t).length;
        assert.equal(ganadas(m.team_a_id), m.score_a, `${m.id}: score_a no coincide con games`);
        assert.equal(ganadas(m.team_b_id), m.score_b, `${m.id}: score_b no coincide con games`);
      }
    }
  }
  // Ningún equipo juega dos partidos de la misma ronda y llave.
  const vistos = new Set();
  for (const m of partidos) {
    if (m.group_id != null) continue;
    for (const t of [m.team_a_id, m.team_b_id].filter(Boolean)) {
      const k = `${m.stage_id}|${m.bracket}|${m.round}|${t}|${m.label === 'Tercer puesto' ? 'tp' : ''}`;
      assert.ok(!vistos.has(k), `${t} juega dos veces en ${m.bracket}${m.round} (${m.label})`);
      vistos.add(k);
    }
  }
}

/** Revisa que las civs y mapas de las partidas respeten las reglas del torneo. */
function revisarDrafts(torneo, partidos) {
  for (const m of partidos) {
    if (m.status !== 'finalizado') continue;
    const mapas = m.games.map((g) => g.map_id);
    if (!torneo.map_repeat) assert.equal(new Set(mapas).size, mapas.length, `${m.id}: mapa repetido en la serie ${mapas}`);
    if (torneo.civ_repeat_series === 0) {
      const porJugador = new Map();
      for (const g of m.games) {
        for (const c of g.civs) {
          const antes = porJugador.get(c.user_id) ?? [];
          assert.ok(!antes.includes(c.civ_id), `${m.id}: ${c.user_id} repitió la civ ${c.civ_id}`);
          porJugador.set(c.user_id, [...antes, c.civ_id]);
        }
      }
    }
    for (const g of m.games) assert.equal(g.civs.length, torneo.team_size * 2, `${m.id}#${g.game_no}: faltan picks`);
  }
}

function campeonDe(partidos, etapaId) {
  const final = partidos.filter((m) => m.stage_id === etapaId && (m.bracket === 'F' || m.label === 'Final'));
  assert.equal(final.length, 1, 'tiene que haber una sola final');
  return final[0].winner_team_id;
}

// ---------------------------------------------------------------------------

const TAMANOS = [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 15, 16, 17, 24, 31, 32, 33];

describe('simulación: eliminación simple', () => {
  for (const n of TAMANOS) {
    for (const extra of [{}, { third_place: 1, best_of_final: 5 }]) {
      it(`${n} equipos ${extra.third_place ? 'con tercer puesto' : ''}`, () => {
        const rnd = rngSemilla(n * 7 + (extra.third_place ? 1 : 0));
        const torneo = torneoBase({ format: 'eliminacion_simple', ...extra });
        const equipos = armarEquipos(n, torneo.team_size);
        const cuadro = generarCuadro(torneo, equipos, idsNuevos());
        const final = jugarTodo(torneo, cuadro.partidos, equipos, rnd);
        revisarCoherencia(final, equipos);
        revisarDrafts(torneo, final);
        const campeon = campeonDe(final, cuadro.etapas[0].id);
        assert.ok(campeon, 'sin campeón');
        const reales = final.filter((m) => m.team_a_id && m.team_b_id && m.label !== 'Tercer puesto');
        assert.equal(reales.length, n - 1, 'cantidad de partidos con dos equipos');
        for (const m of reales) if ([m.team_a_id, m.team_b_id].includes(campeon)) assert.equal(m.winner_team_id, campeon);
        if (extra.third_place && n >= 4) {
          const tp = final.find((m) => m.label === 'Tercer puesto');
          assert.ok(tp?.winner_team_id, 'sin tercer puesto');
        }
      });
    }
  }
});

describe('simulación: eliminación doble', () => {
  it('con dos equipos avisa en vez de romper', () => {
    assert.throws(() => generarCuadro(torneoBase({ format: 'eliminacion_doble' }), armarEquipos(2, 2), idsNuevos()), /al menos tres equipos/);
  });

  for (const n of [3, 4, 5, 6, 7, 8, 9, 12, 16, 17, 20, 32]) {
    it(`${n} equipos`, () => {
      const rnd = rngSemilla(n * 13);
      const torneo = torneoBase({ format: 'eliminacion_doble', best_of_final: 5 });
      const equipos = armarEquipos(n, torneo.team_size);
      const cuadro = generarCuadro(torneo, equipos, idsNuevos());
      const final = jugarTodo(torneo, cuadro.partidos, equipos, rnd, { walkovers: 0.03 });
      revisarCoherencia(final, equipos);
      revisarDrafts(torneo, final);
      const gf = final.find((m) => m.bracket === 'F');
      assert.ok(gf.winner_team_id, 'sin campeón');
      const derrotas = new Map(equipos.map((e) => [e.id, 0]));
      for (const m of final) {
        if (!m.team_a_id || !m.team_b_id) continue;
        const perdedor = m.winner_team_id === m.team_a_id ? m.team_b_id : m.team_a_id;
        derrotas.set(perdedor, derrotas.get(perdedor) + 1);
      }
      for (const [id, d] of derrotas) assert.ok(d <= 2, `${id} perdió ${d} veces`);
    });
  }
});

describe('simulación: liga', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 10]) {
    it(`${n} equipos, todos contra todos`, () => {
      const rnd = rngSemilla(n * 3);
      const torneo = torneoBase({ format: 'liga', team_size: 1 });
      const equipos = armarEquipos(n, 1);
      const cuadro = generarCuadro(torneo, equipos, idsNuevos());
      assert.equal(cuadro.partidos.length, (n * (n - 1)) / 2);
      const final = jugarTodo(torneo, cuadro.partidos, equipos, rnd, { walkovers: 0 });
      for (const m of final) assert.ok(terminado(m));
      const pares = new Set(final.map((m) => [m.team_a_id, m.team_b_id].sort().join('|')));
      assert.equal(pares.size, final.length, 'hay un cruce repetido');
      const tabla = tablaDesde(equipos, final);
      assert.equal(tabla.reduce((s, f) => s + f.pj, 0), n * (n - 1));
      assert.equal(tabla.reduce((s, f) => s + f.pts, 0), 3 * final.length);
      for (const f of tabla) assert.equal(f.pj, n - 1);
    });
  }
});

describe('simulación: grupos + playoff', () => {
  for (const [n, grupos, pasan] of [[4, 2, 2], [6, 2, 2], [8, 2, 2], [8, 2, 1], [9, 3, 2], [12, 4, 2], [12, 3, 2], [16, 4, 2], [10, 2, 3], [7, 2, 2]]) {
    it(`${n} equipos en ${grupos} grupos, pasan ${pasan}`, () => {
      const rnd = rngSemilla(n * 31 + grupos);
      const torneo = torneoBase({ format: 'grupos_playoff', group_count: grupos, group_advance: pasan, third_place: 1 });
      const equipos = armarEquipos(n, torneo.team_size);
      const ids = idsNuevos();
      const cuadro = generarCuadro(torneo, equipos, ids);
      const enGrupos = cuadro.etapas[0].groups.flatMap((g) => g.team_ids);
      assert.equal(new Set(enGrupos).size, n);

      let partidos = jugarTodo(torneo, cuadro.partidos, equipos, rnd, { walkovers: 0.05 });
      assert.equal(torneoTerminado(torneo, partidos), false, 'con solo los grupos jugados el torneo no terminó');
      const playoffs = cuadroDePlayoffs(torneo, cuadro.etapas, equipos, partidos, ids);
      const clasificados = new Set(playoffs.partidos.flatMap((m) => [m.team_a_id, m.team_b_id]).filter(Boolean));
      assert.equal(clasificados.size, cuadro.etapas[0].groups.reduce((s, g) => s + Math.min(pasan, g.team_ids.length), 0), 'cantidad de clasificados');
      for (const g of cuadro.etapas[0].groups) {
        const tabla = tablaDesde(g.team_ids.map((id) => equipos.find((e) => e.id === id)), partidos.filter((m) => m.group_id === g.id));
        for (const fila of tabla.slice(0, pasan)) assert.ok(clasificados.has(fila.team.id), `${fila.team.id} debía clasificar`);
        for (const fila of tabla.slice(pasan)) assert.ok(!clasificados.has(fila.team.id), `${fila.team.id} no debía clasificar`);
      }
      partidos = jugarTodo(torneo, [...partidos, ...playoffs.partidos], equipos, rnd, { walkovers: 0.05 });
      revisarCoherencia(partidos, equipos);
      revisarDrafts(torneo, partidos);
      assert.equal(torneoTerminado(torneo, partidos), true);
      assert.ok(campeonDe(partidos, playoffs.etapas[0].id), 'sin campeón');
    });
  }
});

describe('simulación: suizo', () => {
  for (const [n, rondas] of [[4, 2], [6, 3], [7, 3], [8, 3], [9, 4], [16, 4]]) {
    it(`${n} equipos, ${rondas} rondas`, () => {
      const rnd = rngSemilla(n * 17 + rondas);
      const torneo = torneoBase({ format: 'suizo', swiss_rounds: rondas });
      const equipos = armarEquipos(n, torneo.team_size);
      const ids = idsNuevos();
      const cuadro = generarCuadro(torneo, equipos, ids);
      let partidos = cuadro.partidos;
      for (let r = 1; r <= rondas; r++) {
        partidos = jugarTodo(torneo, partidos, equipos, rnd, { walkovers: 0.05 });
        assert.equal(torneoTerminado(torneo, partidos), r === rondas, `ronda ${r} de ${rondas}`);
        if (r === rondas) break;
        const sig = rondaSuiza(torneo, cuadro.etapas, equipos, partidos, ids);
        assert.equal(sig.ronda, r + 1);
        partidos = [...partidos, ...sig.partidos];
      }
      for (const m of partidos) assert.ok(terminado(m), `${m.id} sin cerrar`);
      assert.throws(() => rondaSuiza(torneo, cuadro.etapas, equipos, partidos, ids), /ya completó/);
      for (let r = 1; r <= rondas; r++) {
        const jugadores = partidos.filter((m) => m.round === r).flatMap((m) => [m.team_a_id, m.team_b_id]);
        assert.equal(new Set(jugadores).size, jugadores.length, `ronda ${r}: un equipo juega dos veces`);
        assert.equal(jugadores.length, n - (n % 2), `ronda ${r}: jugaron ${jugadores.length} de ${n}`);
      }
      const cruces = partidos.map((m) => [m.team_a_id, m.team_b_id].sort().join('|'));
      if (rondas < n) assert.equal(new Set(cruces).size, cruces.length, `revancha en el suizo: ${cruces}`);
    });
  }
});

describe('simulación: tipos de serie', () => {
  for (const [mejor, serie] of [[1, 'mejor_de'], [5, 'mejor_de'], [7, 'mejor_de'], [2, 'fijas'], [3, 'fijas'], [4, 'fijas']]) {
    it(`eliminación simple de 8, ${serie} ${mejor}`, () => {
      const rnd = rngSemilla(mejor * 101);
      const torneo = torneoBase({ best_of: mejor, series_mode: serie, civ_repeat_series: 1, map_repeat: 1 });
      const equipos = armarEquipos(8, torneo.team_size);
      const cuadro = generarCuadro(torneo, equipos, idsNuevos());
      const final = jugarTodo(torneo, cuadro.partidos, equipos, rnd, { walkovers: 0 });
      revisarCoherencia(final, equipos);
      assert.ok(campeonDe(final, cuadro.etapas[0].id));
    });
  }
});
