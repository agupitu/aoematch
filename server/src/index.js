import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';

import { SERVER_DIR, ROOT_DIR, get } from './db.js';
import { attachUser } from './auth.js';
import { montarWebSocket } from './realtime.js';
import { iniciarRelojes } from './draft.js';
import { cargarCatalogo, sembrarDemo } from './seed.js';

import { router as authRouter } from './routes/auth.js';
import { router as catalogRouter } from './routes/catalog.js';
import { router as tournamentsRouter } from './routes/tournaments.js';
import { router as matchesRouter } from './routes/matches.js';

// El puerto llega por --port (así lo pasa el script de dev), por API_PORT o por
// PORT. Lo tomamos en ese orden porque algunos entornos inyectan un PORT propio
// que ya está ocupado por el servidor de Vite.
const argPort = process.argv.indexOf('--port');
const PORT =
  Number(argPort > -1 ? process.argv[argPort + 1] : null) ||
  Number(process.env.API_PORT) ||
  Number(process.env.PORT) ||
  3001;

cargarCatalogo();

// En un deploy nuevo la base arranca vacía. Con SEED_DEMO=1 se siembra la demo
// una sola vez, así la URL muestra algo apenas levanta.
if (process.env.SEED_DEMO === '1' && !get('SELECT 1 FROM tournaments LIMIT 1')) {
  try {
    sembrarDemo();
  } catch (err) {
    console.error('No se pudo sembrar la demo:', err.message);
  }
}

const app = express();
app.disable('x-powered-by');
// Detrás del proxy del hosting, para leer bien protocolo y host.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

// Imágenes de civs y mapas.
app.use('/assets', express.static(join(SERVER_DIR, 'public/assets'), { maxAge: '7d', immutable: true }));

app.use('/api/auth', authRouter);
app.use('/api', catalogRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/matches', matchesRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// En producción servimos el build de Vite desde el mismo proceso.
const dist = join(ROOT_DIR, 'web/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/assets|\/ws).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Error interno.' });
});

const server = createServer(app);
montarWebSocket(server);
iniciarRelojes();

server.listen(PORT, () => {
  console.log(`AOEMatch API escuchando en http://localhost:${PORT}`);
});
