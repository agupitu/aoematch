// Llaves sobre Firestore: guarda lo que calcula la lógica pura de la web
// (plan Spark: web/src/logica/llaves.js). Formatos: eliminación simple,
// eliminación doble, liga, grupos + playoff y suizo.

import {
  cerrarPartido, cuadroDePlayoffs, generarCuadro, rondaSuiza,
} from '../../web/src/logica/llaves.js';
import { enTransaccion, escribirEnLotes, firestore } from './data/base.js';
import { actualizarEquipo, listarEquipos } from './data/equipos.js';
import { actualizarPartido, guardarPartido, leerPartido, listarPartidos, refPartido } from './data/partidos.js';
import { actualizarTorneo, guardarEtapa, leerTorneo, listarEtapas, refEtapa } from './data/torneos.js';
import { avisar } from './live.js';

export {
  cerrarEnMemoria, generarCuadro, ordenSiembra, resolverBye, tablaDesde,
} from '../../web/src/logica/llaves.js';

/** Ids de Firestore para los partidos y etapas nuevos de un torneo. */
const idsDeFirestore = (slug) => ({ nuevoId: () => refPartido().id, nuevoIdEtapa: () => refEtapa(slug).id });

const sinId = ({ id, ...resto }) => resto;

/** Escrituras de los partidos y etapas de un cuadro, para un batch o una transacción. */
function escriturasDelCuadro({ partidos, etapas }, slug) {
  return [
    ...partidos.map((m) => (w) => guardarPartido(sinId(m), w, refPartido(m.id))),
    ...etapas.map((e) => (w) => guardarEtapa(slug, sinId(e), w, refEtapa(slug, e.id))),
  ];
}

/**
 * Borra las llaves de un torneo: partidos (con sus drafts), avisos live,
 * salas de partido (con sus mensajes) y etapas.
 */
async function limpiarLlaves(slug) {
  const deEsteTorneo = (col) => firestore.collection(col).where('tournament_id', '==', String(slug)).get();
  const [partidos, salas, etapas] = await Promise.all([
    deEsteTorneo('matches'),
    deEsteTorneo('rooms'),
    firestore.collection('tournaments').doc(String(slug)).collection('stages').get(),
  ]);

  const bulk = firestore.bulkWriter();
  for (const d of partidos.docs) bulk.delete(firestore.collection('live').doc(d.id));
  for (const d of etapas.docs) bulk.delete(d.ref);
  await Promise.all([
    ...partidos.docs.map((d) => firestore.recursiveDelete(d.ref, bulk)),
    ...salas.docs.filter((d) => d.data().kind === 'partido').map((d) => firestore.recursiveDelete(d.ref, bulk)),
  ]);
  await bulk.close();
}

/** Genera (o vuelve a generar) las llaves del torneo y lo pasa a 'en_curso'. Devuelve la etapa. */
export async function generarLlaves(slug) {
  const torneo = await leerTorneo(slug);
  if (!torneo) throw new Error('Torneo inexistente.');
  const teams = await listarEquipos(slug);
  if (teams.length < 2) throw new Error('Hacen falta al menos dos equipos.');

  const cuadro = generarCuadro(torneo, teams, idsDeFirestore(slug));

  await limpiarLlaves(slug);
  await escribirEnLotes([
    ...cuadro.partidos.map((m) => (w) => guardarPartido(sinId(m), w, refPartido(m.id))),
    ...cuadro.etapas.map((e) => (w) => guardarEtapa(slug, sinId(e), w, refEtapa(slug, e.id))),
    ...cuadro.seeds.map((s) => (w) => actualizarEquipo(s.id, { seed: s.seed }, w)),
    (w) => actualizarTorneo(torneo, { status: 'en_curso' }, w),
  ]);
  return cuadro.etapas[0].id;
}

// ----------------------------------------------------- avance de resultados

/**
 * Cierra un partido y pasa ganador y perdedor a los siguientes, en una
 * transacción que lee todos los partidos del torneo: dos reportes a la vez no
 * se pisan. Si no queda ninguno por jugar, el torneo pasa a 'finalizado'.
 * Avisa en live/* a cada partido que cambió. Devuelve el partido cerrado.
 */
export function cerrarMatch(matchId, winnerTeamId, scoreA, scoreB, walkover = false) {
  return enTransaccion(async (tx, despues) => {
    const m = await leerPartido(matchId, tx);
    if (!m) throw new Error('Partido inexistente.');
    const [torneo, partidos] = await Promise.all([leerTorneo(m.tournament_id, tx), listarPartidos(m.tournament_id, tx)]);

    const { cambios, partido, terminado } = cerrarPartido(partidos, matchId, winnerTeamId, scoreA, scoreB, walkover);
    for (const { id, ...campos } of cambios) {
      actualizarPartido(id, campos, tx);
      despues(() => avisar(id, 'match'));
    }
    if (terminado && torneo.status !== 'finalizado') actualizarTorneo(torneo, { status: 'finalizado' }, tx);
    return partido;
  });
}

// ------------------------------------------------------- grupos + playoff

/** Crea el cuadro final una vez cerrada la fase de grupos. Devuelve la etapa nueva. */
export function generarPlayoffs(slug) {
  return enTransaccion(async (tx) => {
    const torneo = await leerTorneo(slug, tx);
    if (!torneo) throw new Error('Torneo inexistente.');
    const [etapas, equipos, partidos] = await Promise.all([
      listarEtapas(slug, tx), listarEquipos(slug, tx), listarPartidos(slug, tx),
    ]);
    const cuadro = cuadroDePlayoffs(torneo, etapas, equipos, partidos, idsDeFirestore(slug));
    await Promise.all([
      ...escriturasDelCuadro(cuadro, slug).map((escribir) => escribir(tx)),
      ...cuadro.seeds.map((s) => actualizarEquipo(s.id, { seed: s.seed }, tx)),
    ]);
    return cuadro.etapas[0].id;
  });
}

// -------------------------------------------------------------------- suizo

/** Empareja la siguiente ronda suiza según puntaje, evitando revanchas. */
export function siguienteRondaSuiza(slug) {
  return enTransaccion(async (tx) => {
    const torneo = await leerTorneo(slug, tx);
    if (!torneo) throw new Error('Torneo inexistente.');
    const [etapas, equipos, partidos] = await Promise.all([
      listarEtapas(slug, tx), listarEquipos(slug, tx), listarPartidos(slug, tx),
    ]);
    const { ronda, partidos: nuevos, bye } = rondaSuiza(torneo, etapas, equipos, partidos, idsDeFirestore(slug));
    await Promise.all(escriturasDelCuadro({ partidos: nuevos, etapas: [] }, slug).map((escribir) => escribir(tx)));
    return { ronda, partidos: nuevos.length, bye: bye?.name ?? null };
  });
}
