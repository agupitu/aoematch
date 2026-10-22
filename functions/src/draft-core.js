// Motor de draft de mapa y civilizaciones, sin base de datos.
//
// Un draft pertenece a un partido y a un número de partida dentro de la serie.
// El plan de pasos se calcula una sola vez al crearlo y se guarda con el draft,
// así los dos equipos ven exactamente la misma secuencia.
//
// Todo trabaja sobre documentos ya leídos y devuelve los nuevos; quien lee y
// guarda, dentro de una transacción, es draft.js. El contexto (`ctx`) trae:
//   torneo   doc del torneo (reglas, `map_ids`, `civ_ids`, organizador y admins)
//   partido  doc del partido (`team_a_id`, `team_b_id`, marcador, `status`, `games`)
//   equipos  { a, b }: docs de los dos equipos (`captain_id`, `member_ids`)
//   rosters  { a, b }: jugadores de cada equipo, capitán primero
//            ({ id, display_name, avatar_url, steam_avatar, role })

import { civs as catalogoCivs, maps as catalogoMapas } from './catalogo.js';
import { conPartida } from './data/partidos.js';

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

const iso = (ms) => new Date(ms).toISOString();

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

// ------------------------------------------------------------------- pools

/** Mapas del torneo, en el orden del catálogo (por nombre). */
export function poolMapas(torneo) {
  const ids = new Set(torneo.map_ids ?? []);
  return catalogoMapas().filter((m) => ids.has(m.id));
}

/** Civilizaciones del torneo, en el orden del catálogo (por nombre). */
export function poolCivs(torneo) {
  const ids = new Set(torneo.civ_ids ?? []);
  return catalogoCivs().filter((c) => ids.has(c.id));
}

function mapasUsados(partido, antesDePartida) {
  return new Set(
    (partido.games ?? [])
      .filter((g) => g.game_no < antesDePartida && g.map_id != null)
      .map((g) => g.map_id)
  );
}

/** Civs ya usadas por un equipo en partidas anteriores de la serie. */
function civsUsadasPorEquipo(partido, teamId, antesDePartida) {
  const usadas = new Set();
  for (const g of partido.games ?? []) {
    if (g.game_no >= antesDePartida) continue;
    for (const c of g.civs ?? []) if (c.team_id === teamId) usadas.add(c.civ_id);
  }
  return usadas;
}

// ------------------------------------------------------------- crear draft

/**
 * Draft nuevo para la partida `gameNo` del partido. En la partida 1 el primer
 * turno se sortea; después arranca quien viene perdiendo.
 */
export function planDraft(ctx, gameNo = 1, rnd = Math.random) {
  const { torneo, partido } = ctx;
  if (!partido.team_a_id || !partido.team_b_id) throw new Error('Faltan equipos en el partido.');

  const mapas = poolMapas(torneo);
  const usados = mapasUsados(partido, gameNo);
  const disponibles = torneo.map_repeat ? mapas : mapas.filter((m) => !usados.has(m.id));

  let firstSide;
  if (gameNo === 1) {
    firstSide = rnd() < 0.5 ? 'a' : 'b';
  } else {
    firstSide = partido.score_a < partido.score_b ? 'a' : partido.score_b < partido.score_a ? 'b' : 'a';
  }

  // El organizador puede fijar el mapa de la primera partida (lo habitual en
  // series impares, para que nadie arranque con ventaja). Con map_mode 'fijo'
  // vale para todas las partidas de la serie.
  const fijaEstaPartida = torneo.map_mode === 'fijo' || gameNo === 1;
  const mapaFijo =
    torneo.first_map_id && fijaEstaPartida && mapas.some((m) => m.id === torneo.first_map_id)
      ? torneo.first_map_id
      : null;

  return {
    game_no: gameNo,
    state: 'espera',
    steps: construirPasos({ torneo, mapPoolSize: Math.max(1, disponibles.length), firstSide, mapaFijo }),
    current_step: 0,
    first_team_id: firstSide === 'a' ? partido.team_a_id : partido.team_b_id,
    deadline_at: null,
    ready_a: 0,
    ready_b: 0,
    actions: [],
    finished_at: null,
  };
}

// ------------------------------------------------------------ estado y reglas

/**
 * Estado completo del draft, listo para el cliente.
 * `viewerTeamId` oculta los picks ciegos del rival mientras el draft no termina.
 */
export function estadoDraft(ctx, draft, viewerTeamId = null) {
  const { torneo, partido, rosters } = ctx;
  const steps = draft.steps;
  const actions = [...draft.actions].sort((x, y) => x.step_idx - y.step_idx);

  const sideOf = (teamId) => (teamId === partido.team_a_id ? 'a' : teamId === partido.team_b_id ? 'b' : null);
  const teamOf = (side) => (side === 'a' ? partido.team_a_id : partido.team_b_id);

  const finished = draft.state === 'finalizado';
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

  const step = steps[draft.current_step] || null;

  return {
    id: `${partido.id}_${draft.game_no}`,
    match_id: partido.id,
    game_no: draft.game_no,
    state: draft.state,
    current_step: draft.current_step,
    total_steps: steps.length,
    deadline_at: draft.deadline_at,
    timer_s: torneo.draft_timer_s,
    ready: { a: !!draft.ready_a, b: !!draft.ready_b },
    first_team_id: draft.first_team_id,
    teams: {
      a: { id: partido.team_a_id, roster: rosters.a },
      b: { id: partido.team_b_id, roster: rosters.b },
    },
    steps,
    step,
    turn_team_id: step && step.side ? teamOf(step.side) : null,
    pools: { maps: poolMapas(torneo), civs: poolCivs(torneo) },
    maps_banned: actions.filter((a) => a.kind === 'ban_mapa').map((a) => a.target_id),
    map_picked: actions.find((a) => a.kind === 'pick_mapa')?.target_id ?? null,
    civs_banned: actions.filter((a) => a.kind === 'ban_civ').map((a) => a.target_id),
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
export function civsBloqueadas(state, step, partido) {
  const bloqueadas = new Set(state.civs_banned);
  const miEquipo = step.side === 'a' ? state.teams.a.id : state.teams.b.id;

  for (const p of state.civ_picks) {
    if (p.civ_id == null) continue;
    const mismoEquipo = p.team_id === miEquipo;
    if (mismoEquipo && !state.rules.civ_repeat_team) bloqueadas.add(p.civ_id);
    if (!mismoEquipo && !state.rules.civ_mirror) bloqueadas.add(p.civ_id);
  }

  if (!state.rules.civ_repeat_series) {
    for (const id of civsUsadasPorEquipo(partido, miEquipo, state.game_no)) bloqueadas.add(id);
  }
  return bloqueadas;
}

function mapasBloqueados(state) {
  return new Set(state.maps_banned);
}

/** ¿Se venció el reloj del paso actual? */
export function vencido(draft, ahora = Date.now()) {
  return draft.state === 'en_curso' && !!draft.deadline_at && draft.deadline_at <= iso(ahora);
}

// ------------------------------------------------------------------ permisos

const esCapitan = (uid, equipo) => !!equipo && equipo.captain_id === uid;
const enEquipo = (uid, equipo) => !!equipo && (equipo.member_ids ?? []).includes(uid);
const organiza = (uid, torneo) => torneo.organizer_id === uid || (torneo.admin_ids ?? []).includes(uid);

// ------------------------------------------------------------------ acciones
//
// Cada acción trabaja sobre copias y devuelve { ctx, draft, partido } con los
// documentos nuevos (`ctx.partido` es el mismo `partido`). draft.js los guarda.

function copia(ctx, draft) {
  const partido = structuredClone(ctx.partido);
  return { ctx: { ...ctx, partido }, partido, draft: structuredClone(draft) };
}

/** Marca "listo" a un equipo; cuando los dos están listos arranca el reloj. */
export function marcarListo(ctx, draft, user, { ahora = Date.now(), rnd } = {}) {
  const r = copia(ctx, draft);
  if (r.draft.state !== 'espera') return r;

  const side = enEquipo(user.id, ctx.equipos.a) ? 'a' : enEquipo(user.id, ctx.equipos.b) ? 'b' : null;
  if (side) {
    r.draft[`ready_${side}`] = 1;
  } else if (organiza(user.id, ctx.torneo)) {
    // El organizador puede arrancar el draft aunque no juegue el partido.
    r.draft.ready_a = 1;
    r.draft.ready_b = 1;
  } else {
    throw new Error('No sos parte de este partido.');
  }
  if (r.draft.ready_a && r.draft.ready_b) {
    r.draft.state = 'en_curso';
    r.partido.status = 'draft';
    renovarReloj(r, ahora);
    resolverAutomaticos(r, { ahora, rnd });
  }
  return r;
}

function renovarReloj(r, ahora) {
  const s = r.ctx.torneo.draft_timer_s;
  r.draft.deadline_at = s ? iso(ahora + s * 1000) : null;
}

/**
 * Registra una acción del draft.
 * opts: { kind, targetId, forUserId? }
 */
export function aplicarAccion(ctx, draft, user, opts, { ahora = Date.now(), rnd } = {}) {
  const r = copia(ctx, draft);
  const d = r.draft;
  if (d.state !== 'en_curso') throw new Error('El draft no está en curso.');

  const st = estadoDraft(r.ctx, d);
  const step = d.steps[d.current_step];
  if (!step) throw new Error('El draft ya terminó.');
  if (step.auto) throw new Error('Ese paso lo resuelve el servidor.');
  if (step.kind !== opts.kind) throw new Error(`Toca ${step.kind}, no ${opts.kind}.`);

  const teamId = step.side === 'a' ? st.teams.a.id : st.teams.b.id;
  const puede = esCapitan(user.id, ctx.equipos[step.side]) || organiza(user.id, ctx.torneo);
  if (!puede) throw new Error('Solo el capitán del equipo en turno puede draftear.');

  validarObjetivo(st, step, opts, r.partido);

  const forUserId = step.kind === 'pick_civ' ? jugadorDelSlot(st, step, opts.forUserId) : null;

  d.actions.push({
    step_idx: step.idx,
    team_id: teamId,
    user_id: user.id,
    for_user_id: forUserId,
    kind: opts.kind,
    target_id: opts.targetId,
    auto: 0,
    created_at: iso(ahora),
  });
  avanzar(r, { ahora, rnd });
  return r;
}

function jugadorDelSlot(st, step, forUserId) {
  const roster = step.side === 'a' ? st.teams.a.roster : st.teams.b.roster;
  if (forUserId) {
    const ok = roster.some((p) => p.id === forUserId);
    const yaTiene = st.civ_picks.some((p) => p.user_id === forUserId);
    if (ok && !yaTiene) return forUserId;
  }
  const tomados = new Set(st.civ_picks.map((p) => p.user_id));
  const libre = roster.find((p) => !tomados.has(p.id));
  return libre ? libre.id : (roster[step.slot]?.id ?? null);
}

function validarObjetivo(st, step, opts, partido) {
  const id = opts.targetId;
  if (step.kind === 'ban_mapa' || step.kind === 'pick_mapa') {
    const existe = st.pools.maps.some((m) => m.id === id);
    if (!existe) throw new Error('Ese mapa no está en el pool del torneo.');
    if (mapasBloqueados(st).has(id)) throw new Error('Ese mapa ya fue baneado.');
    if (st.map_picked) throw new Error('El mapa ya está decidido.');
  } else {
    const existe = st.pools.civs.some((c) => c.id === id);
    if (!existe) throw new Error('Esa civilización no está en el pool del torneo.');
    if (step.kind === 'pick_civ' && civsBloqueadas(st, step, partido).has(id)) {
      throw new Error('Esa civilización no está disponible.');
    }
    if (step.kind === 'ban_civ' && st.civs_banned.includes(id)) {
      throw new Error('Esa civilización ya fue baneada.');
    }
  }
}

/** Avanza el puntero y resuelve los pasos automáticos que queden por delante. */
function avanzar(r, { ahora, rnd }) {
  const d = r.draft;
  d.current_step += 1;
  if (d.current_step >= d.steps.length) return finalizar(r, ahora);
  renovarReloj(r, ahora);
  resolverAutomaticos(r, { ahora, rnd });
}

/** Registra el paso actual con una elección del servidor (`auto`). */
function accionAutomatica(r, { ahora, rnd }) {
  const d = r.draft;
  const step = d.steps[d.current_step];
  const st = estadoDraft(r.ctx, d);
  d.actions.push({
    step_idx: step.idx,
    team_id: step.side === 'a' ? st.teams.a.id : step.side === 'b' ? st.teams.b.id : null,
    user_id: null,
    for_user_id: step.kind === 'pick_civ' ? jugadorDelSlot(st, step, null) : null,
    kind: step.kind,
    target_id: elegirAutomatico(st, step, r.partido, rnd),
    auto: 1,
    created_at: iso(ahora),
  });
}

/** Ejecuta en cadena los pasos marcados como auto (mapa aleatorio, último mapa, etc). */
function resolverAutomaticos(r, { ahora, rnd }) {
  const d = r.draft;
  for (let guard = 0; guard < 200; guard++) {
    if (d.state !== 'en_curso') return;
    const step = d.steps[d.current_step];
    if (!step || !step.auto) return;

    accionAutomatica(r, { ahora, rnd });
    d.current_step += 1;
    if (d.current_step >= d.steps.length) return finalizar(r, ahora);
    renovarReloj(r, ahora);
  }
}

function elegirAutomatico(st, step, partido, rnd) {
  if (step.kind === 'pick_mapa') {
    if (step.map_id && st.pools.maps.some((m) => m.id === step.map_id)) return step.map_id;
    const bloq = mapasBloqueados(st);
    const libres = st.pools.maps.filter((m) => !bloq.has(m.id));
    const pool = libres.length ? libres : st.pools.maps;
    return shuffle(pool, rnd)[0].id;
  }
  if (step.kind === 'ban_mapa') {
    const bloq = mapasBloqueados(st);
    const libres = st.pools.maps.filter((m) => !bloq.has(m.id));
    return shuffle(libres, rnd)[0].id;
  }
  const bloq = civsBloqueadas(st, step, partido);
  const libres = st.pools.civs.filter((c) => !bloq.has(c.id));
  const pool = libres.length ? libres : st.pools.civs;
  return shuffle(pool, rnd)[0].id;
}

/** Cierra el draft y vuelca mapa y civs a la partida de la serie (`partido.games`). */
function finalizar(r, ahora) {
  const st = estadoDraft(r.ctx, r.draft);
  r.draft.state = 'finalizado';
  r.draft.deadline_at = null;
  r.draft.finished_at = iso(ahora);

  r.partido.games = conPartida(r.partido.games ?? [], {
    game_no: r.draft.game_no,
    map_id: st.map_picked,
    civs: st.civ_picks
      .filter((p) => p.user_id && p.civ_id)
      .map((p) => ({ user_id: p.user_id, team_id: p.team_id, civ_id: p.civ_id })),
  });
  if (r.partido.status === 'draft') r.partido.status = 'en_juego';
}

/**
 * Resuelve el paso actual al azar porque se venció el reloj. Con `aviso`
 * ({ step, deadline }, lo que encola el reloj de T22) no hace nada si el draft
 * ya pasó a otro paso o cambió el plazo: así una tarea vieja o repetida no
 * pisa nada. Devuelve null si no había nada que resolver.
 */
export function porTimeout(ctx, draft, aviso = {}, { ahora = Date.now(), rnd } = {}) {
  if (draft.state !== 'en_curso') return null;
  if (!draft.steps[draft.current_step]) return null;
  if (aviso.step !== undefined && aviso.step !== draft.current_step) return null;
  if (aviso.deadline !== undefined && aviso.deadline !== draft.deadline_at) return null;

  const r = copia(ctx, draft);
  accionAutomatica(r, { ahora, rnd });
  avanzar(r, { ahora, rnd });
  return r;
}
