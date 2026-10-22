// Rutas de torneos que siguen sobre SQLite: inscripciones y equipos (pasan a
// tournaments.js en T17), llaves (T18) y armador de equipos (T20). Se monta
// después de tournaments.js, así que solo atiende lo que ese no tiene. Se borra
// en T33.

import { Router } from 'express';
import { all, get, run, tx, usuariosConHorario } from '../db.js';
import { requireAuth } from '../auth.js';
import { generarLlaves, generarPlayoffs, siguienteRondaSuiza, tablaGrupo, tablaDesde } from '../brackets.js';
import { proponerEquipos, confirmarEquipos } from '../teambuilder.js';
import { patronPorDefecto } from '../draft-core.js';
import { minutosEnComun } from '../availability.js';

export const router = Router();

// --------------------------------------------------------------- utilidades

export function buscarTorneo(idOrSlug) {
  const n = Number(idOrSlug);
  return Number.isInteger(n) && String(n) === String(idOrSlug)
    ? get('SELECT * FROM tournaments WHERE id = ?', n)
    : get('SELECT * FROM tournaments WHERE slug = ?', String(idOrSlug));
}

export function esStaff(userId, tournamentId) {
  if (!userId) return false;
  const t = get('SELECT organizer_id FROM tournaments WHERE id = ?', tournamentId);
  if (!t) return false;
  if (t.organizer_id === userId) return true;
  return !!get('SELECT 1 FROM tournament_admins WHERE tournament_id = ? AND user_id = ?', tournamentId, userId);
}

function requiereStaff(req, res, next) {
  const t = buscarTorneo(req.params.id);
  if (!t) return res.status(404).json({ error: 'Torneo inexistente.' });
  if (!req.user || !esStaff(req.user.id, t.id)) {
    return res.status(403).json({ error: 'Solo el organizador puede hacer esto.' });
  }
  req.torneo = t;
  next();
}

function equipoCompleto(teamId) {
  const team = get('SELECT * FROM teams WHERE id = ?', teamId);
  if (!team) return null;
  const members = all(
    `SELECT u.id, u.display_name, u.avatar_url, u.steam_avatar, u.steam_name, u.timezone,
            u.rating_1v1, u.rating_team, tm.role
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ? ORDER BY (tm.role = 'capitan') DESC, u.display_name`,
    teamId
  ).map((m) => ({ ...m, avatar_url: m.avatar_url || m.steam_avatar }));
  return {
    ...team,
    members,
    overlap_min: members.length > 1 ? minutosEnComun(usuariosConHorario(members.map((m) => m.id))) : null,
  };
}

/**
 * Bolsa de premios y cuánto le toca a cada puesto. La bolsa puede ser un monto
 * declarado por el organizador o salir de lo que se recaudó en inscripciones.
 */
function premiosDe(t) {
  const pagas = get(
    `SELECT COUNT(*) AS n FROM registrations
      WHERE tournament_id = ? AND status != 'retirada' AND paid = 1`,
    t.id
  ).n;
  const recaudado = pagas * t.entry_fee_cents;
  const bolsa =
    t.prize_pool_mode === 'fijo'
      ? t.prize_pool_cents
      : t.prize_pool_mode === 'inscripciones'
        ? Math.round((recaudado * t.prize_pool_pct) / 100)
        : 0;

  const filas = all(
    'SELECT * FROM tournament_prizes WHERE tournament_id = ? ORDER BY position',
    t.id
  ).map((p) => ({
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

// ------------------------------------------------------------------ detalle

function detalle(t, user) {
  const teams = all('SELECT id FROM teams WHERE tournament_id = ? ORDER BY COALESCE(seed, 9999), id', t.id)
    .map((r) => equipoCompleto(r.id));

  const registrations = all(
    `SELECT r.*, u.display_name, u.avatar_url, u.steam_avatar, u.steam_name,
            u.rating_1v1, u.rating_team, u.timezone, te.name AS team_name
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN teams te ON te.id = r.team_id
      WHERE r.tournament_id = ? ORDER BY r.created_at`,
    t.id
  ).map((r) => ({ ...r, avatar_url: r.avatar_url || r.steam_avatar, paid: !!r.paid }));

  const stages = all('SELECT * FROM stages WHERE tournament_id = ? ORDER BY idx', t.id).map((s) => ({
    ...s,
    groups: all('SELECT * FROM groups WHERE stage_id = ? ORDER BY name', s.id).map((g) => ({
      ...g,
      standings: tablaGrupo(g.id),
    })),
  }));

  const matches = all(
    `SELECT m.*, ta.name AS team_a_name, tb.name AS team_b_name
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
      WHERE m.tournament_id = ?
      ORDER BY m.bracket, m.round, m.position`,
    t.id
  );

  const standings = ['liga', 'suizo'].includes(t.format)
    ? tablaDesde(
        all('SELECT * FROM teams WHERE tournament_id = ?', t.id),
        matches.filter((m) => ['finalizado', 'walkover'].includes(m.status))
      )
    : null;

  return {
    ...t,
    organizer: get('SELECT id, display_name FROM users WHERE id = ?', t.organizer_id),
    civ_pattern_efectivo: t.civ_pattern || patronPorDefecto(t.team_size),
    first_map: t.first_map_id ? get('SELECT * FROM maps WHERE id = ?', t.first_map_id) : null,
    ...premiosDe(t),
    maps: all(
      'SELECT m.* FROM tournament_maps tm JOIN maps m ON m.id = tm.map_id WHERE tm.tournament_id = ? ORDER BY m.name_es',
      t.id
    ),
    civs: all(
      'SELECT c.* FROM tournament_civs tc JOIN civs c ON c.id = tc.civ_id WHERE tc.tournament_id = ? ORDER BY c.name_es',
      t.id
    ),
    teams,
    registrations,
    stages,
    matches,
    standings,
    me: user
      ? {
          is_staff: esStaff(user.id, t.id),
          registration: registrations.find((r) => r.user_id === user.id) || null,
          team_id: teams.find((te) => te.members.some((m) => m.id === user.id))?.id ?? null,
        }
      : null,
  };
}

// ------------------------------------------------------------ inscripciones

router.post('/:id/register', requireAuth, (req, res) => {
  const t = buscarTorneo(req.params.id);
  if (!t) return res.status(404).json({ error: 'Torneo inexistente.' });
  if (!['inscripcion', 'armado'].includes(t.status)) {
    return res.status(400).json({ error: 'Las inscripciones no están abiertas.' });
  }
  const ya = get('SELECT * FROM registrations WHERE tournament_id = ? AND user_id = ?', t.id, req.user.id);
  if (ya && ya.status !== 'retirada') return res.status(409).json({ error: 'Ya estás inscripto.' });

  const { kind = 'solo', team_name, team_id, note } = req.body || {};
  let teamId = null;

  if (t.team_size > 1 && kind === 'equipo') {
    if (team_id) {
      const team = get('SELECT * FROM teams WHERE id = ? AND tournament_id = ?', team_id, t.id);
      if (!team) return res.status(404).json({ error: 'Ese equipo no existe en el torneo.' });
      const cupo = get('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', team.id).n;
      if (cupo >= t.team_size) return res.status(400).json({ error: 'El equipo ya está completo.' });
      teamId = team.id;
      run("INSERT OR REPLACE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'jugador')", teamId, req.user.id);
    } else {
      if (!team_name) return res.status(400).json({ error: 'Poné un nombre de equipo.' });
      const info = run(
        'INSERT INTO teams (tournament_id, name, captain_id) VALUES (?, ?, ?)',
        t.id, String(team_name).slice(0, 60), req.user.id
      );
      teamId = info.lastInsertRowid;
      run("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'capitan')", teamId, req.user.id);
      run("INSERT INTO chat_rooms (tournament_id, team_id, kind, name) VALUES (?, ?, 'equipo', ?)",
        t.id, teamId, String(team_name).slice(0, 60));
    }
  } else if (t.team_size === 1) {
    const info = run(
      'INSERT INTO teams (tournament_id, name, captain_id) VALUES (?, ?, ?)',
      t.id, req.user.display_name, req.user.id
    );
    teamId = info.lastInsertRowid;
    run("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'capitan')", teamId, req.user.id);
  } else if (!t.allow_solo) {
    return res.status(400).json({ error: 'Este torneo no acepta jugadores sueltos.' });
  }

  if (ya) {
    run(
      "UPDATE registrations SET status = 'pendiente', kind = ?, team_id = ?, note = ? WHERE id = ?",
      t.team_size === 1 ? 'equipo' : kind, teamId, note ?? null, ya.id
    );
  } else {
    run(
      'INSERT INTO registrations (tournament_id, user_id, team_id, kind, note) VALUES (?, ?, ?, ?, ?)',
      t.id, req.user.id, teamId, t.team_size === 1 ? 'equipo' : kind, note ?? null
    );
  }
  res.json(detalle(get('SELECT * FROM tournaments WHERE id = ?', t.id), req.user));
});

router.post('/:id/withdraw', requireAuth, (req, res) => {
  const t = buscarTorneo(req.params.id);
  if (!t) return res.status(404).json({ error: 'Torneo inexistente.' });
  tx(() => {
    const reg = get('SELECT * FROM registrations WHERE tournament_id = ? AND user_id = ?', t.id, req.user.id);
    if (!reg) return;
    run("UPDATE registrations SET status = 'retirada', team_id = NULL WHERE id = ?", reg.id);
    if (reg.team_id) {
      run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', reg.team_id, req.user.id);
      const quedan = get('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', reg.team_id).n;
      if (quedan === 0) run('DELETE FROM teams WHERE id = ?', reg.team_id);
    }
  });
  res.json(detalle(get('SELECT * FROM tournaments WHERE id = ?', t.id), req.user));
});

router.patch('/:id/registrations/:regId', requireAuth, requiereStaff, (req, res) => {
  const reg = get('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?', Number(req.params.regId), req.torneo.id);
  if (!reg) return res.status(404).json({ error: 'Inscripción inexistente.' });

  const { status, paid, payment_ref } = req.body || {};
  if (status) run('UPDATE registrations SET status = ? WHERE id = ?', status, reg.id);
  if (paid !== undefined) {
    run(
      'UPDATE registrations SET paid = ?, paid_at = ?, payment_ref = ? WHERE id = ?',
      paid ? 1 : 0,
      paid ? new Date().toISOString() : null,
      payment_ref ?? reg.payment_ref,
      reg.id
    );
  }
  res.json(detalle(get('SELECT * FROM tournaments WHERE id = ?', req.torneo.id), req.user));
});

// ----------------------------------------------------------------- equipos

router.post('/:id/teams', requireAuth, (req, res) => {
  const t = buscarTorneo(req.params.id);
  if (!t) return res.status(404).json({ error: 'Torneo inexistente.' });
  const { name, tag, members = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Falta el nombre del equipo.' });
  if (!esStaff(req.user.id, t.id) && members.length) {
    return res.status(403).json({ error: 'Solo el organizador puede armar equipos a mano.' });
  }

  const id = tx(() => {
    const info = run(
      'INSERT INTO teams (tournament_id, name, tag, captain_id) VALUES (?, ?, ?, ?)',
      t.id, String(name).slice(0, 60), tag ? String(tag).slice(0, 8) : null,
      members[0] ?? req.user.id
    );
    const teamId = info.lastInsertRowid;
    const lista = members.length ? members : [req.user.id];
    lista.forEach((uid, i) => {
      run("INSERT OR REPLACE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)",
        teamId, uid, i === 0 ? 'capitan' : 'jugador');
      run('UPDATE registrations SET team_id = ? WHERE tournament_id = ? AND user_id = ?', teamId, t.id, uid);
    });
    run("INSERT INTO chat_rooms (tournament_id, team_id, kind, name) VALUES (?, ?, 'equipo', ?)",
      t.id, teamId, String(name).slice(0, 60));
    return teamId;
  });

  res.json(equipoCompleto(id));
});

router.patch('/:id/teams/:teamId', requireAuth, (req, res) => {
  const t = buscarTorneo(req.params.id);
  const team = get('SELECT * FROM teams WHERE id = ? AND tournament_id = ?', Number(req.params.teamId), t?.id);
  if (!team) return res.status(404).json({ error: 'Equipo inexistente.' });
  if (team.captain_id !== req.user.id && !esStaff(req.user.id, t.id)) {
    return res.status(403).json({ error: 'Solo el capitán o el organizador.' });
  }
  const { name, tag, logo_url, seed, captain_id } = req.body || {};
  const sets = [], vals = [];
  if (name) { sets.push('name = ?'); vals.push(String(name).slice(0, 60)); }
  if (tag !== undefined) { sets.push('tag = ?'); vals.push(tag ? String(tag).slice(0, 8) : null); }
  if (logo_url !== undefined) { sets.push('logo_url = ?'); vals.push(logo_url || null); }
  if (seed !== undefined && esStaff(req.user.id, t.id)) { sets.push('seed = ?'); vals.push(Number(seed) || null); }
  if (captain_id !== undefined) { sets.push('captain_id = ?'); vals.push(Number(captain_id)); }
  if (sets.length) run(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`, ...vals, team.id);
  if (captain_id) {
    run("UPDATE team_members SET role = 'jugador' WHERE team_id = ?", team.id);
    run("UPDATE team_members SET role = 'capitan' WHERE team_id = ? AND user_id = ?", team.id, Number(captain_id));
  }
  res.json(equipoCompleto(team.id));
});

router.post('/:id/teams/:teamId/members', requireAuth, (req, res) => {
  const t = buscarTorneo(req.params.id);
  const team = get('SELECT * FROM teams WHERE id = ? AND tournament_id = ?', Number(req.params.teamId), t?.id);
  if (!team) return res.status(404).json({ error: 'Equipo inexistente.' });
  const esCapitan = team.captain_id === req.user.id;
  const staff = esStaff(req.user.id, t.id);
  const userId = Number(req.body?.user_id) || req.user.id;
  if (userId !== req.user.id && !esCapitan && !staff) {
    return res.status(403).json({ error: 'Solo el capitán puede sumar jugadores.' });
  }
  const cupo = get('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', team.id).n;
  if (cupo >= t.team_size && !staff) return res.status(400).json({ error: 'El equipo está completo.' });

  run("INSERT OR REPLACE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'jugador')", team.id, userId);
  run('UPDATE registrations SET team_id = ?, kind = ? WHERE tournament_id = ? AND user_id = ?',
    team.id, 'equipo', t.id, userId);
  res.json(equipoCompleto(team.id));
});

router.delete('/:id/teams/:teamId/members/:userId', requireAuth, (req, res) => {
  const t = buscarTorneo(req.params.id);
  const team = get('SELECT * FROM teams WHERE id = ? AND tournament_id = ?', Number(req.params.teamId), t?.id);
  if (!team) return res.status(404).json({ error: 'Equipo inexistente.' });
  const userId = Number(req.params.userId);
  if (team.captain_id !== req.user.id && !esStaff(req.user.id, t.id) && userId !== req.user.id) {
    return res.status(403).json({ error: 'Solo el capitán o el organizador.' });
  }
  run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', team.id, userId);
  run("UPDATE registrations SET team_id = NULL, kind = 'solo' WHERE tournament_id = ? AND user_id = ?", t.id, userId);
  const quedan = get('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', team.id).n;
  if (quedan === 0) run('DELETE FROM teams WHERE id = ?', team.id);
  res.json({ ok: true });
});

// ------------------------------------------------------- armador automático

router.post('/:id/autoteams', requireAuth, requiereStaff, (req, res) => {
  try {
    const peso = req.body?.weight_overlap !== undefined ? Number(req.body.weight_overlap) : 1.5;
    res.json(proponerEquipos(req.torneo.id, { pesoSolape: peso }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/autoteams/confirm', requireAuth, requiereStaff, (req, res) => {
  try {
    const propuesta = req.body?.proposal;
    if (!propuesta?.teams?.length) return res.status(400).json({ error: 'Falta la propuesta.' });
    confirmarEquipos(req.torneo.id, propuesta);
    res.json(detalle(get('SELECT * FROM tournaments WHERE id = ?', req.torneo.id), req.user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------------------------ llaves

router.post('/:id/brackets', requireAuth, requiereStaff, (req, res) => {
  try {
    generarLlaves(req.torneo.id);
    res.json(detalle(get('SELECT * FROM tournaments WHERE id = ?', req.torneo.id), req.user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/playoffs', requireAuth, requiereStaff, (req, res) => {
  try {
    generarPlayoffs(req.torneo.id);
    res.json(detalle(get('SELECT * FROM tournaments WHERE id = ?', req.torneo.id), req.user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/swiss/next', requireAuth, requiereStaff, (req, res) => {
  try {
    const r = siguienteRondaSuiza(req.torneo.id);
    res.json({ ...r, tournament: detalle(get('SELECT * FROM tournaments WHERE id = ?', req.torneo.id), req.user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
