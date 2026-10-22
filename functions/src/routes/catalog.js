import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { ventanas, proximaFecha, BLOQUE_MIN } from '../availability.js';
import { civs, maps } from '../catalogo.js';

export const router = Router();

router.get('/civs', (_req, res) => {
  res.json(civs());
});

router.get('/maps', (_req, res) => {
  res.json(maps());
});

// ------------------------------------------------------------ disponibilidad

router.get('/availability/:userId', (req, res) => {
  const userId = Number(req.params.userId);
  res.json({
    user_id: userId,
    block_min: BLOQUE_MIN,
    blocks: all('SELECT start_min, end_min FROM availability WHERE user_id = ? ORDER BY start_min', userId),
    exceptions: all(
      "SELECT day, start_min, end_min, available FROM availability_exceptions WHERE user_id = ? AND day >= date('now') ORDER BY day",
      userId
    ),
  });
});

router.put('/availability', requireAuth, (req, res) => {
  const bloques = Array.isArray(req.body?.blocks) ? req.body.blocks : [];
  run('DELETE FROM availability WHERE user_id = ?', req.user.id);
  for (const b of bloques) {
    const s = Math.max(0, Math.min(10080, parseInt(b.start_min, 10)));
    const e = Math.max(0, Math.min(10080, parseInt(b.end_min, 10)));
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    run('INSERT INTO availability (user_id, start_min, end_min) VALUES (?, ?, ?)', req.user.id, s, e);
  }
  res.json({ ok: true, count: bloques.length });
});

router.post('/availability/exception', requireAuth, (req, res) => {
  const { day, start_min, end_min, available = 1 } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) {
    return res.status(400).json({ error: 'Fecha inválida (usá YYYY-MM-DD).' });
  }
  run(
    'INSERT INTO availability_exceptions (user_id, day, start_min, end_min, available) VALUES (?, ?, ?, ?, ?)',
    req.user.id, day, parseInt(start_min, 10) || 0, parseInt(end_min, 10) || 1440, available ? 1 : 0
  );
  res.json({ ok: true });
});

router.delete('/availability/exception/:id', requireAuth, (req, res) => {
  run('DELETE FROM availability_exceptions WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

/** Cruce de disponibilidades: ?users=1,2,3&duration=90 */
router.get('/overlap', (req, res) => {
  const ids = String(req.query.users || '')
    .split(',')
    .map((n) => parseInt(n, 10))
    .filter(Number.isInteger);
  if (!ids.length) return res.status(400).json({ error: 'Pasá al menos un usuario.' });

  const duracion = Math.max(30, parseInt(req.query.duration, 10) || 60);
  const minimo = req.query.min ? parseInt(req.query.min, 10) : null;
  const vs = ventanas(ids, { duracionMin: duracion, minimo, limite: 30 });

  const usuarios = all(
    `SELECT id, display_name, timezone FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids
  );

  res.json({
    users: usuarios,
    duration_min: duracion,
    windows: vs.map((v) => ({ ...v, next_utc: proximaFecha(v.start_min).toISOString() })),
  });
});
