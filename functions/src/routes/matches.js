// Partidos sobre Firestore: detalle, draft, resultados, horarios y votos.
// Cada cambio avisa en live/{matchId} (live.js) para que la sala del partido
// vuelva a pedir el estado; el chat lo lee la web directo (chat.js).

import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { ventanas, proximaFecha } from '../availability.js';
import { cerrarMatch } from '../brackets.js';
import { civPorId, mapaPorId } from '../catalogo.js';
import { avisoSistema } from '../chat.js';
import { aplicarAccion, crearDraft, estadoDelPartido, marcarListo, resolverVencidos } from '../draft.js';
import { enTransaccion, ordenarPor } from '../data/base.js';
import { ultimoDraft } from '../data/drafts.js';
import { leerEquipos } from '../data/equipos.js';
import { actualizarPartido, conPartida, conVoto, leerPartido } from '../data/partidos.js';
import { leerTorneo } from '../data/torneos.js';
import { mapaDeUsuarios } from '../data/usuarios.js';
import { avisar } from '../live.js';

export const router = Router();

// --------------------------------------------------------------- utilidades

const esStaff = (uid, torneo) => !!uid && (torneo.organizer_id === uid || (torneo.admin_ids ?? []).includes(uid));

/**
 * El partido con lo que hace falta para responder y decidir permisos: torneo,
 * los dos equipos y sus jugadores. null si no existe.
 */
async function contexto(id) {
  const m = await leerPartido(id);
  if (!m) return null;
  const [torneo, filas] = await Promise.all([
    leerTorneo(m.tournament_id),
    leerEquipos([m.team_a_id, m.team_b_id].filter(Boolean)),
  ]);
  const porId = new Map(filas.filter(Boolean).map((e) => [e.id, e]));
  const equipos = { a: porId.get(m.team_a_id) ?? null, b: porId.get(m.team_b_id) ?? null };
  const usuarios = await mapaDeUsuarios([...(equipos.a?.member_ids ?? []), ...(equipos.b?.member_ids ?? [])]);
  return { m, torneo, equipos, usuarios };
}

/** El partido como lo devuelve la API: con los nombres de los equipos y el slug del torneo. */
function comoPartido({ m, equipos }) {
  return { ...m, team_a_name: equipos.a?.name ?? null, team_b_name: equipos.b?.name ?? null, tournament_slug: m.tournament_id };
}

/** Jugadores de un equipo: capitán primero, después por nombre. */
function roster(equipo, usuarios) {
  if (!equipo) return [];
  const jugadores = equipo.members.map((mi) => {
    const u = usuarios.get(mi.user_id) ?? {};
    return {
      id: mi.user_id,
      display_name: u.display_name ?? 'Jugador',
      avatar_url: u.avatar_url || u.steam_avatar || null,
      steam_avatar: u.steam_avatar ?? null,
      timezone: u.timezone ?? 'UTC',
      role: mi.role,
    };
  });
  return ordenarPor(jugadores, (p) => (p.role === 'capitan' ? 0 : 1), 'display_name');
}

/** El equipo del usuario en este partido, o null. */
function equipoDelUsuario(user, { equipos }) {
  if (!user) return null;
  for (const e of [equipos.a, equipos.b]) if (e?.member_ids.includes(user.id)) return e;
  return null;
}

/** El staff, o el capitán de uno de los dos equipos. */
function puedeReportar(user, ctx) {
  if (!user) return false;
  if (esStaff(user.id, ctx.torneo)) return true;
  return equipoDelUsuario(user, ctx)?.captain_id === user.id;
}

async function cargar(req, res) {
  const ctx = await contexto(req.params.id);
  if (!ctx) res.status(404).json({ error: 'Partido inexistente.' });
  return ctx;
}

// ------------------------------------------------------------------ detalle

router.get('/:id', async (req, res) => {
  const ctx = await cargar(req, res);
  if (!ctx) return;
  const { m, torneo, equipos, usuarios } = ctx;
  const miEquipo = equipoDelUsuario(req.user, ctx);

  // Respaldo del reloj: si una tarea se perdió, el paso vencido se resuelve acá.
  await resolverVencidos(m.id);
  const draft = await estadoDelPartido(m.id, miEquipo?.id ?? null);

  const games = (m.games ?? []).map((g) => ({
    id: `${m.id}_${g.game_no}`,
    match_id: m.id,
    ...g,
    map: g.map_id ? mapaPorId(g.map_id) : null,
    civs: (g.civs ?? []).map((c) => ({
      ...c,
      name_es: civPorId(c.civ_id)?.name_es ?? null,
      flag: civPorId(c.civ_id)?.flag ?? null,
      display_name: usuarios.get(c.user_id)?.display_name ?? 'Jugador',
    })),
  }));

  res.json({
    ...comoPartido(ctx),
    tournament: {
      id: torneo.id, slug: torneo.slug, name: torneo.name, team_size: torneo.team_size,
      best_of: torneo.best_of, map_mode: torneo.map_mode, civ_mode: torneo.civ_mode,
      draft_timer_s: torneo.draft_timer_s,
    },
    teams: {
      a: equipos.a ? { id: equipos.a.id, name: equipos.a.name, roster: roster(equipos.a, usuarios) } : null,
      b: equipos.b ? { id: equipos.b.id, name: equipos.b.name, roster: roster(equipos.b, usuarios) } : null,
    },
    games,
    draft,
    me: {
      team_id: miEquipo?.id ?? null,
      is_staff: req.user ? esStaff(req.user.id, torneo) : false,
      can_report: puedeReportar(req.user, ctx),
      is_captain: !!miEquipo && miEquipo.captain_id === req.user?.id,
    },
  });
});

// -------------------------------------------------------------------- draft

router.post('/:id/draft', requireAuth, async (req, res) => {
  const ctx = await cargar(req, res);
  if (!ctx) return;
  const miEquipo = equipoDelUsuario(req.user, ctx);
  if (!miEquipo && !esStaff(req.user.id, ctx.torneo)) {
    return res.status(403).json({ error: 'No sos parte de este partido.' });
  }
  const gameNo = Number(req.body?.game_no) || Math.max(1, ctx.m.score_a + ctx.m.score_b + 1);
  try {
    res.json(await crearDraft(ctx.m.id, gameNo, { viewerTeamId: miEquipo?.id ?? null }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/draft/ready', requireAuth, async (req, res) => {
  const ctx = await cargar(req, res);
  if (!ctx) return;
  if (!(await ultimoDraft(ctx.m.id))) return res.status(404).json({ error: 'No hay draft abierto.' });
  try {
    res.json(await marcarListo(ctx.m.id, req.user, { viewerTeamId: equipoDelUsuario(req.user, ctx)?.id ?? null }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/draft/action', requireAuth, async (req, res) => {
  const ctx = await cargar(req, res);
  if (!ctx) return;
  if (!(await ultimoDraft(ctx.m.id))) return res.status(404).json({ error: 'No hay draft abierto.' });
  const { kind, target_id, for_user_id } = req.body || {};
  const viewerTeamId = equipoDelUsuario(req.user, ctx)?.id ?? null;
  let st;
  try {
    // Si el paso ya venció, se resuelve antes: la acción llega tarde.
    await resolverVencidos(ctx.m.id);
    st = await aplicarAccion(ctx.m.id, req.user, {
      kind,
      targetId: Number(target_id),
      forUserId: for_user_id ? String(for_user_id) : null,
    }, { viewerTeamId });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (st.state === 'finalizado') {
    const mapa = st.map_picked ? mapaPorId(st.map_picked) : null;
    await avisoSistema(`match:${ctx.m.id}`, `Draft cerrado. Mapa: ${mapa?.name_es ?? 'sin definir'}.`);
  }
  res.json(st);
});

// ------------------------------------------------------------- resultados

/**
 * Recalcula el marcador de la serie con las partidas cargadas. Con la serie
 * definida cierra el partido (y avanza la llave); si una corrección la vuelve
 * a dejar abierta, la reabre.
 */
async function recalcularSerie(matchId) {
  const m = await leerPartido(matchId);
  const ganadas = (teamId) => (m.games ?? []).filter((g) => g.winner_team_id === teamId).length;
  const a = ganadas(m.team_a_id);
  const b = ganadas(m.team_b_id);
  const necesarios = Math.floor(m.best_of / 2) + 1;

  await actualizarPartido(matchId, { score_a: a, score_b: b });
  if (a >= necesarios || b >= necesarios) {
    await cerrarMatch(matchId, a > b ? m.team_a_id : m.team_b_id, a, b);
    await avisoSistema(`match:${matchId}`, `Serie cerrada ${a}-${b}.`);
  } else if (m.status === 'finalizado' || m.status === 'walkover') {
    await actualizarPartido(matchId, { status: 'en_juego', winner_team_id: null });
  }
}

router.post('/:id/games/:gameNo', requireAuth, async (req, res) => {
  const ctx = await cargar(req, res);
  if (!ctx) return;
  if (!puedeReportar(req.user, ctx)) {
    return res.status(403).json({ error: 'Solo los capitanes o el organizador reportan resultados.' });
  }
  const gameNo = Number(req.params.gameNo);
  const { winner_team_id, map_id, replay_url, notes } = req.body || {};
  if (winner_team_id && ![ctx.m.team_a_id, ctx.m.team_b_id].includes(String(winner_team_id))) {
    return res.status(400).json({ error: 'Ese equipo no juega este partido.' });
  }

  await enTransaccion(async (tx) => {
    const m = await leerPartido(ctx.m.id, tx);
    const previa = (m.games ?? []).find((g) => g.game_no === gameNo);
    const games = conPartida(m.games ?? [], {
      game_no: gameNo,
      winner_team_id: winner_team_id ? String(winner_team_id) : null,
      map_id: map_id ? Number(map_id) : previa?.map_id ?? null,
      replay_url: replay_url ?? previa?.replay_url ?? null,
      notes: notes ?? previa?.notes ?? null,
    });
    actualizarPartido(m.id, { games }, tx);
  });
  await recalcularSerie(ctx.m.id);
  await avisar(ctx.m.id, 'match');
  res.json(comoPartido(await contexto(ctx.m.id)));
});

router.post('/:id/result', requireAuth, async (req, res) => {
  const ctx = await cargar(req, res);
  if (!ctx) return;
  if (!esStaff(req.user.id, ctx.torneo)) {
    return res.status(403).json({ error: 'Solo el organizador puede forzar un resultado.' });
  }
  const { winner_team_id, score_a = 0, score_b = 0, walkover = false } = req.body || {};
  if (![ctx.m.team_a_id, ctx.m.team_b_id].includes(String(winner_team_id))) {
    return res.status(400).json({ error: 'Ese equipo no juega este partido.' });
  }
  await cerrarMatch(ctx.m.id, String(winner_team_id), Number(score_a), Number(score_b), !!walkover);
  res.json(comoPartido(await contexto(ctx.m.id)));
});

// --------------------------------------------------------------- horarios

router.get('/:id/schedule', async (req, res) => {
  const ctx = await cargar(req, res);
  if (!ctx) return;
  const jugadores = [...roster(ctx.equipos.a, ctx.usuarios), ...roster(ctx.equipos.b, ctx.usuarios)];
  if (!jugadores.length) return res.json({ users: [], windows: [] });

  const conHorario = jugadores.map((p) => ctx.usuarios.get(p.id) ?? { id: p.id, availability: [] });
  const duracion = Math.max(30, parseInt(req.query.duration, 10) || 90);
  const vs = ventanas(conHorario, { duracionMin: duracion, limite: 15 });
  const casi = vs.length ? [] : ventanas(conHorario, { duracionMin: duracion, minimo: jugadores.length - 1, limite: 10 });

  res.json({
    users: jugadores,
    duration_min: duracion,
    windows: vs.map((v) => ({ ...v, next_utc: proximaFecha(v.start_min).toISOString() })),
    partial: casi.map((v) => ({ ...v, next_utc: proximaFecha(v.start_min).toISOString() })),
  });
});

router.post('/:id/schedule', requireAuth, async (req, res) => {
  const ctx = await cargar(req, res);
  if (!ctx) return;
  if (!puedeReportar(req.user, ctx)) {
    return res.status(403).json({ error: 'Solo los capitanes o el organizador agendan.' });
  }
  const scheduled_at = req.body?.scheduled_at || null;
  await actualizarPartido(ctx.m.id, {
    scheduled_at,
    ...(ctx.m.status === 'pendiente' ? { status: 'agendado' } : {}),
  });
  await avisoSistema(`match:${ctx.m.id}`, scheduled_at
    ? `Partido agendado para ${new Date(scheduled_at).toISOString()} (UTC).`
    : 'Se quitó el horario del partido.');
  await avisar(ctx.m.id, 'match');
  res.json(comoPartido(await contexto(ctx.m.id)));
});

router.post('/:id/vote', requireAuth, async (req, res) => {
  const { slot_utc, vote = 1 } = req.body || {};
  if (!slot_utc) return res.status(400).json({ error: 'Falta el horario.' });
  const votos = await enTransaccion(async (tx) => {
    const m = await leerPartido(req.params.id, tx);
    if (!m) return null;
    const nuevos = conVoto(m.schedule_votes ?? [], { user_id: req.user.id, slot_utc: String(slot_utc), vote });
    actualizarPartido(m.id, { schedule_votes: nuevos }, tx);
    return nuevos;
  });
  if (!votos) return res.status(404).json({ error: 'Partido inexistente.' });
  await avisar(req.params.id, 'votes');
  res.json(votos.map((v) => ({ match_id: req.params.id, ...v })));
});
