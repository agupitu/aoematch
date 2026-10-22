import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';

import { app } from './app.js';

// Todo corre en São Paulo (decisión D1 del PLAN.md).
setGlobalOptions({ region: 'southamerica-east1' });

// Hosting reescribe /api/** a esta función; las rutas de Express ya incluyen /api.
export const api = onRequest(app);
