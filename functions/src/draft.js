// Draft guardado en Firestore. Cada operación lee lo que necesita el motor
// (draft-core.js) dentro de una transacción, lo corre y guarda el draft y el
// partido de una vez: dos capitanes que eligen a la vez no se pisan, porque
// Firestore reintenta al segundo con el draft ya avanzado. Después del commit
// avisa en live/{matchId} (live.js) para que los clientes vuelvan a pedir el
// estado y, si el paso estrena plazo, programa su vencimiento (relojes.js).

import * as motor from './draft-core.js';
import { enTransaccion, ordenarPor } from './data/base.js';
import { actualizarDraft, guardarDraft, leerDraft, ultimoDraft } from './data/drafts.js';
import { leerEquipos } from './data/equipos.js';
import { actualizarPartido, leerPartido } from './data/partidos.js';
import { leerTorneo } from './data/torneos.js';
import { mapaDeUsuarios } from './data/usuarios.js';
import { avisar } from './live.js';
import { programarVencimiento } from './relojes.js';

export { patronPorDefecto } from './draft-core.js';

/** Jugadores de un equipo como los espera el draft: capitán primero, después por id. */
function roster(equipo, usuarios) {
  if (!equipo) return [];
  const jugadores = equipo.members.map((m) => {
    const u = usuarios.get(m.user_id);
    return {
      id: m.user_id,
      display_name: u?.display_name ?? 'Jugador',
      avatar_url: u?.avatar_url ?? null,
      steam_avatar: u?.steam_avatar ?? null,
      role: m.role,
    };
  });
  return ordenarPor(jugadores, (p) => (p.role === 'capitan' ? 0 : 1), 'id');
}

/** Lo que el motor necesita saber de un partido (ver draft-core.js). */
async function contexto(matchId, tx) {
  const partido = await leerPartido(matchId, tx);
  if (!partido) throw new Error('El partido no existe.');

  const ids = [partido.team_a_id, partido.team_b_id];
  const [torneo, filas] = await Promise.all([
    leerTorneo(partido.tournament_id, tx),
    leerEquipos(ids.filter(Boolean), tx),
  ]);
  if (!torneo) throw new Error('El torneo del partido no existe.');
  const porId = new Map(filas.filter(Boolean).map((e) => [e.id, e]));
  const equipos = { a: porId.get(ids[0]) ?? null, b: porId.get(ids[1]) ?? null };

  const usuarios = await mapaDeUsuarios([...(equipos.a?.member_ids ?? []), ...(equipos.b?.member_ids ?? [])], tx);
  return { torneo, partido, equipos, rosters: { a: roster(equipos.a, usuarios), b: roster(equipos.b, usuarios) } };
}

/** Crea el draft de una partida de la serie (o devuelve el existente). Devuelve su estado. */
export function crearDraft(matchId, gameNo = 1, { viewerTeamId = null, rnd } = {}) {
  return enTransaccion(async (tx, despues) => {
    const ctx = await contexto(matchId, tx);
    const existente = await leerDraft(matchId, gameNo, tx);
    if (existente) return motor.estadoDraft(ctx, existente, viewerTeamId);

    const nuevo = motor.planDraft(ctx, gameNo, rnd);
    guardarDraft(matchId, gameNo, nuevo, tx);
    despues(() => avisar(matchId, 'draft'));
    return motor.estadoDraft(ctx, nuevo, viewerTeamId);
  });
}

/** Estado del último draft del partido, o null si no hay. */
export async function estadoDelPartido(matchId, viewerTeamId = null, tx) {
  const draft = await ultimoDraft(matchId, tx);
  if (!draft) return null;
  return motor.estadoDraft(await contexto(matchId, tx), draft, viewerTeamId);
}

const CAMPOS_DEL_DRAFT = ['state', 'current_step', 'deadline_at', 'ready_a', 'ready_b', 'actions', 'finished_at'];

/**
 * Corre `mover(ctx, draft)` sobre el último draft del partido y guarda lo que
 * cambió. `mover` devuelve lo que devuelven las acciones de draft-core.js, o
 * null si no hay nada que hacer. Devuelve el estado nuevo (o null).
 */
function correr(matchId, mover, viewerTeamId, { sinDraft = 'error' } = {}) {
  return enTransaccion(async (tx, despues) => {
    const draft = await ultimoDraft(matchId, tx);
    if (!draft) {
      if (sinDraft === 'nada') return null;
      throw new Error('No hay draft abierto.');
    }
    const ctx = await contexto(matchId, tx);

    const r = mover(ctx, draft);
    if (!r) return null;

    const cambios = {};
    for (const c of CAMPOS_DEL_DRAFT) cambios[c] = r.draft[c];
    actualizarDraft(matchId, draft.game_no, cambios, tx);
    despues(() => avisar(matchId, 'draft'));
    if (r.draft.deadline_at !== draft.deadline_at) despues(() => programarVencimiento(matchId, r.draft));

    const partido = {};
    if (r.partido.status !== ctx.partido.status) partido.status = r.partido.status;
    if (JSON.stringify(r.partido.games) !== JSON.stringify(ctx.partido.games)) partido.games = r.partido.games;
    if (Object.keys(partido).length) {
      actualizarPartido(matchId, partido, tx);
      despues(() => avisar(matchId, 'match'));
    }

    return motor.estadoDraft(r.ctx, r.draft, viewerTeamId);
  });
}

/** Marca "listo" al equipo del usuario; con los dos listos arranca el reloj. */
export function marcarListo(matchId, user, { viewerTeamId = null, ahora, rnd } = {}) {
  return correr(matchId, (ctx, draft) => motor.marcarListo(ctx, draft, user, { ahora, rnd }), viewerTeamId);
}

/** Ban o pick del capitán en turno (o del organizador). opts: { kind, targetId, forUserId? } */
export function aplicarAccion(matchId, user, opts, { viewerTeamId = null, ahora, rnd } = {}) {
  return correr(matchId, (ctx, draft) => motor.aplicarAccion(ctx, draft, user, opts, { ahora, rnd }), viewerTeamId);
}

/**
 * Resuelve al azar el paso vencido. Con `aviso` ({ step, deadline }, lo que
 * encola el reloj) solo actúa si el draft sigue en ese paso con ese plazo;
 * si no, devuelve null. Si el aviso es el vigente pero el plazo todavía no
 * llegó (la tarea se adelantó), corta con error para que Cloud Tasks reintente.
 */
export function porTimeout(matchId, aviso = {}, { ahora = Date.now(), rnd } = {}) {
  return correr(matchId, (ctx, draft) => {
    const vigente = aviso.step === draft.current_step && aviso.deadline === draft.deadline_at;
    if (vigente && !motor.vencido(draft, ahora)) throw new Error('Todavía no venció el plazo.');
    return motor.porTimeout(ctx, draft, aviso, { ahora, rnd });
  }, null, { sinDraft: 'nada' });
}

/**
 * Respaldo del reloj: si el paso actual ya venció (por ejemplo, porque se
 * perdió la tarea), lo resuelve ahora. Las rutas de partido lo llaman antes de
 * responder (T23). Devuelve el estado nuevo, o null si no había nada vencido.
 */
export function resolverVencidos(matchId, { viewerTeamId = null, ahora = Date.now(), rnd } = {}) {
  return correr(
    matchId,
    (ctx, draft) => (motor.vencido(draft, ahora) ? motor.porTimeout(ctx, draft, {}, { ahora, rnd }) : null),
    viewerTeamId,
    { sinDraft: 'nada' }
  );
}

/** Lo que hace la tarea del reloj al dispararse (función `vencerPaso` de index.js). */
export async function alVencer({ matchId, step, deadline }) {
  await porTimeout(matchId, { step, deadline });
}
