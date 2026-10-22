// Levanta los emuladores de Firebase (auth, firestore, database, functions,
// hosting, tasks y la UI en :4000).
//
//   npm run emuladores
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

// Firebase da 10 s para cargar el código de las funciones; con los emuladores
// de Java arrancando a la vez, en Windows a veces no alcanza.
env.FUNCTIONS_DISCOVERY_TIMEOUT ??= '30';

const DATOS = './.emulator-data';
const args = ['emulators:start', '--export-on-exit', DATOS];
if (existsSync(DATOS)) args.push('--import', DATOS);

// Con shell (hace falta en Windows para el firebase.cmd de node_modules/.bin)
// el comando va armado en un solo string.
const comando = ['firebase', ...args, ...process.argv.slice(2)].join(' ');
const hijo = spawn(comando, { env, stdio: 'inherit', shell: true });
hijo.on('exit', (code) => process.exit(code ?? 0));
