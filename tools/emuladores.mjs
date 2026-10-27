// Emuladores de Firebase.
//
//   npm run emuladores   -> levanta todos (auth, firestore, database, hosting) con
//                           la UI en :4000
//   npm test             -> levanta auth, firestore y database, corre las pruebas de
//                           functions/ y las de lógica de web/, y los apaga
//
// Firestore y Realtime Database corren en Java. Si local.env trae
// JAVA_HOME_EMULADORES (la carpeta de un JDK 11+), se pone primero en el PATH;
// así no depende de un JAVA_HOME de sistema roto. Los datos se guardan en
// .emulator-data al cerrar y se vuelven a cargar al arrancar.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const env = { ...process.env };
const java = env.JAVA_HOME_EMULADORES && join(env.JAVA_HOME_EMULADORES, 'bin');
if (java && existsSync(java)) {
  // En Windows la variable se llama Path: hay que pisar esa, no sumar otra.
  const clave = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[clave] = `${java}${delimiter}${env[clave] ?? ''}`;
}

const [modo, ...extra] = process.argv.slice(2);
let args;
if (modo === 'test') {
  // Base vacía y aparte: las pruebas no usan ni tocan .emulator-data.
  args = ['emulators:exec', '--only', 'auth,firestore,database', '"npm --prefix functions test && npm --prefix web test"'];
} else {
  const DATOS = './.emulator-data';
  args = ['emulators:start', '--export-on-exit', DATOS];
  if (existsSync(DATOS)) args.push('--import', DATOS);
  if (modo) extra.unshift(modo);
}

// Con shell (hace falta en Windows para el firebase.cmd de node_modules/.bin)
// el comando va armado en un solo string.
const comando = ['firebase', ...args, ...extra].join(' ');
const hijo = spawn(comando, { env, stdio: 'inherit', shell: true });
hijo.on('exit', (code) => process.exit(code ?? 0));
