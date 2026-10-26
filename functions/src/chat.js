// Salas de chat: quién lee y quién escribe en cada una, cómo se crean cuando
// hacen falta y los avisos del sistema. Reemplaza realtime.js.
//
// Las salas se nombran como las nombra la web: 'tournament:<slug>' (la general
// del torneo), 'match:<id>' (la del partido, la ven los dos equipos) y
// 'team:<id>' (la privada de un equipo). En Firestore son rooms/torneo_<slug>,
// rooms/partido_<id> y rooms/equipo_<id> (docs/firestore-modelo.md). Los
// mensajes los lee el cliente directo, con las reglas de T06; escribe la API.

import { leerEquipo, leerEquipos } from './data/equipos.js';
import { leerInscripcion, vigente } from './data/inscripciones.js';
import { leerPartido } from './data/partidos.js';
import { guardarSala, guardarSalaDeEquipo, idDeSala, leerMensaje, leerSala, publicarMensaje } from './data/salas.js';
import { leerTorneo } from './data/torneos.js';

const esStaff = (uid, torneo) => !!uid && (torneo.organizer_id === uid || (torneo.admin_ids ?? []).includes(uid));

/**
 * Lo que hace falta saber de una sala: su id en Firestore, el torneo y, según
 * el tipo, el partido o el equipo. null si el nombre no es válido o lo que
 * nombra no existe.
 */
async function entidadDe(room) {
  const roomId = idDeSala(room);
  if (!roomId) return null;
  const [tipo, ...resto] = String(room).split(':');
  const id = resto.join(':');

  if (tipo === 'tournament') {
    const torneo = await leerTorneo(id);
    return torneo && { roomId, tipo, torneo };
  }
  if (tipo === 'match') {
    const partido = await leerPartido(id);
    const torneo = partido && (await leerTorneo(partido.tournament_id));
    if (!torneo) return null;
    const equipos = (await leerEquipos([partido.team_a_id, partido.team_b_id].filter(Boolean))).filter(Boolean);
    return { roomId, tipo, torneo, partido, equipos };
  }
  const equipo = await leerEquipo(id);
  const torneo = equipo && (await leerTorneo(equipo.tournament_id));
  return torneo && { roomId, tipo, torneo, equipo };
}

/** ¿Puede leer la sala? La general y la del partido son públicas; la de equipo, de sus miembros y el staff. */
function puedeLeer(user, e) {
  if (e.tipo !== 'team') return true;
  return !!user && (e.equipo.member_ids.includes(user.id) || esStaff(user.id, e.torneo));
}

/**
 * ¿Puede escribir? En la general, los inscriptos no retirados y el staff; en
 * la del partido, los jugadores de los dos equipos y el staff; en la de
 * equipo, sus miembros y el staff.
 */
async function puedeEscribir(user, e) {
  if (!user) return false;
  if (esStaff(user.id, e.torneo)) return true;
  if (e.tipo === 'tournament') return vigente(await leerInscripcion(e.torneo.id, user.id));
  if (e.tipo === 'match') return e.equipos.some((t) => t.member_ids.includes(user.id));
  return e.equipo.member_ids.includes(user.id);
}

/** Crea la sala si todavía no existe (las de partido nacen con el primer mensaje o la primera visita). */
async function asegurarSala(e) {
  if (await leerSala(e.roomId)) return;
  try {
    if (e.tipo === 'tournament') {
      await guardarSala(e.roomId, { kind: 'torneo', tournament_id: e.torneo.id, name: 'General', public_read: true });
    } else if (e.tipo === 'match') {
      await guardarSala(e.roomId, {
        kind: 'partido',
        tournament_id: e.torneo.id,
        match_id: e.partido.id,
        name: e.partido.label || `Ronda ${e.partido.round} · #${e.partido.position}`,
        public_read: true,
      });
    } else {
      await guardarSalaDeEquipo(e.equipo.id, e.equipo.name, e.equipo.member_ids, e.torneo);
    }
  } catch (err) {
    // Otro pedido la creó al mismo tiempo.
    if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS
  }
}

/** Error de permiso o de sala inexistente, con su código HTTP. */
export class ErrorDeSala extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Abre una sala para alguien: la crea si hace falta (así el cliente ya puede
 * escucharla con las reglas) y dice si puede escribir. Corta con 404 si no
 * existe lo que nombra y con 403 si no la puede leer.
 */
export async function abrirSala(room, user) {
  const e = await entidadDe(room);
  if (!e) throw new ErrorDeSala(404, 'Esa sala no existe.');
  if (!puedeLeer(user, e)) throw new ErrorDeSala(403, 'Sin acceso a esa sala.');
  await asegurarSala(e);
  return { room, id: e.roomId, puede_escribir: await puedeEscribir(user, e) };
}

/** Publica el mensaje de un usuario (hasta 2000 caracteres) y lo devuelve como lo ve la web. */
export async function escribir(room, user, body) {
  const texto = String(body || '').trim().slice(0, 2000);
  if (!texto) throw new ErrorDeSala(400, 'El mensaje está vacío.');
  const e = await entidadDe(room);
  if (!e) throw new ErrorDeSala(404, 'Esa sala no existe.');
  if (!(await puedeEscribir(user, e))) throw new ErrorDeSala(403, 'No podés escribir acá.');
  await asegurarSala(e);
  const id = await publicarMensaje(e.roomId, { user, body: texto });
  return leerMensaje(e.roomId, id);
}

/** Mensaje del sistema en una sala (ej: "Draft cerrado. Mapa: Alaska."). */
export async function avisoSistema(room, texto) {
  const e = await entidadDe(room);
  if (!e) return null;
  await asegurarSala(e);
  const id = await publicarMensaje(e.roomId, { body: texto, system: 1 });
  return leerMensaje(e.roomId, id);
}
