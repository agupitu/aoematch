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
import { generarLlaves } from './brackets.js';

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
  'yucatan', 'andes', 'deccan', 'saguenay', 'great-plains', 'arabia', 'yellow-river',
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

function sembrarDemo() {
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
  });

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
  });

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

  console.log(`Demo lista.
  Organizador: ${organizador.email} / demo1234
  Torneos: /t/${t1.slug}, /t/${t2.slug}, /t/${t3.slug}`);
}

function resetear() {
  const tablas = [
    'draft_actions', 'drafts', 'game_civs', 'match_games', 'match_schedule_votes',
    'chat_messages', 'chat_rooms', 'matches', 'group_teams', 'groups', 'stages',
    'registrations', 'team_members', 'teams', 'tournament_admins', 'tournament_civs',
    'tournament_maps', 'tournaments', 'availability_exceptions', 'availability',
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
