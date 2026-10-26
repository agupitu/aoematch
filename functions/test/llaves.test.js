// Generación de llaves: el cuadro nuevo contra el de la versión SQLite, el
// guardado en Firestore y la ruta POST /api/tournaments/:id/brackets.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, levantarApi } from './apoyo.js';

// levantarApi abre la base SQLite descartable que usa también brackets-sqlite.js.
const api = await levantarApi();
after(() => api.cerrar());

const { all, run } = await import('../src/db.js');
const sqlite = await import('../src/brackets-sqlite.js');
const { generarCuadro, generarLlaves } = await import('../src/brackets.js');
const { firestore } = await import('../src/data/base.js');
const { guardarTorneo, leerTorneo, listarEtapas } = await import('../src/data/torneos.js');
const { guardarEquipo, listarEquipos } = await import('../src/data/equipos.js');
const { listarPartidos } = await import('../src/data/partidos.js');
const { guardarDraft, leerDraft } = await import('../src/data/drafts.js');
const { guardarSala, leerSala } = await import('../src/data/salas.js');

// ------------------------------------------------- comparación con SQLite

let torneos = 0;

/** Arma el torneo en SQLite, genera las llaves con la versión vieja y la normaliza. */
function llavesSqlite(reglas, nEquipos) {
  run("INSERT OR IGNORE INTO users (id, display_name) VALUES (1, 'Org')");
  const slug = `sqlite-${++torneos}`;
  const cols = Object.keys(reglas);
  const tid = run(
    `INSERT INTO tournaments (slug, name, organizer_id, ${cols.join(', ')}) VALUES (?, ?, 1, ${cols.map(() => '?').join(', ')})`,
    slug, slug, ...Object.values(reglas)
  ).lastInsertRowid;
  for (let i = 1; i <= nEquipos; i++) run('INSERT INTO teams (tournament_id, name) VALUES (?, ?)', tid, `E${i}`);

  sqlite.generarLlaves(tid);

  const etapas = all('SELECT * FROM stages WHERE tournament_id = ?', tid);
  const grupos = all('SELECT g.* FROM groups g JOIN stages s ON s.id = g.stage_id WHERE s.tournament_id = ?', tid);
  const equipos = all('SELECT * FROM teams WHERE tournament_id = ?', tid);
  const enGrupo = all(
    'SELECT gt.group_id, t.name FROM group_teams gt JOIN teams t ON t.id = gt.team_id JOIN groups g ON g.id = gt.group_id JOIN stages s ON s.id = g.stage_id WHERE s.tournament_id = ?',
    tid
  );
  return normalizar({
    partidos: all('SELECT * FROM matches WHERE tournament_id = ?', tid),
    tipoEtapa: new Map(etapas.map((e) => [e.id, e.type])),
    nombreGrupo: new Map(grupos.map((g) => [g.id, g.name])),
    nombreEquipo: new Map(equipos.map((t) => [t.id, t.name])),
    grupos: grupos.map((g) => ({ name: g.name, equipos: enGrupo.filter((x) => x.group_id === g.id).map((x) => x.name) })),
    seeds: equipos.map((t) => `${t.name}:${t.seed}`),
  });
}

/** El mismo torneo armado en memoria con la versión nueva, normalizado igual. */
function llavesNuevas(reglas, nEquipos) {
  const teams = Array.from({ length: nEquipos }, (_, i) => ({ id: `id-E${i + 1}`, name: `E${i + 1}`, seed: null }));
  let n = 0;
  const cuadro = generarCuadro({ id: 'nuevo', best_of: 3, best_of_final: null, group_count: 0, third_place: 0, ...reglas }, teams, {
    nuevoId: () => `p${++n}`,
    nuevoIdEtapa: () => `s${++n}`,
  });
  const grupos = cuadro.etapas.flatMap((e) => e.groups.map((g) => ({ ...g, stage: e.id })));
  const nombreEquipo = new Map(teams.map((t) => [t.id, t.name]));
  const seeds = new Map(cuadro.seeds.map((s) => [s.id, s.seed]));
  return normalizar({
    partidos: cuadro.partidos,
    tipoEtapa: new Map(cuadro.etapas.map((e) => [e.id, e.type])),
    nombreGrupo: new Map(grupos.map((g) => [g.id, g.name])),
    nombreEquipo,
    grupos: grupos.map((g) => ({ name: g.name, equipos: g.team_ids.map((id) => nombreEquipo.get(id)) })),
    seeds: teams.map((t) => `${t.name}:${seeds.get(t.id) ?? t.seed}`),
  });
}

/** Partidos por llave (etapa | grupo | llave | ronda | posición), sin ids. */
function normalizar({ partidos, tipoEtapa, nombreGrupo, nombreEquipo, grupos, seeds }) {
  const porId = new Map(partidos.map((m) => [m.id, m]));
  const clave = (m) => [tipoEtapa.get(m.stage_id), nombreGrupo.get(m.group_id) ?? '', m.bracket, m.round, m.position].join('|');
  const equipo = (id) => (id == null ? null : nombreEquipo.get(id));
  const destino = (id, slot) => (id ? `${clave(porId.get(id))} ${slot}` : null);
  return {
    partidos: Object.fromEntries(partidos.map((m) => [clave(m), {
      label: m.label,
      best_of: m.best_of,
      status: m.status,
      a: equipo(m.team_a_id),
      b: equipo(m.team_b_id),
      ganador: equipo(m.winner_team_id),
      marcador: `${m.score_a}-${m.score_b}`,
      siguiente: destino(m.next_match_id, m.next_slot),
      perdedor: destino(m.loser_match_id, m.loser_slot),
    }])),
    grupos: grupos.map((g) => `${g.name}: ${[...g.equipos].sort().join(',')}`).sort(),
    seeds,
  };
}

describe('mismo cuadro que la versión SQLite', () => {
  const casos = [
    ['eliminación simple de 2', { format: 'eliminacion_simple' }, 2],
    ['eliminación simple de 3 (un bye)', { format: 'eliminacion_simple' }, 3],
    ['eliminación simple de 5 con final al mejor de 5', { format: 'eliminacion_simple', best_of_final: 5 }, 5],
    ['eliminación simple de 8 con tercer puesto', { format: 'eliminacion_simple', third_place: 1 }, 8],
    ['eliminación simple de 6 con tercer puesto', { format: 'eliminacion_simple', third_place: 1 }, 6],
    ['eliminación doble de 3', { format: 'eliminacion_doble' }, 3],
    ['eliminación doble de 4', { format: 'eliminacion_doble' }, 4],
    ['eliminación doble de 6', { format: 'eliminacion_doble', best_of_final: 5 }, 6],
    ['eliminación doble de 8', { format: 'eliminacion_doble' }, 8],
    ['liga de 4', { format: 'liga' }, 4],
    ['liga de 5', { format: 'liga' }, 5],
    ['grupos de 7 en 2 grupos', { format: 'grupos_playoff', group_count: 2 }, 7],
    ['grupos de 9 en 3 grupos', { format: 'grupos_playoff', group_count: 3 }, 9],
    ['suizo de 6', { format: 'suizo' }, 6],
    ['suizo de 7', { format: 'suizo' }, 7],
  ];
  for (const [nombre, reglas, n] of casos) {
    it(nombre, () => {
      const viejo = llavesSqlite(reglas, n);
      const nuevo = llavesNuevas(reglas, n);
      assert.ok(Object.keys(viejo.partidos).length > 0);
      assert.deepEqual(nuevo, viejo);
    });
  }

  it('formato desconocido', () => {
    assert.throws(() => llavesNuevas({ format: 'copa' }, 4), /Formato desconocido/);
  });
});

// --------------------------------------------------------------- Firestore

describe('llaves en Firestore', () => {
  const SLUG = 'llaves-fs';

  before(async () => {
    await guardarTorneo(SLUG, { name: 'Llaves', format: 'eliminacion_doble', organizer_id: 'org' });
    for (let i = 1; i <= 6; i++) {
      await guardarEquipo({ tournament_id: SLUG, name: `F${i}`, seed: i === 1 ? 1 : null, created_at: `2026-01-0${i}T00:00:00.000Z`, members: [] });
    }
  });

  it('escribe partidos enlazados, la etapa, las siembras y pasa el torneo a en curso', async () => {
    const etapa = await generarLlaves(SLUG);
    const partidos = await listarPartidos(SLUG);
    const ids = new Set(partidos.map((m) => m.id));
    assert.equal(partidos.length, 14); // 7 de ganadores, 6 de perdedores y la gran final
    for (const m of partidos) {
      if (m.next_match_id) assert.ok(ids.has(m.next_match_id));
      if (m.loser_match_id) assert.ok(ids.has(m.loser_match_id));
      assert.equal(m.stage_id, etapa);
    }
    const [e] = await listarEtapas(SLUG);
    assert.deepEqual([e.id, e.type], [etapa, 'eliminacion_doble']);
    assert.deepEqual((await listarEquipos(SLUG)).map((t) => `${t.name}:${t.seed}`), ['F1:1', 'F2:2', 'F3:3', 'F4:4', 'F5:5', 'F6:6']);
    assert.equal((await leerTorneo(SLUG)).status, 'en_curso');
    // Los byes ya están resueltos: F1 y F2 pasan solos.
    assert.equal(partidos.filter((m) => m.status === 'walkover').length, 2);
  });

  it('volver a generar borra lo anterior: partidos, drafts, avisos y salas de partido', async () => {
    const [viejo] = await listarPartidos(SLUG);
    await guardarDraft(viejo.id, 1, {});
    await firestore.collection('live').doc(viejo.id).set({ draft: 1 });
    await guardarSala(`partido_${viejo.id}`, { kind: 'partido', tournament_id: SLUG });
    await guardarSala(`torneo_${SLUG}`, { kind: 'torneo', tournament_id: SLUG });

    await generarLlaves(SLUG);
    const partidos = await listarPartidos(SLUG);
    assert.equal(partidos.length, 14);
    assert.ok(!partidos.some((m) => m.id === viejo.id));
    assert.equal(await leerDraft(viejo.id, 1), null);
    assert.equal((await firestore.collection('live').doc(viejo.id).get()).exists, false);
    assert.equal(await leerSala(`partido_${viejo.id}`), null);
    assert.ok(await leerSala(`torneo_${SLUG}`));
    assert.equal((await listarEtapas(SLUG)).length, 1);
  });
});

describe('ruta de llaves', () => {
  let org;
  let otro;

  before(async () => {
    [org, otro] = await Promise.all([cuentaConEmail('llaves-org@demo.aoematch'), cuentaConEmail('llaves-otro@demo.aoematch')]);
    await api.pedir('GET', '/auth/me', { token: org.token });
    await api.pedir('GET', '/auth/me', { token: otro.token });
    await api.pedir('POST', '/tournaments', { token: org.token, body: { name: 'Llaves por ruta', format: 'liga' } });
  });

  it('con menos de dos equipos avisa', async () => {
    const { status, datos } = await api.pedir('POST', '/tournaments/llaves-por-ruta/brackets', { token: org.token });
    assert.equal(status, 400);
    assert.match(datos.error, /al menos dos equipos/);
  });

  it('solo el staff genera, y vuelve el detalle con los partidos', async () => {
    for (const name of ['Uno', 'Dos', 'Tres']) await guardarEquipo({ tournament_id: 'llaves-por-ruta', name, members: [] });
    assert.equal((await api.pedir('POST', '/tournaments/llaves-por-ruta/brackets', { token: otro.token })).status, 403);
    const { status, datos } = await api.pedir('POST', '/tournaments/llaves-por-ruta/brackets', { token: org.token });
    assert.equal(status, 200);
    assert.equal(datos.status, 'en_curso');
    assert.equal(datos.matches.length, 3);
    assert.equal(datos.standings.length, 3);
  });
});
