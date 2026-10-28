// Torneos de punta a punta contra las reglas de Firestore: cada actor (jugadores,
// capitanes, organizador) hace lo mismo que la web con su propia sesión —
// inscribirse, armar equipos, pagar, generar llaves, agendar, draft con pick
// ciego y carga de resultados— y las reglas tienen que dejarlo pasar. Al final
// se revisa que el torneo haya terminado con campeón y datos coherentes.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { civs, maps } from '../../web/src/logica/catalogo.js';
import { proponerEquipos } from '../../web/src/logica/armador.js';
import { banear, civsPermitidas, elegirMapa, planDeDraft, turnoDeBan } from '../../web/src/logica/draft.js';
import { instanteLocal, rangoDeDias } from '../../web/src/logica/calendario.js';
import {
  cargarPartidas, cuadroDePlayoffs, darWalkover, generarCuadro, terminado, torneoTerminado,
} from '../../web/src/logica/llaves.js';
import { rondaIdDe } from '../../web/src/logica/rondas.js';
import { partidasMaximas } from '../../web/src/logica/series.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Faltan los emuladores: corré las pruebas con `npm test` desde la raíz.');
}

const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
let env;

const como = (uid) => env.authenticatedContext(uid).firestore();
const FV = () => firebase.firestore.FieldValue;
const ahora = () => new Date().toISOString();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT,
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
  });
});

after(() => env.cleanup());

function rngSemilla(semilla) {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const alAzar = (lista, rnd) => lista[Math.floor(rnd() * lista.length)];

// ------------------------------------------------------- lo que hace la web

const perfil = (nombre, rating) => ({
  display_name: nombre, display_name_lower: nombre.toLowerCase(), avatar_url: null, timezone: 'America/Argentina/Buenos_Aires',
  rating_1v1: rating, rating_team: rating,
});

async function crearUsuarios(n, rnd) {
  const usuarios = [];
  for (let i = 0; i < n; i++) {
    const id = `j${String(i + 1).padStart(2, '0')}`;
    const datos = perfil(`Jugador ${i + 1}`, 900 + Math.floor(rnd() * 900));
    await assertSucceeds(como(id).doc(`users/${id}`).set(datos));
    usuarios.push({ id, ...datos });
  }
  return usuarios;
}

const POR_DEFECTO = {
  description: null, rules_md: null, banner_url: null, status: 'borrador', format: 'eliminacion_simple',
  team_size: 1, max_teams: null, best_of: 3, best_of_final: null, series_mode: 'mejor_de', group_count: 0, group_advance: 2,
  swiss_rounds: 0, third_place: 0, map_repeat: 0, first_map_id: null, civ_bans: 0, civ_repeat_series: 1, civ_repeat_team: 1,
  entry_fee_cents: 0, currency: 'ARS', payment_methods: [], payment_notes: null, allow_solo: 1, reg_opens_at: null,
  reg_closes_at: null, starts_at: null, prize_pool_mode: 'ninguno', prize_pool_cents: 0, prize_pool_pct: 100,
  prize_notes: null, admin_ids: [], map_ids: [], civ_ids: [], prizes: [],
};

async function crearTorneo(slug, organizador, extra) {
  const created_at = ahora();
  const datos = {
    ...POR_DEFECTO,
    map_ids: maps().slice(0, 10).map((m) => m.id),
    civ_ids: civs().map((c) => c.id),
    ...extra,
    name: `Torneo ${slug}`, organizer_id: organizador, created_at, slug,
  };
  await assertSucceeds(como(organizador).doc(`tournaments/${slug}`).set({ ...datos, orden: created_at }));
  return { id: slug, ...datos, orden: created_at };
}

const leerDoc = async (db, ruta) => {
  const s = await db.doc(ruta).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
};
const leerColeccion = async (query) => (await query.get()).docs.map((d) => ({ id: d.id, ...d.data() }));

const torneoActual = (slug) => leerDoc(como('lector'), `tournaments/${slug}`);

/** Inscripción como `inscribirse` de la web (suelto, equipo nuevo o sumándose a uno). */
async function inscribirse(t, uid, { kind = 'solo', team_name, team_id } = {}) {
  const db = como(uid);
  const actual = await torneoActual(t.id);
  await db.runTransaction(async (tx) => {
    const ya = await tx.get(db.doc(`tournaments/${t.id}/registrations/${uid}`));
    if (ya.exists && ya.data().status !== 'retirada') throw new Error('Ya estás inscripto.');
    let equipo = null;
    let pedido = null;
    let nuevo = null;
    if (actual.team_size > 1 && kind === 'equipo') {
      if (team_id) {
        const e = await tx.get(db.doc(`teams/${team_id}`));
        const datos = { id: e.id, ...e.data() };
        if (datos.staff_made) pedido = datos; else equipo = datos;
      } else nuevo = team_name;
    } else if (actual.team_size === 1) nuevo = `Jugador ${uid}`;
    let teamId = equipo?.id ?? null;
    if (equipo) {
      const members = [...equipo.members, { user_id: uid, role: 'jugador' }];
      tx.update(db.doc(`teams/${equipo.id}`), { members, member_ids: members.map((m) => m.user_id) });
    }
    if (nuevo !== null) {
      const ref = db.collection('teams').doc();
      teamId = ref.id;
      tx.set(ref, {
        tournament_id: t.id, name: nuevo, tag: null, logo_url: null, captain_id: uid, seed: null, auto_built: 0,
        created_at: ahora(), members: [{ user_id: uid, role: 'capitan' }], member_ids: [uid],
      });
    }
    const datos = {
      status: 'pendiente',
      kind: actual.team_size === 1 ? 'equipo' : teamId ? 'equipo' : 'solo',
      team_id: teamId,
      join_request: pedido ? { team_id: pedido.id, status: 'pendiente', created_at: ahora() } : null,
      note: null,
    };
    if (ya.exists) tx.update(db.doc(`tournaments/${t.id}/registrations/${uid}`), datos);
    else tx.set(db.doc(`tournaments/${t.id}/registrations/${uid}`), { user_id: uid, paid: 0, paid_at: null, payment_ref: null, created_at: ahora(), ...datos });
  });
}

async function retirarse(t, uid) {
  const db = como(uid);
  await db.runTransaction(async (tx) => {
    const reg = await tx.get(db.doc(`tournaments/${t.id}/registrations/${uid}`));
    const r = reg.data();
    const equipo = r.team_id ? await tx.get(db.doc(`teams/${r.team_id}`)) : null;
    tx.update(db.doc(`tournaments/${t.id}/registrations/${uid}`), { status: 'retirada', team_id: null, join_request: null });
    if (!equipo?.exists) return;
    const members = equipo.data().members.filter((m) => m.user_id !== uid);
    if (members.length) {
      const cambios = { members, member_ids: members.map((m) => m.user_id) };
      if (equipo.data().captain_id === uid) cambios.captain_id = members[0].user_id;
      tx.update(equipo.ref, cambios);
    } else tx.delete(equipo.ref);
  });
}

const marcarPago = (staff, t, uid) =>
  como(staff).doc(`tournaments/${t.id}/registrations/${uid}`).update({
    status: 'confirmada', paid: 1, paid_at: ahora(), paid_method: 'Mercado Pago', paid_amount_cents: 300000, paid_currency: 'ARS',
  });

async function confirmarEquipos(staff, t, propuesta) {
  const db = como(staff);
  await db.runTransaction(async (tx) => {
    const equipos = propuesta.teams.map((p) => ({ ref: db.collection('teams').doc(), name: p.name, ids: p.members.map((m) => m.id) }));
    const regs = await Promise.all(equipos.map((e) => Promise.all(e.ids.map((uid) => tx.get(db.doc(`tournaments/${t.id}/registrations/${uid}`))))));
    equipos.forEach((e, i) => {
      const members = e.ids.map((uid, j) => ({ user_id: uid, role: j === 0 ? 'capitan' : 'jugador' }));
      tx.set(e.ref, {
        tournament_id: t.id, name: e.name, tag: null, logo_url: null, captain_id: e.ids[0], seed: null, auto_built: 1,
        created_at: ahora(), members, member_ids: e.ids,
      });
      regs[i].forEach((r) => { if (r.exists) tx.update(r.ref, { team_id: e.ref.id, kind: 'equipo' }); });
    });
  });
}

const sinId = ({ id: _id, ...resto }) => resto;

/** `generarLlaves` de la web. */
async function generarLlaves(staff, t) {
  const db = como(staff);
  const torneo = await leerDoc(db, `tournaments/${t.id}`);
  const equipos = (await leerColeccion(db.collection('teams').where('tournament_id', '==', t.id)))
    .sort((a, b) => (a.seed ?? 9999) - (b.seed ?? 9999) || (a.created_at < b.created_at ? -1 : 1));
  const cuadro = generarCuadro(torneo, equipos, {
    nuevoId: () => db.collection('matches').doc().id,
    nuevoIdEtapa: () => db.collection(`tournaments/${t.id}/stages`).doc().id,
  });
  const batch = db.batch();
  const creado = ahora();
  cuadro.partidos.forEach((m) => batch.set(db.collection('matches').doc(m.id), { ...sinId(m), created_at: creado }));
  cuadro.etapas.forEach((e) => batch.set(db.doc(`tournaments/${t.id}/stages/${e.id}`), { ...sinId(e), created_at: creado }));
  cuadro.seeds.forEach((s) => batch.update(db.doc(`teams/${s.id}`), { seed: s.seed }));
  batch.update(db.doc(`tournaments/${t.id}`), { status: 'en_curso' });
  await batch.commit();
  return { equipos, cuadro };
}

async function generarPlayoffs(staff, t) {
  const db = como(staff);
  const torneo = await leerDoc(db, `tournaments/${t.id}`);
  const [etapas, equipos, partidos] = await Promise.all([
    leerColeccion(db.collection(`tournaments/${t.id}/stages`)),
    leerColeccion(db.collection('teams').where('tournament_id', '==', t.id)),
    leerColeccion(db.collection('matches').where('tournament_id', '==', t.id)),
  ]);
  const cuadro = cuadroDePlayoffs(torneo, etapas, equipos, partidos, {
    nuevoId: () => db.collection('matches').doc().id,
    nuevoIdEtapa: () => db.collection(`tournaments/${t.id}/stages`).doc().id,
  });
  const batch = db.batch();
  const creado = ahora();
  cuadro.partidos.forEach((m) => batch.set(db.collection('matches').doc(m.id), { ...sinId(m), created_at: creado }));
  cuadro.etapas.forEach((e) => batch.set(db.doc(`tournaments/${t.id}/stages/${e.id}`), { ...sinId(e), created_at: creado }));
  cuadro.seeds.forEach((s) => batch.update(db.doc(`teams/${s.id}`), { seed: s.seed }));
  await batch.commit();
}

/** Fechas de la ronda (staff), horarios (jugadores) y agenda (capitán). */
async function agendarRonda(staff, t, partido, equipos) {
  const zona = 'America/Argentina/Buenos_Aires';
  const desde = '2026-12-01';
  const hasta = '2026-12-03';
  const rango = rangoDeDias(desde, hasta, zona);
  const rondaId = rondaIdDe(partido);
  await assertSucceeds(
    como(staff).doc(`tournaments/${t.id}/rondas/${rondaId}`).set({
      stage_id: partido.stage_id, bracket: partido.bracket, round: partido.round, label: partido.label,
      from_day: desde, to_day: hasta, zone: zona, ...rango, updated_at: ahora(),
    })
  );
  const bloque = {
    starts_at: new Date(instanteLocal('2026-12-02', 20 * 60, zona)).toISOString(),
    ends_at: new Date(instanteLocal('2026-12-02', 23 * 60, zona)).toISOString(),
  };
  const porId = new Map(equipos.map((e) => [e.id, e]));
  const jugadores = [...porId.get(partido.team_a_id).member_ids, ...porId.get(partido.team_b_id).member_ids];
  for (const uid of jugadores) {
    await assertSucceeds(como(uid).doc(`tournaments/${t.id}/rondas/${rondaId}/horarios/${uid}`).set({ user_id: uid, blocks: [bloque], updated_at: ahora() }));
  }
  const capitan = porId.get(partido.team_a_id).captain_id;
  await assertSucceeds(como(capitan).doc(`matches/${partido.id}`).update({ scheduled_at: bloque.starts_at, status: 'agendado' }));
}

// ----------------------------------------------------------------- el draft

async function jugarDraftEnLaWeb(t, partido, equipos, gameNo, rnd) {
  const porId = new Map(equipos.map((e) => [e.id, e]));
  const refDraft = (db) => db.doc(`matches/${partido.id}/drafts/${gameNo}`);
  const jugadorA = porId.get(partido.team_a_id).captain_id;

  // abrirDraft: cualquiera de los que juegan.
  const dbA = como(jugadorA);
  await dbA.runTransaction(async (tx) => {
    if ((await tx.get(refDraft(dbA))).exists) return;
    const ms = await tx.get(dbA.doc(`matches/${partido.id}`));
    const m = { id: ms.id, ...ms.data() };
    const [ts, as, bs] = await Promise.all([
      tx.get(dbA.doc(`tournaments/${t.id}`)), tx.get(dbA.doc(`teams/${m.team_a_id}`)), tx.get(dbA.doc(`teams/${m.team_b_id}`)),
    ]);
    tx.set(refDraft(dbA), { ...planDeDraft(ts.data(), m, { a: as.data(), b: bs.data() }, gameNo), picked: [] });
  });

  const capitanDe = (teamId) => como(porId.get(teamId).captain_id);
  let d = (await refDraft(dbA).get()).data();

  if (d.state === 'mapa') {
    const db = capitanDe(d.map_chooser_team_id);
    const mapa = alAzar(d.map_pool, rnd);
    await db.runTransaction(async (tx) => {
      const nuevo = elegirMapa((await tx.get(refDraft(db))).data(), d.map_chooser_team_id, mapa);
      tx.update(refDraft(db), { map_id: nuevo.map_id, state: nuevo.state });
    });
    d = (await refDraft(dbA).get()).data();
  }
  while (d.state === 'bans') {
    const equipo = turnoDeBan(d);
    const db = capitanDe(equipo);
    const civ = alAzar(d.civ_pool.filter((c) => !d.banned_civ_ids.includes(c)), rnd);
    await db.runTransaction(async (tx) => {
      const nuevo = banear((await tx.get(refDraft(db))).data(), equipo, civ);
      tx.update(refDraft(db), { banned_civ_ids: nuevo.banned_civ_ids, state: nuevo.state });
    });
    d = (await refDraft(dbA).get()).data();
  }

  // Picks ciegos, de a uno, cada jugador con su sesión (los compañeros ven los suyos si el torneo no deja repetir).
  const picks = {};
  for (const uid of d.player_ids) {
    const db = como(uid);
    const companeros = {};
    if (d.civ_repeat_team === 0) {
      for (const otro of d.player_ids) {
        if (otro !== uid && d.team_of[otro] === d.team_of[uid] && picks[otro] != null) {
          const s = await db.doc(`matches/${partido.id}/drafts/${gameNo}/picks/${otro}`).get();
          assert.ok(s.exists, `${uid} debería ver el pick de su compañero ${otro}`);
          companeros[otro] = s.data().civ_id;
        }
      }
    }
    const civ = alAzar(civsPermitidas(d, uid, companeros), rnd);
    const batch = db.batch();
    batch.set(db.doc(`matches/${partido.id}/drafts/${gameNo}/picks/${uid}`), { civ_id: civ });
    batch.update(refDraft(db), { picked: FV().arrayUnion(uid) });
    await batch.commit();
    picks[uid] = civ;
    // Un rival no puede ver el pick antes de revelar.
    const rival = d.player_ids.find((p) => d.team_of[p] !== d.team_of[uid]);
    await assertFails(como(rival).doc(`matches/${partido.id}/drafts/${gameNo}/picks/${uid}`).get());
  }
  // Revela uno de los que juegan.
  await assertSucceeds(como(d.player_ids[0]).doc(`matches/${partido.id}/drafts/${gameNo}`).update({ revealed: true, state: 'listo' }));
  // Ya revelado, lo ve cualquiera.
  const vistos = await leerColeccion(como('espectador').collection(`matches/${partido.id}/drafts/${gameNo}/picks`));
  assert.equal(vistos.length, d.player_ids.length);
  const final = (await refDraft(dbA).get()).data();
  return {
    map_id: final.map_id,
    civs: d.player_ids.map((uid) => ({ user_id: uid, team_id: d.team_of[uid], civ_id: picks[uid] })),
  };
}

/** `cargarSerie` de la web: transacción que relee los partidos del torneo y escribe lo que cambia. */
async function cargarSerieEnLaWeb(staff, t, matchId, games) {
  const db = como(staff);
  const ids = (await db.collection('matches').where('tournament_id', '==', t.id).get()).docs.map((d) => d.id);
  await db.runTransaction(async (tx) => {
    const refTorneo = db.doc(`tournaments/${t.id}`);
    const [torneo, ...snaps] = await Promise.all([tx.get(refTorneo), ...ids.map((id) => tx.get(db.doc(`matches/${id}`)))]);
    const partidos = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
    const { cambios } = cargarPartidas(partidos, matchId, games);
    for (const { id, ...campos } of cambios) tx.update(db.doc(`matches/${id}`), campos);
    const fin = torneoTerminado(torneo.data(), partidos.map((p) => ({ ...p, ...cambios.find((c) => c.id === p.id) })));
    if (fin && torneo.data().status !== 'finalizado') tx.update(refTorneo, { status: 'finalizado' });
    if (!fin && torneo.data().status === 'finalizado') tx.update(refTorneo, { status: 'en_curso' });
  });
}

async function walkoverEnLaWeb(staff, t, matchId, ganador) {
  const db = como(staff);
  const ids = (await db.collection('matches').where('tournament_id', '==', t.id).get()).docs.map((d) => d.id);
  await db.runTransaction(async (tx) => {
    const refTorneo = db.doc(`tournaments/${t.id}`);
    const [torneo, ...snaps] = await Promise.all([tx.get(refTorneo), ...ids.map((id) => tx.get(db.doc(`matches/${id}`)))]);
    const partidos = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
    const { cambios } = darWalkover(partidos, matchId, ganador);
    for (const { id, ...campos } of cambios) tx.update(db.doc(`matches/${id}`), campos);
    const fin = torneoTerminado(torneo.data(), partidos.map((p) => ({ ...p, ...cambios.find((c) => c.id === p.id) })));
    if (fin && torneo.data().status !== 'finalizado') tx.update(refTorneo, { status: 'finalizado' });
  });
}

/** Juega un partido: agenda, y por cada partida del draft + carga del resultado. */
async function jugarPartido(staff, t, partido, equipos, rnd, { walkover = false } = {}) {
  if (walkover) {
    return walkoverEnLaWeb(staff, t, partido.id, rnd() < 0.5 ? partido.team_a_id : partido.team_b_id);
  }
  await agendarRonda(staff, t, partido, equipos);
  const db = como(staff);
  let games = [];
  let actual = partido;
  for (let g = 1; g <= partidasMaximas(partido); g++) {
    actual = await leerDoc(db, `matches/${partido.id}`);
    if (terminado(actual)) break;
    const delDraft = await jugarDraftEnLaWeb(t, { ...actual, id: partido.id }, equipos, g, rnd);
    games = [...games, {
      game_no: g, winner_team_id: rnd() < 0.5 ? actual.team_a_id : actual.team_b_id, replay_url: null, notes: null, ...delDraft,
    }];
    await cargarSerieEnLaWeb(staff, t, partido.id, games);
  }
  assert.ok(terminado(await leerDoc(db, `matches/${partido.id}`)), `${partido.id}: la serie no se cerró`);
}

async function jugarHastaElFinal(staff, t, rnd, { walkovers = 0.1 } = {}) {
  const db = como(staff);
  const equipos = await leerColeccion(db.collection('teams').where('tournament_id', '==', t.id));
  for (let vuelta = 0; vuelta < 500; vuelta++) {
    const partidos = await leerColeccion(db.collection('matches').where('tournament_id', '==', t.id));
    const orden = (p) => `${p.bracket}${String(p.round).padStart(3, '0')}${String(p.position).padStart(3, '0')}`;
    const siguiente = partidos.filter((m) => !terminado(m) && m.team_a_id && m.team_b_id).sort((a, b) => (orden(a) < orden(b) ? -1 : 1))[0];
    if (!siguiente) return partidos;
    await jugarPartido(staff, t, siguiente, equipos, rnd, { walkover: rnd() < walkovers });
  }
  throw new Error('El torneo no terminó.');
}

// -------------------------------------------------------------- las pruebas

describe('torneo 2v2 de punta a punta (eliminación simple, jugadores sueltos y equipos armados)', () => {
  it('inscripción, pagos, armador, llaves, agenda, drafts y final', async () => {
    const rnd = rngSemilla(2026);
    await env.clearFirestore();
    const usuarios = await crearUsuarios(22, rnd);
    const [org, adm, ...jugadores] = usuarios.map((u) => u.id);
    let t = await crearTorneo('copa-2v2', org, {
      team_size: 2, best_of: 3, best_of_final: 5, third_place: 1, civ_bans: 1, civ_repeat_series: 0, civ_repeat_team: 0,
      allow_solo: 1, status: 'inscripcion', admin_ids: [adm],
    });

    // Cuatro equipos que se inscriben solos: el capitán arma y el compañero se suma.
    for (let i = 0; i < 4; i++) {
      await inscribirse(t, jugadores[i * 2], { kind: 'equipo', team_name: `Equipo armado ${i + 1}` });
      const equipo = (await leerColeccion(como(org).collection('teams').where('captain_id', '==', jugadores[i * 2])))[0];
      await inscribirse(t, jugadores[i * 2 + 1], { kind: 'equipo', team_id: equipo.id });
    }
    // Un equipo ya completo no acepta un tercero.
    const lleno = (await leerColeccion(como(org).collection('teams').where('captain_id', '==', jugadores[0])))[0];
    await assertFails(inscribirse(t, jugadores[8], { kind: 'equipo', team_id: lleno.id }));

    // Equipo del organizador con pedidos de ingreso.
    const ref = como(org).collection('teams').doc();
    const equipoStaff = ref.id;
    await assertSucceeds(ref.set({
      tournament_id: t.id, name: 'Del organizador', tag: null, logo_url: null, captain_id: null, seed: null, auto_built: 0,
      staff_made: 1, created_at: ahora(), members: [], member_ids: [],
    }));
    await inscribirse(t, jugadores[8], { kind: 'equipo', team_id: ref.id });
    await inscribirse(t, jugadores[9], { kind: 'equipo', team_id: ref.id });
    for (const uid of [jugadores[8], jugadores[9]]) {
      const dbAdm = como(adm);
      await dbAdm.runTransaction(async (tx) => {
        const regRef = dbAdm.doc(`tournaments/${t.id}/registrations/${uid}`);
        const reg = await tx.get(regRef);
        assert.equal(reg.data().join_request.status, 'pendiente');
        const ref = dbAdm.doc(`teams/${equipoStaff}`);
        const eq = await tx.get(ref);
        const members = [...eq.data().members, { user_id: uid, role: eq.data().members.length ? 'jugador' : 'capitan' }];
        tx.update(ref, { members, member_ids: members.map((m) => m.user_id), ...(eq.data().captain_id ? {} : { captain_id: uid }) });
        tx.update(regRef, { team_id: ref.id, kind: 'equipo', join_request: null });
      });
    }

    // Diez jugadores sueltos para el armador; uno se retira y se vuelve a inscribir.
    for (const uid of jugadores.slice(10, 20)) await inscribirse(t, uid, { kind: 'solo' });
    await retirarse(t, jugadores[19]);
    await assert.rejects(inscribirse(t, jugadores[18], { kind: 'solo' }), /Ya estás inscripto/);
    await inscribirse(t, jugadores[19], { kind: 'solo' });

    // Pagos: solo el staff marca; el jugador no se auto-confirma.
    await assertFails(como(jugadores[10]).doc(`tournaments/${t.id}/registrations/${jugadores[10]}`).update({ paid: 1, status: 'confirmada' }));
    for (const uid of jugadores.slice(0, 20)) await assertSucceeds(marcarPago(uid === jugadores[0] ? adm : org, t, uid));

    // Armador: propuesta con los sueltos y confirmación del staff.
    const regs = await leerColeccion(como(org).collection(`tournaments/${t.id}/registrations`));
    const sueltas = regs.filter((r) => r.kind === 'solo' && r.status !== 'retirada' && !r.team_id && r.join_request?.status !== 'pendiente');
    assert.equal(sueltas.length, 10);
    t = await leerDoc(como(org), `tournaments/${t.id}`);
    const propuesta = proponerEquipos(t, sueltas.map((r) => ({ ...usuarios.find((u) => u.id === r.user_id) })), { rnd });
    assert.equal(propuesta.teams.length, 5);
    assert.equal(propuesta.leftovers?.length ?? 0, 0);
    await assertFails(confirmarEquipos(jugadores[10], t, propuesta));
    await confirmarEquipos(org, t, propuesta);

    // Torneo a 'armado' y de ahí a las llaves.
    await assertSucceeds(como(org).doc(`tournaments/${t.id}`).update({ status: 'armado' }));
    await assertFails(generarLlaves(jugadores[0], t));
    const { equipos, cuadro } = await generarLlaves(adm, t);
    assert.equal(equipos.length, 10, '4 armados + 1 del organizador + 5 del armador');

    // Un jugador no puede cargar resultados ni cambiar llaves.
    const primero = cuadro.partidos.find((m) => m.team_a_id && m.team_b_id);
    await assertFails(como(jugadores[0]).doc(`matches/${primero.id}`).update({ winner_team_id: primero.team_a_id, status: 'finalizado' }));

    const partidos = await jugarHastaElFinal(org, t, rnd);
    for (const m of partidos) assert.ok(terminado(m), `${m.id} sin cerrar`);
    const final = partidos.find((m) => m.label === 'Final');
    assert.ok(final.winner_team_id, 'sin campeón');
    const tp = partidos.find((m) => m.label === 'Tercer puesto');
    assert.ok(tp.winner_team_id, 'sin tercer puesto');
    assert.equal((await leerDoc(como(org), `tournaments/${t.id}`)).status, 'finalizado');

    // Los drafts quedaron revelados y los picks son legibles por cualquiera.
    const conJuego = partidos.filter((m) => m.status === 'finalizado');
    assert.ok(conJuego.length >= 5);
    for (const m of conJuego) {
      for (const g of m.games) {
        assert.equal(g.civs.length, 4);
        const borrador = await leerDoc(como('espectador'), `matches/${m.id}/drafts/${g.game_no}`);
        assert.equal(borrador.revealed, true);
        assert.equal(borrador.map_id, g.map_id);
      }
    }
  });
});

describe('torneo 1v1 doble eliminación con corrección de un resultado', () => {
  it('juega todo y corrige una serie ya cerrada', async () => {
    const rnd = rngSemilla(77);
    await env.clearFirestore();
    const usuarios = await crearUsuarios(9, rnd);
    const [org, ...jugadores] = usuarios.map((u) => u.id);
    const t = await crearTorneo('ladder', org, { team_size: 1, format: 'eliminacion_doble', best_of: 3, best_of_final: 5, status: 'inscripcion', civ_bans: 0 });
    for (const uid of jugadores.slice(0, 7)) await inscribirse(t, uid);
    await assertSucceeds(como(org).doc(`tournaments/${t.id}`).update({ status: 'armado' }));
    await generarLlaves(org, t);
    const partidos = await jugarHastaElFinal(org, t, rnd, { walkovers: 0 });
    assert.ok(partidos.find((m) => m.bracket === 'F').winner_team_id);

    // Corregir la primera serie: dar vuelta el ganador falla si el partido siguiente ya se jugó.
    const primera = partidos.find((m) => m.bracket === 'W' && m.round === 1 && m.status === 'finalizado');
    const otroGanador = primera.winner_team_id === primera.team_a_id ? primera.team_b_id : primera.team_a_id;
    const invertidas = primera.games.map((g, i) => ({ ...g, winner_team_id: i < 2 ? otroGanador : g.winner_team_id }));
    await assert.rejects(cargarSerieEnLaWeb(org, t, primera.id, [{ ...invertidas[0], winner_team_id: otroGanador }, { ...invertidas[1], winner_team_id: otroGanador }]),
      /ya tiene resultado|corregí/);
  });
});

describe('torneo por grupos y playoffs', () => {
  it('fase de grupos, playoffs generados por el staff, final', async () => {
    const rnd = rngSemilla(5);
    await env.clearFirestore();
    const usuarios = await crearUsuarios(13, rnd);
    const [org, ...jugadores] = usuarios.map((u) => u.id);
    const t = await crearTorneo('clanes', org, {
      team_size: 1, format: 'grupos_playoff', group_count: 2, group_advance: 2, best_of: 3, status: 'inscripcion', civ_bans: 1, third_place: 1,
    });
    for (const uid of jugadores) await inscribirse(t, uid);
    await assertSucceeds(como(org).doc(`tournaments/${t.id}`).update({ status: 'armado' }));
    await generarLlaves(org, t);

    // Antes de cerrar los grupos no se pueden generar los playoffs.
    await assert.rejects(generarPlayoffs(org, t), /no terminó/);
    await jugarHastaElFinal(org, t, rnd, { walkovers: 0.05 });
    // Con los grupos cerrados y sin playoffs todavía, el torneo sigue en curso.
    assert.equal((await leerDoc(como(org), `tournaments/${t.id}`)).status, 'en_curso', 'se marcó finalizado al cerrar los grupos, sin playoffs');
    await generarPlayoffs(org, t);
    await jugarHastaElFinal(org, t, rnd, { walkovers: 0.05 });
    assert.equal((await leerDoc(como(org), `tournaments/${t.id}`)).status, 'finalizado');
  });
});

describe('torneo grande (40 jugadores 1v1, doble eliminación)', () => {
  it('genera las llaves y carga resultados dentro de los límites de las reglas', async () => {
    const rnd = rngSemilla(40);
    await env.clearFirestore();
    const usuarios = await crearUsuarios(41, rnd);
    const [org, ...jugadores] = usuarios.map((u) => u.id);
    const t = await crearTorneo('grande', org, { team_size: 1, format: 'eliminacion_doble', best_of: 3, status: 'inscripcion', civ_bans: 1 });
    for (const uid of jugadores) await inscribirse(t, uid);
    await assertSucceeds(como(org).doc(`tournaments/${t.id}`).update({ status: 'armado' }));
    const { cuadro } = await generarLlaves(org, t);
    assert.ok(cuadro.partidos.length > 100, `partidos generados: ${cuadro.partidos.length}`);
    const equipos = await leerColeccion(como(org).collection('teams').where('tournament_id', '==', t.id));
    const jugable = (await leerColeccion(como(org).collection('matches').where('tournament_id', '==', t.id)))
      .filter((m) => m.team_a_id && m.team_b_id && !terminado(m));
    // Una serie completa y un walkover en la primera ronda, con todo el cuadro grande leído en la transacción.
    await jugarPartido(org, t, jugable[0], equipos, rnd);
    await jugarPartido(org, t, jugable[1], equipos, rnd, { walkover: true });
  });
});
