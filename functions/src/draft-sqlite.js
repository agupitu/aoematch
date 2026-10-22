// Motor de draft sobre SQLite: lo usan las rutas hasta que pasen a draft.js
// (Firestore) en T23. Se borra en T33.
//
// Motor de draft de mapa y civilizaciones.
//
// Un draft pertenece a un partido y a un número de partida dentro de la serie.
// El plan de pasos se calcula una sola vez al crearlo y se guarda en steps_json,
// así los dos equipos ven exactamente la misma secuencia.

import { all, get, run, tx } from './db.js';
import { publish } from './bus.js';

// --------------------------------------------------------------- utilidades

const PATRON_POR_TAMANO = {
  1: '1-1',
  2: '1-2-1',
  3: '1-2-2-1',
  4: '1-2-2-2-1',
};

/** Patrón serpiente por defecto: el borde toma 1 y el medio 2 (A BB AA BB A). */
export function patronPorDefecto(teamSize) {
  if (PATRON_POR_TAMANO[teamSize]) return PATRON_POR_TAMANO[teamSize];
  return ['1', ...Array.from({ length: teamSize - 1 }, () => '2'), '1'].join('-');
}

export function parsePatron(patron, teamSize) {
  const counts = String(patron || '')
    .split(/[-,\s]+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!counts.length || total !== teamSize * 2) {
    return parsePatron(patronPorDefecto(teamSize), teamSize);
  }
  return counts;
}

function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------ plan de pasos

/**
 * Construye la lista de pasos del draft.
 * Cada paso: { kind, side: 'a'|'b'|null, slot: n|null, auto: bool }
 *   - kind: ban_mapa | pick_mapa | ban_civ | pick_civ
 *   - side: qué equipo actúa ('a' / 'b' según el partido)
 *   - slot: índice del jugador dentro del equipo al que va la civ
 *   - auto: lo resuelve el servidor (aleatorio)
 */
export function construirPasos({ torneo, mapPoolSize, firstSide = 'a', mapaFijo = null }) {
  const steps = [];
  const other = (s) => (s === 'a' ? 'b' : 'a');
  const teamSize = torneo.team_size;

  // --- fase de mapa
  let side = firstSide;
  if (mapaFijo) {
    // Mapa decidido por el organizador: un solo paso, sin bans ni picks.
    steps.push({ kind: 'pick_mapa', side: null, slot: null, auto: true, map_id: mapaFijo });
  } else if (torneo.map_mode === 'aleatorio' || torneo.map_mode === 'fijo') {
    steps.push({ kind: 'pick_mapa', side: null, slot: null, auto: true });
  } else if (torneo.map_mode === 'ban_hasta_uno') {
    const bans = Math.max(0, mapPoolSize - 1);
    for (let i = 0; i < bans; i++) {
      steps.push({ kind: 'ban_mapa', side, slot: null, auto: false });
      side = other(side);
    }
    // El último mapa que queda es el elegido: lo resuelve el servidor.
    steps.push({ kind: 'pick_mapa', side: null, slot: null, auto: true });
  } else if (torneo.map_mode === 'ban_pick') {
    for (let i = 0; i < torneo.map_bans; i++) {
      steps.push({ kind: 'ban_mapa', side: 'a', slot: null, auto: false });
      steps.push({ kind: 'ban_mapa', side: 'b', slot: null, auto: false });
    }
    steps.push({ kind: 'pick_mapa', side: firstSide, slot: null, auto: false });
  }

  // --- fase de civilizaciones
  // Quien NO eligió mapa arranca el draft de civs (contrapick). Con mapa fijo
  // nadie eligió, así que arranca el mismo lado que abre la partida.
  const civFirst = torneo.map_mode === 'ban_pick' && !mapaFijo ? other(firstSide) : firstSide;

  if (torneo.civ_mode === 'aleatorio') {
    for (const s of [civFirst, other(civFirst)]) {
      for (let slot = 0; slot < teamSize; slot++) {
        steps.push({ kind: 'pick_civ', side: s, slot, auto: true });
      }
    }
  } else if (torneo.civ_mode === 'ciega') {
    // Picks simultáneos: mismo orden pero sin revelar hasta el final.
    for (const s of [civFirst, other(civFirst)]) {
      for (let slot = 0; slot < teamSize; slot++) {
        steps.push({ kind: 'pick_civ', side: s, slot, auto: false, blind: true });
      }
    }
  } else if (torneo.civ_mode === 'snake') {
    for (let i = 0; i < torneo.civ_bans; i++) {
      steps.push({ kind: 'ban_civ', side: civFirst, slot: null, auto: false });
      steps.push({ kind: 'ban_civ', side: other(civFirst), slot: null, auto: false });
    }
    const counts = parsePatron(torneo.civ_pattern, teamSize);
    const nextSlot = { a: 0, b: 0 };
    let s = civFirst;
    for (const c of counts) {
      for (let k = 0; k < c; k++) {
        steps.push({ kind: 'pick_civ', side: s, slot: nextSlot[s]++, auto: false });
      }
      s = other(s);
    }
  }
  // 'libre' no agrega pasos de civ.

  return steps.map((st, idx) => ({ idx, ...st }));
}

// ------------------------------------------------------------ estado y reglas

export function torneoDeMatch(matchId) {
  return get(
    `SELECT t.* FROM tournaments t JOIN matches m ON m.tournament_id = t.id WHERE m.id = ?`,
    matchId
  );
}

function rosterDe(teamId) {
  if (!teamId) return [];
  return all(
    `SELECT u.id, u.display_name, u.avatar_url, u.steam_avatar, tm.role
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY (tm.role = 'capitan') DESC, u.id`,
    teamId
  );
}

function poolMapas(tournamentId) {
  return all(
    `SELECT m.* FROM tournament_maps tm JOIN maps m ON m.id = tm.map_id
      WHERE tm.tournament_id = ? ORDER BY m.name_es`,
    tournamentId
  );
}

function poolCivs(tournamentId) {
  return all(
    `SELECT c.* FROM tournament_civs tc JOIN civs c ON c.id = tc.civ_id
      WHERE tc.tournament_id = ? ORDER BY c.name_es`,
    tournamentId
  );
}

/** Crea el draft de una partida de la serie (o devuelve el existente). */
export function crearDraft(matchId, gameNo = 1) {
  const existente = get('SELECT * FROM drafts WHERE match_id = ? AND game_no = ?', matchId, gameNo);
  if (existente) return existente;

  const match = get('SELECT * FROM matches WHERE id = ?', matchId);
  if (!match) throw new Error('El partido no existe.');
  if (!match.team_a_id || !match.team_b_id) throw new Error('Faltan equipos en el partido.');

  const torneo = torneoDeMatch(matchId);
  const mapas = poolMapas(torneo.id);
  const usados = mapasUsados(matchId, gameNo);
  const disponibles = torneo.map_repeat ? mapas : mapas.filter((m) => !usados.has(m.id));

  // Primer turno: en la partida 1 se sortea; después arranca quien viene perdiendo.
  let firstSide;
  if (gameNo === 1) {
    firstSide = Math.random() < 0.5 ? 'a' : 'b';
  } else {
    firstSide = match.score_a < match.score_b ? 'a' : match.score_b < match.score_a ? 'b' : 'a';
  }

  // El organizador puede fijar el mapa de la primera partida (lo habitual en
  // series impares, para que nadie arranque con ventaja). Con map_mode 'fijo'
  // vale para todas las partidas de la serie.
  const fijaEstaPartida = torneo.map_mode === 'fijo' || gameNo === 1;
  const mapaFijo =
    torneo.first_map_id && fijaEstaPartida && mapas.some((m) => m.id === torneo.first_map_id)
      ? torneo.first_map_id
      : null;

  const steps = construirPasos({
    torneo,
    mapPoolSize: Math.max(1, disponibles.length),
    firstSide,
    mapaFijo,
  });

  const firstTeamId = firstSide === 'a' ? match.team_a_id : match.team_b_id;
  const info = run(
    `INSERT INTO drafts (match_id, game_no, state, steps_json, current_step, first_team_id)
     VALUES (?, ?, 'espera', ?, 0, ?)`,
    matchId,
    gameNo,
    JSON.stringify(steps),
    firstTeamId
  );
  return get('SELECT * FROM drafts WHERE id = ?', info.lastInsertRowid);
}

function mapasUsados(matchId, beforeGameNo) {
  const rows = all(
    'SELECT map_id FROM match_games WHERE match_id = ? AND game_no < ? AND map_id IS NOT NULL',
    matchId,
    beforeGameNo
  );
  return new Set(rows.map((r) => r.map_id));
}

/** Civs ya usadas por un equipo en partidas anteriores de la serie. */
function civsUsadasPorEquipo(matchId, teamId, beforeGameNo) {
  const rows = all(
    `SELECT gc.civ_id FROM game_civs gc
       JOIN match_games mg ON mg.id = gc.game_id
      WHERE mg.match_id = ? AND mg.game_no < ? AND gc.team_id = ?`,
    matchId,
    beforeGameNo,
    teamId
  );
  return new Set(rows.map((r) => r.civ_id));
}

/**
 * Estado completo del draft, listo para el cliente.
 * `viewerTeamId` oculta los picks ciegos del rival mientras el draft no termina.
 */
export function estadoDraft(draftId, viewerTeamId = null) {
  const d = get('SELECT * FROM drafts WHERE id = ?', draftId);
  if (!d) return null;

  const match = get('SELECT * FROM matches WHERE id = ?', d.match_id);
  const torneo = torneoDeMatch(d.match_id);
  const steps = JSON.parse(d.steps_json);
  const actions = all('SELECT * FROM draft_actions WHERE draft_id = ? ORDER BY step_idx', draftId);

  const sideOf = (teamId) => (teamId === match.team_a_id ? 'a' : teamId === match.team_b_id ? 'b' : null);
  const teamOf = (side) => (side === 'a' ? match.team_a_id : match.team_b_id);

  const mapPool = poolMapas(torneo.id);
  const civPool = poolCivs(torneo.id);

  const mapsBanned = actions.filter((a) => a.kind === 'ban_mapa').map((a) => a.target_id);
  const mapPicked = actions.find((a) => a.kind === 'pick_mapa')?.target_id ?? null;
  const civsBanned = actions.filter((a) => a.kind === 'ban_civ').map((a) => a.target_id);

  const finished = d.state === 'finalizado';
  const civPicks = actions
    .filter((a) => a.kind === 'pick_civ')
    .map((a) => {
      const st = steps[a.step_idx];
      const oculto = !finished && st?.blind && viewerTeamId && a.team_id !== viewerTeamId;
      return {
        step_idx: a.step_idx,
        team_id: a.team_id,
        side: sideOf(a.team_id),
        slot: st?.slot ?? null,
        user_id: a.for_user_id,
        civ_id: oculto ? null : a.target_id,
        hidden: !!oculto,
        auto: !!a.auto,
      };
    });

  const rosters = {
    a: rosterDe(match.team_a_id),
    b: rosterDe(match.team_b_id),
  };

  const step = steps[d.current_step] || null;

  return {
    id: d.id,
    match_id: d.match_id,
    game_no: d.game_no,
    state: d.state,
    current_step: d.current_step,
    total_steps: steps.length,
    deadline_at: d.deadline_at,
    timer_s: torneo.draft_timer_s,
    ready: { a: !!d.ready_a, b: !!d.ready_b },
    first_team_id: d.first_team_id,
    teams: {
      a: { id: match.team_a_id, roster: rosters.a },
      b: { id: match.team_b_id, roster: rosters.b },
    },
    steps,
    step,
    turn_team_id: step && step.side ? teamOf(step.side) : null,
    pools: { maps: mapPool, civs: civPool },
    maps_banned: mapsBanned,
    map_picked: mapPicked,
    civs_banned: civsBanned,
    civ_picks: civPicks,
    rules: {
      map_mode: torneo.map_mode,
      civ_mode: torneo.civ_mode,
      civ_pattern: torneo.civ_pattern || patronPorDefecto(torneo.team_size),
      civ_repeat_team: !!torneo.civ_repeat_team,
      civ_mirror: !!torneo.civ_mirror,
      civ_repeat_series: !!torneo.civ_repeat_series,
      team_size: torneo.team_size,
    },
  };
}

/** Ids de civ que no se pueden elegir en el paso actual. */
export function civsBloqueadas(state, step) {
  const bloqueadas = new Set(state.civs_banned);
  const match = { a: state.teams.a.id, b: state.teams.b.id };
  const miEquipo = step.side === 'a' ? match.a : match.b;

  for (const p of state.civ_picks) {
    if (p.civ_id == null) continue;
    const mismoEquipo = p.team_id === miEquipo;
    if (mismoEquipo && !state.rules.civ_repeat_team) bloqueadas.add(p.civ_id);
    if (!mismoEquipo && !state.rules.civ_mirror) bloqueadas.add(p.civ_id);
  }

  if (!state.rules.civ_repeat_series) {
    for (const id of civsUsadasPorEquipo(state.match_id, miEquipo, state.game_no)) {
      bloqueadas.add(id);
    }
  }
  return bloqueadas;
}

function mapasBloqueados(state) {
  return new Set(state.maps_banned);
}

// ------------------------------------------------------------------ acciones

function esCapitan(userId, teamId) {
  const t = get('SELECT captain_id FROM teams WHERE id = ?', teamId);
  return t && t.captain_id === userId;
}

function enEquipo(userId, teamId) {
  return !!get('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?', teamId, userId);
}

function organiza(userId, tournamentId) {
  const t = get('SELECT organizer_id FROM tournaments WHERE id = ?', tournamentId);
  if (t && t.organizer_id === userId) return true;
  return !!get(
    'SELECT 1 FROM tournament_admins WHERE tournament_id = ? AND user_id = ?',
    tournamentId,
    userId
  );
}

/** Marca "listo" a un equipo; cuando los dos están listos arranca el reloj. */
export function marcarListo(draftId, user) {
  const st = estadoDraft(draftId);
  if (!st) throw new Error('Draft inexistente.');
  if (st.state !== 'espera') return st;

  const torneo = torneoDeMatch(st.match_id);
  const side = enEquipo(user.id, st.teams.a.id) ? 'a' : enEquipo(user.id, st.teams.b.id) ? 'b' : null;

  if (side) {
    run(`UPDATE drafts SET ready_${side} = 1 WHERE id = ?`, draftId);
  } else if (organiza(user.id, torneo.id)) {
    // El organizador puede arrancar el draft aunque no juegue el partido.
    run('UPDATE drafts SET ready_a = 1, ready_b = 1 WHERE id = ?', draftId);
  } else {
    throw new Error('No sos parte de este partido.');
  }
  const d = get('SELECT * FROM drafts WHERE id = ?', draftId);
  if (d.ready_a && d.ready_b) {
    run("UPDATE drafts SET state = 'en_curso' WHERE id = ?", draftId);
    run("UPDATE matches SET status = 'draft' WHERE id = ?", d.match_id);
    renovarReloj(draftId);
    resolverAutomaticos(draftId);
  }
  return emitir(draftId);
}

function renovarReloj(draftId) {
  const d = get('SELECT * FROM drafts WHERE id = ?', draftId);
  const torneo = torneoDeMatch(d.match_id);
  if (!torneo.draft_timer_s) {
    run('UPDATE drafts SET deadline_at = NULL WHERE id = ?', draftId);
    return;
  }
  const deadline = new Date(Date.now() + torneo.draft_timer_s * 1000).toISOString();
  run('UPDATE drafts SET deadline_at = ? WHERE id = ?', deadline, draftId);
}

/**
 * Registra una acción del draft.
 * opts: { kind, targetId, forUserId? }
 */
export function aplicarAccion(draftId, user, opts) {
  return tx(() => {
    const d = get('SELECT * FROM drafts WHERE id = ?', draftId);
    if (!d) throw new Error('Draft inexistente.');
    if (d.state !== 'en_curso') throw new Error('El draft no está en curso.');

    const st = estadoDraft(draftId);
    const step = st.steps[d.current_step];
    if (!step) throw new Error('El draft ya terminó.');
    if (step.auto) throw new Error('Ese paso lo resuelve el servidor.');
    if (step.kind !== opts.kind) throw new Error(`Toca ${step.kind}, no ${opts.kind}.`);

    const teamId = step.side === 'a' ? st.teams.a.id : st.teams.b.id;
    const torneo = torneoDeMatch(d.match_id);
    const puede = esCapitan(user.id, teamId) || organiza(user.id, torneo.id);
    if (!puede) throw new Error('Solo el capitán del equipo en turno puede draftear.');

    validarObjetivo(st, step, opts);

    const forUserId = step.kind === 'pick_civ' ? jugadorDelSlot(st, step, opts.forUserId) : null;

    run(
      `INSERT INTO draft_actions (draft_id, step_idx, team_id, user_id, for_user_id, kind, target_id, auto)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      draftId,
      step.idx,
      teamId,
      user.id,
      forUserId,
      opts.kind,
      opts.targetId
    );
    avanzar(draftId);
    return estadoDraft(draftId);
  });
}

function jugadorDelSlot(st, step, forUserId) {
  const roster = step.side === 'a' ? st.teams.a.roster : st.teams.b.roster;
  if (forUserId) {
    const ok = roster.some((r) => r.id === forUserId);
    const yaTiene = st.civ_picks.some((p) => p.user_id === forUserId);
    if (ok && !yaTiene) return forUserId;
  }
  const tomados = new Set(st.civ_picks.map((p) => p.user_id));
  const libre = roster.find((r) => !tomados.has(r.id));
  return libre ? libre.id : (roster[step.slot]?.id ?? null);
}

function validarObjetivo(st, step, opts) {
  const id = opts.targetId;
  if (step.kind === 'ban_mapa' || step.kind === 'pick_mapa') {
    const existe = st.pools.maps.some((m) => m.id === id);
    if (!existe) throw new Error('Ese mapa no está en el pool del torneo.');
    if (mapasBloqueados(st).has(id)) throw new Error('Ese mapa ya fue baneado.');
    if (st.map_picked) throw new Error('El mapa ya está decidido.');
  } else {
    const existe = st.pools.civs.some((c) => c.id === id);
    if (!existe) throw new Error('Esa civilización no está en el pool del torneo.');
    if (step.kind === 'pick_civ' && civsBloqueadas(st, step).has(id)) {
      throw new Error('Esa civilización no está disponible.');
    }
    if (step.kind === 'ban_civ' && st.civs_banned.includes(id)) {
      throw new Error('Esa civilización ya fue baneada.');
    }
  }
}

/** Avanza el puntero y resuelve los pasos automáticos que queden por delante. */
function avanzar(draftId) {
  const d = get('SELECT * FROM drafts WHERE id = ?', draftId);
  const steps = JSON.parse(d.steps_json);
  const next = d.current_step + 1;
  run('UPDATE drafts SET current_step = ? WHERE id = ?', next, draftId);
  if (next >= steps.length) return finalizar(draftId);
  renovarReloj(draftId);
  resolverAutomaticos(draftId);
}

/** Ejecuta en cadena los pasos marcados como auto (mapa aleatorio, último mapa, etc). */
function resolverAutomaticos(draftId) {
  for (let guard = 0; guard < 200; guard++) {
    const d = get('SELECT * FROM drafts WHERE id = ?', draftId);
    if (d.state !== 'en_curso') return;
    const steps = JSON.parse(d.steps_json);
    const step = steps[d.current_step];
    if (!step || !step.auto) return;

    const st = estadoDraft(draftId);
    const targetId = elegirAutomatico(st, step);
    const teamId = step.side === 'a' ? st.teams.a.id : step.side === 'b' ? st.teams.b.id : null;
    const forUserId = step.kind === 'pick_civ' ? jugadorDelSlot(st, step, null) : null;

    run(
      `INSERT INTO draft_actions (draft_id, step_idx, team_id, user_id, for_user_id, kind, target_id, auto)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 1)`,
      draftId,
      step.idx,
      teamId,
      forUserId,
      step.kind,
      targetId
    );

    const next = d.current_step + 1;
    run('UPDATE drafts SET current_step = ? WHERE id = ?', next, draftId);
    if (next >= steps.length) return finalizar(draftId);
    renovarReloj(draftId);
  }
}

function elegirAutomatico(st, step) {
  if (step.kind === 'pick_mapa') {
    if (step.map_id && st.pools.maps.some((m) => m.id === step.map_id)) return step.map_id;
    const bloq = mapasBloqueados(st);
    const libres = st.pools.maps.filter((m) => !bloq.has(m.id));
    const pool = libres.length ? libres : st.pools.maps;
    return shuffle(pool)[0].id;
  }
  if (step.kind === 'ban_mapa') {
    const bloq = mapasBloqueados(st);
    const libres = st.pools.maps.filter((m) => !bloq.has(m.id));
    return shuffle(libres)[0].id;
  }
  const bloq = civsBloqueadas(st, step);
  const libres = st.pools.civs.filter((c) => !bloq.has(c.id));
  const pool = libres.length ? libres : st.pools.civs;
  return shuffle(pool)[0].id;
}

/** Cierra el draft y vuelca el resultado a match_games / game_civs. */
function finalizar(draftId) {
  const d = get('SELECT * FROM drafts WHERE id = ?', draftId);
  const st = estadoDraft(draftId);

  run(
    "UPDATE drafts SET state = 'finalizado', deadline_at = NULL, finished_at = datetime('now') WHERE id = ?",
    draftId
  );

  const existente = get(
    'SELECT * FROM match_games WHERE match_id = ? AND game_no = ?',
    d.match_id,
    d.game_no
  );
  let gameId;
  if (existente) {
    run('UPDATE match_games SET map_id = ? WHERE id = ?', st.map_picked, existente.id);
    gameId = existente.id;
  } else {
    const info = run(
      'INSERT INTO match_games (match_id, game_no, map_id) VALUES (?, ?, ?)',
      d.match_id,
      d.game_no,
      st.map_picked
    );
    gameId = info.lastInsertRowid;
  }

  run('DELETE FROM game_civs WHERE game_id = ?', gameId);
  for (const p of st.civ_picks) {
    if (!p.user_id || !p.civ_id) continue;
    run(
      'INSERT OR REPLACE INTO game_civs (game_id, user_id, team_id, civ_id) VALUES (?, ?, ?, ?)',
      gameId,
      p.user_id,
      p.team_id,
      p.civ_id
    );
  }
  run("UPDATE matches SET status = 'en_juego' WHERE id = ? AND status = 'draft'", d.match_id);
}

/** Resuelve el paso actual al azar porque se venció el reloj. */
export function porTimeout(draftId) {
  return tx(() => {
    const d = get('SELECT * FROM drafts WHERE id = ?', draftId);
    if (!d || d.state !== 'en_curso') return null;
    const steps = JSON.parse(d.steps_json);
    const step = steps[d.current_step];
    if (!step) return null;

    const st = estadoDraft(draftId);
    const targetId = elegirAutomatico(st, step);
    const teamId = step.side === 'a' ? st.teams.a.id : step.side === 'b' ? st.teams.b.id : null;
    const forUserId = step.kind === 'pick_civ' ? jugadorDelSlot(st, step, null) : null;

    run(
      `INSERT INTO draft_actions (draft_id, step_idx, team_id, user_id, for_user_id, kind, target_id, auto)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 1)`,
      draftId,
      step.idx,
      teamId,
      forUserId,
      step.kind,
      targetId
    );
    avanzar(draftId);
    return estadoDraft(draftId);
  });
}

export function emitir(draftId) {
  const st = estadoDraft(draftId);
  if (st) publish(`match:${st.match_id}`, 'draft', st);
  return st;
}

/** Revisa relojes vencidos una vez por segundo. */
export function iniciarRelojes() {
  setInterval(() => {
    const vencidos = all(
      "SELECT id FROM drafts WHERE state = 'en_curso' AND deadline_at IS NOT NULL AND deadline_at <= ?",
      new Date().toISOString()
    );
    for (const { id } of vencidos) {
      try {
        porTimeout(id);
        emitir(id);
      } catch (err) {
        console.error('timeout draft', id, err.message);
      }
    }
  }, 1000).unref();
}
