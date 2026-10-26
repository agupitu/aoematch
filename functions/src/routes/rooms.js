// Salas de chat (chat.js). Los mensajes se leen directo de Firestore; acá se
// abre la sala (la crea si hace falta y dice si se puede escribir) y se escribe.

import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { ErrorDeSala, abrirSala, escribir } from '../chat.js';

export const router = Router();

/** Responde lo que devuelve `fn`, o el error de sala con su código. */
async function responder(res, fn) {
  try {
    res.json(await fn());
  } catch (err) {
    if (!(err instanceof ErrorDeSala)) throw err;
    res.status(err.status).json({ error: err.message });
  }
}

router.get('/:room', (req, res) => responder(res, () => abrirSala(req.params.room, req.user)));

router.post('/:room/messages', requireAuth, (req, res) =>
  responder(res, async () => ({ message: await escribir(req.params.room, req.user, req.body?.body) }))
);
