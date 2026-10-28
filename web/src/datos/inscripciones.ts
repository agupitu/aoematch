// tournaments/{slug}/registrations/{uid} y teams/{teamId}: inscribirse,
// retirarse, sumarse a un equipo o salir, y lo que marca el staff. Cada
// cambio que toca varios documentos va en una transacción, como en la API.

import {
  type Transaction,
  collection,
  doc,
  runTransaction,
  updateDoc,
} from 'firebase/firestore';
import { firestore } from '../firebase';
import { sinMiembro } from '../logica/equipos.js';
import type { Tournament, User } from '../types';
import { type Doc, Rechazo, ahora, conMensaje } from './base';
import { vigente } from './torneos';

const refInscripcion = (slug: string, uid: string) => doc(firestore, 'tournaments', slug, 'registrations', uid);
const refEquipo = (id: string) => doc(firestore, 'teams', id);
const equipoNuevo = () => doc(collection(firestore, 'teams'));

type Miembro = { user_id: string; role: string };

async function leerEnTx(tx: Transaction, ref: ReturnType<typeof doc>): Promise<Doc | null> {
  const snap = await tx.get(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** `members` y `member_ids` siempre juntos. */
const conIds = (members: Miembro[]) => ({ members, member_ids: members.map((m) => m.user_id) });

export type Alta = { kind: 'solo' | 'equipo'; team_name?: string; team_id?: string; note?: string };

/**
 * Inscribe a quien entró: suelto, con un equipo nuevo, sumándose a uno con
 * lugar o, si el equipo es del organizador, pidiéndole lugar (queda suelto con
 * el pedido hasta que el staff lo apruebe).
 */
export function inscribirse(t: Tournament, user: User, { kind, team_name, team_id, note }: Alta) {
  return conMensaje(() =>
    runTransaction(firestore, async (tx) => {
      const ya = await leerEnTx(tx, refInscripcion(t.id, user.id));
      if (vigente(ya)) throw new Rechazo('Ya estás inscripto.');
      if (!['inscripcion', 'armado'].includes(t.status)) throw new Rechazo('Las inscripciones no están abiertas.');

      let equipo: Doc | null = null;
      let pedido: Doc | null = null;
      let nuevo: string | null = null;
      if (t.team_size > 1 && kind === 'equipo') {
        if (team_id) {
          const elegido = await leerEnTx(tx, refEquipo(team_id));
          if (!elegido || elegido.tournament_id !== t.id) throw new Rechazo('Ese equipo no existe en el torneo.');
          if (elegido.members.length >= t.team_size) throw new Rechazo('El equipo ya está completo.');
          if (elegido.staff_made) pedido = elegido;
          else equipo = elegido;
        } else {
          if (!team_name) throw new Rechazo('Poné un nombre de equipo.');
          nuevo = String(team_name).slice(0, 60);
        }
      } else if (t.team_size === 1) {
        nuevo = user.display_name.slice(0, 60);
      } else if (!t.allow_solo) {
        throw new Rechazo('Este torneo no acepta jugadores sueltos.');
      }

      let teamId: string | null = equipo?.id ?? null;
      if (equipo) {
        tx.update(refEquipo(equipo.id), conIds([...equipo.members, { user_id: user.id, role: 'jugador' }]));
      }
      if (nuevo !== null) {
        const ref = equipoNuevo();
        teamId = ref.id;
        tx.set(ref, {
          tournament_id: t.id,
          name: nuevo,
          tag: null,
          logo_url: null,
          captain_id: user.id,
          seed: null,
          auto_built: 0,
          created_at: ahora(),
          ...conIds([{ user_id: user.id, role: 'capitan' }]),
        });
      }

      const datos = {
        status: 'pendiente',
        kind: t.team_size === 1 ? 'equipo' : teamId ? 'equipo' : 'solo',
        team_id: teamId,
        join_request: pedido ? { team_id: pedido.id, status: 'pendiente', created_at: ahora() } : null,
        note: note ? String(note).slice(0, 500) : null,
      };
      if (ya) {
        tx.update(refInscripcion(t.id, user.id), datos);
      } else {
        tx.set(refInscripcion(t.id, user.id), {
          user_id: user.id,
          paid: 0,
          paid_at: null,
          payment_ref: null,
          created_at: ahora(),
          ...datos,
        });
      }
    })
  );
}

/**
 * Se retira del torneo y de su equipo (y se va su pedido de ingreso, si lo
 * había); el equipo se borra si queda vacío, salvo uno del organizador, que
 * queda como lugar libre.
 */
export function retirarse(t: Tournament, uid: string) {
  return conMensaje(() =>
    runTransaction(firestore, async (tx) => {
      const reg = await leerEnTx(tx, refInscripcion(t.id, uid));
      if (!reg) return;
      const equipo = reg.team_id ? await leerEnTx(tx, refEquipo(reg.team_id)) : null;
      tx.update(refInscripcion(t.id, uid), { status: 'retirada', team_id: null, join_request: null });
      if (!equipo) return;
      const queda = sinMiembro(equipo, uid);
      if (queda) tx.update(refEquipo(equipo.id), queda);
      else tx.delete(refEquipo(equipo.id));
    })
  );
}

/**
 * Saca a un jugador de un equipo (él mismo, su capitán o el staff) y deja su
 * inscripción suelta. Si el equipo queda vacío, se borra (uno del organizador
 * queda como lugar libre).
 */
export function sacarMiembro(t: Tournament, teamId: string, userId: string) {
  return conMensaje(() =>
    runTransaction(firestore, async (tx) => {
      const equipo = await leerEnTx(tx, refEquipo(teamId));
      if (!equipo || equipo.tournament_id !== t.id) throw new Rechazo('Equipo inexistente.');
      const reg = await leerEnTx(tx, refInscripcion(t.id, userId));
      const queda = sinMiembro(equipo, userId);
      if (reg) tx.update(refInscripcion(t.id, userId), { team_id: null, kind: 'solo' });
      if (queda) tx.update(refEquipo(teamId), queda);
      else tx.delete(refEquipo(teamId));
    })
  );
}

/** Por dónde y cuánto pagó alguien: un medio del torneo con su costo, si lo tiene. */
export type PagoElegido = { method: string | null; amount_cents?: number; currency?: string };

/**
 * Estado y pago de una inscripción: solo el staff. Al marcarla paga se anota por
 * qué medio y cuánto (`pago`); al marcarla impaga se borra.
 */
export function marcarInscripcion(
  t: Tournament,
  r: { user_id: string; payment_ref: string | null },
  {
    status, paid, payment_ref, pago,
  }: { status?: string; paid?: boolean; payment_ref?: string | null; pago?: PagoElegido }
) {
  const cambios: Record<string, unknown> = {};
  if (status) cambios.status = status;
  if (paid !== undefined) {
    cambios.paid = paid ? 1 : 0;
    cambios.paid_at = paid ? ahora() : null;
    cambios.payment_ref = payment_ref ?? r.payment_ref;
    cambios.paid_method = paid ? (pago?.method ?? null) : null;
    cambios.paid_amount_cents = paid ? (pago?.amount_cents ?? null) : null;
    cambios.paid_currency = paid ? (pago?.currency ?? null) : null;
  }
  if (!Object.keys(cambios).length) return Promise.resolve();
  return conMensaje(() => updateDoc(refInscripcion(t.id, r.user_id), cambios));
}
