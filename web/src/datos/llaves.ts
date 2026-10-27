// Llaves y armador desde el navegador del staff (plan Spark: no hay servidor).
// Lo que calcula cada cosa está en web/src/logica/ (llaves.js y armador.js);
// acá se lee lo guardado, se escribe en batches y las reglas de
// firestore.rules aceptan solo al organizador y sus admins.

import {
  type DocumentReference,
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  where,
  writeBatch,
} from 'firebase/firestore';
import { firestore } from '../firebase';
import { proponerEquipos } from '../logica/armador.js';
import { cuadroDePlayoffs, generarCuadro, rondaSuiza } from '../logica/llaves.js';
import type { Tournament } from '../types';
import { type Doc, ahora, conMensaje, consultar, leer, ordenarPor } from './base';
import { vigente } from './torneos';
import { mapaDeUsuarios } from './usuarios';

const partidos = () => collection(firestore, 'matches');
const etapas = (slug: string) => collection(firestore, 'tournaments', slug, 'stages');
const refTorneo = (slug: string) => doc(firestore, 'tournaments', slug);

/** Ids de Firestore para los partidos y etapas nuevos de un torneo. */
const ids = (slug: string) => ({ nuevoId: () => doc(partidos()).id, nuevoIdEtapa: () => doc(etapas(slug)).id });

/** El torneo guardado, no el de la pantalla: el cuadro sale de lo que hay en la base. */
async function torneo(slug: string) {
  const t = await leer(refTorneo(slug));
  if (!t) throw new Error('Torneo inexistente.');
  return t;
}

/** Equipos como el ORDER BY COALESCE(seed, 9999), id de antes. */
async function equiposEnOrden(slug: string) {
  const filas = await consultar(query(collection(firestore, 'teams'), where('tournament_id', '==', slug)));
  return ordenarPor(filas, (e: Doc) => e.seed ?? 9999, 'created_at', 'id');
}

const partidosDe = (slug: string) => consultar(query(partidos(), where('tournament_id', '==', slug)));

type Escritura = (b: ReturnType<typeof writeBatch>) => void;

/** Escribe en tandas de 450: un batch acepta hasta 500 escrituras. */
async function escribirEnTandas(escrituras: Escritura[]) {
  for (let i = 0; i < escrituras.length; i += 450) {
    const b = writeBatch(firestore);
    escrituras.slice(i, i + 450).forEach((e) => e(b));
    await b.commit();
  }
}

const sinId = ({ id: _id, ...resto }: Doc) => resto;

/** Escrituras de un cuadro: partidos y etapas con sus ids ya elegidos. */
function escriturasDelCuadro(slug: string, cuadro: { partidos: Doc[]; etapas: Doc[] }): Escritura[] {
  const creado = ahora();
  return [
    ...cuadro.partidos.map((m) => (b: ReturnType<typeof writeBatch>) =>
      b.set(doc(partidos(), m.id), { ...sinId(m), created_at: creado })),
    ...cuadro.etapas.map((e) => (b: ReturnType<typeof writeBatch>) =>
      b.set(doc(etapas(slug), e.id), { ...sinId(e), created_at: creado })),
  ];
}

/**
 * Borra las llaves del torneo: partidos con sus drafts y picks, etapas y
 * salas de partido con sus mensajes. Firestore no borra en cascada.
 */
async function borrarLlaves(slug: string) {
  const refs: DocumentReference[] = [];
  const existentes = await getDocs(query(partidos(), where('tournament_id', '==', slug)));
  for (const m of existentes.docs) {
    const drafts = await getDocs(collection(m.ref, 'drafts'));
    for (const d of drafts.docs) {
      const picks = await getDocs(collection(d.ref, 'picks'));
      refs.push(...picks.docs.map((p) => p.ref), d.ref);
    }
    const votos = await getDocs(collection(m.ref, 'votos'));
    refs.push(...votos.docs.map((v) => v.ref), m.ref);
  }
  const salas = await getDocs(
    query(collection(firestore, 'rooms'), where('tournament_id', '==', slug), where('kind', '==', 'partido'))
  );
  for (const s of salas.docs) {
    const mensajes = await getDocs(collection(s.ref, 'messages'));
    refs.push(...mensajes.docs.map((x) => x.ref), s.ref);
  }
  refs.push(...(await getDocs(etapas(slug))).docs.map((e) => e.ref));
  await escribirEnTandas(refs.map((r) => (b) => b.delete(r)));
}

/** Genera (o vuelve a generar) las llaves y pasa el torneo a 'en_curso'. */
export function generarLlaves(slug: string) {
  return conMensaje(async () => {
    const t = await torneo(slug);
    const equipos = await equiposEnOrden(slug);
    if (equipos.length < 2) throw new Error('Hacen falta al menos dos equipos.');
    const cuadro = generarCuadro(t, equipos, ids(slug));
    await borrarLlaves(slug);
    await escribirEnTandas([
      ...escriturasDelCuadro(slug, cuadro),
      ...cuadro.seeds.map((s: { id: string; seed: number }) => (b: ReturnType<typeof writeBatch>) =>
        b.update(doc(firestore, 'teams', s.id), { seed: s.seed })),
      (b) => b.update(refTorneo(slug), { status: 'en_curso' }),
    ]);
  });
}

/** Cuadro final una vez cerrada la fase de grupos. */
export function generarPlayoffs(slug: string) {
  return conMensaje(async () => {
    const t = await torneo(slug);
    const [lasEtapas, equipos, losPartidos] = await Promise.all([
      consultar(etapas(slug)), equiposEnOrden(slug), partidosDe(slug),
    ]);
    const cuadro = cuadroDePlayoffs(t, lasEtapas, equipos, losPartidos, ids(slug));
    await escribirEnTandas([
      ...escriturasDelCuadro(slug, cuadro),
      ...cuadro.seeds.map((s: { id: string; seed: number }) => (b: ReturnType<typeof writeBatch>) =>
        b.update(doc(firestore, 'teams', s.id), { seed: s.seed })),
    ]);
  });
}

/** Siguiente ronda suiza. Devuelve la ronda y quién quedó libre. */
export function siguienteRondaSuiza(slug: string) {
  return conMensaje(async () => {
    const t = await torneo(slug);
    const [lasEtapas, equipos, losPartidos] = await Promise.all([
      consultar(etapas(slug)), equiposEnOrden(slug), partidosDe(slug),
    ]);
    const { ronda, partidos: nuevos, bye } = rondaSuiza(t, lasEtapas, equipos, losPartidos, ids(slug));
    await escribirEnTandas(escriturasDelCuadro(slug, { partidos: nuevos, etapas: [] }));
    return { ronda, bye: (bye as Doc | null)?.name ?? null };
  });
}

// ------------------------------------------------------------------ armador

/** Propuesta de equipos para los inscriptos solos (no retirados, sin equipo). No escribe nada. */
export function proponerEquiposDelTorneo(t: Tournament, pesoSolape: number) {
  return conMensaje(async () => {
    const inscripciones = await consultar(collection(firestore, 'tournaments', t.id, 'registrations'));
    const sueltas = ordenarPor(
      inscripciones.filter((r) => r.kind === 'solo' && vigente(r) && !r.team_id),
      'user_id'
    );
    const usuarios = await mapaDeUsuarios(sueltas.map((r) => r.user_id));
    return proponerEquipos(t, sueltas.map((r) => ({ ...usuarios.get(r.user_id), id: r.user_id })), { pesoSolape });
  });
}

type Propuesta = { teams: { name?: string; members?: { id: string }[] }[] };

/**
 * Guarda una propuesta en una transacción: crea los equipos (el primero de
 * cada uno es el capitán) y engancha las inscripciones. Las salas de equipo
 * se crean solas la primera vez que alguien abre el chat.
 */
export function confirmarEquipos(t: Tournament, propuesta: Propuesta) {
  return conMensaje(() =>
    runTransaction(firestore, async (tx) => {
      const equipos = propuesta.teams
        .map((p) => ({
          ref: doc(collection(firestore, 'teams')),
          name: String(p.name || 'Equipo').slice(0, 60),
          ids: [...new Set((p.members ?? []).map((m) => String(m.id)))],
        }))
        .filter((e) => e.ids.length);
      const regs = await Promise.all(
        equipos.map((e) => Promise.all(e.ids.map((uid) => tx.get(doc(firestore, 'tournaments', t.id, 'registrations', uid)))))
      );
      const creado = ahora();
      equipos.forEach((e, i) => {
        const members = e.ids.map((uid, j) => ({ user_id: uid, role: j === 0 ? 'capitan' : 'jugador' }));
        tx.set(e.ref, {
          tournament_id: t.id,
          name: e.name,
          tag: null,
          logo_url: null,
          captain_id: e.ids[0],
          seed: null,
          auto_built: 1,
          created_at: creado,
          members,
          member_ids: e.ids,
        });
        regs[i].forEach((r) => {
          if (r.exists()) tx.update(r.ref, { team_id: e.ref.id, kind: 'equipo' });
        });
      });
    })
  );
}
