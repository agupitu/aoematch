import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';

// En desarrollo todo va a los emuladores (npm run dev) con el proyecto demo,
// que no necesita credenciales. En producción, el proyecto aoe-3-draft-2eea7
// (plan Spark). Estos valores identifican la app y no son secretos: la
// seguridad la ponen firestore.rules y database.rules.json. Las variables
// VITE_FIREBASE_* del build, si están, los reemplazan (otro proyecto).
const env = import.meta.env;
const config = env.DEV
  ? {
      apiKey: 'demo',
      authDomain: 'demo-aoe3draft.firebaseapp.com',
      projectId: 'demo-aoe3draft',
      databaseURL: 'https://demo-aoe3draft-default-rtdb.firebaseio.com',
    }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyAb9UXDTMp8IGKJeb_6Wx8mc8zvOUe26y8',
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'aoe-3-draft-2eea7.firebaseapp.com',
      projectId: env.VITE_FIREBASE_PROJECT_ID || 'aoe-3-draft-2eea7',
      databaseURL: env.VITE_FIREBASE_DATABASE_URL || 'https://aoe-3-draft-2eea7-default-rtdb.firebaseio.com',
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'aoe-3-draft-2eea7.firebasestorage.app',
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '122691877670',
      appId: env.VITE_FIREBASE_APP_ID || '1:122691877670:web:611d971fec1359d8c91fe7',
    };

export const app = initializeApp(config);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const database = getDatabase(app);

if (import.meta.env.DEV) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
  connectDatabaseEmulator(database, '127.0.0.1', 9000);
}
