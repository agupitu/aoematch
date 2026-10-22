// Torneos sobre Firestore: listado, alta, detalle, edición, borrado y horarios.
// Inscripciones, equipos, llaves y armador siguen en tournaments-sqlite.js hasta
// sus tareas (T17, T18, T20).

import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { minutosEnComun, ventanas, proximaFecha } from '../availability.js';
import { civs, mapaPorId } from '../catalogo.js';
import { patronPorDefecto, poolCivs, poolMapas } from '../draft-core.js';
import { ordenarPor } from '../data/base.js';
import { listarEquipos } from '../data/equipos.js';
import { listarInscripciones, vigente } from '../data/inscripciones.js';
import { listarPartidos } from '../data/partidos.js';
import { guardarSala } from '../data/salas.js';
import { actualizarTorneo, borrarTorneo, guardarTorneo, leerTorneo, listarEtapas, listarTorneos } from '../data/torneos.js';
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

/** Tabla de posiciones; mismo cálculo que tenía SQLite (3 por partido ganado). */
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
