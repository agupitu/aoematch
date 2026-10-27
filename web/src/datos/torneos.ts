// tournaments/{slug} y lo que cuelga de él: listado, alta, detalle y edición.
// El detalle arma lo mismo que devolvía GET /api/tournaments/:id.

import {
  collection,
  doc,
  getCountFromServer,
  orderBy,
  query,
  runTransaction,
  deleteField,
  updateDoc,
  where,
} from 'firebase/firestore';
import { firestore } from '../firebase';
import { mapaPorId, civs as todasLasCivs } from '../logica/catalogo.js';
import { poolCivs, poolMapas } from '../logica/draft.js';
import { minutosEnComun, proximaFecha, ventanas } from '../logica/horarios.js';
import { tablaDesde, terminado } from '../logica/llaves.js';
import type { Tournament } from '../types';
import { type Doc, ahora, conMensaje, consultar, leer, ordenarPor } from './base';
import { mapaDeUsuarios } from './usuarios';

const refTorneo = (slug: string) => doc(firestore, 'tournaments', slug);

/** ¿Organiza o administra el torneo? */
export const esStaff = (uid: string | null | undefined, t: Doc | Tournament | null) =>
  !!uid && !!t && (t.organizer_id === uid || ((t as Doc).admin_ids ?? []).includes(uid));

/** No retirada: cuenta como inscripta. */
export const vigente = (r: Doc | null | undefined) => !!r && r.status !== 'retirada';

// ------------------------------------------------------------------ listado

/** Torneos más nuevos primero, con el nombre del organizador y sus cuentas. */
export async function listarTorneos() {
  const torneos = await consultar(query(collection(firestore, 'tournaments'), orderBy('orden', 'desc')));
  const organizadores = await mapaDeUsuarios(torneos.map((t) => t.organizer_id));
  return Promise.all(
    torneos.map(async (t) => {
      const inscripciones = collection(firestore, 'tournaments', t.id, 'registrations');
      const vigentes = ['pendiente', 'confirmada', 'rechazada'];
      const [inscriptos, pagos, equipos] = await Promise.all([
        getCountFromServer(query(inscripciones, where('status', 'in', vigentes))),
        getCountFromServer(query(inscripciones, where('status', 'in', vigentes), where('paid', '==', 1))),
        getCountFromServer(query(collection(firestore, 'teams'), where('tournament_id', '==', t.id))),
      ]);
      return {
        ...t,
        organizer_name: organizadores.get(t.organizer_id)?.display_name ?? null,
        inscriptos: inscriptos.data().count,
        pagos: pagos.data().count,
        equipos: equipos.data().count,
      };
    })
  );
}

// -------------------------------------------------------------- alta y edición

const CAMPOS_EDITABLES = [
  'name', 'description', 'rules_md', 'banner_url', 'status', 'format', 'team_size',
  'max_teams', 'best_of', 'best_of_final', 'group_count', 'group_advance', 'swiss_rounds',
  'third_place', 'map_repeat', 'first_map_id', 'civ_bans', 'civ_repeat_series', 'entry_fee_cents',
  'currency', 'payment_link', 'payment_notes', 'allow_solo', 'reg_opens_at', 'reg_closes_at',
  'starts_at', 'prize_pool_mode', 'prize_pool_cents', 'prize_pool_pct', 'prize_notes',
];

const CAMPOS_NUMERICOS = [
  'team_size', 'max_teams', 'best_of', 'best_of_final', 'group_count', 'group_advance',
  'swiss_rounds', 'third_place', 'map_repeat', 'civ_bans', 'civ_repeat_series',
  'entry_fee_cents', 'allow_solo',
  'prize_pool_cents', 'prize_pool_pct', 'first_map_id',
];

/** Lo que manda el formulario, limpio: los cambios a guardar en el torneo. */
export function camposDe(body: Record<string, unknown>) {
  const cambios: Record<string, unknown> = {};
  for (const c of CAMPOS_EDITABLES) {
    if (body[c] === undefined) continue;
    let v: unknown = body[c];
    if (CAMPOS_NUMERICOS.includes(c)) {
      v = v === null || v === '' ? null : Number(v);
      if (v !== null && !Number.isFinite(v)) continue;
      // Solo estos tres admiten null; los demás tienen siempre un valor.
      if (v === null && !['max_teams', 'best_of_final', 'first_map_id'].includes(c)) continue;
      if (typeof body[c] === 'boolean') v = body[c] ? 1 : 0;
    } else if (v === '') {
      v = null;
    }
    cambios[c] = v;
  }
  if (cambios.name === null) delete cambios.name;
  if (cambios.name !== undefined) cambios.name = String(cambios.name).slice(0, 120);
  if (typeof cambios.civ_bans === 'number') cambios.civ_bans = Math.max(0, Math.min(3, Math.round(cambios.civ_bans)));

  if (Array.isArray(body.prizes)) cambios.prizes = premiosLimpios(body.prizes);
  if (Array.isArray(body.map_ids)) cambios.map_ids = idsLimpios(body.map_ids);
  if (Array.isArray(body.civ_ids)) cambios.civ_ids = idsLimpios(body.civ_ids);
  return cambios;
}

type PremioCrudo = { label?: unknown; kind?: unknown; amount_cents?: unknown; percent?: unknown; extra?: unknown };

function premiosLimpios(premios: PremioCrudo[]) {
  return premios.slice(0, 20).map((p, i) => {
    const etiqueta = String(p.label ?? '').trim() || `${i + 1}º puesto`;
    const kind = p.kind === 'fijo' ? 'fijo' : 'porcentaje';
    return {
      position: i + 1,
      label: etiqueta.slice(0, 60),
      kind,
      amount_cents: kind === 'fijo' ? Math.max(0, Math.round(Number(p.amount_cents) || 0)) : 0,
      percent: kind === 'porcentaje' ? Math.max(0, Number(p.percent) || 0) : 0,
      extra: p.extra ? String(p.extra).slice(0, 200) : null,
    };
  });
}

const idsLimpios = (ids: unknown[]) => [...new Set(ids.map((n) => parseInt(String(n), 10)).filter(Number.isInteger))];

function slugify(s: string) {
  return (
    String(s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      .slice(0, 60) || 'torneo'
  );
}

/** Valores por defecto de un torneo nuevo (los de la tabla `tournaments`). */
const POR_DEFECTO = {
  description: null, rules_md: null, banner_url: null, status: 'borrador', format: 'eliminacion_simple',
  team_size: 1, max_teams: null, best_of: 3, best_of_final: null, group_count: 0, group_advance: 2,
  swiss_rounds: 0, third_place: 0, map_repeat: 0, first_map_id: null,
  civ_bans: 0, civ_repeat_series: 1, entry_fee_cents: 0, currency: 'ARS', payment_link: null, payment_notes: null,
  allow_solo: 1, reg_opens_at: null, reg_closes_at: null, starts_at: null, prize_pool_mode: 'ninguno',
  prize_pool_cents: 0, prize_pool_pct: 100, prize_notes: null, admin_ids: [], map_ids: [], civ_ids: [], prizes: [],
};

/** Crea el torneo con quien lo crea de organizador. El slug es el id: si está tomado, -2, -3... */
export async function crearTorneo(body: Record<string, unknown>, organizerId: string): Promise<string> {
  if (!body.name) throw new Error('Falta el nombre del torneo.');
  const base = slugify(String(body.name));
  const created_at = ahora();
  return conMensaje(() =>
    runTransaction(firestore, async (tx) => {
      for (let n = 1; n < 50; n++) {
        const slug = n === 1 ? base : `${base}-${n}`;
        if ((await tx.get(refTorneo(slug))).exists()) continue;
        const datos = {
          ...POR_DEFECTO,
          // Por defecto, todas las civs disponibles.
          civ_ids: todasLasCivs().map((c) => c.id),
          ...camposDe(body),
          name: String(body.name).slice(0, 120),
          organizer_id: organizerId,
          created_at,
          slug,
        };
        tx.set(refTorneo(slug), { ...datos, orden: datos.starts_at ?? created_at });
        return slug;
      }
      throw new Error('No hay un nombre libre para ese torneo.');
    })
  );
}

const CAMPOS_VIEJOS = ['map_mode', 'map_bans', 'civ_mode', 'civ_pattern', 'civ_repeat_team', 'civ_mirror', 'draft_timer_s'];

export function guardarVodFase(slug: string, stageId: string, links: { label: string; url: string }[]) {
  return conMensaje(() => updateDoc(doc(firestore, 'tournaments', slug, 'stages', stageId), { vod_links: links }));
}

/** Cambios del staff. `orden` sigue a `starts_at`. Saca los modos del draft viejo. */
export async function actualizarTorneo(t: Doc | Tournament, body: Record<string, unknown>) {
  const cambios = camposDe(body);
  for (const c of CAMPOS_VIEJOS) cambios[c] = deleteField();
  if (!Object.keys(cambios).length) return;
  if (cambios.starts_at !== undefined) cambios.orden = cambios.starts_at ?? (t as Doc).created_at;
  await conMensaje(() => updateDoc(refTorneo(t.id), cambios));
}

// ------------------------------------------------------------------ detalle

/**
 * Bolsa de premios y cuánto le toca a cada puesto. La bolsa puede ser un monto
 * declarado por el organizador o salir de lo que se recaudó en inscripciones.
 */
function premiosDe(t: Doc, pagas: number) {
  const recaudado = pagas * t.entry_fee_cents;
  const bolsa =
    t.prize_pool_mode === 'fijo'
      ? t.prize_pool_cents
      : t.prize_pool_mode === 'inscripciones'
        ? Math.round((recaudado * t.prize_pool_pct) / 100)
        : 0;

  const filas = ordenarPor(t.prizes ?? [], 'position').map((p: Doc) => ({
    ...p,
    id: p.position,
    tournament_id: t.id,
    value_cents: p.kind === 'fijo' ? p.amount_cents : Math.round((bolsa * p.percent) / 100),
  }));

  return {
    prizes: filas,
    prize_pool: {
      mode: t.prize_pool_mode,
      total_cents: bolsa,
      collected_cents: recaudado,
      paid_count: pagas,
      assigned_cents: filas.reduce((s: number, p: Doc) => s + p.value_cents, 0),
      assigned_pct: filas.filter((p: Doc) => p.kind === 'porcentaje').reduce((s: number, p: Doc) => s + p.percent, 0),
    },
  };
}

/** Equipo con sus jugadores (capitán primero, después por nombre) y las horas en común. */
function equipoCompleto(equipo: Doc, usuarios: Map<string, Doc>) {
  const { member_ids, ...resto } = equipo;
  const jugadores = (equipo.members ?? []).map((m: Doc) => {
    const u = usuarios.get(m.user_id) ?? ({} as Doc);
    return {
      id: m.user_id,
      display_name: u.display_name ?? 'Jugador',
      avatar_url: u.avatar_url || u.steam_avatar || null,
      steam_avatar: u.steam_avatar ?? null,
      steam_name: u.steam_name ?? null,
      steam_url: u.steam_url ?? null,
      timezone: u.timezone ?? 'UTC',
      rating_1v1: u.rating_1v1 ?? null,
      rating_team: u.rating_team ?? null,
      role: m.role,
    };
  });
  const members = ordenarPor(jugadores, (p: Doc) => (p.role === 'capitan' ? 0 : 1), 'display_name');
  const conHorario = (id: string) => usuarios.get(id) ?? { id, availability: [] };
  return {
    ...resto,
    members,
    overlap_min: members.length > 1 ? minutosEnComun((member_ids ?? []).map(conHorario)) : null,
  };
}

/** Todo lo que muestra la página del torneo, con la forma que daba la API. */
export async function detalleTorneo(slug: string, uid: string | null): Promise<Tournament> {
  const t = await leer(refTorneo(slug));
  if (!t) throw new Error('Torneo inexistente.');
  const [equipos, inscripciones, etapas, partidos] = await Promise.all([
    consultar(query(collection(firestore, 'teams'), where('tournament_id', '==', slug))),
    consultar(collection(firestore, 'tournaments', slug, 'registrations')),
    consultar(collection(firestore, 'tournaments', slug, 'stages')),
    consultar(query(collection(firestore, 'matches'), where('tournament_id', '==', slug))),
  ]);
  const equiposEnOrden = ordenarPor(equipos, (e: Doc) => e.seed ?? 9999, 'created_at', 'id');
  const usuarios = await mapaDeUsuarios([
    t.organizer_id,
    ...inscripciones.map((r) => r.user_id),
    ...equipos.flatMap((e) => e.member_ids ?? []),
  ]);

  const teams = equiposEnOrden.map((e) => equipoCompleto(e, usuarios));
  const filaEquipo = ({ members: _m, member_ids: _ids, ...e }: Doc) => e;
  const nombreEquipo = new Map(equipos.map((e) => [e.id, e.name]));

  const registrations = ordenarPor(inscripciones, 'created_at').map((r) => {
    const u = usuarios.get(r.user_id) ?? ({} as Doc);
    return {
      ...r,
      display_name: u.display_name ?? 'Jugador',
      avatar_url: u.avatar_url || u.steam_avatar || null,
      steam_avatar: u.steam_avatar ?? null,
      steam_name: u.steam_name ?? null,
      rating_1v1: u.rating_1v1 ?? null,
      rating_team: u.rating_team ?? null,
      timezone: u.timezone ?? 'UTC',
      team_name: nombreEquipo.get(r.team_id) ?? null,
      paid: !!r.paid,
    };
  });

  const stages = ordenarPor(etapas, 'idx').map((s) => ({
    ...s,
    groups: ordenarPor(s.groups ?? [], 'name').map((g: Doc) => ({
      id: g.id,
      stage_id: s.id,
      name: g.name,
      standings: tablaDesde(
        equiposEnOrden.filter((e) => (g.team_ids ?? []).includes(e.id)).map(filaEquipo),
        partidos.filter((m) => m.stage_id === s.id && m.group_id === g.id && terminado(m))
      ),
    })),
  }));

  const matches = ordenarPor(partidos, 'bracket', 'round', 'position').map((m) => ({
    ...m,
    team_a_name: nombreEquipo.get(m.team_a_id) ?? null,
    team_b_name: nombreEquipo.get(m.team_b_id) ?? null,
  }));

  const standings = ['liga', 'suizo'].includes(t.format)
    ? tablaDesde(equiposEnOrden.map(filaEquipo), partidos.filter(terminado))
    : null;

  const pagas = inscripciones.filter((r) => vigente(r) && r.paid).length;
  const organizador = usuarios.get(t.organizer_id);
  return {
    ...t,
    organizer: organizador ? { id: organizador.id, display_name: organizador.display_name } : null,
    first_map: t.first_map_id ? mapaPorId(t.first_map_id) : null,
    ...premiosDe(t, pagas),
    maps: poolMapas(t),
    civs: poolCivs(t),
    teams,
    registrations,
    stages,
    matches,
    standings,
    me: uid
      ? {
          is_staff: esStaff(uid, t),
          registration: registrations.find((r) => r.user_id === uid) || null,
          team_id: teams.find((te) => te.members.some((m: Doc) => m.id === uid))?.id ?? null,
        }
      : null,
  } as unknown as Tournament;
}

// ------------------------------------------------------- horarios del torneo

/**
 * Mejores ventanas para todos los inscriptos (no retirados): las que juntan al
 * 60 % o más durante `duracion` minutos.
 */
export async function horariosDelTorneo(t: Tournament, duracion = 90) {
  const ids = [...new Set(t.registrations.filter((r) => r.status !== 'retirada').map((r) => r.user_id))];
  const usuarios = await mapaDeUsuarios(ids);
  const conHorario = ids.map((id) => usuarios.get(id) ?? { id, availability: [] });
  const vs = ventanas(conHorario, {
    duracionMin: Math.max(30, duracion),
    minimo: Math.ceil(ids.length * 0.6),
    limite: 20,
  });
  return {
    total: ids.length,
    windows: vs.map((v) => ({ ...v, next_utc: proximaFecha(v.start_min).toISOString() })),
    // Horario de cada uno, para el mapa de calor.
    horarios: conHorario.map((u) => ({ id: u.id, blocks: (u.availability ?? []) as { start_min: number; end_min: number }[] })),
  };
}
