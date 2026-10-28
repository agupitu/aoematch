// tournaments/{slug} y su subcolección stages (docs/firestore-modelo.md).
// Las inscripciones están en inscripciones.js.

import { FieldValue, ahora, consultar, escritor, firestore, leer, ordenarPor } from './base.js';

const torneos = firestore.collection('tournaments');

export const refTorneo = (slug) => torneos.doc(String(slug));

export function leerTorneo(slug, tx) {
  return leer(refTorneo(slug), tx);
}

/** Torneos más nuevos primero, como el ORDER BY COALESCE(starts_at, created_at) DESC de antes. */
export function listarTorneos({ status } = {}, tx) {
  let q = torneos;
  if (status) q = q.where('status', '==', status);
  return consultar(q.orderBy('orden', 'desc'), tx);
}

/**
 * Alta con los valores por defecto de la tabla `tournaments`. El slug es el id:
 * falla si ya existe.
 */
export function guardarTorneo(slug, datos, w) {
  const created_at = ahora();
  const torneo = {
    description: null,
    rules_md: null,
    banner_url: null,
    status: 'borrador',
    format: 'eliminacion_simple',
    team_size: 1,
    max_teams: null,
    best_of: 3,
    best_of_final: null,
    series_mode: 'mejor_de',
    group_count: 0,
    group_advance: 2,
    swiss_rounds: 0,
    third_place: 0,
    map_mode: 'ban_hasta_uno',
    map_bans: 1,
    map_repeat: 0,
    first_map_id: null,
    civ_mode: 'snake',
    civ_bans: 0,
    civ_pattern: null,
    civ_repeat_series: 1,
    civ_repeat_team: 1,
    civ_mirror: 1,
    draft_timer_s: 60,
    entry_fee_cents: 0,
    currency: 'ARS',
    payment_methods: [],
    payment_notes: null,
    allow_solo: 1,
    reg_opens_at: null,
    reg_closes_at: null,
    starts_at: null,
    prize_pool_mode: 'ninguno',
    prize_pool_cents: 0,
    prize_pool_pct: 100,
    prize_notes: null,
    admin_ids: [],
    map_ids: [],
    civ_ids: [],
    prizes: [],
    inscriptos: 0,
    pagos: 0,
    equipos: 0,
    created_at,
    ...datos,
    slug: String(slug),
  };
  torneo.orden = torneo.starts_at ?? torneo.created_at;
  return escritor(w).create(refTorneo(slug), torneo);
}

/**
 * Cambios parciales. Necesita el torneo actual para recalcular `orden` cuando
 * cambia `starts_at`.
 */
export function actualizarTorneo(torneo, cambios, w) {
  const datos = { ...cambios };
  if (datos.starts_at !== undefined) datos.orden = datos.starts_at ?? torneo.created_at;
  delete datos.slug;
  return escritor(w).update(refTorneo(torneo.id), datos);
}

/** Suma o resta a los contadores `inscriptos`, `pagos` y `equipos`. */
export function sumarContadores(slug, deltas, w) {
  const datos = {};
  for (const [campo, n] of Object.entries(deltas)) {
    if (n) datos[campo] = FieldValue.increment(n);
  }
  if (!Object.keys(datos).length) return null;
  return escritor(w).update(refTorneo(slug), datos);
}

/**
 * Borra el torneo y todo lo que cuelga de él: inscripciones y etapas, sus
 * equipos y partidos (con los drafts), las salas de chat (con los mensajes) y
 * los avisos live/* de esos partidos. Firestore no borra en cascada.
 */
export async function borrarTorneo(slug) {
  const deEsteTorneo = (col) => firestore.collection(col).where('tournament_id', '==', String(slug)).get();
  const [equipos, partidos, salas] = await Promise.all([
    deEsteTorneo('teams'),
    deEsteTorneo('matches'),
    deEsteTorneo('rooms'),
  ]);

  const bulk = firestore.bulkWriter();
  for (const d of equipos.docs) bulk.delete(d.ref);
  for (const d of partidos.docs) bulk.delete(firestore.collection('live').doc(d.id));
  await Promise.all([
    ...partidos.docs.map((d) => firestore.recursiveDelete(d.ref, bulk)),
    ...salas.docs.map((d) => firestore.recursiveDelete(d.ref, bulk)),
    firestore.recursiveDelete(refTorneo(slug), bulk),
  ]);
  await bulk.close();
}

// ----------------------------------------------------------------- etapas

const etapas = (slug) => refTorneo(slug).collection('stages');

/** Ref de una etapa; sin id, una nueva (para conocer el id antes de escribir). */
export const refEtapa = (slug, id) => (id ? etapas(slug).doc(String(id)) : etapas(slug).doc());

/** Etapas del torneo en orden (`idx`), con sus grupos adentro. */
export async function listarEtapas(slug, tx) {
  return ordenarPor(await consultar(etapas(slug), tx), 'idx');
}

/** Alta de una etapa. Devuelve el id. */
export async function guardarEtapa(slug, datos, w, ref = refEtapa(slug)) {
  await escritor(w).set(ref, { groups: [], created_at: ahora(), ...datos });
  return ref.id;
}

export function actualizarEtapa(slug, id, cambios, w) {
  return escritor(w).update(refEtapa(slug, id), cambios);
}
