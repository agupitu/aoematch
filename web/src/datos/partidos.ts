// matches/{matchId}: detalle de un partido (lo que devolvía GET
// /api/matches/:id) y agenda. Resultados: T40; draft: T43.

import { doc, updateDoc } from 'firebase/firestore';
import { firestore } from '../firebase';
import { civPorId, mapaPorId } from '../logica/catalogo.js';
import { cruceDeRonda } from '../logica/cruce.js';
import { rondaIdDe } from '../logica/rondas.js';
import type { MatchDetail, Ventana } from '../types';
import { type Doc, conMensaje, leer, leerPorIds, ordenarPor } from './base';
import { horariosDeLaRonda } from './rondas';
import { esStaff } from './torneos';
import { mapaDeUsuarios } from './usuarios';

const refPartido = (id: string) => doc(firestore, 'matches', id);

/** Jugadores de un equipo: capitán primero, después por nombre. */
function roster(equipo: Doc | null, usuarios: Map<string, Doc>) {
  if (!equipo) return [];
  const jugadores = (equipo.members ?? []).map((mi: Doc) => {
    const u = usuarios.get(mi.user_id) ?? ({} as Doc);
    return {
      id: mi.user_id,
      display_name: u.display_name ?? 'Jugador',
      avatar_url: u.avatar_url || u.steam_avatar || null,
      steam_avatar: u.steam_avatar ?? null,
      timezone: u.timezone ?? 'UTC',
      role: mi.role,
    };
  });
  return ordenarPor(jugadores, (p: Doc) => (p.role === 'capitan' ? 0 : 1), 'display_name');
}

/** El partido con su torneo, equipos, partidas y lo que puede hacer quien lo mira. */
export async function detallePartido(id: string, uid: string | null): Promise<MatchDetail> {
  const m = await leer(refPartido(id));
  if (!m) throw new Error('Partido inexistente.');
  const [torneo, equipos] = await Promise.all([
    leer(doc(firestore, 'tournaments', m.tournament_id)),
    leerPorIds('teams', [m.team_a_id, m.team_b_id]),
  ]);
  if (!torneo) throw new Error('Torneo inexistente.');
  const a = equipos.get(m.team_a_id) ?? null;
  const b = equipos.get(m.team_b_id) ?? null;
  const usuarios = await mapaDeUsuarios([...(a?.member_ids ?? []), ...(b?.member_ids ?? [])]);

  const miEquipo = uid ? [a, b].find((e) => e?.member_ids?.includes(uid)) ?? null : null;
  const staff = esStaff(uid, torneo);
  const capitan = !!miEquipo && miEquipo.captain_id === uid;

  const games = ordenarPor(m.games ?? [], 'game_no').map((g: Doc) => ({
    ...g,
    id: `${m.id}_${g.game_no}`,
    match_id: m.id,
    map: g.map_id ? mapaPorId(g.map_id) : null,
    civs: (g.civs ?? []).map((c: Doc) => ({
      ...c,
      name_es: civPorId(c.civ_id)?.name_es ?? null,
      flag: civPorId(c.civ_id)?.flag ?? null,
      display_name: usuarios.get(c.user_id)?.display_name ?? 'Jugador',
    })),
  }));

  return {
    ...m,
    team_a_name: a?.name ?? null,
    team_b_name: b?.name ?? null,
    tournament_slug: m.tournament_id,
    tournament: {
      id: torneo.id, slug: torneo.slug, name: torneo.name, team_size: torneo.team_size,
      best_of: torneo.best_of,
    },
    teams: {
      a: a ? { id: a.id, name: a.name, roster: roster(a, usuarios) } : null,
      b: b ? { id: b.id, name: b.name, roster: roster(b, usuarios) } : null,
    },
    games,
    me: {
      team_id: miEquipo?.id ?? null,
      is_staff: staff,
      // Los resultados los carga solo el staff (pedido del 2026-10-26).
      can_report: staff,
      is_captain: capitan,
    },
  } as unknown as MatchDetail;
}

/** Fija o quita el horario: capitanes y staff. Un partido pendiente pasa a agendado. */
export function guardarVodPartido(matchId: string, links: { label: string; url: string }[]) {
  return conMensaje(() => updateDoc(refPartido(matchId), { vod_links: links }));
}

export function agendar(m: { id: string; status: string }, scheduledAt: string | null) {
  return conMensaje(() =>
    updateDoc(refPartido(m.id), {
      scheduled_at: scheduledAt,
      ...(m.status === 'pendiente' ? { status: 'agendado' } : {}),
    })
  );
}

/**
 * Ventanas en las que pueden jugar todos los del partido (o, si no hay
 * ninguna, todos menos uno) durante `duracion` minutos, con los horarios que
 * cargaron en la ronda del partido. `estado` dice si hay algo que cruzar:
 * `falta_rival` si todavía no están los dos equipos y `sin_fechas` si el staff
 * no fijó las fechas de la ronda.
 */
export async function horariosDelPartido(m: MatchDetail, duracion = 90) {
  const jugadores = [...(m.teams.a?.roster ?? []), ...(m.teams.b?.roster ?? [])];
  const base = {
    users: jugadores.map((p) => ({ id: p.id, display_name: p.display_name })),
    duration_min: Math.max(30, duracion),
    windows: [] as Ventana[],
    partial: [] as Ventana[],
  };
  if (!m.teams.a || !m.teams.b) return { ...base, estado: 'falta_rival' as const };

  const ronda = await leer(doc(firestore, 'tournaments', m.tournament_id, 'rondas', rondaIdDe(m)));
  if (!ronda) return { ...base, estado: 'sin_fechas' as const };

  const horarios = await horariosDeLaRonda(m.tournament_id, ronda.id, jugadores.map((p) => p.id));
  const { windows, partial } = cruceDeRonda(
    jugadores.map((p) => ({ id: p.id, blocks: horarios.get(p.id) ?? [] })),
    { starts_at: ronda.starts_at, ends_at: ronda.ends_at },
    { duracionMin: base.duration_min }
  );
  return { ...base, estado: 'ok' as const, windows: windows as Ventana[], partial: partial as Ventana[] };
}
