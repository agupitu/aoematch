// Rutas de partido sobre Firestore: detalle, draft, resultados, horarios y
// votos. Contra los emuladores.
//
//   npm test        (desde la raíz)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaConEmail, levantarApi } from './apoyo.js';

const api = await levantarApi();
after(() => api.cerrar());

const { firestore } = await import('../src/data/base.js');
const { guardarEquipo } = await import('../src/data/equipos.js');
const { listarPartidos, leerPartido } = await import('../src/data/partidos.js');
const { leerTorneo } = await import('../src/data/torneos.js');
const { historial } = await import('../src/data/salas.js');
const { actualizarUsuario } = await import('../src/data/usuarios.js');

const c = {};
const SLUG = 'copa-partidos';
let rojos;
let azules;
let partido;

const pedir = (metodo, ruta, quien, body) => api.pedir(metodo, ruta, { token: quien && c[quien].token, body });
const live = async () => (await firestore.collection('live').doc(partido).get()).data() ?? {};

before(async () => {
  for (const n of ['org', 'ana', 'ana2', 'beto', 'beto2', 'ciro']) {
    c[n] = await cuentaConEmail(`partidos-${n}@demo.aoematch`);
    await api.pedir('GET', '/auth/me', { token: c[n].token });
    await actualizarUsuario(c[n].uid, {
      display_name: n.toUpperCase(),
      availability: [{ start_min: 1200, end_min: n === 'beto2' ? 1290 : 1380 }],
    });
  }
  await pedir('POST', '/tournaments', 'org', {
    name: 'Copa partidos', team_size: 2, best_of: 3, map_ids: [1, 2, 3], civ_ids: [1, 2, 3, 4, 5, 6], draft_timer_s: 60,
  });
  rojos = await guardarEquipo({
    tournament_id: SLUG, name: 'Rojos', captain_id: c.ana.uid, seed: 1,
    members: [{ user_id: c.ana.uid, role: 'capitan' }, { user_id: c.ana2.uid, role: 'jugador' }],
  });
  azules = await guardarEquipo({
    tournament_id: SLUG, name: 'Azules', captain_id: c.beto.uid, seed: 2,
    members: [{ user_id: c.beto.uid, role: 'capitan' }, { user_id: c.beto2.uid, role: 'jugador' }],
  });
  await pedir('POST', `/tournaments/${SLUG}/brackets`, 'org');
  [{ id: partido }] = await listarPartidos(SLUG);
});

/** Juega el draft entero: en cada paso actúa el capitán en turno con lo primero que se puede. */
async function jugarDraft() {
  let st = (await pedir('GET', `/matches/${partido}`, 'org')).datos.draft;
  const capitan = (teamId) => (teamId === rojos ? 'ana' : 'beto');
  for (let i = 0; i < 20 && st.state === 'en_curso'; i++) {
    const quien = capitan(st.turn_team_id);
    let target;
    if (st.step.kind === 'ban_mapa') {
      target = st.pools.maps.find((m) => !st.maps_banned.includes(m.id)).id;
    } else {
      const mios = st.civ_picks.filter((p) => p.team_id === st.turn_team_id).map((p) => p.civ_id);
      target = st.pools.civs.find((x) => !mios.includes(x.id)).id;
    }
    const r = await pedir('POST', `/matches/${partido}/draft/action`, quien, { kind: st.step.kind, target_id: target });
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    st = r.datos;
  }
  return st;
}

describe('detalle', () => {
  it('equipos con jugadores (capitán primero), sin draft y sin permisos para un anónimo', async () => {
    const { status, datos } = await pedir('GET', `/matches/${partido}`);
    assert.equal(status, 200);
    assert.deepEqual([datos.team_a_name, datos.team_b_name, datos.tournament_slug], ['Rojos', 'Azules', SLUG]);
    assert.deepEqual(datos.teams.a.roster.map((p) => [p.display_name, p.role]), [['ANA', 'capitan'], ['ANA2', 'jugador']]);
    assert.deepEqual([datos.draft, datos.games], [null, []]);
    assert.deepEqual(datos.me, { team_id: null, is_staff: false, can_report: false, is_captain: false });
    assert.equal(datos.tournament.best_of, 3);
    assert.equal(datos.chat, undefined);
  });

  it('quién soy en el partido', async () => {
    assert.deepEqual((await pedir('GET', `/matches/${partido}`, 'ana')).datos.me, { team_id: rojos, is_staff: false, can_report: true, is_captain: true });
    assert.deepEqual((await pedir('GET', `/matches/${partido}`, 'ana2')).datos.me, { team_id: rojos, is_staff: false, can_report: false, is_captain: false });
    assert.deepEqual((await pedir('GET', `/matches/${partido}`, 'org')).datos.me, { team_id: null, is_staff: true, can_report: true, is_captain: false });
  });

  it('un partido que no existe da 404', async () => {
    assert.equal((await pedir('GET', '/matches/no-existe')).status, 404);
  });
});

describe('draft', () => {
  it('lo abre un jugador del partido o el staff, no un extraño', async () => {
    assert.equal((await pedir('POST', `/matches/${partido}/draft/ready`, 'ana')).status, 404);
    assert.equal((await pedir('POST', `/matches/${partido}/draft`, 'ciro')).status, 403);
    const { datos } = await pedir('POST', `/matches/${partido}/draft`, 'ana2');
    assert.deepEqual([datos.state, datos.game_no], ['espera', 1]);
  });

  it('con los dos listos arranca; un extraño no puede marcar listo', async () => {
    assert.equal((await pedir('POST', `/matches/${partido}/draft/ready`, 'ciro')).status, 400);
    await pedir('POST', `/matches/${partido}/draft/ready`, 'ana2');
    const { datos } = await pedir('POST', `/matches/${partido}/draft/ready`, 'beto');
    assert.equal(datos.state, 'en_curso');
    assert.equal((await leerPartido(partido)).status, 'draft');
  });

  it('una acción fuera de turno se rechaza', async () => {
    const st = (await pedir('GET', `/matches/${partido}`, 'ana')).datos.draft;
    const fuera = st.turn_team_id === rojos ? 'beto' : 'ana';
    const r = await pedir('POST', `/matches/${partido}/draft/action`, fuera, { kind: st.step.kind, target_id: 1 });
    assert.equal(r.status, 400);
  });

  it('si el paso venció, el detalle lo resuelve solo', async () => {
    const antes = (await pedir('GET', `/matches/${partido}`, 'org')).datos.draft.current_step;
    await firestore.doc(`matches/${partido}/drafts/1`).update({ deadline_at: '2000-01-01T00:00:00.000Z' });
    const despues = (await pedir('GET', `/matches/${partido}`, 'org')).datos.draft.current_step;
    assert.ok(despues > antes);
  });

  it('al cerrar el draft deja la partida con mapa y civs, y lo avisa en el chat', async () => {
    const st = await jugarDraft();
    assert.equal(st.state, 'finalizado');
    const { datos } = await pedir('GET', `/matches/${partido}`);
    const g = datos.games[0];
    assert.equal(g.game_no, 1);
    assert.ok(g.map.name_es);
    assert.equal(g.civs.length, 4);
    assert.ok(g.civs.every((x) => x.name_es && x.flag && x.display_name));
    assert.equal(datos.status, 'en_juego');
    const avisos = (await historial(`partido_${partido}`)).filter((m) => m.system).map((m) => m.body);
    assert.match(avisos.at(-1), /^Draft cerrado\. Mapa: .+\.$/);
  });
});

describe('resultados', () => {
  const reportar = (quien, gameNo, body) => pedir('POST', `/matches/${partido}/games/${gameNo}`, quien, body);

  it('reportan los capitanes o el staff, con un equipo del partido', async () => {
    assert.equal((await reportar('ana2', 1, { winner_team_id: rojos })).status, 403);
    assert.equal((await reportar('ana', 1, { winner_team_id: 'otro' })).status, 400);
  });

  it('el marcador sigue a las partidas y la serie se cierra al llegar a dos', async () => {
    const avisosAntes = (await live()).match ?? 0;
    let r = await reportar('ana', 1, { winner_team_id: rojos, replay_url: 'https://replays/1' });
    assert.deepEqual([r.datos.score_a, r.datos.score_b, r.datos.status], [1, 0, 'en_juego']);
    assert.ok((await live()).match > avisosAntes);
    // El mapa del draft se conserva si no se manda otro.
    assert.ok((await leerPartido(partido)).games[0].map_id);

    r = await reportar('beto', 2, { winner_team_id: azules });
    assert.deepEqual([r.datos.score_a, r.datos.score_b], [1, 1]);
    r = await reportar('ana', 3, { winner_team_id: rojos });
    assert.deepEqual([r.datos.score_a, r.datos.score_b, r.datos.status, r.datos.winner_team_id], [2, 1, 'finalizado', rojos]);
    assert.equal((await leerTorneo(SLUG)).status, 'finalizado');
    const avisos = (await historial(`partido_${partido}`)).map((m) => m.body);
    assert.ok(avisos.includes('Serie cerrada 2-1.'));
  });

  it('una corrección que deja la serie abierta la reabre', async () => {
    const r = await reportar('org', 3, { winner_team_id: azules });
    assert.deepEqual([r.datos.score_a, r.datos.score_b, r.datos.status], [1, 2, 'finalizado']);
    const r2 = await reportar('org', 3, {});
    assert.deepEqual([r2.datos.score_a, r2.datos.score_b, r2.datos.status, r2.datos.winner_team_id], [1, 1, 'en_juego', null]);
  });

  it('el staff fuerza un resultado', async () => {
    assert.equal((await pedir('POST', `/matches/${partido}/result`, 'ana', { winner_team_id: rojos })).status, 403);
    assert.equal((await pedir('POST', `/matches/${partido}/result`, 'org', { winner_team_id: 'x' })).status, 400);
    const { datos } = await pedir('POST', `/matches/${partido}/result`, 'org', { winner_team_id: azules, score_a: 0, score_b: 2, walkover: true });
    assert.deepEqual([datos.status, datos.winner_team_id, datos.score_b], ['walkover', azules, 2]);
  });
});

describe('horarios y votos', () => {
  it('ventanas en las que pueden los cuatro, o en las que falta uno', async () => {
    const { datos } = await pedir('GET', `/matches/${partido}/schedule?duration=60`);
    assert.equal(datos.users.length, 4);
    assert.deepEqual([datos.windows[0].start_min, datos.windows[0].end_min, datos.windows[0].count], [1200, 1290, 4]);
    const largo = (await pedir('GET', `/matches/${partido}/schedule?duration=120`)).datos;
    assert.deepEqual([largo.windows.length, largo.partial[0].count, largo.partial[0].missing], [0, 3, [c.beto2.uid]]);
  });

  it('agendan los capitanes o el staff, con aviso en el chat', async () => {
    assert.equal((await pedir('POST', `/matches/${partido}/schedule`, 'ana2', { scheduled_at: '2099-01-01T20:00:00.000Z' })).status, 403);
    const { datos } = await pedir('POST', `/matches/${partido}/schedule`, 'beto', { scheduled_at: '2099-01-01T20:00:00.000Z' });
    assert.equal(datos.scheduled_at, '2099-01-01T20:00:00.000Z');
    const avisos = (await historial(`partido_${partido}`)).map((m) => m.body);
    assert.ok(avisos.includes('Partido agendado para 2099-01-01T20:00:00.000Z (UTC).'));
  });

  it('votar un horario reemplaza el voto anterior y avisa', async () => {
    assert.equal((await pedir('POST', `/matches/${partido}/vote`, 'ana', {})).status, 400);
    assert.equal((await pedir('POST', '/matches/no-existe/vote', 'ana', { slot_utc: 'x' })).status, 404);
    await pedir('POST', `/matches/${partido}/vote`, 'ana', { slot_utc: '2099-01-01T20:00:00.000Z', vote: 1 });
    const { datos } = await pedir('POST', `/matches/${partido}/vote`, 'ana', { slot_utc: '2099-01-01T20:00:00.000Z', vote: 0 });
    assert.deepEqual(datos, [{ match_id: partido, user_id: c.ana.uid, slot_utc: '2099-01-01T20:00:00.000Z', vote: 0 }]);
    assert.ok((await live()).votes >= 2);
  });
});
