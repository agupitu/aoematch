// Datos de demostración para los emuladores: jugadores con cuentas de prueba y
// horarios, un torneo abierto a inscripción, otro con las llaves armadas, otro
// listo para armar y la copa de muestra con drafts jugados, semis agendadas y
// chat. Usa las mismas funciones que la API (llaves, draft, cierre de partido).
//
// Las cuentas entran con email y contraseña desde el formulario de prueba,
// que solo aparece contra el emulador: kaiser@demo.aoematch / demo1234.
// Lo corre scripts/seed.js (npm run seed).

import { getAuth } from 'firebase-admin/auth';
import { cerrarMatch, generarLlaves } from './brackets.js';
import { civs, maps } from './catalogo.js';
import { civsBloqueadas } from './draft-core.js';
import { aplicarAccion, crearDraft, estadoDelPartido, marcarListo } from './draft.js';
import { listarEquipos, guardarEquipo, leerEquipo } from './data/equipos.js';
import { guardarInscripcion, listarInscripciones, vigente } from './data/inscripciones.js';
import { actualizarPartido, leerPartido, listarPartidos } from './data/partidos.js';
import { guardarSala, guardarSalaDeEquipo, publicarMensaje } from './data/salas.js';
import { actualizarTorneo, guardarTorneo, leerTorneo } from './data/torneos.js';
import { guardarUsuario, leerUsuario } from './data/usuarios.js';

export const CLAVE_DEMO = 'demo1234';

// ---------------------------------------------------------------- jugadores

const NOMBRES = [
  'Kaiser', 'Mitoe', 'Hazza54', 'Garja', 'Aizamk', 'Interjection', 'Fifty', 'Vividlyplain',
  'Lordraphael', 'Sebnan', 'Mr.Bramboy', 'SoldieR', 'Silverbadger', 'Jaeger', 'Dolan', 'Yagami',
  'Riotcoke', 'Pitu', 'Bacso', 'Elvisgomez', 'Chrazini', 'Demonsnipe', 'Papa', 'Nanaki',
];

const ZONAS = ['America/Argentina/Buenos_Aires', 'Europe/Madrid', 'Europe/Berlin', 'America/Sao_Paulo', 'UTC'];

function rngSemilla(semilla) {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function bloquesAleatorios(rnd) {
  // 3 a 6 franjas semanales de 2-5 horas.
  const bloques = [];
  const dias = [...Array(7).keys()].sort(() => rnd() - 0.5).slice(0, 3 + Math.floor(rnd() * 4));
  for (const d of dias) {
    const inicioH = 16 + Math.floor(rnd() * 5); // tarde/noche
    const largoH = 2 + Math.floor(rnd() * 4);
    const start = d * 1440 + inicioH * 60;
    bloques.push({ start_min: start, end_min: Math.min(d * 1440 + 1440, start + largoH * 60) });
  }
  return bloques.sort((a, b) => a.start_min - b.start_min);
}

/** Cuenta de prueba en el emulador de Auth (uid `demo-<nombre>`) y su perfil. */
async function crearUsuario(nombre, rnd, { admin = false, availability } = {}) {
  const corto = nombre.toLowerCase().replace(/[^a-z0-9]/g, '');
  const uid = `demo-${corto}`;
  const email = `${corto}@demo.aoematch`;
  const datos = {
    display_name: nombre,
    email,
    timezone: ZONAS[Math.floor(rnd() * ZONAS.length)],
    rating_1v1: 900 + Math.floor(rnd() * 900),
    rating_team: 900 + Math.floor(rnd() * 900),
    is_admin: admin ? 1 : 0,
    availability: availability ?? bloquesAleatorios(rnd),
  };
  await getAuth().createUser({ uid, email, password: CLAVE_DEMO, displayName: nombre });
  await guardarUsuario(uid, datos);
  return { id: uid, ...datos };
}

// ------------------------------------------------------------------ torneos

const POOL_COMPETITIVO = [
  'yucatan', 'andes', 'decan', 'saguenay', 'grandes-llanuras', 'arabia', 'rio-amarillo',
  'bayou', 'carolina', 'california', 'pampa', 'sonora', 'manchuria',
];

function poolMapas() {
  const porSlug = new Map(maps().map((m) => [m.slug, m.id]));
  const ids = POOL_COMPETITIVO.map((s) => porSlug.get(s)).filter(Boolean);
  if (ids.length < 7) {
    for (const m of [...maps()].sort((a, b) => a.id - b.id).slice(0, 9)) if (!ids.includes(m.id)) ids.push(m.id);
  }
  return ids;
}

const premios = (lista) => lista.map((p, i) => ({
  position: i + 1, label: p.label, kind: p.kind, amount_cents: p.amount_cents ?? 0, percent: p.percent ?? 0, extra: p.extra ?? null,
}));

async function crearTorneo(slug, campos) {
  await guardarTorneo(slug, { map_ids: poolMapas(), civ_ids: civs().map((c) => c.id), ...campos });
  await guardarSala(`torneo_${slug}`, { kind: 'torneo', tournament_id: slug, name: 'General', public_read: true });
  return leerTorneo(slug);
}

/** Equipo con su sala (en torneos por equipos) e inscripciones de sus jugadores. */
async function crearEquipo(torneo, { name, tag = null, seed, jugadores, paid = 1, paid_at = null }) {
  const id = await guardarEquipo({
    tournament_id: torneo.id, name, tag, captain_id: jugadores[0].id, seed,
    members: jugadores.map((u, i) => ({ user_id: u.id, role: i === 0 ? 'capitan' : 'jugador' })),
  });
  if (torneo.team_size > 1) await guardarSalaDeEquipo(id, name, jugadores.map((u) => u.id), torneo);
  for (const u of jugadores) {
    await guardarInscripcion(torneo.id, u.id, { team_id: id, kind: 'equipo', status: 'confirmada', paid, paid_at });
  }
  return id;
}

/** Los contadores del torneo, contados de nuevo. */
async function recontar(slug) {
  const [regs, equipos, torneo] = await Promise.all([listarInscripciones(slug), listarEquipos(slug), leerTorneo(slug)]);
  const activas = regs.filter(vigente);
  await actualizarTorneo(torneo, {
    inscriptos: activas.length,
    pagos: activas.filter((r) => r.paid).length,
    equipos: equipos.length,
  });
}

// ------------------------------------------------------------- copa de muestra

const REGLAS_MOCK = [
  '- Series al mejor de 3, final al mejor de 5.',
  '- Mapa de la primera partida fijo (Decán); el resto sale de bans alternados.',
  '- Un ban de civilización por equipo y draft en serpiente 1-2-1.',
  '- Sin espejos y sin repetir civilización entre partidas de la misma serie.',
].join('\n');

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

const capitanDe = async (teamId) => ({ id: (await leerEquipo(teamId)).captain_id });

/** Un objetivo válido para el paso actual del draft. */
function objetivoLegal(st, step, partido, rnd) {
  if (step.kind === 'ban_mapa' || step.kind === 'pick_mapa') {
    const baneados = new Set(st.maps_banned);
    const libres = st.pools.maps.filter((m) => !baneados.has(m.id));
    return libres[Math.floor(rnd() * libres.length)].id;
  }
  const bloqueadas = civsBloqueadas(st, step, partido);
  const libres = st.pools.civs.filter((c) => !bloqueadas.has(c.id));
  return libres[Math.floor(rnd() * libres.length)].id;
}

/** Corre un draft con acciones reales, las mismas que haría un capitán. */
async function correrDraft(matchId, gameNo, rnd) {
  const m = await leerPartido(matchId);
  await crearDraft(matchId, gameNo, { rnd });
  await marcarListo(matchId, await capitanDe(m.team_a_id), { rnd });
  await marcarListo(matchId, await capitanDe(m.team_b_id), { rnd });

  for (let guard = 0; guard < 300; guard++) {
    const st = await estadoDelPartido(matchId);
    if (!st || st.state !== 'en_curso' || !st.step || st.step.auto) break;
    const teamId = st.step.side === 'a' ? st.teams.a.id : st.teams.b.id;
    const partido = await leerPartido(matchId);
    await aplicarAccion(matchId, await capitanDe(teamId), {
      kind: st.step.kind,
      targetId: objetivoLegal(st, st.step, partido, rnd),
    }, { rnd });
  }
}

/** Mensaje en una sala con la hora de hace `minutosAtras` minutos. */
function decir(roomId, user, body, minutosAtras = 0) {
  return publicarMensaje(roomId, { user, body, created_at: new Date(Date.now() - minutosAtras * 60000) });
}

async function sembrarMockup(rnd, organizador) {
  const decan = maps().find((m) => m.slug === 'decan') ?? maps()[0];
  const t = await crearTorneo('copa-aoematch-mockup', {
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
    first_map_id: decan.id,
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
    prizes: premios([
      { label: 'Campeón', kind: 'porcentaje', percent: 55 },
      { label: 'Subcampeón', kind: 'porcentaje', percent: 30 },
      { label: 'Tercer puesto', kind: 'porcentaje', percent: 15, extra: 'Cupo directo a la próxima edición' },
    ]),
  });

  // Prime time compartido (mar/jue/dom 22:00–23:30 UTC y sábado a la tarde),
  // para que el cruce de horarios tenga algo que mostrar.
  const COMUNES = [
    { start_min: 1 * 1440 + 22 * 60, end_min: 1 * 1440 + 23 * 60 + 30 },
    { start_min: 3 * 1440 + 22 * 60, end_min: 3 * 1440 + 23 * 60 + 30 },
    { start_min: 5 * 1440 + 18 * 60, end_min: 5 * 1440 + 22 * 60 },
    { start_min: 6 * 1440 + 22 * 60, end_min: 6 * 1440 + 23 * 60 + 30 },
  ];
  const jugadores = [];
  for (const n of NOMBRES_MOCK) jugadores.push(await crearUsuario(n, rnd, { availability: COMUNES }));

  const equipos = [];
  for (const [i, [nombre, tag]] of EQUIPOS_MOCK.entries()) {
    const integrantes = [jugadores[i * 2], jugadores[i * 2 + 1]];
    const id = await crearEquipo(t, { name: nombre, tag, seed: i + 1, jugadores: integrantes, paid_at: fechaRelativa(-10, 12) });
    equipos.push({ id, jugadores: integrantes });
  }
  await recontar(t.id);
  await generarLlaves(t.id);
  // generarLlaves lo pasa a 'en_curso', como ya estaba.

  // --- cuartos: jugados de verdad, con un draft por partida
  const fuerza = (teamId) => equipos.find((e) => e.id === teamId).jugadores.reduce((s, u) => s + (u.rating_team || 1000), 0);
  const ganadores = (await listarPartidos(t.id)).filter((m) => m.bracket === 'W');
  const cuartos = ganadores.filter((m) => m.round === 1).sort((a, b) => a.position - b.position);

  for (const [i, m] of cuartos.entries()) {
    if (!m.team_a_id || !m.team_b_id) continue;
    await actualizarPartido(m.id, { scheduled_at: fechaRelativa(-6 + Math.floor(i / 2), 22 + (i % 2)) });
    const ganaA = fuerza(m.team_a_id) + rnd() * 600 >= fuerza(m.team_b_id) + rnd() * 600;
    const apretado = rnd() < 0.5;
    const partidas = apretado ? 3 : 2;
    for (let g = 1; g <= partidas; g++) await correrDraft(m.id, g, rnd);
    await cerrarMatch(m.id, ganaA ? m.team_a_id : m.team_b_id, ganaA ? 2 : apretado ? 1 : 0, ganaA ? (apretado ? 1 : 0) : 2);
  }

  // --- semis agendadas; la primera con el draft abierto pero sin arrancar:
  // el que entra lo empieza y ve la secuencia paso a paso.
  const semis = (await listarPartidos(t.id)).filter((m) => m.bracket === 'W' && m.round === 2).sort((a, b) => a.position - b.position);
  for (const [i, m] of semis.entries()) {
    await actualizarPartido(m.id, { scheduled_at: fechaRelativa(2 + i, 23), status: 'agendado' });
  }
  if (semis[0]?.team_a_id && semis[0]?.team_b_id) await crearDraft(semis[0].id, 1, { rnd });
  for (const m of (await listarPartidos(t.id)).filter((x) => x.round === 3)) {
    await actualizarPartido(m.id, { scheduled_at: fechaRelativa(6, 23) });
  }

  // --- algo de charla para que no se vea vacío
  const general = `torneo_${t.id}`;
  await decir(general, organizador, 'Cuartos terminados. Las semis van el fin de semana, revisen los horarios.', 2880);
  await decir(general, equipos[0].jugadores[0], 'Nosotros podemos cualquier día después de las 21.', 2700);
  await decir(general, equipos[3].jugadores[0], '¿Alguien tiene el replay de la serie contra Mamelucos?', 1500);
  await decir(general, organizador, 'Recordatorio: el mapa de la primera partida es Decán para todos.', 600);
  if (semis[0]?.team_a_id) {
    const sala = `partido_${semis[0].id}`;
    await guardarSala(sala, { kind: 'partido', tournament_id: t.id, match_id: semis[0].id, name: 'Semifinal 1', public_read: true });
    const usuarioDe = async (teamId) => leerUsuario((await capitanDe(teamId)).id);
    await decir(sala, await usuarioDe(semis[0].team_a_id), 'Arrancamos el draft, ¿listos?', 45);
    await decir(sala, await usuarioDe(semis[0].team_b_id), 'Dale, baneamos y vamos.', 40);
  }
  return t;
}

// ------------------------------------------------------------------ entrada

/**
 * Siembra la demo si todavía no está (la copa de muestra hace de marca).
 * Devuelve { creada, organizador, torneos }.
 */
export async function sembrarDemo() {
  if (await leerTorneo('copa-aoematch-mockup')) return { creada: false };

  const rnd = rngSemilla(20261020);
  const usuarios = [];
  for (const [i, n] of NOMBRES.entries()) usuarios.push(await crearUsuario(n, rnd, { admin: i === 0 }));
  const organizador = usuarios[0];

  // --- torneo 1: 3v3, inscripción abierta, con sueltos para el armador
  const t1 = await crearTorneo('copa-sudamericana-3v3', {
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
    prizes: premios([
      { label: 'Campeón', kind: 'porcentaje', percent: 60 },
      { label: 'Subcampeón', kind: 'porcentaje', percent: 30 },
      { label: 'Tercer puesto', kind: 'porcentaje', percent: 10 },
    ]),
  });
  for (const u of usuarios.slice(1, 16)) {
    const paid = rnd() < 0.6 ? 1 : 0;
    await guardarInscripcion(t1.id, u.id, { kind: 'solo', status: 'confirmada', paid, paid_at: paid ? new Date().toISOString() : null });
  }
  await recontar(t1.id);

  // --- torneo 2: 1v1 en curso, con llaves listas
  const t2 = await crearTorneo('ladder-1v1-de-otono', {
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
    prizes: premios([
      { label: 'Campeón', kind: 'fijo', amount_cents: 10000000 },
      { label: 'Subcampeón', kind: 'fijo', amount_cents: 5000000, extra: 'Cupo directo a la próxima edición' },
    ]),
  });
  for (const [i, u] of usuarios.slice(0, 8).entries()) {
    await crearEquipo(t2, { name: u.display_name, seed: i + 1, jugadores: [u] });
  }
  await recontar(t2.id);
  await generarLlaves(t2.id);

  // --- torneo 3: 2v2 por equipos ya inscriptos, listo para armar llaves
  const t3 = await crearTorneo('clan-wars-2v2', {
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
  const CLANES = ['Los Jinetes', 'Hussar Gang', 'Falconetes', 'Mamelucos', 'Doppel Crew', 'Oprichniks'];
  for (const [i, nombre] of CLANES.entries()) {
    await crearEquipo(t3, { name: nombre, seed: i + 1, jugadores: [usuarios[i * 2], usuarios[i * 2 + 1]] });
  }
  await recontar(t3.id);

  const mock = await sembrarMockup(rnd, organizador);
  return { creada: true, organizador, torneos: [mock.id, t1.id, t2.id, t3.id] };
}

/** Vacía los emuladores de Firestore y Auth (no toca nada fuera de un proyecto demo-*). */
export async function vaciarEmuladores() {
  const proyecto = process.env.GCLOUD_PROJECT;
  if (!proyecto?.startsWith('demo-')) throw new Error('Solo se vacían los emuladores de un proyecto demo-*.');
  const pedidos = [
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${proyecto}/databases/(default)/documents`,
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${proyecto}/accounts`,
  ];
  for (const url of pedidos) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(`No se pudo vaciar ${url}: ${r.status}`);
  }
}
