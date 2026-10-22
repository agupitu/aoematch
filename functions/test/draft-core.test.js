// Reglas del motor de draft, sin base de datos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const motor = await import('../src/draft-core.js');

const T0 = Date.parse('2026-10-25T20:00:00.000Z');
// rnd fijo: la partida 1 la abre el lado 'a' y el azar siempre toma el primero.
const OPC = { ahora: T0, rnd: () => 0.1 };

function contexto(reglas = {}, partido = {}) {
  return {
    torneo: {
      team_size: 2,
      map_mode: 'ban_hasta_uno',
      map_bans: 1,
      map_repeat: 0,
      first_map_id: null,
      civ_mode: 'snake',
      civ_bans: 0,
      civ_pattern: null,
      civ_repeat_series: 1,
      civ_repeat_team: 0,
      civ_mirror: 1,
      draft_timer_s: 60,
      map_ids: [1, 2, 3],
      civ_ids: [1, 2, 3, 4, 5, 6, 7, 8],
      organizer_id: 'org',
      admin_ids: [],
      ...reglas,
    },
    partido: { id: 'm1', team_a_id: 'ta', team_b_id: 'tb', score_a: 0, score_b: 0, status: 'agendado', games: [], ...partido },
    equipos: {
      a: { id: 'ta', captain_id: 'a1', member_ids: ['a1', 'a2'] },
      b: { id: 'tb', captain_id: 'b1', member_ids: ['b1', 'b2'] },
    },
    rosters: {
      a: [{ id: 'a1', display_name: 'A1', role: 'capitan' }, { id: 'a2', display_name: 'A2', role: 'jugador' }],
      b: [{ id: 'b1', display_name: 'B1', role: 'capitan' }, { id: 'b2', display_name: 'B2', role: 'jugador' }],
    },
  };
}

/** Draft de la partida `gameNo` con los dos equipos listos. */
function arrancado(ctx, gameNo = 1) {
  const draft = motor.planDraft(ctx, gameNo, OPC.rnd);
  let r = motor.marcarListo(ctx, draft, { id: 'a1' }, OPC);
  r = motor.marcarListo(r.ctx, r.draft, { id: 'b1' }, OPC);
  return r;
}

const jugar = (r, uid, kind, targetId, forUserId) =>
  motor.aplicarAccion(r.ctx, r.draft, { id: uid }, { kind, targetId, forUserId }, OPC);

const resumen = (steps) => steps.map((s) => `${s.kind}:${s.side ?? '-'}${s.auto ? '*' : ''}`);

describe('plan de pasos', () => {
  it('ban hasta uno y serpiente 1-2-1 en 2v2', () => {
    const draft = motor.planDraft(contexto(), 1, OPC.rnd);
    assert.deepEqual(resumen(draft.steps), [
      'ban_mapa:a', 'ban_mapa:b', 'pick_mapa:-*', 'pick_civ:a', 'pick_civ:b', 'pick_civ:b', 'pick_civ:a',
    ]);
    assert.deepEqual(draft.steps.filter((s) => s.kind === 'pick_civ').map((s) => s.slot), [0, 0, 1, 1]);
    assert.equal(draft.first_team_id, 'ta');
    assert.equal(draft.state, 'espera');
  });

  it('ban y pick: el que no eligió mapa arranca las civs', () => {
    const draft = motor.planDraft(contexto({ map_mode: 'ban_pick' }), 1, OPC.rnd);
    assert.deepEqual(resumen(draft.steps).slice(0, 4), ['ban_mapa:a', 'ban_mapa:b', 'pick_mapa:a', 'pick_civ:b']);
  });

  it('mapa fijo en la partida 1, no en la 2', () => {
    const ctx = contexto({ first_map_id: 2 });
    assert.deepEqual(resumen(motor.planDraft(ctx, 1, OPC.rnd).steps).slice(0, 2), ['pick_mapa:-*', 'pick_civ:a']);
    assert.equal(motor.planDraft(ctx, 1, OPC.rnd).steps[0].map_id, 2);
    assert.equal(motor.planDraft(ctx, 2, OPC.rnd).steps[0].kind, 'ban_mapa');
  });

  it('desde la partida 2 abre el que va perdiendo y no se repiten mapas', () => {
    const jugada = { games: [{ game_no: 1, map_id: 3, civs: [] }] };
    assert.equal(motor.planDraft(contexto({}, { ...jugada, score_a: 0, score_b: 1 }), 2).first_team_id, 'ta');
    const ctx = contexto({}, { ...jugada, score_a: 1, score_b: 0 });
    const draft = motor.planDraft(ctx, 2);
    assert.equal(draft.first_team_id, 'tb');
    // Quedan 2 mapas sin jugar: un solo ban.
    assert.deepEqual(resumen(draft.steps).slice(0, 2), ['ban_mapa:b', 'pick_mapa:-*']);
  });

  it('sin equipos no hay draft', () => {
    assert.throws(() => motor.planDraft(contexto({}, { team_b_id: null }), 1), /Faltan equipos/);
  });

  it('patrón por defecto y patrón inválido', () => {
    assert.equal(motor.patronPorDefecto(3), '1-2-2-1');
    assert.equal(motor.patronPorDefecto(5), '1-2-2-2-2-1');
    assert.deepEqual(motor.parsePatron('2-2', 2), [2, 2]);
    assert.deepEqual(motor.parsePatron('1-1', 2), [1, 2, 1]);
  });
});

describe('listos', () => {
  it('cada equipo marca el suyo; con los dos arranca el reloj', () => {
    const ctx = contexto();
    const draft = motor.planDraft(ctx, 1, OPC.rnd);
    let r = motor.marcarListo(ctx, draft, { id: 'a2' }, OPC);
    assert.deepEqual([r.draft.ready_a, r.draft.ready_b, r.draft.state], [1, 0, 'espera']);
    r = motor.marcarListo(r.ctx, r.draft, { id: 'b2' }, OPC);
    assert.equal(r.draft.state, 'en_curso');
    assert.equal(r.partido.status, 'draft');
    assert.equal(r.draft.deadline_at, new Date(T0 + 60_000).toISOString());
    // Los documentos de entrada no cambian.
    assert.equal(draft.state, 'espera');
    assert.equal(ctx.partido.status, 'agendado');
  });

  it('el organizador arranca los dos; un extraño no puede', () => {
    const ctx = contexto({ admin_ids: ['adm'] });
    const draft = motor.planDraft(ctx, 1, OPC.rnd);
    assert.equal(motor.marcarListo(ctx, draft, { id: 'adm' }, OPC).draft.state, 'en_curso');
    assert.throws(() => motor.marcarListo(ctx, draft, { id: 'nadie' }, OPC), /No sos parte/);
  });

  it('sin reloj no hay plazo', () => {
    assert.equal(arrancado(contexto({ draft_timer_s: 0 })).draft.deadline_at, null);
  });
});

describe('acciones', () => {
  it('un draft entero: bans, último mapa automático y serpiente', () => {
    let r = arrancado(contexto());
    r = jugar(r, 'a1', 'ban_mapa', 1);
    r = jugar(r, 'b1', 'ban_mapa', 2);
    const st = motor.estadoDraft(r.ctx, r.draft);
    assert.equal(st.map_picked, 3);
    assert.equal(st.step.kind, 'pick_civ');
    assert.equal(st.turn_team_id, 'ta');

    r = jugar(r, 'a1', 'pick_civ', 1);
    r = jugar(r, 'b1', 'pick_civ', 2);
    r = jugar(r, 'b1', 'pick_civ', 3, 'b2');
    r = jugar(r, 'a1', 'pick_civ', 4);

    assert.equal(r.draft.state, 'finalizado');
    assert.equal(r.draft.deadline_at, null);
    assert.equal(r.draft.finished_at, new Date(T0).toISOString());
    assert.equal(r.partido.status, 'en_juego');
    assert.deepEqual(r.partido.games, [{
      game_no: 1, map_id: 3, winner_team_id: null, replay_url: null, notes: null,
      civs: [
        { user_id: 'a1', team_id: 'ta', civ_id: 1 },
        { user_id: 'b1', team_id: 'tb', civ_id: 2 },
        { user_id: 'b2', team_id: 'tb', civ_id: 3 },
        { user_id: 'a2', team_id: 'ta', civ_id: 4 },
      ],
    }]);
  });

  it('solo el capitán en turno (o el organizador), con el paso que toca', () => {
    const r = arrancado(contexto());
    assert.throws(() => jugar(r, 'b1', 'ban_mapa', 1), /Solo el capitán/);
    assert.throws(() => jugar(r, 'a2', 'ban_mapa', 1), /Solo el capitán/);
    assert.throws(() => jugar(r, 'a1', 'pick_civ', 1), /Toca ban_mapa/);
    assert.throws(() => jugar(r, 'a1', 'ban_mapa', 99), /no está en el pool/);
    assert.equal(jugar(r, 'org', 'ban_mapa', 1).draft.current_step, 1);
  });

  it('no se banea dos veces el mismo mapa', () => {
    const r = jugar(arrancado(contexto({ map_ids: [1, 2, 3, 4] })), 'a1', 'ban_mapa', 1);
    assert.throws(() => jugar(r, 'b1', 'ban_mapa', 1), /ya fue baneado/);
  });

  it('sin draft en curso no hay acciones', () => {
    const ctx = contexto();
    const draft = motor.planDraft(ctx, 1, OPC.rnd);
    assert.throws(() => motor.aplicarAccion(ctx, draft, { id: 'a1' }, { kind: 'ban_mapa', targetId: 1 }, OPC), /no está en curso/);
  });

  it('espejos prohibidos y misma civ en el equipo prohibida', () => {
    let r = arrancado(contexto({ civ_mirror: 0, civ_repeat_team: 0 }));
    r = jugar(jugar(r, 'a1', 'ban_mapa', 1), 'b1', 'ban_mapa', 2);
    r = jugar(r, 'a1', 'pick_civ', 1);
    assert.throws(() => jugar(r, 'b1', 'pick_civ', 1), /no está disponible/);
    r = jugar(r, 'b1', 'pick_civ', 2);
    r = jugar(r, 'b1', 'pick_civ', 3);
    assert.throws(() => jugar(r, 'a1', 'pick_civ', 1), /no está disponible/);
  });

  it('con espejos permitidos el rival puede repetir', () => {
    let r = arrancado(contexto({ civ_mirror: 1 }));
    r = jugar(jugar(r, 'a1', 'ban_mapa', 1), 'b1', 'ban_mapa', 2);
    r = jugar(r, 'a1', 'pick_civ', 1);
    assert.equal(jugar(r, 'b1', 'pick_civ', 1).draft.current_step, 5);
  });

  it('sin repetir civs en la serie, cada equipo pierde las que ya usó', () => {
    const games = [{
      game_no: 1, map_id: 3,
      civs: [{ user_id: 'a1', team_id: 'ta', civ_id: 1 }, { user_id: 'b1', team_id: 'tb', civ_id: 2 }],
    }];
    let r = arrancado(contexto({ civ_repeat_series: 0, map_repeat: 1 }, { games, score_a: 1 }), 2);
    // Abre 'b', que va perdiendo: bans b, a y después civs desde b.
    r = jugar(jugar(r, 'b1', 'ban_mapa', 1), 'a1', 'ban_mapa', 2);
    assert.throws(() => jugar(r, 'b1', 'pick_civ', 2), /no está disponible/);
    r = jugar(r, 'b1', 'pick_civ', 1);
    assert.throws(() => jugar(r, 'a1', 'pick_civ', 1), /no está disponible/);
    assert.equal(jugar(r, 'a1', 'pick_civ', 2).draft.current_step, 5);
  });

  it('modo ciego: el rival no ve los picks hasta el final', () => {
    let r = arrancado(contexto({ civ_mode: 'ciega' }));
    r = jugar(jugar(r, 'a1', 'ban_mapa', 1), 'b1', 'ban_mapa', 2);
    r = jugar(r, 'a1', 'pick_civ', 1);
    const delRival = motor.estadoDraft(r.ctx, r.draft, 'tb').civ_picks[0];
    assert.deepEqual([delRival.civ_id, delRival.hidden], [null, true]);
    assert.equal(motor.estadoDraft(r.ctx, r.draft, 'ta').civ_picks[0].civ_id, 1);
    r = jugar(jugar(jugar(r, 'a1', 'pick_civ', 2), 'b1', 'pick_civ', 3), 'b1', 'pick_civ', 4);
    assert.equal(r.draft.state, 'finalizado');
    assert.equal(motor.estadoDraft(r.ctx, r.draft, 'tb').civ_picks[0].civ_id, 1);
  });

  it('todo aleatorio se resuelve solo al arrancar', () => {
    const r = arrancado(contexto({ map_mode: 'aleatorio', civ_mode: 'aleatorio' }));
    assert.equal(r.draft.state, 'finalizado');
    assert.equal(r.partido.games[0].civs.length, 4);
    assert.ok(r.draft.actions.every((a) => a.auto === 1));
  });
});

describe('reloj', () => {
  it('vencido mira el plazo y el estado', () => {
    const r = arrancado(contexto());
    assert.equal(motor.vencido(r.draft, T0 + 59_000), false);
    assert.equal(motor.vencido(r.draft, T0 + 60_000), true);
    assert.equal(motor.vencido({ ...r.draft, state: 'finalizado' }, T0 + 99_000), false);
  });

  it('el timeout de un ban elige un mapa libre y sigue', () => {
    let r = jugar(arrancado(contexto({ map_ids: [1, 2, 3, 4] })), 'a1', 'ban_mapa', 1);
    r = motor.porTimeout(r.ctx, r.draft, { step: 1, deadline: r.draft.deadline_at }, OPC);
    const accion = r.draft.actions.at(-1);
    assert.deepEqual([accion.kind, accion.auto, accion.user_id, accion.team_id], ['ban_mapa', 1, null, 'tb']);
    assert.notEqual(accion.target_id, 1);
    assert.equal(r.draft.current_step, 2);
  });

  it('el timeout de un pick de civ asigna jugador y civ permitida', () => {
    let r = arrancado(contexto({ civ_mirror: 0 }));
    r = jugar(jugar(r, 'a1', 'ban_mapa', 1), 'b1', 'ban_mapa', 2);
    r = jugar(r, 'a1', 'pick_civ', 1);
    r = motor.porTimeout(r.ctx, r.draft, {}, OPC);
    const accion = r.draft.actions.at(-1);
    assert.equal(accion.for_user_id, 'b1');
    assert.notEqual(accion.target_id, 1);
  });

  it('el timeout del pick de mapa (ban y pick) toma uno no baneado', () => {
    let r = arrancado(contexto({ map_mode: 'ban_pick' }));
    r = jugar(jugar(r, 'a1', 'ban_mapa', 1), 'b1', 'ban_mapa', 2);
    r = motor.porTimeout(r.ctx, r.draft, {}, OPC);
    assert.equal(motor.estadoDraft(r.ctx, r.draft).map_picked, 3);
  });

  it('el timeout de un ban de civ banea una libre', () => {
    let r = arrancado(contexto({ civ_bans: 1 }));
    r = jugar(jugar(r, 'a1', 'ban_mapa', 1), 'b1', 'ban_mapa', 2);
    r = jugar(r, 'a1', 'ban_civ', 1);
    r = motor.porTimeout(r.ctx, r.draft, {}, OPC);
    const st = motor.estadoDraft(r.ctx, r.draft);
    assert.equal(st.civs_banned.length, 2);
    assert.notEqual(st.civs_banned[1], 1);
    assert.equal(st.step.kind, 'pick_civ');
  });

  it('un aviso viejo o repetido no hace nada', () => {
    const r = arrancado(contexto());
    assert.equal(motor.porTimeout(r.ctx, r.draft, { step: 3, deadline: r.draft.deadline_at }, OPC), null);
    assert.equal(motor.porTimeout(r.ctx, r.draft, { step: 0, deadline: 'otro' }, OPC), null);
    assert.equal(motor.porTimeout(r.ctx, { ...r.draft, state: 'finalizado' }, {}, OPC), null);
  });
});
