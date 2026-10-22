import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { requireAuth } from '../auth.js';
import { ventanas, proximaFecha, BLOQUE_MIN } from '../availability.js';
import { civs, maps } from '../catalogo.js';
import { enTransaccion, ordenarPor } from '../data/base.js';
import { actualizarUsuario, leerUsuario, mapaDeUsuarios } from '../data/usuarios.js';

export const router = Router();

router.get('/civs', (_req, res) => {
  res.json(civs());
});

router.get('/maps', (_req, res) => {
  res.json(maps());
});

// ------------------------------------------------------------ disponibilidad

/** Hoy en UTC, como YYYY-MM-DD (lo que daba date('now') en SQLite). */
const hoy = () => new Date().toISOString().slice(0, 10);

/** Excepciones que todavía no pasaron, por fecha. */
const vigentes = (excepciones) => ordenarPor((excepciones ?? []).filter((e) => e.day >= hoy()), 'day');

router.get('/availability/:userId', async (req, res) => {
  const u = await leerUsuario(req.params.userId);
  res.json({
    user_id: req.params.userId,
    block_min: BLOQUE_MIN,
    blocks: ordenarPor(u?.availability ?? [], 'start_min'),
    exceptions: vigentes(u?.exceptions),
  });
});

router.put('/availability', requireAuth, async (req, res) => {
  const bloques = Array.isArray(req.body?.blocks) ? req.body.blocks : [];
  const limpios = [];
  for (const b of bloques) {
    const s = Math.max(0, Math.min(10080, parseInt(b.start_min, 10)));
    const e = Math.max(0, Math.min(10080, parseInt(b.end_min, 10)));
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    limpios.push({ start_min: s, end_min: e });
  }
  await actualizarUsuario(req.user.id, { availability: ordenarPor(limpios, 'start_min') });
  res.json({ ok: true, count: bloques.length });
});

router.post('/availability/exception', requireAuth, async (req, res) => {
  const { day, start_min, end_min, available = 1 } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) {
    return res.status(400).json({ error: 'Fecha inválida (usá YYYY-MM-DD).' });
  }
  const nueva = {
    id: randomBytes(6).toString('hex'),
    day,
    start_min: parseInt(start_min, 10) || 0,
    end_min: parseInt(end_min, 10) || 1440,
    available: available ? 1 : 0,
  };
  // De paso se limpian las que ya pasaron.
  await enTransaccion(async (tx) => {
    const u = await leerUsuario(req.user.id, tx);
    actualizarUsuario(req.user.id, { exceptions: [...vigentes(u?.exceptions), nueva] }, tx);
  });
  res.json({ ok: true, id: nueva.id });
});

router.delete('/availability/exception/:id', requireAuth, async (req, res) => {
  await enTransaccion(async (tx) => {
    const u = await leerUsuario(req.user.id, tx);
    const quedan = vigentes(u?.exceptions).filter((e) => e.id !== req.params.id);
    actualizarUsuario(req.user.id, { exceptions: quedan }, tx);
  });
  res.json({ ok: true });
});

/** Cruce de disponibilidades: ?users=uid1,uid2,uid3&duration=90 */
router.get('/overlap', async (req, res) => {
  const ids = [...new Set(String(req.query.users || '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error: 'Pasá al menos un usuario.' });

  const duracion = Math.max(30, parseInt(req.query.duration, 10) || 60);
  const minimo = req.query.min ? parseInt(req.query.min, 10) : null;

  // Un id que no existe cuenta como alguien sin horarios, como antes.
  const mapa = await mapaDeUsuarios(ids);
  const vs = ventanas(ids.map((id) => mapa.get(id) ?? { id, availability: [] }), { duracionMin: duracion, minimo, limite: 30 });

  res.json({
    users: [...mapa.values()].map((u) => ({ id: u.id, display_name: u.display_name, timezone: u.timezone })),
    duration_min: duracion,
    windows: vs.map((v) => ({ ...v, next_utc: proximaFecha(v.start_min).toISOString() })),
  });
});
