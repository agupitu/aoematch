// Cierre de partidos, playoffs y suizo: el mismo torneo jugado en SQLite
// (brackets-sqlite.js) y en Firestore (brackets.js) tiene que terminar igual.
// También las rutas playoffs y swiss/next.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, levantarApi } from './apoyo.js';

// levantarApi abre la base SQLite descartable que usa también brackets-sqlite.js.
const api = await levantarApi();
after(() => api.cerrar());

const { all, get, run } = await import('../src/db.js');
const sqlite = await import('../src/brackets-sqlite.js');
const llaves = await import('../src/brackets.js');
const { guardarTorneo, leerTorneo, listarEtapas } = await import('../src/data/torneos.js');
const { guardarEquipo, listarEquipos } = await import('../src/data/equipos.js');
const { listarPartidos } = await import('../src/data/partidos.js');

// --------------------------------------------------------- los dos mundos

let n = 0;
const REGLAS = { best_of: 3, best_of_final: null, group_count: 0, group_advance: 2, swiss_rounds: 0, third_place: 0 };

/** Partidos por llave (etapa | grupo | llave | ronda | posición), sin ids. */
function normalizar({ partidos, tipoEtapa, nombreGrupo, nombreEquipo }) {
  const porId = new Map(partidos.map((m) => [m.id, m]));
  const clave = (m) => [tipoEtapa.get(m.stage_id), nombreGrupo.get(`${m.stage_id}|${m.group_id}`) ?? '', m.bracket, m.round, m.position].join('|');
  const equipo = (id) => (id == null ? null : nombreEquipo.get(id));
  const destino = (id, slot) => (id ? `${clave(porId.get(id))} ${slot}` : null);
  const out = {};
  for (const m of partidos) {
    out[clave(m)] = {
      id: m.id,
      label: m.label,
      status: m.status,
      a: equipo(m.team_a_id),
      b: equipo(m.team_b_id),
      ganador: equipo(m.winner_team_id),
      marcador: `${m.score_a}-${m.score_b}`,
      siguiente: destino(m.next_match_id, m.next_slot),
      perdedor: destino(m.loser_match_id, m.loser_slot),
    };
  }
  return out;
}

const sinIds = (estado) => ({
  ...estado,
  partidos: Object.fromEntries(Object.entries(estado.partidos).map(([k, { id, ...v }]) => [k, v])),
});

const viejo = {
  crear(reglas, cuantos) {
    run("INSERT OR IGNORE INTO users (id, display_name) VALUES (1, 'Org')");
    const todas = { ...REGLAS, ...reglas };
    const cols = Object.keys(todas);
    const slug = `cierre-sqlite-${++n}`;
    const tid = run(
      `INSERT INTO tournaments (slug, name, organizer_id, ${cols.join(', ')}) VALUES (?, ?, 1, ${cols.map(() => '?').join(', ')})`,
      slug, slug, ...Object.values(todas)
    ).lastInsertRowid;
    for (let i = 1; i <= cuantos; i++) run('INSERT INTO teams (tournament_id, name) VALUES (?, ?)', tid, `E${i}`);
    sqlite.generarLlaves(tid);
    return tid;
  },
  estado(tid) {
    const etapas = all('SELECT * FROM stages WHERE tournament_id = ?', tid);
    const grupos = all('SELECT g.* FROM groups g JOIN stages s ON s.id = g.stage_id WHERE s.tournament_id = ?', tid);
    const equipos = all('SELECT * FROM teams WHERE tournament_id = ?', tid);
    return {
      partidos: normalizar({
        partidos: all('SELECT * FROM matches WHERE tournament_id = ?', tid),
        tipoEtapa: new Map(etapas.map((e) => [e.id, e.type])),
        nombreGrupo: new Map(grupos.map((g) => [`${g.stage_id}|${g.id}`, g.name])),
        nombreEquipo: new Map(equipos.map((t) => [t.id, t.name])),
      }),
      seeds: equipos.map((t) => `${t.name}:${t.seed}`).sort(),
      status: get('SELECT status FROM tournaments WHERE id = ?', tid).status,
    };
  },
  equipo: (tid, nombre) => get('SELECT id FROM teams WHERE tournament_id = ? AND name = ?', tid, nombre).id,
  cerrar: (tid, id, ganador, a, b) => sqlite.cerrarMatch(id, viejo.equipo(tid, ganador), a, b),
  playoffs: (tid) => sqlite.generarPlayoffs(tid),
  suizo: (tid) => sqlite.siguienteRondaSuiza(tid),
};

const nuevo = {
  async crear(reglas, cuantos) {
    const slug = `cierre-fs-${++n}`;
    await guardarTorneo(slug, { name: slug, organizer_id: 'org', ...REGLAS, ...reglas });
    for (let i = 1; i <= cuantos; i++) {
      await guardarEquipo({ tournament_id: slug, name: `E${i}`, created_at: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, members: [] });
    }
    await llaves.generarLlaves(slug);
    return slug;
  },
  async estado(slug) {
    const [etapas, equipos, partidos, torneo] = await Promise.all([
      listarEtapas(slug), listarEquipos(slug), listarPartidos(slug), leerTorneo(slug),
    ]);
    return {
      partidos: normalizar({
        partidos,
        tipoEtapa: new Map(etapas.map((e) => [e.id, e.type])),
        nombreGrupo: new Map(etapas.flatMap((e) => e.groups.map((g) => [`${e.id}|${g.id}`, g.name]))),
        nombreEquipo: new Map(equipos.map((t) => [t.id, t.name])),
      }),
      seeds: equipos.map((t) => `${t.name}:${t.seed}`).sort(),
      status: torneo.status,
    };
  },
  async cerrar(slug, id, ganador, a, b) {
    const t = (await listarEquipos(slug)).find((e) => e.name === ganador);
    return llaves.cerrarMatch(id, t.id, a, b);
  },
  playoffs: (slug) => llaves.generarPlayoffs(slug),
  suizo: (slug) => llaves.siguienteRondaSuiza(slug),
};

/** Gana el equipo de número más bajo (E1 le gana a todos), 2 a 1 o 1 a 2 según el lado. */
function resultado(p) {
  const numero = (nombre) => Number(nombre.slice(1));
  const ganaA = numero(p.a) < numero(p.b);
  return { ganador: ganaA ? p.a : p.b, a: ganaA ? 2 : 1, b: ganaA ? 1 : 2 };
}

/** Juega en los dos mundos, en el mismo orden, todos los partidos que se puedan jugar. */
async function jugarTodo(tid, slug, filtro = () => true) {
  for (let vuelta = 0; vuelta < 300; vuelta++) {
    const [v, f] = [viejo.estado(tid), await nuevo.estado(slug)];
    assert.deepEqual(sinIds(f), sinIds(v));
    const clave = Object.keys(v.partidos).sort()
      .find((k) => v.partidos[k].status === 'pendiente' && v.partidos[k].a && v.partidos[k].b && filtro(k));
    if (!clave) return v;
    const r = resultado(v.partidos[clave]);
    viejo.cerrar(tid, v.partidos[clave].id, r.ganador, r.a, r.b);
    await nuevo.cerrar(slug, f.partidos[clave].id, r.ganador, r.a, r.b);
  }
  throw new Error('demasiadas vueltas');
}

describe('cerrar partidos da lo mismo que SQLite', () => {
  const casos = [
    ['eliminación simple de 6 con tercer puesto', { format: 'eliminacion_simple', third_place: 1 }, 6],
    ['eliminación simple de 5', { format: 'eliminacion_simple' }, 5],
    // Sin byes: con byes la doble eliminación de SQLite se traba (ver abajo).
    ['eliminación doble de 8', { format: 'eliminacion_doble' }, 8],
    ['liga de 5', { format: 'liga' }, 5],
  ];
  for (const [nombre, reglas, cuantos] of casos) {
    it(`${nombre}, hasta el final`, async () => {
      const tid = viejo.crear(reglas, cuantos);
      const slug = await nuevo.crear(reglas, cuantos);
      const fin = await jugarTodo(tid, slug);
      assert.equal(fin.status, 'finalizado');
    });
  }
});

describe('doble eliminación con byes: ahora termina', () => {
  // En SQLite, el lugar de perdedores que esperaba al perdedor de un partido
  // ganado por bye quedaba esperando para siempre y el torneo no terminaba.
  for (const cuantos of [3, 5, 6, 7, 9, 12]) {
    it(`de ${cuantos}: termina, E1 campeón invicto y el resto con dos derrotas`, () => {
      const teams = Array.from({ length: cuantos }, (_, i) => ({ id: `E${i + 1}`, name: `E${i + 1}`, seed: null }));
      let k = 0;
      const cuadro = llaves.generarCuadro({ id: 't', format: 'eliminacion_doble', best_of: 3 }, teams, {
        nuevoId: () => `p${++k}`, nuevoIdEtapa: () => `s${++k}`,
      });
      const mapa = new Map(cuadro.partidos.map((p) => [p.id, p]));
      const clave = (p) => `${p.bracket}${p.round}.${p.position}`;
      for (let i = 0; i < 200; i++) {
        const p = [...mapa.values()].sort((x, y) => (clave(x) < clave(y) ? -1 : 1))
          .find((m) => m.status === 'pendiente' && m.team_a_id && m.team_b_id);
        if (!p) break;
        const r = resultado({ a: p.team_a_id, b: p.team_b_id });
        llaves.cerrarEnMemoria(mapa, p.id, r.ganador, r.a, r.b);
      }
      assert.deepEqual([...mapa.values()].filter((m) => m.status === 'pendiente').map(clave), []);
      const final = [...mapa.values()].find((m) => m.bracket === 'F');
      assert.equal(final.winner_team_id, 'E1');

      const derrotas = new Map(teams.map((t) => [t.id, 0]));
      for (const m of mapa.values()) {
        if (m.status !== 'finalizado') continue;
        const perdedor = m.winner_team_id === m.team_a_id ? m.team_b_id : m.team_a_id;
        derrotas.set(perdedor, derrotas.get(perdedor) + 1);
      }
      assert.equal(derrotas.get('E1'), 0);
      for (const t of teams.slice(1)) assert.equal(derrotas.get(t.id), 2, `${t.id} tiene ${derrotas.get(t.id)} derrotas`);
    });
  }

  it('de 6 guardada en Firestore: el torneo queda finalizado', async () => {
    const slug = await nuevo.crear({ format: 'eliminacion_doble' }, 6);
    for (let i = 0; i < 50; i++) {
      const equipos = new Map((await listarEquipos(slug)).map((t) => [t.id, t.name]));
      const p = (await listarPartidos(slug)).find((m) => m.status === 'pendiente' && m.team_a_id && m.team_b_id);
      if (!p) break;
      const r = resultado({ a: equipos.get(p.team_a_id), b: equipos.get(p.team_b_id) });
      await nuevo.cerrar(slug, p.id, r.ganador, r.a, r.b);
    }
    assert.equal((await leerTorneo(slug)).status, 'finalizado');
  });
});

describe('playoffs y suizo dan lo mismo que SQLite', () => {
  it('grupos de 7 en 2 grupos: playoffs con los dos primeros de cada uno', async () => {
    const reglas = { format: 'grupos_playoff', group_count: 2, group_advance: 2 };
    const tid = viejo.crear(reglas, 7);
    const slug = await nuevo.crear(reglas, 7);
    await jugarTodo(tid, slug);

    viejo.playoffs(tid);
    await nuevo.playoffs(slug);
    const [v, f] = [viejo.estado(tid), await nuevo.estado(slug)];
    assert.deepEqual(sinIds(f), sinIds(v));
    assert.ok(Object.keys(f.partidos).some((k) => k.startsWith('eliminacion_simple|')));

    await assert.rejects(nuevo.playoffs(slug), /ya estaban generados/);
    const fin = await jugarTodo(tid, slug);
    assert.equal(fin.status, 'finalizado');
  });

  it('suizo de 6 con 3 rondas', async () => {
    const reglas = { format: 'suizo', swiss_rounds: 3 };
    const tid = viejo.crear(reglas, 6);
    const slug = await nuevo.crear(reglas, 6);
    await assert.rejects(nuevo.suizo(slug), /Faltan partidos por cerrar/);

    for (let ronda = 2; ronda <= 3; ronda++) {
      await jugarTodo(tid, slug);
      const rv = viejo.suizo(tid);
      const rf = await nuevo.suizo(slug);
      assert.deepEqual(rf, rv);
      assert.equal(rf.ronda, ronda);
    }
    await jugarTodo(tid, slug);
    assert.throws(() => viejo.suizo(tid), /completó todas sus rondas/);
    await assert.rejects(nuevo.suizo(slug), /completó todas sus rondas/);
  });

  it('suizo impar: uno queda libre', async () => {
    const reglas = { format: 'suizo' };
    const tid = viejo.crear(reglas, 5);
    const slug = await nuevo.crear(reglas, 5);
    await jugarTodo(tid, slug);
    assert.deepEqual(await nuevo.suizo(slug), viejo.suizo(tid));
  });

  it('sin fase de grupos no hay playoffs; sin suizo no hay ronda suiza', async () => {
    const slug = await nuevo.crear({ format: 'liga' }, 3);
    await assert.rejects(nuevo.playoffs(slug), /no tiene fase de grupos/);
    await assert.rejects(nuevo.suizo(slug), /no es suizo/);
    await assert.rejects(llaves.cerrarMatch('no-existe', 'x', 1, 0), /Partido inexistente/);
  });
});

describe('rutas de playoffs y suizo', () => {
  let org;

  before(async () => {
    org = await cuentaConEmail('cierre-org@demo.aoematch');
    await api.pedir('GET', '/auth/me', { token: org.token });
    await api.pedir('POST', '/tournaments', { token: org.token, body: { name: 'Suizo por ruta', format: 'suizo' } });
    for (const name of ['S1', 'S2', 'S3', 'S4']) await guardarEquipo({ tournament_id: 'suizo-por-ruta', name, members: [] });
    await api.pedir('POST', '/tournaments/suizo-por-ruta/brackets', { token: org.token });
  });

  it('con partidos abiertos avisa; cerrados, arma la ronda y devuelve el torneo', async () => {
    const r = await api.pedir('POST', '/tournaments/suizo-por-ruta/swiss/next', { token: org.token });
    assert.deepEqual([r.status, r.datos.error], [400, 'Faltan partidos por cerrar en la ronda actual.']);

    for (const m of await listarPartidos('suizo-por-ruta')) await llaves.cerrarMatch(m.id, m.team_a_id, 2, 0);
    const { status, datos } = await api.pedir('POST', '/tournaments/suizo-por-ruta/swiss/next', { token: org.token });
    assert.equal(status, 200);
    assert.deepEqual([datos.ronda, datos.partidos, datos.bye], [2, 2, null]);
    assert.equal(datos.tournament.matches.length, 4);
  });

  it('playoffs: solo el staff, y en un torneo sin grupos avisa', async () => {
    const otro = await cuentaConEmail('cierre-otro@demo.aoematch');
    assert.equal((await api.pedir('POST', '/tournaments/suizo-por-ruta/playoffs', { token: otro.token })).status, 403);
    const r = await api.pedir('POST', '/tournaments/suizo-por-ruta/playoffs', { token: org.token });
    assert.deepEqual([r.status, r.datos.error], [400, 'Este torneo no tiene fase de grupos.']);
  });
});
