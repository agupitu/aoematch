// Equipos del organizador (teams/{id} con `staff_made`) y los pedidos de ingreso
// que los jugadores hacen desde su inscripción (`join_request`). El staff crea,
// renombra y borra los equipos, y aprueba o rechaza los pedidos; el jugador
// pide lugar y cancela. Qué puede escribir cada uno lo deciden las reglas.

import { collection, doc, runTransaction, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { firestore } from '../firebase';
import { conMiembro, nombreDeEquipo } from '../logica/equipos.js';
import type { Team, Tournament, User } from '../types';
import { type Doc, Rechazo, ahora, conMensaje } from './base';
import { inscribirse } from './inscripciones';

const refEquipo = (id: string) => doc(firestore, 'teams', id);
const refInscripcion = (slug: string, uid: string) => doc(firestore, 'tournaments', slug, 'registrations', uid);

/** Equipo vacío del organizador: los jugadores piden lugar y el staff los aprueba. */
export function crearEquipoDelOrganizador(t: Tournament, nombre: string) {
  const name = nombreDeEquipo(nombre);
  if (!name) throw new Error('Poné un nombre de equipo.');
  if (t.team_size < 2) throw new Error('En 1v1 cada jugador es su propio equipo.');
  if (t.max_teams && t.teams.length >= t.max_teams) throw new Error('Ya están todos los equipos del torneo.');
  return conMensaje(() =>
    setDoc(doc(collection(firestore, 'teams')), {
      tournament_id: t.id,
      name,
      tag: null,
      logo_url: null,
      captain_id: null,
      seed: null,
      auto_built: 0,
      staff_made: 1,
      created_at: ahora(),
      members: [],
      member_ids: [],
    })
  );
}

export function renombrarEquipo(teamId: string, nombre: string) {
  const name = nombreDeEquipo(nombre);
  if (!name) throw new Error('El equipo necesita un nombre.');
  return conMensaje(() => updateDoc(refEquipo(teamId), { name }));
}

/** Borra un equipo del organizador sin jugadores y les quita el pedido a quienes le habían pedido lugar. */
export function borrarEquipoDelOrganizador(t: Tournament, team: Team) {
  if (team.members.length) throw new Error('El equipo tiene jugadores: sacalos primero.');
  return conMensaje(async () => {
    const lote = writeBatch(firestore);
    for (const r of t.registrations) {
      if (r.join_request?.team_id === team.id) lote.update(refInscripcion(t.id, r.user_id), { join_request: null });
    }
    lote.delete(refEquipo(team.id));
    await lote.commit();
  });
}

/** Pide lugar en un equipo del organizador; si todavía no está inscripto, se inscribe con el pedido. */
export function pedirLugar(t: Tournament, user: User, teamId: string) {
  const reg = t.registrations.find((r) => r.user_id === user.id);
  if (!reg || reg.status === 'retirada') return inscribirse(t, user, { kind: 'equipo', team_id: teamId });
  if (reg.team_id) throw new Error('Ya estás en un equipo: salí primero para pedir lugar en otro.');
  return conMensaje(() =>
    updateDoc(refInscripcion(t.id, user.id), {
      join_request: { team_id: teamId, status: 'pendiente', created_at: ahora() },
    })
  );
}

/** Cancela el pedido propio, o quita el aviso de uno rechazado. */
export function cancelarPedido(t: Tournament, uid: string) {
  return conMensaje(() => updateDoc(refInscripcion(t.id, uid), { join_request: null }));
}

/**
 * El staff aprueba un pedido: mete al jugador en el equipo (si el equipo no
 * tenía capitán, lo es) y deja su inscripción con equipo. En una transacción:
 * dos aprobaciones a la vez no pasan del tamaño del equipo.
 */
export function aprobarPedido(t: Tournament, userId: string) {
  return conMensaje(() =>
    runTransaction(firestore, async (tx) => {
      const regSnap = await tx.get(refInscripcion(t.id, userId));
      const reg = regSnap.exists() ? (regSnap.data() as Doc) : null;
      const pedido = reg?.join_request;
      if (!reg || reg.status === 'retirada' || pedido?.status !== 'pendiente') throw new Rechazo('Ese pedido ya no está.');
      if (reg.team_id) throw new Rechazo('El jugador ya está en un equipo.');

      const equipoSnap = await tx.get(refEquipo(pedido.team_id));
      if (!equipoSnap.exists() || equipoSnap.data().tournament_id !== t.id) throw new Rechazo('El equipo ya no existe.');
      let cambios: Record<string, unknown>;
      try {
        cambios = conMiembro(equipoSnap.data(), userId, t.team_size);
      } catch (err) {
        throw new Rechazo((err as Error).message);
      }
      tx.update(refEquipo(equipoSnap.id), cambios);
      tx.update(refInscripcion(t.id, userId), { team_id: equipoSnap.id, kind: 'equipo', join_request: null });
    })
  );
}

/** El staff rechaza el pedido: queda como aviso para el jugador, que lo quita o pide en otro equipo. */
export function rechazarPedido(t: Tournament, userId: string) {
  const pedido = t.registrations.find((r) => r.user_id === userId)?.join_request;
  if (!pedido) throw new Error('Ese pedido ya no está.');
  return conMensaje(() =>
    updateDoc(refInscripcion(t.id, userId), { join_request: { ...pedido, status: 'rechazado' } })
  );
}
