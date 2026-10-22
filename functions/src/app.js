import express from 'express';
import cookieParser from 'cookie-parser';

import { attachUser } from './auth.js';
import { cargarCatalogo } from './seed.js';

import { router as authRouter } from './routes/auth.js';
import { router as catalogRouter } from './routes/catalog.js';
import { router as tournamentsRouter } from './routes/tournaments.js';
import { router as matchesRouter } from './routes/matches.js';

// La API completa, sin listen: la monta la función `api` de index.js detrás de
// /api/**. La web y las imágenes las sirve Hosting (en local, Vite).

// Mientras la base siga en SQLite, civs y mapas viven en tablas (hasta T05).
cargarCatalogo();

export const app = express();
app.disable('x-powered-by');
// Detrás del proxy de Hosting (o de Vite en local), para leer bien protocolo y host.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

app.use('/api/auth', authRouter);
app.use('/api', catalogRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/matches', matchesRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Error interno.' });
});
