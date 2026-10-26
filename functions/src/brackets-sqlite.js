// Llaves sobre SQLite: las usan las rutas que siguen en SQLite (playoffs,
// suizo y partidos) hasta T19 y T23. Se borra en T33.
//
// Generación de llaves y avance de resultados.
//
// Formatos: eliminación simple, eliminación doble, liga (todos contra todos),
// grupos + playoff y suizo.

import { all, get, run, tx } from './db.js';

// --------------------------------------------------------------- utilidades

/** Orden de siembra clásico: 1-8-4-5-2-7-3-6 para 8. */
export function ordenSiembra(n) {
  let arr = [1, 2];
  while (arr.length < n) {
    const m = arr.length * 2 + 1;
    const out = [];
    for (const s of arr) out.push(s, m - s);
    arr = out;
  }
  return arr;
}

function potenciaDe2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function equiposDe(tournamentId) {
  return all(
    `SELECT * FROM teams WHERE tournament_id = ? ORDER BY COALESCE(seed, 9999), id`,
    tournamentId
  );
}

function crearStage(tournamentId, idx, name, type) {
  const info = run(
    'INSERT INTO stages (tournament_id, idx, name, type) VALUES (?, ?, ?, ?)',
    tournamentId,
    idx,
    name,
    type
  );
  return info.lastInsertRowid;
}

function crearMatch(m) {
  const info = run(
    `INSERT INTO matches
       (tournament_id, stage_id, group_id, bracket, round, position, label,
        team_a_id, team_b_id, best_of, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.tournament_id,
    m.stage_id,
    m.group_id ?? null,
    m.bracket ?? 'W',
    m.round,
    m.position,
    m.label ?? null,
    m.team_a_id ?? null,
    m.team_b_id ?? null,
    m.best_of,
    m.status ?? 'pendiente'
  );
  const id = info.lastInsertRowid;
  run(
    "INSERT INTO chat_rooms (tournament_id, match_id, kind, name) VALUES (?, ?, 'partido', ?)",
    m.tournament_id,
    id,
    m.label || `Ronda ${m.round} · #${m.position}`
  );
  return id;
}

function enlazar(matchId, nextId, slot, { loser = false } = {}) {
  if (loser) {
    run('UPDATE matches SET loser_match_id = ?, loser_slot = ? WHERE id = ?', nextId, slot, matchId);
  } else {
    run('UPDATE matches SET next_match_id = ?, next_slot = ? WHERE id = ?', nextId, slot, matchId);
  }
}

function limpiar(tournamentId) {
  run('DELETE FROM chat_rooms WHERE tournament_id = ? AND kind = ?', tournamentId, 'partido');
  run('DELETE FROM matches WHERE tournament_id = ?', tournamentId);
  run('DELETE FROM stages WHERE tournament_id = ?', tournamentId);
}

// -------------------------------------------------------- eliminación simple

function eliminacionSimple(torneo, teams, { stageId, bracket = 'W', offsetRonda = 0 }) {
  const n = potenciaDe2(Math.max(2, teams.length));
  const orden = ordenSiembra(n);
  const slots = orden.map((seed) => teams[seed - 1] ?? null); // null = bye

  const rondas = Math.log2(n);
  const porRonda = [];

  for (let r = 1; r <= rondas; r++) {
    const cantidad = n / 2 ** r;
    const ids = [];
    for (let p = 0; p < cantidad; p++) {
      const esFinal = r === rondas;
      const bo = esFinal && torneo.best_of_final ? torneo.best_of_final : torneo.best_of;
      ids.push(
        crearMatch({
          tournament_id: torneo.id,
          stage_id: stageId,
          bracket,
          round: r + offsetRonda,
          position: p + 1,
          label: nombreRonda(rondas, r, bracket),
          team_a_id: r === 1 ? slots[p * 2]?.id ?? null : null,
          team_b_id: r === 1 ? slots[p * 2 + 1]?.id ?? null : null,
          best_of: bo,
        })
      );
    }
    porRonda.push(ids);
  }

  for (let r = 0; r < porRonda.length - 1; r++) {
    porRonda[r].forEach((id, i) => {
      enlazar(id, porRonda[r + 1][Math.floor(i / 2)], i % 2 === 0 ? 'a' : 'b');
    });
  }

  // Resuelve los byes de la primera ronda.
  for (const id of porRonda[0]) resolverBye(id);

  return porRonda;
}

function nombreRonda(total, r, bracket = 'W') {
  const restantes = total - r;
  const base =
    restantes === 0 ? 'Final' :
    restantes === 1 ? 'Semifinal' :
    restantes === 2 ? 'Cuartos' :
    restantes === 3 ? 'Octavos' :
    `Ronda ${r}`;
  if (bracket === 'L') return `Perdedores · ${base}`;
  return base;
}

function resolverBye(matchId) {
  const m = get('SELECT * FROM matches WHERE id = ?', matchId);
  if (!m || m.status !== 'pendiente') return;
  const a = m.team_a_id, b = m.team_b_id;
  if ((a && b) || (!a && !b)) return;

  // Solo es bye si el lugar vacío no espera a nadie. Si otro partido manda su
  // ganador (o su perdedor) a ese lugar, todavía falta jugarlo.
  const vacio = a ? 'b' : 'a';
  const esperando = get(
    `SELECT 1 FROM matches
      WHERE (next_match_id = ? AND COALESCE(next_slot, 'a') = ?)
         OR (loser_match_id = ? AND COALESCE(loser_slot, 'a') = ?)`,
    matchId, vacio, matchId, vacio
  );
  if (esperando) return;

  cerrarMatch(matchId, a || b, a ? m.best_of : 0, a ? 0 : m.best_of, true);
}

// --------------------------------------------------------- eliminación doble

function eliminacionDoble(torneo, teams) {
  const stageId = crearStage(torneo.id, 1, 'Eliminación doble', 'eliminacion_doble');
  const n = potenciaDe2(Math.max(2, teams.length));
  const k = Math.log2(n);

  const wb = eliminacionSimple(torneo, teams, { stageId, bracket: 'W' });

  // Rondas del bracket de perdedores: 2k-2 en total.
  const lb = [];
  for (let r = 1; r <= 2 * k - 2; r++) {
    const cantidad = r % 2 === 1
      ? 2 ** (k - 1 - Math.ceil(r / 2))
      : 2 ** (k - 1 - r / 2);
    const ids = [];
    for (let p = 0; p < cantidad; p++) {
      ids.push(
        crearMatch({
          tournament_id: torneo.id,
          stage_id: stageId,
          bracket: 'L',
          round: r,
          position: p + 1,
          label: r === 2 * k - 2 ? 'Perdedores · Final' : `Perdedores · Ronda ${r}`,
          best_of: torneo.best_of,
        })
      );
    }
    lb.push(ids);
  }

  // Encadena el bracket de perdedores consigo mismo.
  for (let r = 0; r < lb.length - 1; r++) {
    const actual = lb[r], siguiente = lb[r + 1];
    actual.forEach((id, i) => {
      if (actual.length === siguiente.length) enlazar(id, siguiente[i], 'a');
      else enlazar(id, siguiente[Math.floor(i / 2)], i % 2 === 0 ? 'a' : 'b');
    });
  }

  // Los perdedores del bracket de ganadores caen al de perdedores.
  // WB R1 -> LB R1 (cruzado); WB R(j+1) -> LB R(2j), en orden invertido.
  wb[0].forEach((id, i) => {
    const destino = lb[0][Math.floor(i / 2)];
    enlazar(id, destino, i % 2 === 0 ? 'a' : 'b', { loser: true });
  });
  for (let j = 1; j < k; j++) {
    const origen = wb[j];
    const destino = lb[2 * j - 1];
    if (!destino) break;
    origen.forEach((id, i) => {
      const idx = destino.length === origen.length ? destino.length - 1 - i : Math.floor(i / 2);
      enlazar(id, destino[idx], 'b', { loser: true });
    });
  }

  // Gran final: ganador del WB contra ganador del LB.
  const gf = crearMatch({
    tournament_id: torneo.id,
    stage_id: stageId,
    bracket: 'F',
    round: k + 1,
    position: 1,
    label: 'Gran final',
    best_of: torneo.best_of_final || torneo.best_of,
  });
  enlazar(wb[wb.length - 1][0], gf, 'a');
  enlazar(lb[lb.length - 1][0], gf, 'b');

  for (const id of lb.flat()) resolverBye(id);
  return stageId;
}

// -------------------------------------------------------------------- liga

function roundRobin(torneo, teams, { stageId, groupId = null }) {
  const lista = [...teams];
  if (lista.length % 2 === 1) lista.push(null); // bye rotativo
  const n = lista.length;
  const rondas = n - 1;
  let pos = 1;

  for (let r = 0; r < rondas; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = lista[i];
      const b = lista[n - 1 - i];
      if (!a || !b) continue;
      const [x, y] = r % 2 === 0 ? [a, b] : [b, a];
      crearMatch({
        tournament_id: torneo.id,
        stage_id: stageId,
        group_id: groupId,
        round: r + 1,
        position: pos++,
        label: `Fecha ${r + 1}`,
        team_a_id: x.id,
        team_b_id: y.id,
        best_of: torneo.best_of,
      });
    }
    lista.splice(1, 0, lista.pop()); // rota dejando fijo el primero
  }
}

// --------------------------------------------------------- grupos + playoff

function gruposPlayoff(torneo, teams) {
  const stageId = crearStage(torneo.id, 1, 'Fase de grupos', 'grupos');
  const g = Math.max(2, torneo.group_count || 2);
  const grupos = Array.from({ length: g }, (_, i) => ({
    id: run('INSERT INTO groups (stage_id, name) VALUES (?, ?)', stageId, `Grupo ${String.fromCharCode(65 + i)}`)
      .lastInsertRowid,
    teams: [],
  }));

  // Serpiente por siembra para repartir parejo.
  teams.forEach((t, i) => {
    const vuelta = Math.floor(i / g);
    const pos = i % g;
    const idx = vuelta % 2 === 0 ? pos : g - 1 - pos;
    grupos[idx].teams.push(t);
    run('INSERT OR IGNORE INTO group_teams (group_id, team_id) VALUES (?, ?)', grupos[idx].id, t.id);
  });

  for (const grupo of grupos) {
    roundRobin(torneo, grupo.teams, { stageId, groupId: grupo.id });
  }
  return stageId;
}

/** Crea el cuadro final una vez cerrada la fase de grupos. */
export function generarPlayoffs(tournamentId) {
  return tx(() => {
    const torneo = get('SELECT * FROM tournaments WHERE id = ?', tournamentId);
    const stageGrupos = get(
      "SELECT * FROM stages WHERE tournament_id = ? AND type = 'grupos' ORDER BY idx LIMIT 1",
      tournamentId
    );
    if (!stageGrupos) throw new Error('Este torneo no tiene fase de grupos.');
    const yaHay = get(
      "SELECT 1 FROM stages WHERE tournament_id = ? AND type != 'grupos'",
      tournamentId
    );
    if (yaHay) throw new Error('Los playoffs ya estaban generados.');

    const grupos = all('SELECT * FROM groups WHERE stage_id = ? ORDER BY name', stageGrupos.id);
    const clasificados = [];
    for (const grupo of grupos) {
      const tabla = tablaGrupo(grupo.id);
      clasificados.push(...tabla.slice(0, torneo.group_advance).map((row, i) => ({
        ...row.team,
        _pos: i + 1,
        _grupo: grupo.name,
      })));
    }
    // Siembra: primeros de grupo arriba, después segundos, etc.
    clasificados.sort((a, b) => a._pos - b._pos || b.pts - a.pts);
    clasificados.forEach((t, i) => run('UPDATE teams SET seed = ? WHERE id = ?', i + 1, t.id));

    const stageId = crearStage(tournamentId, 2, 'Playoffs', 'eliminacion_simple');
    eliminacionSimple(torneo, clasificados, { stageId });
    return stageId;
  });
}

/** Tabla de posiciones de un grupo. */
export function tablaGrupo(groupId) {
  const teams = all(
    'SELECT t.* FROM group_teams gt JOIN teams t ON t.id = gt.team_id WHERE gt.group_id = ?',
    groupId
  );
  const matches = all(
    "SELECT * FROM matches WHERE group_id = ? AND status IN ('finalizado','walkover')",
    groupId
  );
  return tablaDesde(teams, matches);
}

export function tablaDesde(teams, matches) {
  const filas = new Map(
    teams.map((t) => [t.id, { team: t, pj: 0, pg: 0, pp: 0, gf: 0, gc: 0, pts: 0 }])
  );
  for (const m of matches) {
    const a = filas.get(m.team_a_id);
    const b = filas.get(m.team_b_id);
    if (!a || !b) continue;
    a.pj++; b.pj++;
    a.gf += m.score_a; a.gc += m.score_b;
    b.gf += m.score_b; b.gc += m.score_a;
    if (m.winner_team_id === m.team_a_id) { a.pg++; b.pp++; a.pts += 3; }
    else if (m.winner_team_id === m.team_b_id) { b.pg++; a.pp++; b.pts += 3; }
  }
  return [...filas.values()].sort(
    (x, y) => y.pts - x.pts || (y.gf - y.gc) - (x.gf - x.gc) || y.gf - x.gf
  );
}

// -------------------------------------------------------------------- suizo

function suizo(torneo, teams) {
  const stageId = crearStage(torneo.id, 1, 'Sistema suizo', 'suizo');
  const mitad = Math.ceil(teams.length / 2);
  const arriba = teams.slice(0, mitad);
  const abajo = teams.slice(mitad);
  arriba.forEach((t, i) => {
    const rival = abajo[i];
    if (!rival) return;
    crearMatch({
      tournament_id: torneo.id,
      stage_id: stageId,
      round: 1,
      position: i + 1,
      label: 'Ronda 1',
      team_a_id: t.id,
      team_b_id: rival.id,
      best_of: torneo.best_of,
    });
  });
  return stageId;
}

/** Empareja la siguiente ronda suiza según puntaje, evitando revanchas. */
export function siguienteRondaSuiza(tournamentId) {
  return tx(() => {
    const torneo = get('SELECT * FROM tournaments WHERE id = ?', tournamentId);
    const stage = get("SELECT * FROM stages WHERE tournament_id = ? AND type = 'suizo'", tournamentId);
    if (!stage) throw new Error('Este torneo no es suizo.');

    const pendientes = get(
      "SELECT COUNT(*) AS n FROM matches WHERE stage_id = ? AND status NOT IN ('finalizado','walkover')",
      stage.id
    );
    if (pendientes.n > 0) throw new Error('Faltan partidos por cerrar en la ronda actual.');

    const ultima = get('SELECT MAX(round) AS r FROM matches WHERE stage_id = ?', stage.id).r || 0;
    if (torneo.swiss_rounds && ultima >= torneo.swiss_rounds) {
      throw new Error('El suizo ya completó todas sus rondas.');
    }

    const teams = equiposDe(tournamentId);
    const jugados = all('SELECT team_a_id, team_b_id FROM matches WHERE stage_id = ?', stage.id);
    const previos = new Set(jugados.flatMap((m) => [`${m.team_a_id}-${m.team_b_id}`, `${m.team_b_id}-${m.team_a_id}`]));

    const tabla = tablaDesde(teams, all(
      "SELECT * FROM matches WHERE stage_id = ? AND status IN ('finalizado','walkover')",
      stage.id
    ));

    const libres = tabla.map((r) => r.team);
    const parejas = [];
    while (libres.length > 1) {
      const a = libres.shift();
      let idx = libres.findIndex((b) => !previos.has(`${a.id}-${b.id}`));
      if (idx === -1) idx = 0;
      parejas.push([a, libres.splice(idx, 1)[0]]);
    }

    const ronda = ultima + 1;
    parejas.forEach(([a, b], i) =>
      crearMatch({
        tournament_id: tournamentId,
        stage_id: stage.id,
        round: ronda,
        position: i + 1,
        label: `Ronda ${ronda}`,
        team_a_id: a.id,
        team_b_id: b.id,
        best_of: torneo.best_of,
      })
    );
    return { ronda, partidos: parejas.length, bye: libres[0]?.name ?? null };
  });
}

// ------------------------------------------------------------------ entrada

export function generarLlaves(tournamentId) {
  return tx(() => {
    const torneo = get('SELECT * FROM tournaments WHERE id = ?', tournamentId);
    if (!torneo) throw new Error('Torneo inexistente.');
    const teams = equiposDe(tournamentId);
    if (teams.length < 2) throw new Error('Hacen falta al menos dos equipos.');

    limpiar(tournamentId);
    teams.forEach((t, i) => {
      if (t.seed == null) run('UPDATE teams SET seed = ? WHERE id = ?', i + 1, t.id);
    });

    let stageId;
    if (torneo.format === 'eliminacion_simple') {
      stageId = crearStage(tournamentId, 1, 'Eliminatoria', 'eliminacion_simple');
      eliminacionSimple(torneo, teams, { stageId });
      if (torneo.third_place) crearTercerPuesto(torneo, stageId);
    } else if (torneo.format === 'eliminacion_doble') {
      stageId = eliminacionDoble(torneo, teams);
    } else if (torneo.format === 'liga') {
      stageId = crearStage(tournamentId, 1, 'Liga', 'liga');
      roundRobin(torneo, teams, { stageId });
    } else if (torneo.format === 'grupos_playoff') {
      stageId = gruposPlayoff(torneo, teams);
    } else if (torneo.format === 'suizo') {
      stageId = suizo(torneo, teams);
    } else {
      throw new Error(`Formato desconocido: ${torneo.format}`);
    }

    run("UPDATE tournaments SET status = 'en_curso' WHERE id = ?", tournamentId);
    return stageId;
  });
}

function crearTercerPuesto(torneo, stageId) {
  const rondas = all(
    "SELECT round FROM matches WHERE stage_id = ? AND bracket = 'W' GROUP BY round ORDER BY round",
    stageId
  );
  const semis = all(
    "SELECT * FROM matches WHERE stage_id = ? AND bracket = 'W' AND round = ? ORDER BY position",
    stageId,
    rondas[rondas.length - 2]?.round ?? 1
  );
  if (semis.length !== 2) return;
  const id = crearMatch({
    tournament_id: torneo.id,
    stage_id: stageId,
    bracket: 'W',
    round: rondas[rondas.length - 1].round,
    position: 2,
    label: 'Tercer puesto',
    best_of: torneo.best_of,
  });
  enlazar(semis[0].id, id, 'a', { loser: true });
  enlazar(semis[1].id, id, 'b', { loser: true });
}

// ----------------------------------------------------- avance de resultados

/** Cierra un partido y propaga ganador y perdedor a los siguientes. */
export function cerrarMatch(matchId, winnerTeamId, scoreA, scoreB, walkover = false) {
  const m = get('SELECT * FROM matches WHERE id = ?', matchId);
  if (!m) throw new Error('Partido inexistente.');
  const loserTeamId = winnerTeamId === m.team_a_id ? m.team_b_id : m.team_a_id;

  run(
    `UPDATE matches SET winner_team_id = ?, score_a = ?, score_b = ?, status = ? WHERE id = ?`,
    winnerTeamId,
    scoreA,
    scoreB,
    walkover ? 'walkover' : 'finalizado',
    matchId
  );

  if (m.next_match_id) {
    run(
      `UPDATE matches SET ${m.next_slot === 'b' ? 'team_b_id' : 'team_a_id'} = ? WHERE id = ?`,
      winnerTeamId,
      m.next_match_id
    );
    resolverBye(m.next_match_id);
  }
  if (m.loser_match_id && loserTeamId) {
    run(
      `UPDATE matches SET ${m.loser_slot === 'b' ? 'team_b_id' : 'team_a_id'} = ? WHERE id = ?`,
      loserTeamId,
      m.loser_match_id
    );
    resolverBye(m.loser_match_id);
  }

  const quedan = get(
    "SELECT COUNT(*) AS n FROM matches WHERE tournament_id = ? AND status NOT IN ('finalizado','walkover')",
    m.tournament_id
  );
  if (quedan.n === 0) {
    run("UPDATE tournaments SET status = 'finalizado' WHERE id = ?", m.tournament_id);
  }
  return get('SELECT * FROM matches WHERE id = ?', matchId);
}
