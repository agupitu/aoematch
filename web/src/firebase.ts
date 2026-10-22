import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';

// En desarrollo todo va a los emuladores (npm run dev) con el proyecto demo,
// que no necesita credenciales. En producción la config sale de variables del
// build: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
// VITE_FIREBASE_APP_ID y VITE_FIREBASE_DATABASE_URL (la de Realtime Database, en
// us-central1). Salen de la consola (Configuración del proyecto > Tus apps > App
// web) y no son secretas: van en web/.env.production o en el entorno del deploy.
const config = import.meta.env.DEV
  ? {
      apiKey: 'demo',
      authDomain: 'demo-aoe3draft.firebaseapp.com',
      projectId: 'demo-aoe3draft',
      databaseURL: 'https://demo-aoe3draft-default-rtdb.firebaseio.com',
    }
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };

if (!config.apiKey || !config.projectId) {
  throw new Error('Falta la config de Firebase: completá web/.env.production con la app web del proyecto.');
}

export const app = initializeApp(config);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const database = getDatabase(app);

if (import.meta.env.DEV) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
  connectDatabaseEmulator(database, '127.0.0.1', 9000);
}
