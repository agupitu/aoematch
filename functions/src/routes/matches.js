import { Router } from 'express';
import { all, get, run, usuariosConHorario } from '../db.js';
import { requireAuth } from '../auth.js';
import { esStaff } from './tournaments-sqlite.js';
import { cerrarMatch } from '../brackets.js';
import { crearDraft, estadoDraft, aplicarAccion, marcarListo, emitir } from '../draft-sqlite.js';
import { equipoDelUsuario, avisoSistema, historial } from '../realtime.js';
import { publish } from '../bus.js';
import { ventanas, proximaFecha } from '../availability.js';

export const router = Router();

function cargarMatch(id) {
  return get(
    `SELECT m.*, ta.name AS team_a_name, tb.name AS team_b_name, t.slug AS tournament_slug
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       JOIN tournaments t ON t.id = m.tournament_id
      WHERE m.id = ?`,
    id
  );
}

function roster(teamId) {
  if (!teamId) return [];
  return all(
    `SELECT u.id, u.display_name, u.avatar_url, u.steam_avatar, u.timezone, tm.role
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ? ORDER BY (tm.role = 'capitan') DESC, u.display_name`,
    teamId
  ).map((m) => ({ ...m, avatar_url: m.avatar_url || m.steam_avatar }));
}

function puedeReportar(user, m) {
  if (!user) return false;
  if (esStaff(user.id, m.tournament_id)) return true;
  const t = equipoDelUsuario(user, m.id);
  if (!t) return false;
  const team = get('SELECT captain_id FROM teams WHERE id = ?', t);
  return team?.captain_id === user.id;
}

router.get('/:id', (req, res) => {
  const m = cargarMatch(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Partido inexistente.' });

  const torneo = get('SELECT * FROM tournaments WHERE id = ?', m.tournament_id);
  const miEquipo = equipoDelUsuario(req.user, m.id);
  const draftRow = get('SELECT id FROM drafts WHERE match_id = ? ORDER BY game_no DESC LIMIT 1', m.id);

  const games = all('SELECT * FROM match_games WHERE match_id = ? ORDER BY game_no', m.id).map((g) => ({
    ...g,
    map: g.map_id ? get('SELECT * FROM maps WHERE id = ?', g.map_id) : null,
    civs: all(
      `SELECT gc.user_id, gc.team_id, c.id AS civ_id, c.name_es, c.flag, u.display_name
         FROM game_civs gc JOIN civs c ON c.id = gc.civ_id JOIN users u ON u.id = gc.user_id
        WHERE gc.game_id = ?`,
      g.id
    ),
  }));

  res.json({
    ...m,
    tournament: {
      id: torneo.id, slug: torneo.slug, name: torneo.name, team_size: torneo.team_size,
      best_of: torneo.best_of, map_mode: torneo.map_mode, civ_mode: torneo.civ_mode,
      draft_timer_s: torneo.draft_timer_s,
    },
    teams: {
      a: m.team_a_id ? { id: m.team_a_id, name: m.team_a_name, roster: roster(m.team_a_id) } : null,
      b: m.team_b_id ? { id: m.team_b_id, name: m.team_b_name, roster: roster(m.team_b_id) } : null,
    },
    games,
    draft: draftRow ? estadoDraft(draftRow.id, miEquipo) : null,
    me: {
      team_id: miEquipo,
      is_staff: req.user ? esStaff(req.user.id, m.tournament_id) : false,
      can_report: puedeReportar(req.user, m),
      is_captain: miEquipo ? get('SELECT captain_id FROM teams WHERE id = ?', miEquipo)?.captain_id === req.user?.id : false,
    },
    chat: {
      general: historial(`match:${m.id}`),
      team: miEquipo ? historial(`team:${miEquipo}`) : null,
      team_id: miEquipo,
    },
  });
});

// -------------------------------------------------------------------- draft

router.post('/:id/draft', requireAuth, (req, res) => {
  const m = cargarMatch(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Partido inexistente.' });
  const miEquipo = equipoDelUsuario(req.user, m.id);
  if (!miEquipo && !esStaff(req.user.id, m.tournament_id)) {
    return res.status(403).json({ error: 'No sos parte de este partido.' });
  }
  try {
    const gameNo = Number(req.body?.game_no) || Math.max(1, m.score_a + m.score_b + 1);
    const d = crearDraft(m.id, gameNo);
    const st = emitir(d.id);
    res.json(st);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/draft/ready', requireAuth, (req, res) => {
  const d = get('SELECT * FROM drafts WHERE match_id = ? ORDER BY game_no DESC LIMIT 1', Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'No hay draft abierto.' });
  try {
    marcarListo(d.id, req.user);
    res.json(estadoDraft(d.id, equipoDelUsuario(req.user, d.match_id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/draft/action', requireAuth, (req, res) => {
  const matchId = Number(req.params.id);
  const d = get('SELECT * FROM drafts WHERE match_id = ? ORDER BY game_no DESC LIMIT 1', matchId);
  if (!d) return res.status(404).json({ error: 'No hay draft abierto.' });
  const { kind, target_id, for_user_id } = req.body || {};
  try {
    const st = aplicarAccion(d.id, req.user, {
      kind,
      targetId: Number(target_id),
      forUserId: for_user_id ? Number(for_user_id) : null,
    });
    emitir(d.id);
    if (st.state === 'finalizado') {
      const mapa = st.map_picked ? get('SELECT name_es FROM maps WHERE id = ?', st.map_picked) : null;
      avisoSistema(`match:${matchId}`, `Draft cerrado. Mapa: ${mapa?.name_es ?? 'sin definir'}.`);
    }
    res.json(estadoDraft(d.id, equipoDelUsuario(req.user, matchId)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------------------- resultados

router.post('/:id/games/:gameNo', requireAuth, (req, res) => {
  const m = cargarMatch(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Partido inexistente.' });
  if (!puedeReportar(req.user, m)) {
    return res.status(403).json({ error: 'Solo los capitanes o el organizador reportan resultados.' });
  }
  const gameNo = Number(req.params.gameNo);
  const { winner_team_id, map_id, replay_url, notes } = req.body || {};
  if (winner_team_id && ![m.team_a_id, m.team_b_id].includes(Number(winner_team_id))) {
    return res.status(400).json({ error: 'Ese equipo no juega este partido.' });
  }

  const existente = get('SELECT * FROM match_games WHERE match_id = ? AND game_no = ?', m.id, gameNo);
  if (existente) {
    run(
      'UPDATE match_games SET winner_team_id = ?, map_id = COALESCE(?, map_id), replay_url = ?, notes = ? WHERE id = ?',
      winner_team_id ? Number(winner_team_id) : null,
      map_id ? Number(map_id) : null,
      replay_url ?? existente.replay_url,
      notes ?? existente.notes,
      existente.id
    );
  } else {
    run(
      'INSERT INTO match_games (match_id, game_no, map_id, winner_team_id, replay_url, notes) VALUES (?, ?, ?, ?, ?, ?)',
      m.id, gameNo, map_id ? Number(map_id) : null,
      winner_team_id ? Number(winner_team_id) : null, replay_url ?? null, notes ?? null
    );
  }

  recalcularSerie(m.id);
  publish(`match:${m.id}`, 'match', cargarMatch(m.id));
  res.json(cargarMatch(m.id));
});

function recalcularSerie(matchId) {
  const m = get('SELECT * FROM matches WHERE id = ?', matchId);
  const games = all('SELECT * FROM match_games WHERE match_id = ?', matchId);
  const a = games.filter((g) => g.winner_team_id === m.team_a_id).length;
  const b = games.filter((g) => g.winner_team_id === m.team_b_id).length;
  const necesarios = Math.floor(m.best_of / 2) + 1;

  run('UPDATE matches SET score_a = ?, score_b = ? WHERE id = ?', a, b, matchId);

  if (a >= necesarios || b >= necesarios) {
    cerrarMatch(matchId, a > b ? m.team_a_id : m.team_b_id, a, b);
    avisoSistema(`match:${matchId}`, `Serie cerrada ${a}-${b}.`);
  } else if (m.status === 'finalizado' || m.status === 'walkover') {
    run("UPDATE matches SET status = 'en_juego', winner_team_id = NULL WHERE id = ?", matchId);
  }
}

router.post('/:id/result', requireAuth, (req, res) => {
  const m = cargarMatch(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Partido inexistente.' });
  if (!esStaff(req.user.id, m.tournament_id)) {
    return res.status(403).json({ error: 'Solo el organizador puede forzar un resultado.' });
  }
  const { winner_team_id, score_a = 0, score_b = 0, walkover = false } = req.body || {};
  cerrarMatch(m.id, Number(winner_team_id), Number(score_a), Number(score_b), !!walkover);
  publish(`match:${m.id}`, 'match', cargarMatch(m.id));
  res.json(cargarMatch(m.id));
});

// --------------------------------------------------------------- horarios

router.get('/:id/schedule', (req, res) => {
  const m = cargarMatch(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Partido inexistente.' });
  const ids = [...roster(m.team_a_id), ...roster(m.team_b_id)].map((p) => p.id);
  if (!ids.length) return res.json({ users: [], windows: [] });

  const duracion = Math.max(30, parseInt(req.query.duration, 10) || 90);
  const jugadores = usuariosConHorario(ids);
  const vs = ventanas(jugadores, { duracionMin: duracion, limite: 15 });
  const casi = vs.length ? [] : ventanas(jugadores, { duracionMin: duracion, minimo: ids.length - 1, limite: 10 });

  res.json({
    users: [...roster(m.team_a_id), ...roster(m.team_b_id)],
    duration_min: duracion,
    windows: vs.map((v) => ({ ...v, next_utc: proximaFecha(v.start_min).toISOString() })),
    partial: casi.map((v) => ({ ...v, next_utc: proximaFecha(v.start_min).toISOString() })),
  });
});

router.post('/:id/schedule', requireAuth, (req, res) => {
  const m = cargarMatch(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Partido inexistente.' });
  if (!puedeReportar(req.user, m)) {
    return res.status(403).json({ error: 'Solo los capitanes o el organizador agendan.' });
  }
  const { scheduled_at } = req.body || {};
  run("UPDATE matches SET scheduled_at = ?, status = CASE WHEN status = 'pendiente' THEN 'agendado' ELSE status END WHERE id = ?",
    scheduled_at || null, m.id);
  avisoSistema(`match:${m.id}`, scheduled_at
    ? `Partido agendado para ${new Date(scheduled_at).toISOString()} (UTC).`
    : 'Se quitó el horario del partido.');
  publish(`match:${m.id}`, 'match', cargarMatch(m.id));
  res.json(cargarMatch(m.id));
});

router.post('/:id/vote', requireAuth, (req, res) => {
  const matchId = Number(req.params.id);
  const { slot_utc, vote = 1 } = req.body || {};
  if (!slot_utc) return res.status(400).json({ error: 'Falta el horario.' });
  run(
    'INSERT OR REPLACE INTO match_schedule_votes (match_id, user_id, slot_utc, vote) VALUES (?, ?, ?, ?)',
    matchId, req.user.id, slot_utc, vote ? 1 : 0
  );
  const votos = all('SELECT * FROM match_schedule_votes WHERE match_id = ?', matchId);
  publish(`match:${matchId}`, 'votes', votos);
  res.json(votos);
});
