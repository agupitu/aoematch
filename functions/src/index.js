import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';

import { app } from './app.js';
import { STEAM_API_KEY } from './config.js';

// Todo corre en São Paulo (decisión D1 del PLAN.md). El techo de instancias
// limita el gasto si algo se descontrola: para un torneo sobra.
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 3 });

// Hosting reescribe /api/** a esta función; las rutas de Express ya incluyen /api.
export const api = onRequest({ memory: '512MiB', secrets: [STEAM_API_KEY] }, app);
