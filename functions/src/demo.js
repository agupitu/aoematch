// Datos de demostración para los emuladores: jugadores con cuentas de prueba,
// un torneo abierto a inscripción, otro con las llaves armadas, otro listo para
// armar y la copa de muestra con drafts jugados, semis agendadas, fechas de
// ronda con horarios cargados y chat. Usa la misma lógica que la web
// (web/src/logica/: llaves, draft, resultados y calendario) y escribe con el
// Admin SDK, sin pasar por las reglas.
//
// Las cuentas entran con email y contraseña desde el formulario de prueba,
// que solo aparece contra el emulador: kaiser@demo.aoematch / demo1234.
// Lo corre scripts/seed.js (npm run seed).

import { getAuth } from 'firebase-admin/auth';
import { civs, maps } from '../../web/src/logica/catalogo.js';
import { banear, civsPermitidas, elegirMapa, planDeDraft, revelar, turnoDeBan } from '../../web/src/logica/draft.js';
import { instanteLocal, rangoDeDias } from '../../web/src/logica/calendario.js';
import { cargarPartidas, generarCuadro } from '../../web/src/logica/llaves.js';
import { rondaIdDe } from '../../web/src/logica/rondas.js';
import { escribirEnLotes } from './data/base.js';
import { guardarDraft, guardarPick } from './data/drafts.js';
import { actualizarEquipo, listarEquipos, guardarEquipo, leerEquipo } from './data/equipos.js';
import { guardarInscripcion } from './data/inscripciones.js';
import { actualizarPartido, guardarPartido, leerPartido, listarPartidos, refPartido } from './data/partidos.js';
import { guardarHorario, guardarRonda } from './data/rondas.js';
import { guardarSala, guardarSalaDeEquipo, publicarMensaje } from './data/salas.js';
import { actualizarTorneo, guardarEtapa, guardarTorneo, leerTorneo, refEtapa } from './data/torneos.js';
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

/** Cuenta de prueba en el emulador de Auth (uid `demo-<nombre>`) y su perfil. */
async function crearUsuario(nombre, rnd, { admin = false } = {}) {
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

/** Llaves del torneo con la lógica de la web; lo pasa a 'en_curso'. */
async function armarLlaves(slug) {
  const torneo = await leerTorneo(slug);
  const equipos = await listarEquipos(slug);
  const ids = { nuevoId: () => refPartido().id, nuevoIdEtapa: () => refEtapa(slug).id };
  const cuadro = generarCuadro(torneo, equipos, ids);
  const sinId = ({ id, ...resto }) => resto;
  await escribirEnLotes([
    ...cuadro.partidos.map((m) => (w) => guardarPartido(sinId(m), w, refPartido(m.id))),
    ...cuadro.etapas.map((e) => (w) => guardarEtapa(slug, sinId(e), w, refEtapa(slug, e.id))),
    ...cuadro.seeds.map((x) => (w) => actualizarEquipo(x.id, { seed: x.seed }, w)),
    (w) => actualizarTorneo(torneo, { status: 'en_curso' }, w),
  ]);
}

/** Carga las partidas de una serie como lo hace el staff (datos/resultados.ts). */
async function cargarSerie(slug, matchId, games) {
  const { cambios, terminado } = cargarPartidas(await listarPartidos(slug), matchId, games);
  for (const { id, ...campos } of cambios) await actualizarPartido(id, campos);
  if (terminado) await actualizarTorneo(await leerTorneo(slug), { status: 'finalizado' });
}

// ------------------------------------------------------------- copa de muestra

const REGLAS_MOCK = [
  '- Series al mejor de 3, final al mejor de 5.',
  '- Mapa de la primera partida fijo (Decán); después elige el que perdió la anterior.',
  '- Un ban de civilización por equipo y después pick ciego: se ven todas juntas.',
  '- Sin repetir civilización entre partidas de la misma serie.',
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

const ZONA_DEMO = 'America/Argentina/Buenos_Aires';

/** Fecha 'YYYY-MM-DD' a N días de hoy. */
const diaRelativo = (dias) => fechaRelativa(dias, 12).slice(0, 10);

/** rondas/{rondaId} como lo guarda el staff: de 00:00 de `desde` a 24:00 de `hasta` en `ZONA_DEMO`. */
const fechasDeRonda = (partido, desde, hasta) => ({
  stage_id: partido.stage_id,
  bracket: partido.bracket,
  round: partido.round,
  label: partido.label,
  from_day: desde,
  to_day: hasta,
  zone: ZONA_DEMO,
  ...rangoDeDias(desde, hasta, ZONA_DEMO),
});

/** Bloque de 20:00 a 23:00, hora de Buenos Aires, de ese día. */
const nocheDelDia = (dia) => ({
  starts_at: new Date(instanteLocal(dia, 20 * 60, ZONA_DEMO)).toISOString(),
  ends_at: new Date(instanteLocal(dia, 23 * 60, ZONA_DEMO)).toISOString(),
});

const alAzar = (lista, rnd) => lista[Math.floor(rnd() * lista.length)];

/**
 * Juega el draft de una partida con los mismos pasos que la web: mapa (si le
 * toca a alguien), bans y un pick por jugador. Lo deja revelado y devuelve
 * el mapa y las civs para `games[]`.
 */
async function correrDraft(slug, matchId, gameNo, rnd) {
  const [torneo, m] = await Promise.all([leerTorneo(slug), leerPartido(matchId)]);
  const equipos = { a: await leerEquipo(m.team_a_id), b: await leerEquipo(m.team_b_id) };
  let d = planDeDraft(torneo, m, equipos, gameNo);
  if (d.state === 'mapa') d = elegirMapa(d, d.map_chooser_team_id, alAzar(d.map_pool, rnd));
  while (d.state === 'bans') {
    const libres = d.civ_pool.filter((c) => !d.banned_civ_ids.includes(c));
    d = banear(d, turnoDeBan(d), alAzar(libres, rnd));
  }
  const picks = Object.fromEntries(d.player_ids.map((uid) => [uid, alAzar(civsPermitidas(d, uid), rnd)]));
  const { draft, civs: elegidas } = revelar(d, picks);
  await guardarDraft(matchId, gameNo, { ...draft, picked: d.player_ids });
  for (const [uid, civ] of Object.entries(picks)) await guardarPick(matchId, gameNo, uid, civ);
  return { map_id: draft.map_id, civs: elegidas };
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
    first_map_id: decan.id,
    map_repeat: 0,
    civ_bans: 1,
    civ_repeat_series: 0,
    entry_fee_cents: 300000,
    currency: 'ARS',
    payment_methods: [
      { method: 'Mercado Pago', name: 'Organización AoE III Draft', alias: 'aoe3draft.mp', url: 'https://link.mercadopago.com.ar/ejemplo' },
      { method: 'PayPal', url: 'https://www.paypal.com/paypalme/ejemplo' },
    ],
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

  const jugadores = [];
  for (const n of NOMBRES_MOCK) jugadores.push(await crearUsuario(n, rnd));

  const equipos = [];
  for (const [i, [nombre, tag]] of EQUIPOS_MOCK.entries()) {
    const integrantes = [jugadores[i * 2], jugadores[i * 2 + 1]];
    const id = await crearEquipo(t, { name: nombre, tag, seed: i + 1, jugadores: integrantes, paid_at: fechaRelativa(-10, 12) });
    equipos.push({ id, jugadores: integrantes });
  }
  await armarLlaves(t.id);

  // --- cuartos: jugados de verdad, con un draft por partida
  const fuerza = (teamId) => equipos.find((e) => e.id === teamId).jugadores.reduce((s, u) => s + (u.rating_team || 1000), 0);
  const ganadores = (await listarPartidos(t.id)).filter((m) => m.bracket === 'W');
  const cuartos = ganadores.filter((m) => m.round === 1).sort((a, b) => a.position - b.position);

  for (const [i, m] of cuartos.entries()) {
    if (!m.team_a_id || !m.team_b_id) continue;
    await actualizarPartido(m.id, { scheduled_at: fechaRelativa(-6 + Math.floor(i / 2), 22 + (i % 2)) });
    const ganaA = fuerza(m.team_a_id) + rnd() * 600 >= fuerza(m.team_b_id) + rnd() * 600;
    const [ganador, perdedor] = ganaA ? [m.team_a_id, m.team_b_id] : [m.team_b_id, m.team_a_id];
    // 2-0 o 2-1: en la apretada el perdedor gana la segunda.
    const orden = rnd() < 0.5 ? [ganador, perdedor, ganador] : [ganador, ganador];
    const games = [];
    for (const [i, winner] of orden.entries()) {
      // El draft de cada partida necesita la anterior cargada (elige mapa el que perdió).
      const delDraft = await correrDraft(t.id, m.id, i + 1, rnd);
      games.push({ game_no: i + 1, winner_team_id: winner, replay_url: null, notes: null, ...delDraft });
      await actualizarPartido(m.id, { games });
    }
    await cargarSerie(t.id, m.id, games);
  }

  // --- semis agendadas; la primera con el draft abierto (mapa fijo y bans
  // por hacer): el que entra lo sigue paso a paso.
  const semis = (await listarPartidos(t.id)).filter((m) => m.bracket === 'W' && m.round === 2).sort((a, b) => a.position - b.position);
  for (const [i, m] of semis.entries()) {
    await actualizarPartido(m.id, { scheduled_at: fechaRelativa(2 + i, 23), status: 'agendado' });
  }
  if (semis[0]?.team_a_id && semis[0]?.team_b_id) {
    const m = await leerPartido(semis[0].id);
    const equipos2 = { a: await leerEquipo(m.team_a_id), b: await leerEquipo(m.team_b_id) };
    await guardarDraft(m.id, 1, planDeDraft(await leerTorneo(t.id), m, equipos2, 1));
  }
  for (const m of (await listarPartidos(t.id)).filter((x) => x.round === 3)) {
    await actualizarPartido(m.id, { scheduled_at: fechaRelativa(6, 23) });
  }

  // --- fechas de las rondas que quedan y los horarios que cargaron los que
  // juegan las semis, para que "Buscar horario" tenga algo que cruzar: en la
  // semi 1 cargaron los cuatro y en la semi 2 falta uno.
  const final = (await listarPartidos(t.id)).find((m) => m.label === 'Final');
  await guardarRonda(t.id, rondaIdDe(semis[0]), fechasDeRonda(semis[0], diaRelativo(1), diaRelativo(3)));
  if (final) await guardarRonda(t.id, rondaIdDe(final), fechasDeRonda(final, diaRelativo(6), diaRelativo(7)));
  const noches = [nocheDelDia(diaRelativo(1)), nocheDelDia(diaRelativo(3))];
  for (const [i, m] of semis.entries()) {
    if (!m.team_a_id || !m.team_b_id) continue;
    const uids = [...(await leerEquipo(m.team_a_id)).member_ids, ...(await leerEquipo(m.team_b_id)).member_ids];
    for (const uid of i === 1 ? uids.slice(0, -1) : uids) await guardarHorario(t.id, rondaIdDe(m), uid, noches);
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
    await decir(sala, await usuarioDe(semis[0].team_b_id), 'Dale, baneamos y elegimos a ciegas.', 40);
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
    description: 'Torneo por equipos con pick ciego de civilizaciones y pool de mapas competitivo.',
    rules_md: '- Al mejor de 3.\n- Un ban de civ por equipo y pick ciego.\n- Sin repetir civ en la serie.',
    organizer_id: organizador.id,
    status: 'inscripcion',
    format: 'eliminacion_simple',
    team_size: 3,
    best_of: 3,
    best_of_final: 5,
    civ_bans: 1,
    civ_repeat_series: 0,
    entry_fee_cents: 500000,
    currency: 'ARS',
    payment_methods: [{ method: 'Transferencia bancaria', name: 'Kaiser', alias: 'kaiser.aoe3' }],
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

  // Equipos del organizador: uno ya con su capitán, uno vacío, y dos pedidos de ingreso por resolver.
  const tercios = await guardarEquipo({
    tournament_id: t1.id, name: 'Los Tercios', staff_made: 1, captain_id: usuarios[1].id,
    members: [{ user_id: usuarios[1].id, role: 'capitan' }],
  });
  await guardarSalaDeEquipo(tercios, 'Los Tercios', [usuarios[1].id], t1);
  await guardarInscripcion(t1.id, usuarios[1].id, { kind: 'equipo', team_id: tercios, status: 'confirmada', paid: 1, paid_at: new Date().toISOString() });
  const halcones = await guardarEquipo({ tournament_id: t1.id, name: 'Halcones', staff_made: 1 });
  const pedido = (team_id) => ({ team_id, status: 'pendiente', created_at: new Date().toISOString() });
  await guardarInscripcion(t1.id, usuarios[2].id, { kind: 'solo', status: 'confirmada', join_request: pedido(tercios) });
  await guardarInscripcion(t1.id, usuarios[3].id, { kind: 'solo', status: 'confirmada', join_request: pedido(halcones) });

  // --- torneo 2: 1v1 en curso, con llaves listas
  const t2 = await crearTorneo('ladder-1v1-de-otono', {
    name: 'Ladder 1v1 de Otoño',
    description: 'Eliminación simple a 8. Primer mapa al azar, después elige el que perdió; pick ciego.',
    organizer_id: organizador.id,
    status: 'inscripcion',
    format: 'eliminacion_simple',
    team_size: 1,
    best_of: 3,
    civ_bans: 0,
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
  await armarLlaves(t2.id);

  // --- torneo 3: 2v2 por equipos ya inscriptos, listo para armar llaves
  const t3 = await crearTorneo('clan-wars-2v2', {
    name: 'Clan Wars 2v2',
    description: 'Formato de grupos y playoff. Dos bans de civ por equipo y pick ciego.',
    organizer_id: organizador.id,
    status: 'armado',
    format: 'grupos_playoff',
    team_size: 2,
    best_of: 3,
    group_count: 2,
    group_advance: 2,
    civ_bans: 2,
    entry_fee_cents: 0,
    allow_solo: 0,
  });
  const CLANES = ['Los Jinetes', 'Hussar Gang', 'Falconetes', 'Mamelucos', 'Doppel Crew', 'Oprichniks'];
  for (const [i, nombre] of CLANES.entries()) {
    await crearEquipo(t3, { name: nombre, seed: i + 1, jugadores: [usuarios[i * 2], usuarios[i * 2 + 1]] });
  }

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
