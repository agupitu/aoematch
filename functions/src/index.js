import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { app } from './app.js';
import { STEAM_API_KEY } from './config.js';
import { alVencer } from './draft.js';
import { REGION } from './relojes.js';

// Todo corre en São Paulo (decisión D1 del PLAN.md). El techo de instancias
// limita el gasto si algo se descontrola: para un torneo sobra.
setGlobalOptions({ region: REGION, maxInstances: 3 });

// Hosting reescribe /api/** a esta función; las rutas de Express ya incluyen /api.
export const api = onRequest({ memory: '512MiB', secrets: [STEAM_API_KEY] }, app);

// Reloj del draft (relojes.js): una tarea por plazo. Si se dispara antes de
// tiempo, porTimeout corta con error y Cloud Tasks la reintenta.
export const vencerPaso = onTaskDispatched(
  { retryConfig: { maxAttempts: 5, minBackoffSeconds: 5 }, rateLimits: { maxConcurrentDispatches: 20 } },
  (req) => alVencer(req.data)
);
