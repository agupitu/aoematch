// Carga el catálogo (civs y mapas) y, cuando se ejecuta directo, crea datos de
// demostración: jugadores con disponibilidad, un torneo abierto a inscripción y
// otro ya en curso con las llaves armadas.
//
//   npm run seed          -> agrega la demo si la base está vacía
//   npm run reset         -> borra todo y vuelve a sembrar

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { all, get, run, tx, SERVER_DIR } from './db.js';
import { hashPassword } from './auth.js';
import { generarLlaves, cerrarMatch } from './brackets.js';
import { crearDraft, marcarListo, aplicarAccion, estadoDraft, civsBloqueadas } from './draft.js';

/** Inserta civs y mapas desde server/data/*.json (idempotente). */
export function cargarCatalogo() {
  const civsPath = join(SERVER_DIR, 'data/civs.json');
  const mapsPath = join(SERVER_DIR, 'data/maps.json');
  if (!existsSync(civsPath) || !existsSync(mapsPath)) {
    console.warn('Faltan server/data/civs.json y maps.json. Corré: npm run assets');
    return;
  }
  const civs = JSON.parse(readFileSync(civsPath, 'utf8'));
  const maps = JSON.parse(readFileSync(mapsPath, 'utf8'));

  tx(() => {
    for (const c of civs) {
      run(
        `INSERT INTO civs (id, slug, name_es, name_en, grp, flag) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name_es=excluded.name_es,
           name_en=excluded.name_en, grp=excluded.grp, flag=excluded.flag`,
        c.id, c.slug, c.name_es, c.name_en, c.group, c.flag
      );
    }
    for (const m of maps) {
      run(
        `INSERT INTO maps (id, slug, name_es, img) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name_es=excluded.name_es, img=excluded.img`,
        m.id, m.slug, m.name_es, m.img
      );
    }
  });
}

// ------------------------------------------------------------------- demo

const NOMBRES = [
  'Kaiser', 'Mitoe', 'Hazza54', 'Garja', 'Aizamk', 'Interjection', 'Fifty', 'Vividlyplain',
  'Lordraphael', 'Sebnan', 'Mr.Bramboy', 'SoldieR', 'Silverbadger', 'Jaeger', 'Dolan', 'Yagami',
  'Riotcoke', 'Pitu', 'Bacso', 'Elvisgomez', 'Chrazini', 'Demonsnipe', 'Papa', 'Nanaki',
];

const ZONAS = ['America/Argentina/Buenos_Aires', 'Europe/Madrid', 'Europe/Berlin', 'America/Sao_Paulo', 'UTC'];

function bloquesAleatorios(rnd) {
  // 3 a 6 franjas semanales de 2-5 horas.
  const bloques = [];
  const dias = [...Array(7).keys()].sort(() => rnd() - 0.5).slice(0, 3 + Math.floor(rnd() * 4));
  for (const d of dias) {
    const inicioH = 16 + Math.floor(rnd() * 5);          // tarde/noche
    const largoH = 2 + Math.floor(rnd() * 4);
    const start = d * 1440 + inicioH * 60;
    bloques.push({ start_min: start, end_min: Math.min(d * 1440 + 1440, start + largoH * 60) });
  }
  return bloques;
}

function rngSemilla(semilla) {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function crearUsuario(nombre, rnd, { admin = false } = {}) {
  const existente = get('SELECT * FROM users WHERE display_name = ?', nombre);
  if (existente) return existente;
  const email = `${nombre.toLowerCase().replace(/[^a-z0-9]/g, '')}@demo.aoematch`;
  const info = run(
    `INSERT INTO users (email, pass_hash, display_name, timezone, rating_1v1, rating_team, is_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    email,
    hashPassword('demo1234'),
    nombre,
    ZONAS[Math.floor(rnd() * ZONAS.length)],
    900 + Math.floor(rnd() * 900),
    900 + Math.floor(rnd() * 900),
    admin ? 1 : 0
  );
  const u = get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
  for (const b of bloquesAleatorios(rnd)) {
    run('INSERT INTO availability (user_id, start_min, end_min) VALUES (?, ?, ?)', u.id, b.start_min, b.end_min);
  }
  return u;
}

const POOL_COMPETITIVO = [
  'yucatan', 'andes', 'decan', 'saguenay', 'grandes-llanuras', 'arabia', 'rio-amarillo',
  'bayou', 'carolina', 'california', 'pampa', 'sonora', 'manchuria',
];

function poolMapas() {
  const ids = [];
  for (const slug of POOL_COMPETITIVO) {
    const m = get('SELECT id FROM maps WHERE slug = ?', slug);
    if (m) ids.push(m.id);
  }
  if (ids.length < 7) {
    for (const m of all('SELECT id FROM maps ORDER BY id LIMIT 9')) {
      if (!ids.includes(m.id)) ids.push(m.id);
    }
  }
  return ids;
}

function crearTorneo(campos) {
  const existente = get('SELECT * FROM tournaments WHERE slug = ?', campos.slug);
  if (existente) return existente;
  const cols = Object.keys(campos);
  run(
    `INSERT INTO tournaments (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ...cols.map((c) => campos[c])
  );
  const t = get('SELECT * FROM tournaments WHERE slug = ?', campos.slug);
  run("INSERT INTO chat_rooms (tournament_id, kind, name) VALUES (?, 'torneo', 'General')", t.id);
  for (const id of poolMapas()) {
    run('INSERT OR IGNORE INTO tournament_maps (tournament_id, map_id) VALUES (?, ?)', t.id, id);
  }
  for (const c of all('SELECT id FROM civs')) {
    run('INSERT OR IGNORE INTO tournament_civs (tournament_id, civ_id) VALUES (?, ?)', t.id, c.id);
  }
  return t;
}

function cargarPremios(torneoId, premios) {
  if (get('SELECT 1 FROM tournament_prizes WHERE tournament_id = ?', torneoId)) return;
  premios.forEach((p, i) => {
    run(
      `INSERT INTO tournament_prizes (tournament_id, position, label, kind, amount_cents, percent, extra)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      torneoId, i + 1, p.label, p.kind, p.amount_cents ?? 0, p.percent ?? 0, p.extra ?? null
    );
  });
}

export function sembrarDemo() {
  const rnd = rngSemilla(20261020);
  const usuarios = NOMBRES.map((n, i) => crearUsuario(n, rnd, { admin: i === 0 }));
  const organizador = usuarios[0];

  // --- torneo 1: 3v3, inscripción abierta, con sueltos para el armador
  const t1 = crearTorneo({
    slug: 'copa-sudamericana-3v3',
    name: 'Copa Sudamericana 3v3',
    description: 'Torneo por equipos con draft de civilizaciones en serpiente y pool de mapas competitivo.',
    rules_md: '- Al mejor de 3.\n- Sin repetir civ dentro del equipo.\n- Deadline de draft: 60 s por pick.',
    organizer_id: organizador.id,
    status: 'inscripcion',
    format: 'eliminacion_simple',
    team_size: 3,
    best_of: 3,
    best_of_final: 5,
    map_mode: 'ban_hasta_uno',
    civ_mode: 'snake',
    civ_bans: 1,
    civ_pattern: '1-2-2-1',
    civ_repeat_team: 0,
    civ_mirror: 1,
    civ_repeat_series: 0,
    draft_timer_s: 60,
    entry_fee_cents: 500000,
    currency: 'ARS',
    payment_link: 'https://link.mercadopago.com.ar/ejemplo',
    allow_solo: 1,
    third_place: 1,
    prize_pool_mode: 'inscripciones',
    prize_pool_pct: 80,
    prize_notes: 'Se paga por Mercado Pago dentro de las 48 h de terminado el torneo.',
  });

  cargarPremios(t1.id, [
    { label: 'Campeón', kind: 'porcentaje', percent: 60 },
    { label: 'Subcampeón', kind: 'porcentaje', percent: 30 },
    { label: 'Tercer puesto', kind: 'porcentaje', percent: 10 },
  ]);

  for (const u of usuarios.slice(1, 16)) {
    if (get('SELECT 1 FROM registrations WHERE tournament_id = ? AND user_id = ?', t1.id, u.id)) continue;
    run(
      "INSERT INTO registrations (tournament_id, user_id, kind, status, paid, paid_at) VALUES (?, ?, 'solo', 'confirmada', ?, ?)",
      t1.id, u.id, rnd() < 0.6 ? 1 : 0, rnd() < 0.6 ? new Date().toISOString() : null
    );
  }

  // --- torneo 2: 1v1 en curso, con llaves listas
  const t2 = crearTorneo({
    slug: 'ladder-1v1-de-otono',
    name: 'Ladder 1v1 de Otoño',
    description: 'Eliminación simple a 8, ban de mapas hasta que queda uno y civs a elección libre.',
    organizer_id: organizador.id,
    status: 'inscripcion',
    format: 'eliminacion_simple',
    team_size: 1,
    best_of: 3,
    map_mode: 'ban_hasta_uno',
    civ_mode: 'snake',
    civ_pattern: '1-1',
    civ_mirror: 1,
    draft_timer_s: 45,
    entry_fee_cents: 0,
    currency: 'ARS',
    allow_solo: 1,
    prize_pool_mode: 'fijo',
    prize_pool_cents: 15000000,
  });

  cargarPremios(t2.id, [
    { label: 'Campeón', kind: 'fijo', amount_cents: 10000000 },
    { label: 'Subcampeón', kind: 'fijo', amount_cents: 5000000, extra: 'Cupo directo a la próxima edición' },
  ]);

  const yaTieneEquipos = get('SELECT COUNT(*) AS n FROM teams WHERE tournament_id = ?', t2.id).n;
  if (!yaTieneEquipos) {
    usuarios.slice(0, 8).forEach((u, i) => {
      const info = run('INSERT INTO teams (tournament_id, name, captain_id, seed) VALUES (?, ?, ?, ?)',
        t2.id, u.display_name, u.id, i + 1);
      const teamId = info.lastInsertRowid;
      run("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'capitan')", teamId, u.id);
      run("INSERT INTO registrations (tournament_id, user_id, team_id, kind, status, paid) VALUES (?, ?, ?, 'equipo', 'confirmada', 1)",
        t2.id, u.id, teamId);
    });
    generarLlaves(t2.id);
  }

  // --- torneo 3: 2v2 por equipos ya inscriptos, listo para armar llaves
  const t3 = crearTorneo({
    slug: 'clan-wars-2v2',
    name: 'Clan Wars 2v2',
    description: 'Formato de grupos y playoff. Draft de civs ciego para que nadie contrapickee.',
    organizer_id: organizador.id,
    status: 'armado',
    format: 'grupos_playoff',
    team_size: 2,
    best_of: 3,
    group_count: 2,
    group_advance: 2,
    map_mode: 'ban_pick',
    map_bans: 2,
    civ_mode: 'ciega',
    civ_mirror: 1,
    civ_repeat_team: 0,
    draft_timer_s: 90,
    entry_fee_cents: 0,
    allow_solo: 0,
  });

  if (!get('SELECT COUNT(*) AS n FROM teams WHERE tournament_id = ?', t3.id).n) {
    const nombres = ['Los Jinetes', 'Hussar Gang', 'Falconetes', 'Mamelucos', 'Doppel Crew', 'Oprichniks'];
    nombres.forEach((nombre, i) => {
      const a = usuarios[i * 2 % usuarios.length];
      const b = usuarios[(i * 2 + 1) % usuarios.length];
      const info = run('INSERT INTO teams (tournament_id, name, captain_id, seed) VALUES (?, ?, ?, ?)',
        t3.id, nombre, a.id, i + 1);
      const teamId = info.lastInsertRowid;
      run("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'capitan')", teamId, a.id);
      run("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'jugador')", teamId, b.id);
      run("INSERT INTO chat_rooms (tournament_id, team_id, kind, name) VALUES (?, ?, 'equipo', ?)", t3.id, teamId, nombre);
      for (const u of [a, b]) {
        run(
          `INSERT OR IGNORE INTO registrations (tournament_id, user_id, team_id, kind, status, paid)
           VALUES (?, ?, ?, 'equipo', 'confirmada', 1)`,
          t3.id, u.id, teamId
        );
      }
    });
  }

  const mock = sembrarMockup(rnd, organizador);

  console.log(`Demo lista.
  Organizador: ${organizador.email} / demo1234
  Torneos: /t/${mock.slug} (mockup completo), /t/${t1.slug}, /t/${t2.slug}, /t/${t3.slug}`);
}

const REGLAS_MOCK = [
  '- Series al mejor de 3, final al mejor de 5.',
  '- Mapa de la primera partida fijo (Decán); el resto sale de bans alternados.',
  '- Un ban de civilización por equipo y draft en serpiente 1-2-1.',
  '- Sin espejos y sin repetir civilización entre partidas de la misma serie.',
].join('\n');

// ------------------------------------------------- torneo mockup completo
//
// Un torneo de muestra con todo andando: 16 jugadores en 8 equipos, cuartos ya
// jugados con sus drafts reales, semis agendadas y una con el draft abierto a
// mitad de camino. Sirve para ver la app funcionando sin cargar nada a mano.

const NOMBRES_MOCK = [
  'Tincho', 'Lauti', 'ElMago', 'Gonza', 'Pichu', 'ElRuso', 'Cacho', 'Zorro',
  'Pampa', 'ElTano', 'Vasco', 'Colo', 'Tucu', 'Morocho', 'Pulga', 'Pity',
];

const EQUIPOS_MOCK = [
  ['Jinetes del Plata', 'JDP'],
  ['Guardia Imperial', 'GIM'],
  ['Húsares de Córdoba', 'HUS'],
  ['Falconetes FC', 'FAL'],
  ['Mamelucos', 'MAM'],
  ['Doppel Crew', 'DOP'],
  ['Oprichniks', 'OPR'],
  ['Lanceros del Sur', 'LAN'],
];

const DIA_MS = 86400000;

/** Fecha ISO a N días de hoy, a la hora UTC pedida. */
function fechaRelativa(dias, horaUtc) {
  const d = new Date(Date.now() + dias * DIA_MS);
  d.setUTCHours(horaUtc, 0, 0, 0);
  return d.toISOString();
}

function capitanDe(teamId) {
  const t = get('SELECT captain_id FROM teams WHERE id = ?', teamId);
  return get('SELECT * FROM users WHERE id = ?', t.captain_id);
}

/** Un objetivo válido para el paso actual del draft. */
function objetivoLegal(st, step, rnd) {
  if (step.kind === 'ban_mapa' || step.kind === 'pick_mapa') {
    const baneados = new Set(st.maps_banned);
    const libres = st.pools.maps.filter((m) => !baneados.has(m.id));
    return libres[Math.floor(rnd() * libres.length)].id;
  }
  const bloqueadas = civsBloqueadas(st, step);
  const libres = st.pools.civs.filter((c) => !bloqueadas.has(c.id));
  return libres[Math.floor(rnd() * libres.length)].id;
}

/**
 * Corre un draft con acciones reales (las mismas que haría un capitán).
 * `pasos` permite dejarlo a mitad de camino.
 */
function correrDraft(matchId, gameNo, rnd, pasos = Infinity) {
  const m = get('SELECT * FROM matches WHERE id = ?', matchId);
  const draft = crearDraft(matchId, gameNo);
  marcarListo(draft.id, capitanDe(m.team_a_id));
  marcarListo(draft.id, capitanDe(m.team_b_id));

  let hechos = 0;
  for (let guard = 0; guard < 300 && hechos < pasos; guard++) {
    const st = estadoDraft(draft.id);
    if (!st || st.state !== 'en_curso' || !st.step || st.step.auto) break;
    const teamId = st.step.side === 'a' ? st.teams.a.id : st.teams.b.id;
    aplicarAccion(draft.id, capitanDe(teamId), {
      kind: st.step.kind,
      targetId: objetivoLegal(st, st.step, rnd),
    });
    hechos++;
  }
  return draft;
}

function salaDePartido(torneoId, matchId, nombre) {
  const ya = get("SELECT * FROM chat_rooms WHERE match_id = ? AND kind = 'partido'", matchId);
  if (ya) return ya;
  const info = run(
    "INSERT INTO chat_rooms (tournament_id, match_id, kind, name) VALUES (?, ?, 'partido', ?)",
    torneoId, matchId, nombre
  );
  return get('SELECT * FROM chat_rooms WHERE id = ?', info.lastInsertRowid);
}

function decir(roomId, userId, body, minutosAtras = 0) {
  run(
    'INSERT INTO chat_messages (room_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
    roomId, userId, body,
    new Date(Date.now() - minutosAtras * 60000).toISOString().slice(0, 19).replace('T', ' ')
  );
}

function sembrarMockup(rnd, organizador) {
  const mapaFijo = get("SELECT id FROM maps WHERE slug = 'decan'") || get('SELECT id FROM maps LIMIT 1');

  const t = crearTorneo({
    slug: 'copa-aoematch-mockup',
    name: 'Copa AoE III Draft 2v2',
    description:
      'Torneo de muestra con todo funcionando: llaves, drafts ya jugados, horarios y premios. Entrá a cualquier partido para ver el draft.',
    rules_md: REGLAS_MOCK,
    organizer_id: organizador.id,
    status: 'en_curso',
    format: 'eliminacion_simple',
    team_size: 2,
    best_of: 3,
    best_of_final: 5,
    third_place: 1,
    map_mode: 'ban_hasta_uno',
    first_map_id: mapaFijo.id,
    map_repeat: 0,
    civ_mode: 'snake',
    civ_bans: 1,
    civ_pattern: '1-2-1',
    civ_repeat_team: 0,
    civ_mirror: 0,
    civ_repeat_series: 0,
    draft_timer_s: 60,
    entry_fee_cents: 300000,
    currency: 'ARS',
    payment_link: 'https://link.mercadopago.com.ar/ejemplo',
    payment_notes: 'Transferencia o Mercado Pago. Mandá el comprobante por Discord.',
    allow_solo: 0,
    reg_closes_at: fechaRelativa(-9, 23),
    starts_at: fechaRelativa(-7, 22),
    prize_pool_mode: 'fijo',
    prize_pool_cents: 30000000,
    prize_notes: 'Se paga dentro de la semana siguiente a la final.',
  });

  if (get('SELECT COUNT(*) AS n FROM teams WHERE tournament_id = ?', t.id).n) return t;

  cargarPremios(t.id, [
    { label: 'Campeón', kind: 'porcentaje', percent: 55 },
    { label: 'Subcampeón', kind: 'porcentaje', percent: 30 },
    { label: 'Tercer puesto', kind: 'porcentaje', percent: 15, extra: 'Cupo directo a la próxima edición' },
  ]);

  // --- 16 jugadores en 8 equipos
  const jugadores = NOMBRES_MOCK.map((n) => crearUsuario(n, rnd));

  // Prime time compartido (mar/jue/dom 22:00–23:30 UTC y sábado a la tarde),
  // para que el cruce de horarios tenga algo que mostrar.
  const COMUNES = [
    [1 * 1440 + 22 * 60, 1 * 1440 + 23 * 60 + 30],
    [3 * 1440 + 22 * 60, 3 * 1440 + 23 * 60 + 30],
    [6 * 1440 + 22 * 60, 6 * 1440 + 23 * 60 + 30],
    [5 * 1440 + 18 * 60, 5 * 1440 + 22 * 60],
  ];
  for (const u of jugadores) {
    for (const [desde, hasta] of COMUNES) {
      run('INSERT INTO availability (user_id, start_min, end_min) VALUES (?, ?, ?)', u.id, desde, hasta);
    }
  }

  const equipos = EQUIPOS_MOCK.map(([nombre, tag], i) => {
    const a = jugadores[i * 2];
    const b = jugadores[i * 2 + 1];
    const info = run(
      'INSERT INTO teams (tournament_id, name, tag, captain_id, seed) VALUES (?, ?, ?, ?, ?)',
      t.id, nombre, tag, a.id, i + 1
    );
    const teamId = info.lastInsertRowid;
    run("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'capitan')", teamId, a.id);
    run("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'jugador')", teamId, b.id);
    run("INSERT INTO chat_rooms (tournament_id, team_id, kind, name) VALUES (?, ?, 'equipo', ?)", t.id, teamId, nombre);
    for (const u of [a, b]) {
      run(
        `INSERT INTO registrations (tournament_id, user_id, team_id, kind, status, paid, paid_at)
         VALUES (?, ?, ?, 'equipo', 'confirmada', 1, ?)`,
        t.id, u.id, teamId, fechaRelativa(-10, 12)
      );
    }
    return { id: teamId, nombre, jugadores: [a, b] };
  });

  generarLlaves(t.id);

  // --- cuartos: jugados de verdad, con un draft por partida
  const fuerza = (teamId) =>
    all('SELECT u.rating_team FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ?', teamId)
      .reduce((s, u) => s + (u.rating_team || 1000), 0);

  const cuartos = all(
    "SELECT * FROM matches WHERE tournament_id = ? AND bracket = 'W' AND round = 1 ORDER BY position",
    t.id
  );

  cuartos.forEach((m, i) => {
    if (!m.team_a_id || !m.team_b_id) return;
    run('UPDATE matches SET scheduled_at = ? WHERE id = ?', fechaRelativa(-6 + Math.floor(i / 2), 22 + (i % 2)), m.id);

    const ganaA = fuerza(m.team_a_id) + rnd() * 600 >= fuerza(m.team_b_id) + rnd() * 600;
    const apretado = rnd() < 0.5;
    const partidas = apretado ? 3 : 2;
    for (let g = 1; g <= partidas; g++) correrDraft(m.id, g, rnd);

    cerrarMatch(
      m.id,
      ganaA ? m.team_a_id : m.team_b_id,
      ganaA ? 2 : apretado ? 1 : 0,
      ganaA ? (apretado ? 1 : 0) : 2
    );
  });

  // --- semis agendadas; la primera ya tiene el draft abierto
  const semis = all(
    "SELECT * FROM matches WHERE tournament_id = ? AND bracket = 'W' AND round = 2 ORDER BY position",
    t.id
  );
  semis.forEach((m, i) => {
    run("UPDATE matches SET scheduled_at = ?, status = 'agendado' WHERE id = ?", fechaRelativa(2 + i, 23), m.id);
  });
  // La primera semi queda con el draft abierto pero sin arrancar: el que entra
  // lo empieza y ve la secuencia paso a paso.
  if (semis[0] && semis[0].team_a_id && semis[0].team_b_id) crearDraft(semis[0].id, 1);

  for (const m of all(
    "SELECT * FROM matches WHERE tournament_id = ? AND round = 3 ORDER BY position",
    t.id
  )) {
    run('UPDATE matches SET scheduled_at = ? WHERE id = ?', fechaRelativa(6, 23), m.id);
  }

  // --- algo de charla para que no se vea vacío
  const general = get("SELECT * FROM chat_rooms WHERE tournament_id = ? AND kind = 'torneo'", t.id);
  if (general) {
    decir(general.id, organizador.id, 'Cuartos terminados. Las semis van el fin de semana, revisen los horarios.', 2880);
    decir(general.id, equipos[0].jugadores[0].id, 'Nosotros podemos cualquier día después de las 21.', 2700);
    decir(general.id, equipos[3].jugadores[0].id, '¿Alguien tiene el replay de la serie contra Mamelucos?', 1500);
    decir(general.id, organizador.id, 'Recordatorio: el mapa de la primera partida es Decán para todos.', 600);
  }
  if (semis[0] && semis[0].team_a_id) {
    const sala = salaDePartido(t.id, semis[0].id, 'Semifinal 1');
    decir(sala.id, capitanDe(semis[0].team_a_id).id, 'Arrancamos el draft, ¿listos?', 45);
    decir(sala.id, capitanDe(semis[0].team_b_id).id, 'Dale, baneamos y vamos.', 40);
  }

  return t;
}

function resetear() {
  const tablas = [
    'draft_actions', 'drafts', 'game_civs', 'match_games', 'match_schedule_votes',
    'chat_messages', 'chat_rooms', 'matches', 'group_teams', 'groups', 'stages',
    'registrations', 'team_members', 'teams', 'tournament_admins', 'tournament_civs',
    'tournament_maps', 'tournament_prizes', 'tournaments', 'availability_exceptions', 'availability',
    'sessions', 'users',
  ];
  tx(() => {
    for (const t of tablas) run(`DELETE FROM ${t}`);
    run("DELETE FROM sqlite_sequence WHERE name NOT IN ('civs','maps')");
  });
  console.log('Base vaciada.');
}

const esEntrada = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (esEntrada) {
  cargarCatalogo();
  if (process.argv.includes('--reset')) resetear();
  sembrarDemo();
}
