// Siembra la demo en los emuladores (src/demo.js).
//
//   npm run seed      -> agrega la demo si no está (con `npm run emuladores` prendido)
//   npm run reset     -> vacía los emuladores y la vuelve a sembrar
//
// Solo corre contra un proyecto demo-* (los emuladores). Sembrar producción
// depende de la decisión D2 del PLAN.md.

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT ??= 'demo-aoe3draft';

if (!process.env.GCLOUD_PROJECT.startsWith('demo-')) {
  console.error('La demo solo se siembra en los emuladores (proyecto demo-*).');
  process.exit(1);
}

const { CLAVE_DEMO, sembrarDemo, vaciarEmuladores } = await import('../src/demo.js');

try {
  if (process.argv.includes('--reset')) {
    await vaciarEmuladores();
    console.log('Emuladores vaciados.');
  }
  const r = await sembrarDemo();
  if (!r.creada) {
    console.log('La demo ya estaba. Para empezar de cero: npm run reset');
  } else {
    console.log(`Demo lista.
  Organizador: ${r.organizador.email} / ${CLAVE_DEMO}
  Torneos: ${r.torneos.map((slug) => `/t/${slug}`).join(', ')}`);
  }
  process.exit(0);
} catch (err) {
  if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
    console.error('No hay emuladores: prendelos con `npm run emuladores` (o `npm run dev`).');
  } else {
    console.error(err);
  }
  process.exit(1);
}
