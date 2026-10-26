// Torneos sobre Firestore: listado, alta, detalle, edición, borrado,
// inscripciones, equipos, armador, llaves, playoffs, suizo y horarios.

import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { minutosEnComun, ventanas, proximaFecha } from '../availability.js';
import { civs, mapaPorId } from '../catalogo.js';
import { generarLlaves, generarPlayoffs, siguienteRondaSuiza, tablaDesde } from '../brackets.js';
import { confirmarEquipos, proponerEquipos } from '../teambuilder.js';
import { patronPorDefecto, poolCivs, poolMapas } from '../draft-core.js';
import { ahora, enTransaccion, firestore, ordenarPor } from '../data/base.js';
import { actualizarEquipo, borrarEquipo, guardarEquipo, leerEquipo, listarEquipos, refEquipo } from '../data/equipos.js';
import {
  actualizarInscripcion, guardarInscripcion, leerInscripcion, listarInscripciones, vigente,
} from '../data/inscripciones.js';
import { listarPartidos } from '../data/partidos.js';
import { actualizarLectores, guardarSala, guardarSalaDeEquipo, leerSala, lectoresDeEquipo, refSala } from '../data/salas.js';
import {
  actualizarTorneo, borrarTorneo, guardarTorneo, leerTorneo, listarEtapas, listarTorneos, sumarContadores,
} from '../data/torneos.js';
import { mapaDeUsuarios } from '../data/usuarios.js';

export const router = Router();

// --------------------------------------------------------------- utilidades

function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60) || 'torneo';
}

/** El torneo por su slug (es el id del documento), o null. */
export function buscarTorneo(slug) {
  return leerTorneo(String(slug));
}

/** ¿Organiza o administra el torneo? */
export function esStaff(userId, torneo) {
  if (!userId || !torneo) return false;
  return torneo.organizer_id === userId || (torneo.admin_ids ?? []).includes(userId);
}

async function requiereStaff(req, res, next) {
  const t = await buscarTorneo(req.params.id);
  if (!t) return res.status(404).json({ error: 'Torneo inexistente.' });
  if (!req.user || !esStaff(req.user.id, t)) {
    return res.status(403).json({ error: 'Solo el organizador puede hacer esto.' });
  }
  req.torneo = t;
  next();
}

/** Usuario con horario para availability.js; uno que no existe cuenta como sin horarios. */
const conHorario = (usuarios, id) => usuarios.get(id) ?? { id, availability: [] };

/** Equipo con sus jugadores (capitán primero, después por nombre) y las horas en común. */
function equipoCompleto(equipo, usuarios) {
  const { member_ids, ...resto } = equipo;
  const jugadores = equipo.members.map((m) => {
    const u = usuarios.get(m.user_id) ?? {};
    return {
      id: m.user_id,
      display_name: u.display_name ?? 'Jugador',
      avatar_url: u.avatar_url || u.steam_avatar || null,
      steam_avatar: u.steam_avatar ?? null,
      steam_name: u.steam_name ?? null,
      timezone: u.timezone ?? 'UTC',
      rating_1v1: u.rating_1v1 ?? null,
      rating_team: u.rating_team ?? null,
      role: m.role,
    };
  });
  const members = ordenarPor(jugadores, (p) => (p.role === 'capitan' ? 0 : 1), 'display_name');
  return {
    ...resto,
    members,
    overlap_min: members.length > 1 ? minutosEnComun(member_ids.map((id) => conHorario(usuarios, id))) : null,
  };
}

const terminado = (m) => ['finalizado', 'walkover'].includes(m.status);

// ------------------------------------------------------------------ listado

router.get('/', async (req, res) => {
  const torneos = await listarTorneos({ status: req.query.status || undefined });
  const organizadores = await mapaDeUsuarios(torneos.map((t) => t.organizer_id));
  res.json(torneos.map((t) => ({ ...t, organizer_name: organizadores.get(t.organizer_id)?.display_name ?? null })));
});

// -------------------------------------------------------------------- crear

const CAMPOS_EDITABLES = [
  'name', 'description', 'rules_md', 'banner_url', 'status', 'format', 'team_size',
  'max_teams', 'best_of', 'best_of_final', 'group_count', 'group_advance', 'swiss_rounds',
  'third_place', 'map_mode', 'map_bans', 'map_repeat', 'first_map_id', 'civ_mode', 'civ_bans', 'civ_pattern',
  'civ_repeat_series', 'civ_repeat_team', 'civ_mirror', 'draft_timer_s', 'entry_fee_cents',
  'currency', 'payment_link', 'payment_notes', 'allow_solo', 'reg_opens_at', 'reg_closes_at',
  'starts_at', 'prize_pool_mode', 'prize_pool_cents', 'prize_pool_pct', 'prize_notes',
];

const CAMPOS_NUMERICOS = [
  'team_size', 'max_teams', 'best_of', 'best_of_final', 'group_count', 'group_advance',
  'swiss_rounds', 'third_place', 'map_bans', 'map_repeat', 'civ_bans', 'civ_repeat_series',
  'civ_repeat_team', 'civ_mirror', 'draft_timer_s', 'entry_fee_cents', 'allow_solo',
  'prize_pool_cents', 'prize_pool_pct', 'first_map_id',
];

/** Lo que manda el formulario, limpio: los cambios a guardar en el torneo. */
function camposDe(body) {
  const cambios = {};
  for (const c of CAMPOS_EDITABLES) {
    if (body[c] === undefined) continue;
    let v = body[c];
    if (CAMPOS_NUMERICOS.includes(c)) {
      v = v === null || v === '' ? null : Number(v);
      if (v !== null && !Number.isFinite(v)) continue;
      // Solo estos tres admiten null; los demás tienen siempre un valor.
      if (v === null && !['max_teams', 'best_of_final', 'first_map_id'].includes(c)) continue;
      if (typeof body[c] === 'boolean') v = body[c] ? 1 : 0;
    } else if (v === '') {
      v = null;
    }
    cambios[c] = v;
  }
  if (cambios.name === null) delete cambios.name;
  if (cambios.name !== undefined) cambios.name = String(cambios.name).slice(0, 120);

  if (Array.isArray(body.prizes)) cambios.prizes = premiosLimpios(body.prizes);
  if (Array.isArray(body.map_ids)) cambios.map_ids = idsLimpios(body.map_ids);
  if (Array.isArray(body.civ_ids)) cambios.civ_ids = idsLimpios(body.civ_ids);
  return cambios;
}

/** La lista de premios del torneo, como la guardaba setPremios. */
function premiosLimpios(premios) {
  return premios.slice(0, 20).map((p, i) => {
    const etiqueta = String(p.label ?? '').trim() || `${i + 1}º puesto`;
    const kind = p.kind === 'fijo' ? 'fijo' : 'porcentaje';
    return {
      position: i + 1,
      label: etiqueta.slice(0, 60),
      kind,
      amount_cents: kind === 'fijo' ? Math.max(0, Math.round(Number(p.amount_cents) || 0)) : 0,
      percent: kind === 'porcentaje' ? Math.max(0, Number(p.percent) || 0) : 0,
      extra: p.extra ? String(p.extra).slice(0, 200) : null,
    };
  });
}

const idsLimpios = (ids) => [...new Set(ids.map((n) => parseInt(n, 10)).filter(Number.isInteger))];

router.post('/', requireAuth, async (req, res) => {
  const body = req.body || {};
  if (!body.name) return res.status(400).json({ error: 'Falta el nombre del torneo.' });

  const datos = {
    // Por defecto, todas las civs disponibles.
    civ_ids: civs().map((c) => c.id),
    ...camposDe(body),
    name: String(body.name).slice(0, 120),
    organizer_id: req.user.id,
  };

  // El slug es el id: si ya existe, se prueba con -2, -3...
  const base = slugify(body.name);
  let slug = base;
  for (let n = 2; ; n++) {
    try {
      await guardarTorneo(slug, datos);
      break;
    } catch (err) {
      if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS
      slug = `${base}-${n}`;
    }
  }
  await guardarSala(`torneo_${slug}`, { kind: 'torneo', tournament_id: slug, name: 'General', public_read: true });

  res.json(await detalle(await leerTorneo(slug), req.user));
});

// ------------------------------------------------------------------ detalle

/**
 * Bolsa de premios y cuánto le toca a cada puesto. La bolsa puede ser un monto
 * declarado por el organizador o salir de lo que se recaudó en inscripciones.
 */
function premiosDe(t) {
  const pagas = t.pagos ?? 0;
  const recaudado = pagas * t.entry_fee_cents;
  const bolsa =
    t.prize_pool_mode === 'fijo'
      ? t.prize_pool_cents
      : t.prize_pool_mode === 'inscripciones'
        ? Math.round((recaudado * t.prize_pool_pct) / 100)
        : 0;

  const filas = ordenarPor(t.prizes ?? [], 'position').map((p) => ({
    id: p.position,
    tournament_id: t.id,
    ...p,
    value_cents: p.kind === 'fijo' ? p.amount_cents : Math.round((bolsa * p.percent) / 100),
  }));

  return {
    prizes: filas,
    prize_pool: {
      mode: t.prize_pool_mode,
      total_cents: bolsa,
      collected_cents: recaudado,
      paid_count: pagas,
      assigned_cents: filas.reduce((s, p) => s + p.value_cents, 0),
      assigned_pct: filas.filter((p) => p.kind === 'porcentaje').reduce((s, p) => s + p.percent, 0),
    },
  };
}

/** Todo lo que muestra la página del torneo, con la misma forma que daba SQLite. */
async function detalle(t, user) {
  const [equipos, inscripciones, etapas, partidos] = await Promise.all([
    listarEquipos(t.id),
    listarInscripciones(t.id),
    listarEtapas(t.id),
    listarPartidos(t.id),
  ]);
  const usuarios = await mapaDeUsuarios([
    t.organizer_id,
    ...inscripciones.map((r) => r.user_id),
    ...equipos.flatMap((e) => e.member_ids),
  ]);

  const teams = equipos.map((e) => equipoCompleto(e, usuarios));
  const filaEquipo = ({ members, member_ids, ...e }) => e;
  const nombreEquipo = new Map(equipos.map((e) => [e.id, e.name]));

  const registrations = inscripciones.map((r) => {
    const u = usuarios.get(r.user_id) ?? {};
    return {
      ...r,
      display_name: u.display_name ?? 'Jugador',
      avatar_url: u.avatar_url || u.steam_avatar || null,
      steam_avatar: u.steam_avatar ?? null,
      steam_name: u.steam_name ?? null,
      rating_1v1: u.rating_1v1 ?? null,
      rating_team: u.rating_team ?? null,
      timezone: u.timezone ?? 'UTC',
      team_name: nombreEquipo.get(r.team_id) ?? null,
      paid: !!r.paid,
    };
  });

  const stages = etapas.map((s) => ({
    ...s,
    groups: ordenarPor(s.groups ?? [], 'name').map((g) => ({
      id: g.id,
      stage_id: s.id,
      name: g.name,
      standings: tablaDesde(
        equipos.filter((e) => (g.team_ids ?? []).includes(e.id)).map(filaEquipo),
        partidos.filter((m) => m.stage_id === s.id && m.group_id === g.id && terminado(m))
      ),
    })),
  }));

  const matches = partidos.map((m) => ({
    ...m,
    team_a_name: nombreEquipo.get(m.team_a_id) ?? null,
    team_b_name: nombreEquipo.get(m.team_b_id) ?? null,
  }));

  const standings = ['liga', 'suizo'].includes(t.format)
    ? tablaDesde(equipos.map(filaEquipo), partidos.filter(terminado))
    : null;

  const organizador = usuarios.get(t.organizer_id);
  return {
    ...t,
    organizer: organizador ? { id: organizador.id, display_name: organizador.display_name } : null,
    civ_pattern_efectivo: t.civ_pattern || patronPorDefecto(t.team_size),
    first_map: t.first_map_id ? mapaPorId(t.first_map_id) : null,
    ...premiosDe(t),
    maps: poolMapas(t),
    civs: poolCivs(t),
    teams,
    registrations,
    stages,
    matches,
    standings,
    me: user
      ? {
          is_staff: esStaff(user.id, t),
          registration: registrations.find((r) => r.user_id === user.id) || null,
          team_id: teams.find((te) => te.members.some((m) => m.id === user.id))?.id ?? null,
        }
      : null,
  };
}

router.get('/:id', async (req, res) => {
  const t = await buscarTorneo(req.params.id);
  if (!t) return res.status(404).json({ error: 'Torneo inexistente.' });
  res.json(await detalle(t, req.user));
});

router.patch('/:id', requireAuth, requiereStaff, async (req, res) => {
  const cambios = camposDe(req.body || {});
  if (Object.keys(cambios).length) await actualizarTorneo(req.torneo, cambios);
  res.json(await detalle(await leerTorneo(req.torneo.id), req.user));
});

router.delete('/:id', requireAuth, requiereStaff, async (req, res) => {
  await borrarTorneo(req.torneo.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------ inscripciones

/** Error de regla con su código HTTP: corta la transacción y se responde tal cual. */
class Rechazo extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Responde lo que devuelve `fn`, o el Rechazo con su código. */
async function responder(res, fn) {
  try {
    res.json(await fn());
  } catch (err) {
    if (!(err instanceof Rechazo)) throw err;
    res.status(err.status).json({ error: err.message });
  }
}

/** Los miembros con `uid` agregado (o con su rol cambiado, si ya estaba). */
function conMiembro(members, uid, role) {
  return [...members.filter((m) => m.user_id !== uid), { user_id: uid, role }];
}

const sinMiembro = (members, uid) => members.filter((m) => m.user_id !== uid);

/** El equipo con sus jugadores y horas en común, para responder. */
async function equipoParaResponder(teamId) {
  const equipo = await leerEquipo(teamId);
  return equipo ? equipoCompleto(equipo, await mapaDeUsuarios(equipo.member_ids)) : null;
}

router.post('/:id/register', requireAuth, (req, res) => responder(res, async () => {
  const uid = req.user.id;
  const { kind = 'solo', team_name, team_id, note } = req.body || {};

  await enTransaccion(async (tx) => {
    const t = await leerTorneo(req.params.id, tx);
    if (!t) throw new Rechazo(404, 'Torneo inexistente.');
    if (!['inscripcion', 'armado'].includes(t.status)) {
      throw new Rechazo(400, 'Las inscripciones no están abiertas.');
    }
    const ya = await leerInscripcion(t.id, uid, tx);
    if (vigente(ya)) throw new Rechazo(409, 'Ya estás inscripto.');

    let equipo = null;
    let sala = null;
    let nuevo = null;
    if (t.team_size > 1 && kind === 'equipo') {
      if (team_id) {
        equipo = await leerEquipo(team_id, tx);
        if (!equipo || equipo.tournament_id !== t.id) throw new Rechazo(404, 'Ese equipo no existe en el torneo.');
        if (equipo.members.length >= t.team_size) throw new Rechazo(400, 'El equipo ya está completo.');
        sala = await leerSala(`equipo_${equipo.id}`, tx);
      } else {
        if (!team_name) throw new Rechazo(400, 'Poné un nombre de equipo.');
        nuevo = String(team_name).slice(0, 60);
      }
    } else if (t.team_size === 1) {
      nuevo = req.user.display_name;
    } else if (!t.allow_solo) {
      throw new Rechazo(400, 'Este torneo no acepta jugadores sueltos.');
    }

    let teamId = equipo?.id ?? null;
    if (equipo) {
      const members = conMiembro(equipo.members, uid, 'jugador');
      actualizarEquipo(equipo.id, { members }, tx);
      if (sala) actualizarLectores(sala.id, lectoresDeEquipo(members.map((m) => m.user_id), t), tx);
    }
    if (nuevo !== null) {
      const ref = refEquipo();
      teamId = ref.id;
      await guardarEquipo({ tournament_id: t.id, name: nuevo, captain_id: uid, members: [{ user_id: uid, role: 'capitan' }] }, tx, ref);
      // En 1v1 no hay con quién hablar: la sala la crea el chat si hace falta.
      if (t.team_size > 1) guardarSalaDeEquipo(teamId, nuevo, [uid], t, tx);
    }

    const datos = { status: 'pendiente', kind: t.team_size === 1 ? 'equipo' : kind, team_id: teamId, note: note ?? null };
    if (ya) actualizarInscripcion(t.id, uid, datos, tx);
    else guardarInscripcion(t.id, uid, datos, tx);
    // Una retirada que vuelve recupera su pago.
    sumarContadores(t.id, { inscriptos: 1, pagos: ya?.paid ? 1 : 0, equipos: nuevo !== null ? 1 : 0 }, tx);
  });

  return detalle(await leerTorneo(req.params.id), req.user);
}));

router.post('/:id/withdraw', requireAuth, (req, res) => responder(res, async () => {
  const uid = req.user.id;
  const t = await buscarTorneo(req.params.id);
  if (!t) throw new Rechazo(404, 'Torneo inexistente.');

  await enTransaccion(async (tx, despues) => {
    const reg = await leerInscripcion(t.id, uid, tx);
    if (!reg) return;
    const equipo = reg.team_id ? await leerEquipo(reg.team_id, tx) : null;
    const sala = equipo ? await leerSala(`equipo_${equipo.id}`, tx) : null;

    actualizarInscripcion(t.id, uid, { status: 'retirada', team_id: null }, tx);
    let equipos = 0;
    if (equipo) {
      const members = sinMiembro(equipo.members, uid);
      if (members.length) {
        actualizarEquipo(equipo.id, { members }, tx);
        if (sala) actualizarLectores(sala.id, lectoresDeEquipo(members.map((m) => m.user_id), t), tx);
      } else {
        // El equipo se va si queda vacío, con su sala.
        borrarEquipo(equipo.id, tx);
        equipos = -1;
        if (sala) despues(() => firestore.recursiveDelete(refSala(sala.id)));
      }
    }
    const activa = vigente(reg);
    sumarContadores(t.id, { inscriptos: activa ? -1 : 0, pagos: activa && reg.paid ? -1 : 0, equipos }, tx);
  });

  return detalle(await leerTorneo(t.id), req.user);
}));

router.patch('/:id/registrations/:regId', requireAuth, requiereStaff, (req, res) => responder(res, async () => {
  const slug = req.torneo.id;
  const { status, paid, payment_ref } = req.body || {};

  await enTransaccion(async (tx) => {
    const reg = await leerInscripcion(slug, req.params.regId, tx);
    if (!reg) throw new Rechazo(404, 'Inscripción inexistente.');

    const cambios = {};
    if (status) cambios.status = status;
    if (paid !== undefined) {
      cambios.paid = paid ? 1 : 0;
      cambios.paid_at = paid ? ahora() : null;
      cambios.payment_ref = payment_ref ?? reg.payment_ref;
    }
    if (!Object.keys(cambios).length) return;

    // Los contadores siguen a las inscripciones no retiradas y, de esas, las pagas.
    const cuenta = (r) => ({ inscriptos: vigente(r) ? 1 : 0, pagos: vigente(r) && r.paid ? 1 : 0 });
    const antes = cuenta(reg);
    const luego = cuenta({ ...reg, ...cambios });
    actualizarInscripcion(slug, reg.id, cambios, tx);
    sumarContadores(slug, { inscriptos: luego.inscriptos - antes.inscriptos, pagos: luego.pagos - antes.pagos }, tx);
  });

  return detalle(await leerTorneo(slug), req.user);
}));

// ----------------------------------------------------------------- equipos

router.post('/:id/teams', requireAuth, (req, res) => responder(res, async () => {
  const t = await buscarTorneo(req.params.id);
  if (!t) throw new Rechazo(404, 'Torneo inexistente.');
  const { name, tag, members = [] } = req.body || {};
  if (!name) throw new Rechazo(400, 'Falta el nombre del equipo.');
  if (!esStaff(req.user.id, t) && members.length) {
    throw new Rechazo(403, 'Solo el organizador puede armar equipos a mano.');
  }

  // El primero es el capitán; un repetido cuenta una vez.
  const lista = [...new Set((members.length ? members : [req.user.id]).map(String))];
  const nombre = String(name).slice(0, 60);
  const ref = refEquipo();

  await enTransaccion(async (tx) => {
    const inscripciones = await Promise.all(lista.map((uid) => leerInscripcion(t.id, uid, tx)));
    await guardarEquipo({
      tournament_id: t.id,
      name: nombre,
      tag: tag ? String(tag).slice(0, 8) : null,
      captain_id: lista[0],
      members: lista.map((uid, i) => ({ user_id: uid, role: i === 0 ? 'capitan' : 'jugador' })),
    }, tx, ref);
    inscripciones.forEach((r, i) => {
      if (r) actualizarInscripcion(t.id, lista[i], { team_id: ref.id }, tx);
    });
    guardarSalaDeEquipo(ref.id, nombre, lista, t, tx);
    sumarContadores(t.id, { equipos: 1 }, tx);
  });

  return equipoParaResponder(ref.id);
}));

/** El equipo del torneo, o un 404. Va dentro de la transacción. */
async function equipoDelTorneo(t, teamId, tx) {
  const equipo = await leerEquipo(teamId, tx);
  if (!t || !equipo || equipo.tournament_id !== t.id) throw new Rechazo(404, 'Equipo inexistente.');
  return equipo;
}

router.patch('/:id/teams/:teamId', requireAuth, (req, res) => responder(res, async () => {
  const t = await buscarTorneo(req.params.id);
  await enTransaccion(async (tx) => {
    const equipo = await equipoDelTorneo(t, req.params.teamId, tx);
    const staff = esStaff(req.user.id, t);
    if (equipo.captain_id !== req.user.id && !staff) throw new Rechazo(403, 'Solo el capitán o el organizador.');

    const { name, tag, logo_url, seed, captain_id } = req.body || {};
    const cambios = {};
    if (name) cambios.name = String(name).slice(0, 60);
    if (tag !== undefined) cambios.tag = tag ? String(tag).slice(0, 8) : null;
    if (logo_url !== undefined) cambios.logo_url = logo_url || null;
    if (seed !== undefined && staff) cambios.seed = Number(seed) || null;
    if (captain_id !== undefined) cambios.captain_id = captain_id ? String(captain_id) : null;
    if (captain_id) {
      cambios.members = equipo.members.map((m) => ({ ...m, role: m.user_id === String(captain_id) ? 'capitan' : 'jugador' }));
    }
    if (Object.keys(cambios).length) actualizarEquipo(equipo.id, cambios, tx);
  });
  return equipoParaResponder(req.params.teamId);
}));

router.post('/:id/teams/:teamId/members', requireAuth, (req, res) => responder(res, async () => {
  const t = await buscarTorneo(req.params.id);
  await enTransaccion(async (tx) => {
    const equipo = await equipoDelTorneo(t, req.params.teamId, tx);
    const staff = esStaff(req.user.id, t);
    const userId = req.body?.user_id ? String(req.body.user_id) : req.user.id;
    if (userId !== req.user.id && equipo.captain_id !== req.user.id && !staff) {
      throw new Rechazo(403, 'Solo el capitán puede sumar jugadores.');
    }
    if (equipo.members.length >= t.team_size && !staff) throw new Rechazo(400, 'El equipo está completo.');

    const reg = await leerInscripcion(t.id, userId, tx);
    const sala = await leerSala(`equipo_${equipo.id}`, tx);
    const members = conMiembro(equipo.members, userId, 'jugador');
    actualizarEquipo(equipo.id, { members }, tx);
    if (reg) actualizarInscripcion(t.id, userId, { team_id: equipo.id, kind: 'equipo' }, tx);
    if (sala) actualizarLectores(sala.id, lectoresDeEquipo(members.map((m) => m.user_id), t), tx);
  });
  return equipoParaResponder(req.params.teamId);
}));

router.delete('/:id/teams/:teamId/members/:userId', requireAuth, (req, res) => responder(res, async () => {
  const t = await buscarTorneo(req.params.id);
  const userId = req.params.userId;
  await enTransaccion(async (tx, despues) => {
    const equipo = await equipoDelTorneo(t, req.params.teamId, tx);
    if (equipo.captain_id !== req.user.id && !esStaff(req.user.id, t) && userId !== req.user.id) {
      throw new Rechazo(403, 'Solo el capitán o el organizador.');
    }
    const reg = await leerInscripcion(t.id, userId, tx);
    const sala = await leerSala(`equipo_${equipo.id}`, tx);

    const members = sinMiembro(equipo.members, userId);
    if (reg) actualizarInscripcion(t.id, userId, { team_id: null, kind: 'solo' }, tx);
    if (members.length) {
      actualizarEquipo(equipo.id, { members }, tx);
      if (sala) actualizarLectores(sala.id, lectoresDeEquipo(members.map((m) => m.user_id), t), tx);
    } else {
      borrarEquipo(equipo.id, tx);
      sumarContadores(t.id, { equipos: -1 }, tx);
      if (sala) despues(() => firestore.recursiveDelete(refSala(sala.id)));
    }
  });
  return { ok: true };
}));

// ------------------------------------------------------- armador automático

router.post('/:id/autoteams', requireAuth, requiereStaff, async (req, res) => {
  const peso = req.body?.weight_overlap !== undefined ? Number(req.body.weight_overlap) : 1.5;
  try {
    res.json(await proponerEquipos(req.torneo.id, { pesoSolape: peso }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/autoteams/confirm', requireAuth, requiereStaff, async (req, res) => {
  const propuesta = req.body?.proposal;
  if (!propuesta?.teams?.length) return res.status(400).json({ error: 'Falta la propuesta.' });
  try {
    await confirmarEquipos(req.torneo.id, propuesta);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json(await detalle(await leerTorneo(req.torneo.id), req.user));
});

// ------------------------------------------------------------------ llaves

router.post('/:id/brackets', requireAuth, requiereStaff, async (req, res) => {
  try {
    await generarLlaves(req.torneo.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json(await detalle(await leerTorneo(req.torneo.id), req.user));
});

router.post('/:id/playoffs', requireAuth, requiereStaff, async (req, res) => {
  try {
    await generarPlayoffs(req.torneo.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json(await detalle(await leerTorneo(req.torneo.id), req.user));
});

router.post('/:id/swiss/next', requireAuth, requiereStaff, async (req, res) => {
  let ronda;
  try {
    ronda = await siguienteRondaSuiza(req.torneo.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ ...ronda, tournament: await detalle(await leerTorneo(req.torneo.id), req.user) });
});

// --------------------------------------------------- horarios del torneo

/** Mejores ventanas para todo el torneo. */
router.get('/:id/schedule', async (req, res) => {
  const t = await buscarTorneo(req.params.id);
  if (!t) return res.status(404).json({ error: 'Torneo inexistente.' });
  const ids = [...new Set((await listarInscripciones(t.id)).filter(vigente).map((r) => r.user_id))];
  const usuarios = await mapaDeUsuarios(ids);

  const duracion = Math.max(30, parseInt(req.query.duration, 10) || 90);
  const minimo = req.query.min ? parseInt(req.query.min, 10) : Math.ceil(ids.length * 0.6);
  const vs = ventanas(ids.map((id) => conHorario(usuarios, id)), { duracionMin: duracion, minimo, limite: 20 });
  res.json({
    total: ids.length,
    windows: vs.map((v) => ({ ...v, next_utc: proximaFecha(v.start_min).toISOString() })),
  });
});
