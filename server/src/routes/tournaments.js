import { Router } from 'express';
import { all, get, run, tx, marks } from '../db.js';
import { requireAuth } from '../auth.js';
import { generarLlaves, generarPlayoffs, siguienteRondaSuiza, tablaGrupo, tablaDesde } from '../brackets.js';
import { proponerEquipos, confirmarEquipos } from '../teambuilder.js';
import { patronPorDefecto } from '../draft.js';
import { minutosEnComun, ventanas, proximaFecha } from '../availability.js';

export const router = Router();

// --------------------------------------------------------------- utilidades

function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60) || 'torneo';
}

function slugLibre(base) {
  let slug = base, n = 2;
  while (get('SELECT 1 FROM tournaments WHERE slug = ?', slug)) slug = `${base}-${n++}`;
  return slug;
}

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
    overlap_min: members.length > 1 ? minutosEnComun(members.map((m) => m.id)) : null,
  };
}

// ------------------------------------------------------------------ listado

router.get('/', (req, res) => {
  const estado = req.query.status;
  const filas = all(
    `SELECT t.*, u.display_name AS organizer_name,
            (SELECT COUNT(*) FROM registrations r WHERE r.tournament_id = t.id AND r.status != 'retirada') AS inscriptos,
            (SELECT COUNT(*) FROM teams te WHERE te.tournament_id = t.id) AS equipos
       FROM tournaments t JOIN users u ON u.id = t.organizer_id
      ${estado ? 'WHERE t.status = ?' : ''}
      ORDER BY COALESCE(t.starts_at, t.created_at) DESC`,
    ...(estado ? [estado] : [])
  );
  res.json(filas);
});

// -------------------------------------------------------------------- crear

const CAMPOS_EDITABLES = [
  'name', 'description', 'rules_md', 'banner_url', 'status', 'format', 'team_size',
  'max_teams', 'best_of', 'best_of_final', 'group_count', 'group_advance', 'swiss_rounds',
  'third_place', 'map_mode', 'map_bans', 'map_repeat', 'civ_mode', 'civ_bans', 'civ_pattern',
  'civ_repeat_series', 'civ_repeat_team', 'civ_mirror', 'draft_timer_s', 'entry_fee_cents',
  'currency', 'payment_link', 'payment_notes', 'allow_solo', 'reg_opens_at', 'reg_closes_at',
  'starts_at',
];

router.post('/', requireAuth, (req, res) => {
  const body = req.body || {};
  if (!body.name) return res.status(400).json({ error: 'Falta el nombre del torneo.' });

  const slug = slugLibre(slugify(body.name));
  const info = run(
    'INSERT INTO tournaments (slug, name, organizer_id) VALUES (?, ?, ?)',
    slug, String(body.name).slice(0, 120), req.user.id
  );
  const id = info.lastInsertRowid;

  aplicarCampos(id, body);
  run("INSERT INTO chat_rooms (tournament_id, kind, name) VALUES (?, 'torneo', 'General')", id);

  if (Array.isArray(body.map_ids)) setPool(id, 'tournament_maps', 'map_id', body.map_ids);
  if (Array.isArray(body.civ_ids)) setPool(id, 'tournament_civs', 'civ_id', body.civ_ids);
  else {
    // Por defecto, todas las civs disponibles.
    const todas = all('SELECT id FROM civs').map((c) => c.id);
    setPool(id, 'tournament_civs', 'civ_id', todas);
  }

  res.json(detalle(get('SELECT * FROM tournaments WHERE id = ?', id), req.user));
});

function aplicarCampos(id, body) {
  const sets = [], vals = [];
  for (const c of CAMPOS_EDITABLES) {
    if (body[c] === undefined) continue;
    let v = body[c];
    if (['team_size', 'max_teams', 'best_of', 'best_of_final', 'group_count', 'group_advance',
         'swiss_rounds', 'third_place', 'map_bans', 'map_repeat', 'civ_bans', 'civ_repeat_series',
         'civ_repeat_team', 'civ_mirror', 'draft_timer_s', 'entry_fee_cents', 'allow_solo'].includes(c)) {
      v = v === null || v === '' ? null : Number(v);
      if (v !== null && !Number.isFinite(v)) continue;
      if (typeof body[c] === 'boolean') v = body[c] ? 1 : 0;
    } else if (v === '') {
      v = null;
    }
    sets.push(`${c} = ?`);
    vals.push(v);
  }
  if (sets.length) run(`UPDATE tournaments SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
}

function setPool(tournamentId, tabla, columna, ids) {
  const limpios = [...new Set(ids.map((n) => parseInt(n, 10)).filter(Number.isInteger))];
  run(`DELETE FROM ${tabla} WHERE tournament_id = ?`, tournamentId);
  for (const id of limpios) {
    run(`INSERT OR IGNORE INTO ${tabla} (tournament_id, ${columna}) VALUES (?, ?)`, tournamentId, id);
  }
  return limpios.length;
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

router.get('/:id', (req, res) => {
  const t = buscarTorneo(req.params.id);
  if (!t) return res.status(404).json({ error: 'Torneo inexistente.' });
  res.json(detalle(t, req.user));
});

router.patch('/:id', requireAuth, requiereStaff, (req, res) => {
  aplicarCampos(req.torneo.id, req.body || {});
  if (Array.isArray(req.body?.map_ids)) setPool(req.torneo.id, 'tournament_maps', 'map_id', req.body.map_ids);
  if (Array.isArray(req.body?.civ_ids)) setPool(req.torneo.id, 'tournament_civs', 'civ_id', req.body.civ_ids);
  res.json(detalle(get('SELECT * FROM tournaments WHERE id = ?', req.torneo.id), req.user));
});

router.delete('/:id', requireAuth, requiereStaff, (req, res) => {
  run('DELETE FROM tournaments WHERE id = ?', req.torneo.id);
  res.json({ ok: true });
});

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

// --------------------------------------------------- horarios del torneo

/** Mejores ventanas para un conjunto de equipos o para todo el torneo. */
router.get('/:id/schedule', (req, res) => {
  const t = buscarTorneo(req.params.id);
  if (!t) return res.status(404).json({ error: 'Torneo inexistente.' });
  const ids = all(
    `SELECT DISTINCT u.id FROM registrations r JOIN users u ON u.id = r.user_id
      WHERE r.tournament_id = ? AND r.status != 'retirada'`,
    t.id
  ).map((r) => r.id);
  const duracion = Math.max(30, parseInt(req.query.duration, 10) || 90);
  const minimo = req.query.min ? parseInt(req.query.min, 10) : Math.ceil(ids.length * 0.6);
  const vs = ventanas(ids, { duracionMin: duracion, minimo, limite: 20 });
  res.json({
    total: ids.length,
    windows: vs.map((v) => ({ ...v, next_utc: proximaFecha(v.start_min).toISOString() })),
  });
});
