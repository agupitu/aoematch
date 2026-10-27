// Llaves sin base de datos: generación, avance de resultados, playoffs, suizo y
// tabla de posiciones. Corre en el navegador del staff (plan Spark: no hay
// servidor) y en las pruebas; quien lee y escribe Firestore es otro módulo.
//
// Los cuadros se arman en memoria: los partidos se enlazan con ids que da
// `ids.nuevoId()` / `ids.nuevoIdEtapa()` antes de escribir, y se guardan de una
// vez. Formatos: eliminación simple, eliminación doble, liga (todos contra
// todos), grupos + playoff y suizo. Los partidos tienen la forma de
// matches/{id} (docs/firestore-modelo.md) con su `id`.

import { ordenarPor } from './orden.js';

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

// ------------------------------------------------------- cuadro en memoria
//
// Un cuadro en armado: { torneo, nuevoId, nuevoIdEtapa, partidos: Map id ->
// partido, etapas: [] }. Los partidos tienen la forma de matches/{id}.

function cuadroNuevo(torneo, { nuevoId, nuevoIdEtapa }) {
  return { torneo, nuevoId, nuevoIdEtapa, partidos: new Map(), etapas: [] };
}

function crearEtapa(c, idx, name, type) {
  const id = c.nuevoIdEtapa();
  c.etapas.push({ id, idx, name, type, groups: [] });
  return id;
}

function crearMatch(c, m) {
  const id = c.nuevoId();
  c.partidos.set(id, {
    id,
    tournament_id: c.torneo.id,
    stage_id: m.stage_id,
    group_id: m.group_id ?? null,
    bracket: m.bracket ?? 'W',
    round: m.round,
    position: m.position,
    label: m.label ?? null,
    team_a_id: m.team_a_id ?? null,
    team_b_id: m.team_b_id ?? null,
    winner_team_id: null,
    score_a: 0,
    score_b: 0,
    best_of: m.best_of,
    status: m.status ?? 'pendiente',
    scheduled_at: null,
    next_match_id: null,
    next_slot: null,
    loser_match_id: null,
    loser_slot: null,
    games: [],
    schedule_votes: [],
  });
  return id;
}

function enlazar(c, matchId, nextId, slot, { loser = false } = {}) {
  const m = c.partidos.get(matchId);
  if (loser) {
    m.loser_match_id = nextId;
    m.loser_slot = slot;
  } else {
    m.next_match_id = nextId;
    m.next_slot = slot;
  }
}

/**
 * Cierra un partido en memoria y pasa ganador y perdedor a los siguientes
 * (resolviendo los byes que eso destape). `partidos` es un Map id -> partido
 * con todos los del torneo; se modifican ahí mismo.
 */
export function cerrarEnMemoria(partidos, matchId, winnerTeamId, scoreA, scoreB, walkover = false) {
  const m = partidos.get(matchId);
  if (!m) throw new Error('Partido inexistente.');
  const loserTeamId = winnerTeamId === m.team_a_id ? m.team_b_id : m.team_a_id;

  m.winner_team_id = winnerTeamId;
  m.score_a = scoreA;
  m.score_b = scoreB;
  m.status = walkover ? 'walkover' : 'finalizado';

  const siguiente = m.next_match_id && partidos.get(m.next_match_id);
  if (siguiente) {
    siguiente[m.next_slot === 'b' ? 'team_b_id' : 'team_a_id'] = winnerTeamId;
    resolverBye(partidos, siguiente.id);
  }
  const dePerdedores = m.loser_match_id && loserTeamId && partidos.get(m.loser_match_id);
  if (dePerdedores) {
    dePerdedores[m.loser_slot === 'b' ? 'team_b_id' : 'team_a_id'] = loserTeamId;
    resolverBye(partidos, dePerdedores.id);
  }
}

/** ¿Algún partido sin cerrar todavía puede mandar un equipo a ese lugar? */
function llegaAlguien(partidos, matchId, slot) {
  for (const o of partidos.values()) {
    if (o.status !== 'pendiente') continue;
    if (o.next_match_id === matchId && (o.next_slot ?? 'a') === slot && puedeMandar(partidos, o, 'ganador')) return true;
    if (o.loser_match_id === matchId && (o.loser_slot ?? 'a') === slot && puedeMandar(partidos, o, 'perdedor')) return true;
  }
  return false;
}

/** Un partido sin cerrar tiene ganador si va a tener algún equipo, y perdedor si va a tener los dos. */
function puedeMandar(partidos, o, que) {
  const a = !!o.team_a_id || llegaAlguien(partidos, o.id, 'a');
  const b = !!o.team_b_id || llegaAlguien(partidos, o.id, 'b');
  return que === 'ganador' ? a || b : a && b;
}

/**
 * Si a un lugar vacío del partido ya no puede llegar nadie, el otro gana por
 * bye. Un partido ya cerrado no manda a nadie más, y uno que se gana por bye
 * no tiene perdedor: sin esto, la llave de perdedores de una doble eliminación
 * con byes quedaba esperando para siempre (pasaba en la versión SQLite). Un
 * partido al que no puede llegar nadie de ningún lado se cierra vacío.
 */
export function resolverBye(partidos, matchId) {
  const m = partidos.get(matchId);
  if (!m || m.status !== 'pendiente') return;
  const a = m.team_a_id, b = m.team_b_id;
  if (a && b) return;
  if (!a && llegaAlguien(partidos, matchId, 'a')) return;
  if (!b && llegaAlguien(partidos, matchId, 'b')) return;

  cerrarEnMemoria(partidos, matchId, a || b || null, a ? m.best_of : 0, b && !a ? m.best_of : 0, true);
}

// -------------------------------------------------------- eliminación simple

function eliminacionSimple(c, teams, { stageId, bracket = 'W', offsetRonda = 0 }) {
  const { torneo } = c;
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
        crearMatch(c, {
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
      enlazar(c, id, porRonda[r + 1][Math.floor(i / 2)], i % 2 === 0 ? 'a' : 'b');
    });
  }

  // Resuelve los byes de la primera ronda.
  for (const id of porRonda[0]) resolverBye(c.partidos, id);

  return porRonda;
}

function crearTercerPuesto(c, stageId) {
  const ganadores = [...c.partidos.values()].filter((m) => m.stage_id === stageId && m.bracket === 'W');
  const rondas = [...new Set(ganadores.map((m) => m.round))].sort((a, b) => a - b);
  const rondaSemis = rondas[rondas.length - 2] ?? 1;
  const semis = ganadores.filter((m) => m.round === rondaSemis).sort((a, b) => a.position - b.position);
  if (semis.length !== 2) return;
  const id = crearMatch(c, {
    stage_id: stageId,
    bracket: 'W',
    round: rondas[rondas.length - 1],
    position: 2,
    label: 'Tercer puesto',
    best_of: c.torneo.best_of,
  });
  enlazar(c, semis[0].id, id, 'a', { loser: true });
  enlazar(c, semis[1].id, id, 'b', { loser: true });
}

// --------------------------------------------------------- eliminación doble

function eliminacionDoble(c, teams) {
  const { torneo } = c;
  const stageId = crearEtapa(c, 1, 'Eliminación doble', 'eliminacion_doble');
  const n = potenciaDe2(Math.max(2, teams.length));
  const k = Math.log2(n);

  const wb = eliminacionSimple(c, teams, { stageId, bracket: 'W' });

  // Rondas del bracket de perdedores: 2k-2 en total.
  const lb = [];
  for (let r = 1; r <= 2 * k - 2; r++) {
    const cantidad = r % 2 === 1
      ? 2 ** (k - 1 - Math.ceil(r / 2))
      : 2 ** (k - 1 - r / 2);
    const ids = [];
    for (let p = 0; p < cantidad; p++) {
      ids.push(
        crearMatch(c, {
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
      if (actual.length === siguiente.length) enlazar(c, id, siguiente[i], 'a');
      else enlazar(c, id, siguiente[Math.floor(i / 2)], i % 2 === 0 ? 'a' : 'b');
    });
  }

  // Los perdedores del bracket de ganadores caen al de perdedores.
  // WB R1 -> LB R1 (cruzado); WB R(j+1) -> LB R(2j), en orden invertido.
  wb[0].forEach((id, i) => {
    const destino = lb[0][Math.floor(i / 2)];
    enlazar(c, id, destino, i % 2 === 0 ? 'a' : 'b', { loser: true });
  });
  for (let j = 1; j < k; j++) {
    const origen = wb[j];
    const destino = lb[2 * j - 1];
    if (!destino) break;
    origen.forEach((id, i) => {
      const idx = destino.length === origen.length ? destino.length - 1 - i : Math.floor(i / 2);
      enlazar(c, id, destino[idx], 'b', { loser: true });
    });
  }

  // Gran final: ganador del WB contra ganador del LB.
  const gf = crearMatch(c, {
    stage_id: stageId,
    bracket: 'F',
    round: k + 1,
    position: 1,
    label: 'Gran final',
    best_of: torneo.best_of_final || torneo.best_of,
  });
  enlazar(c, wb[wb.length - 1][0], gf, 'a');
  enlazar(c, lb[lb.length - 1][0], gf, 'b');

  for (const id of lb.flat()) resolverBye(c.partidos, id);
  return stageId;
}

// -------------------------------------------------------------------- liga

function roundRobin(c, teams, { stageId, groupId = null }) {
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
      crearMatch(c, {
        stage_id: stageId,
        group_id: groupId,
        round: r + 1,
        position: pos++,
        label: `Fecha ${r + 1}`,
        team_a_id: x.id,
        team_b_id: y.id,
        best_of: c.torneo.best_of,
      });
    }
    lista.splice(1, 0, lista.pop()); // rota dejando fijo el primero
  }
}

// --------------------------------------------------------- grupos + playoff

function gruposPlayoff(c, teams) {
  const stageId = crearEtapa(c, 1, 'Fase de grupos', 'grupos');
  const etapa = c.etapas.find((e) => e.id === stageId);
  const g = Math.max(2, c.torneo.group_count || 2);
  // Los grupos van dentro de la etapa; su id es la letra.
  etapa.groups = Array.from({ length: g }, (_, i) => {
    const letra = String.fromCharCode(65 + i);
    return { id: letra, name: `Grupo ${letra}`, team_ids: [] };
  });
  const integrantes = etapa.groups.map(() => []);

  // Serpiente por siembra para repartir parejo.
  teams.forEach((t, i) => {
    const vuelta = Math.floor(i / g);
    const pos = i % g;
    const idx = vuelta % 2 === 0 ? pos : g - 1 - pos;
    integrantes[idx].push(t);
    etapa.groups[idx].team_ids.push(t.id);
  });

  etapa.groups.forEach((grupo, i) => roundRobin(c, integrantes[i], { stageId, groupId: grupo.id }));
  return stageId;
}

// -------------------------------------------------------------------- suizo

function suizo(c, teams) {
  const stageId = crearEtapa(c, 1, 'Sistema suizo', 'suizo');
  const mitad = Math.ceil(teams.length / 2);
  const arriba = teams.slice(0, mitad);
  const abajo = teams.slice(mitad);
  arriba.forEach((t, i) => {
    const rival = abajo[i];
    if (!rival) return;
    crearMatch(c, {
      stage_id: stageId,
      round: 1,
      position: i + 1,
      label: 'Ronda 1',
      team_a_id: t.id,
      team_b_id: rival.id,
      best_of: c.torneo.best_of,
    });
  });
  return stageId;
}

// ------------------------------------------------------------------ entrada

/**
 * Arma en memoria el cuadro de un torneo con sus equipos ya ordenados por
 * siembra. Devuelve { etapas, partidos, seeds }: `seeds` son los equipos sin
 * siembra con la que les toca por su lugar en la lista.
 */
export function generarCuadro(torneo, teams, ids) {
  const c = cuadroNuevo(torneo, ids);

  if (torneo.format === 'eliminacion_simple') {
    const stageId = crearEtapa(c, 1, 'Eliminatoria', 'eliminacion_simple');
    eliminacionSimple(c, teams, { stageId });
    if (torneo.third_place) crearTercerPuesto(c, stageId);
  } else if (torneo.format === 'eliminacion_doble') {
    eliminacionDoble(c, teams);
  } else if (torneo.format === 'liga') {
    roundRobin(c, teams, { stageId: crearEtapa(c, 1, 'Liga', 'liga') });
  } else if (torneo.format === 'grupos_playoff') {
    gruposPlayoff(c, teams);
  } else if (torneo.format === 'suizo') {
    suizo(c, teams);
  } else {
    throw new Error(`Formato desconocido: ${torneo.format}`);
  }

  return {
    etapas: c.etapas,
    partidos: [...c.partidos.values()],
    seeds: teams.map((t, i) => (t.seed == null ? { id: t.id, seed: i + 1 } : null)).filter(Boolean),
  };
}

export const terminado = (m) => m.status === 'finalizado' || m.status === 'walkover';

/** Tabla de posiciones: 3 puntos por partido ganado; desempata por diferencia y por tantos a favor. */
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

// ----------------------------------------------------- avance de resultados

const CAMPOS_DE_RESULTADO = ['team_a_id', 'team_b_id', 'winner_team_id', 'score_a', 'score_b', 'status'];

/**
 * Cierra un partido y pasa ganador y perdedor a los siguientes. `partidos` son
 * todos los del torneo, sin tocar. Devuelve { cambios: [{ id, ...campos }],
 * partido, terminado }: solo los campos de resultado que cambiaron en cada
 * partido, el partido cerrado y si ya no queda ninguno por jugar.
 */
export function cerrarPartido(partidos, matchId, winnerTeamId, scoreA, scoreB, walkover = false) {
  const antes = new Map(partidos.map((p) => [p.id, p]));
  const mapa = new Map(partidos.map((p) => [p.id, { ...p }]));
  cerrarEnMemoria(mapa, matchId, winnerTeamId, scoreA, scoreB, walkover);

  const cambios = [];
  for (const p of mapa.values()) {
    const campos = {};
    for (const c of CAMPOS_DE_RESULTADO) if (p[c] !== antes.get(p.id)[c]) campos[c] = p[c];
    if (Object.keys(campos).length) cambios.push({ id: p.id, ...campos });
  }
  return { cambios, partido: mapa.get(matchId), terminado: [...mapa.values()].every(terminado) };
}

// ------------------------------------------------------- grupos + playoff

/**
 * Cuadro final una vez cerrada la fase de grupos. Devuelve { etapas,
 * partidos, seeds } como `generarCuadro`, con la siembra de los clasificados
 * (primeros de grupo arriba, después segundos...).
 */
export function cuadroDePlayoffs(torneo, etapas, equipos, partidos, ids) {
  const deGrupos = etapas.find((e) => e.type === 'grupos');
  if (!deGrupos) throw new Error('Este torneo no tiene fase de grupos.');
  if (etapas.some((e) => e.type !== 'grupos')) throw new Error('Los playoffs ya estaban generados.');

  const porId = new Map(equipos.map((e) => [e.id, e]));
  const clasificados = [];
  for (const grupo of ordenarPor(deGrupos.groups, 'name')) {
    const tabla = tablaDesde(
      grupo.team_ids.map((id) => porId.get(id)).filter(Boolean),
      partidos.filter((m) => m.stage_id === deGrupos.id && m.group_id === grupo.id && terminado(m))
    );
    clasificados.push(...tabla.slice(0, torneo.group_advance).map((fila, i) => ({ ...fila.team, _pos: i + 1 })));
  }
  clasificados.sort((a, b) => a._pos - b._pos);

  const c = cuadroNuevo(torneo, ids);
  const stageId = crearEtapa(c, 2, 'Playoffs', 'eliminacion_simple');
  eliminacionSimple(c, clasificados, { stageId });
  return {
    etapas: c.etapas,
    partidos: [...c.partidos.values()],
    seeds: clasificados.map((t, i) => ({ id: t.id, seed: i + 1 })),
  };
}

// -------------------------------------------------------------------- suizo

/**
 * Siguiente ronda suiza según puntaje, evitando revanchas. Devuelve { ronda,
 * partidos, bye }: los partidos nuevos y el equipo que queda libre (o null).
 */
export function rondaSuiza(torneo, etapas, equipos, partidos, ids) {
  const etapa = etapas.find((e) => e.type === 'suizo');
  if (!etapa) throw new Error('Este torneo no es suizo.');

  const jugados = partidos.filter((m) => m.stage_id === etapa.id);
  if (jugados.some((m) => !terminado(m))) throw new Error('Faltan partidos por cerrar en la ronda actual.');
  const ultima = Math.max(0, ...jugados.map((m) => m.round));
  if (torneo.swiss_rounds && ultima >= torneo.swiss_rounds) {
    throw new Error('El suizo ya completó todas sus rondas.');
  }

  const previos = new Set(jugados.flatMap((m) => [`${m.team_a_id}-${m.team_b_id}`, `${m.team_b_id}-${m.team_a_id}`]));
  const libres = tablaDesde(equipos, jugados).map((r) => r.team);
  const parejas = [];
  while (libres.length > 1) {
    const a = libres.shift();
    let idx = libres.findIndex((b) => !previos.has(`${a.id}-${b.id}`));
    if (idx === -1) idx = 0;
    parejas.push([a, libres.splice(idx, 1)[0]]);
  }

  const ronda = ultima + 1;
  const c = cuadroNuevo(torneo, ids);
  parejas.forEach(([a, b], i) =>
    crearMatch(c, {
      stage_id: etapa.id,
      round: ronda,
      position: i + 1,
      label: `Ronda ${ronda}`,
      team_a_id: a.id,
      team_b_id: b.id,
      best_of: torneo.best_of,
    })
  );
  return { ronda, partidos: [...c.partidos.values()], bye: libres[0] ?? null };
}

// ------------------------------------------------- partidas de una serie

/** Partidas que necesita un equipo para ganar la serie al mejor de `bestOf`. */
export const paraGanar = (bestOf) => Math.floor(bestOf / 2) + 1;

/**
 * Saca de los partidos siguientes al ganador y al perdedor de un partido que
 * se reabre. Si alguno de esos ya tiene resultado, no se puede: hay que
 * corregir ese primero.
 */
function reabrir(mapa, m) {
  for (const [destino, slot] of [[m.next_match_id, m.next_slot], [m.loser_match_id, m.loser_slot]]) {
    const d = destino && mapa.get(destino);
    if (!d) continue;
    const campo = slot === 'b' ? 'team_b_id' : 'team_a_id';
    if (d[campo] == null) continue;
    if (terminado(d) || (d.games ?? []).some((g) => g.winner_team_id)) {
      throw new Error('El partido siguiente ya tiene resultado: corregí ese primero.');
    }
    d[campo] = null;
  }
  m.winner_team_id = null;
  m.status = 'en_juego';
}

const CAMPOS_DE_SERIE = [...CAMPOS_DE_RESULTADO, 'games'];

/**
 * Guarda las partidas de una serie (cargadas o corregidas por el staff) y deja
 * la llave coherente: con la serie definida, la cierra y pasa ganador y
 * perdedor; si una corrección cambia o borra el ganador, la reabre y saca al
 * equipo de los partidos siguientes que todavía no se jugaron.
 * `partidos` son todos los del torneo, sin tocar. Devuelve { cambios: [{ id,
 * ...campos }], partido, terminado } como `cerrarPartido`.
 */
export function cargarPartidas(partidos, matchId, games) {
  const antes = new Map(partidos.map((p) => [p.id, p]));
  const mapa = new Map(partidos.map((p) => [p.id, { ...p }]));
  const m = mapa.get(matchId);
  if (!m) throw new Error('Partido inexistente.');
  if (!m.team_a_id || !m.team_b_id) throw new Error('Faltan equipos en el partido.');
  if (games.some((g) => g.winner_team_id && ![m.team_a_id, m.team_b_id].includes(g.winner_team_id))) {
    throw new Error('Ese equipo no juega este partido.');
  }

  const lista = ordenarPor(games, 'game_no');
  const ganadas = (teamId) => lista.filter((g) => g.winner_team_id === teamId).length;
  const a = ganadas(m.team_a_id);
  const b = ganadas(m.team_b_id);
  if (a + b > m.best_of) throw new Error(`La serie es al mejor de ${m.best_of}.`);
  const necesarias = paraGanar(m.best_of);
  const ganador = a >= necesarias ? m.team_a_id : b >= necesarias ? m.team_b_id : null;

  const ganadorAntes = terminado(m) ? m.winner_team_id : null;
  if (ganadorAntes && ganadorAntes !== ganador) reabrir(mapa, m);

  m.games = lista;
  m.score_a = a;
  m.score_b = b;
  if (ganador && ganadorAntes !== ganador) {
    cerrarEnMemoria(mapa, matchId, ganador, a, b);
  } else if (!ganador && a + b > 0) {
    m.status = 'en_juego';
  }

  const cambios = [];
  for (const p of mapa.values()) {
    const campos = {};
    for (const c of CAMPOS_DE_SERIE) {
      const viejo = antes.get(p.id)[c];
      const distinto = c === 'games' ? JSON.stringify(p[c] ?? []) !== JSON.stringify(viejo ?? []) : p[c] !== viejo;
      if (distinto) campos[c] = p[c];
    }
    if (Object.keys(campos).length) cambios.push({ id: p.id, ...campos });
  }
  return { cambios, partido: m, terminado: [...mapa.values()].every(terminado) };
}

/** Walkover: gana `winnerTeamId` sin jugar (el rival no se presentó). */
export function darWalkover(partidos, matchId, winnerTeamId) {
  const m = partidos.find((p) => p.id === matchId);
  if (!m) throw new Error('Partido inexistente.');
  if (![m.team_a_id, m.team_b_id].includes(winnerTeamId)) throw new Error('Ese equipo no juega este partido.');
  if (terminado(m)) throw new Error('El partido ya tiene resultado.');
  const n = paraGanar(m.best_of);
  const a = winnerTeamId === m.team_a_id ? n : 0;
  return cerrarPartido(partidos, matchId, winnerTeamId, a, n - a, true);
}
