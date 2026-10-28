import { useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { onValue, ref } from 'firebase/database';
import { useAuth } from './auth';
import { mensajeDeError } from './datos/base';
import { firestore, database } from './firebase';
import type { ChatMessage } from './types';

// Tiempo real sin API: el partido y el draft se escuchan en Firestore, y el
// chat se escribe desde el cliente con las reglas de firestore.rules.

function comoMensaje(id: string, d: DocumentData): ChatMessage {
  return {
    id,
    body: d.body,
    system: !!d.system,
    created_at: d.created_at?.toDate().toISOString() ?? new Date().toISOString(),
    user: d.user ?? null,
  };
}

const PREFIJOS = { tournament: 'torneo', match: 'partido', team: 'equipo' } as const;

function parsearSala(room: string): { tipo: keyof typeof PREFIJOS; id: string; roomId: string } | null {
  const [tipo, ...resto] = room.split(':');
  const id = resto.join(':');
  if (!(tipo in PREFIJOS) || !id || id.includes('/')) return null;
  const clave = tipo as keyof typeof PREFIJOS;
  return { tipo: clave, id, roomId: `${PREFIJOS[clave]}_${id}` };
}

async function datosDeSala(parsed: { tipo: keyof typeof PREFIJOS; id: string }) {
  if (parsed.tipo === 'tournament') {
    return {
      kind: 'torneo',
      tournament_id: parsed.id,
      public_read: true,
      name: 'General',
      created_at: serverTimestamp(),
    };
  }
  if (parsed.tipo === 'match') {
    const m = await getDoc(doc(firestore, 'matches', parsed.id));
    if (!m.exists()) throw new Error('Ese partido no existe.');
    const d = m.data();
    return {
      kind: 'partido',
      tournament_id: d.tournament_id,
      match_id: parsed.id,
      public_read: true,
      name: String(d.label || `Ronda ${d.round ?? ''}`.trim()).slice(0, 120),
      created_at: serverTimestamp(),
    };
  }
  const e = await getDoc(doc(firestore, 'teams', parsed.id));
  if (!e.exists()) throw new Error('Ese equipo no existe.');
  const d = e.data();
  return {
    kind: 'equipo',
    tournament_id: d.tournament_id,
    team_id: parsed.id,
    public_read: false,
    name: String(d.name || 'Equipo').slice(0, 120),
    created_at: serverTimestamp(),
  };
}

/**
 * ¿Existe la sala? Las reglas leen `resource.data`: con la sala sin crear no hay
 * `resource` y la lectura se rechaza. Eso es una sala que falta, no un error.
 */
async function existeLaSala(refSala: DocumentReference) {
  try {
    return (await getDoc(refSala)).exists();
  } catch {
    return false;
  }
}

async function asegurarSala(room: string) {
  const parsed = parsearSala(room);
  if (!parsed) throw new Error('Sala inválida.');
  const refSala = doc(firestore, 'rooms', parsed.roomId);
  if (await existeLaSala(refSala)) return parsed.roomId;
  try {
    await setDoc(refSala, await datosDeSala(parsed));
  } catch (err) {
    if (!(await existeLaSala(refSala))) throw err;
  }
  return parsed.roomId;
}

/**
 * Mensajes en vivo de varias salas ('match:<id>', 'team:<id>',
 * 'tournament:<slug>'). Si la sala no existe, la crea quien puede
 * (salaNuevaValida). Escribir compara el perfil con las reglas.
 */
export function useChat(salas: string[]) {
  const { user } = useAuth();
  const [mensajes, setMensajes] = useState<Record<string, ChatMessage[]>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const clave = salas.join('|');
  const uid = user?.id;

  useEffect(() => {
    let vivo = true;
    const cortes: (() => void)[] = [];
    for (const room of clave ? clave.split('|') : []) {
      const parsed = parsearSala(room);
      if (!parsed) {
        setErrores((p) => ({ ...p, [room]: 'Sala inválida.' }));
        continue;
      }
      const abrir = async () => {
        if (uid) {
          try {
            await asegurarSala(room);
          } catch (err) {
            if (vivo) setErrores((p) => ({ ...p, [room]: mensajeDeError(err) }));
          }
        }
        if (!vivo) return;
        const q = query(
          collection(firestore, 'rooms', parsed.roomId, 'messages'),
          orderBy('created_at', 'desc'),
          limit(80)
        );
        const cortar = onSnapshot(
          q,
          (snap) => {
            const lista = snap.docs.map((d) => comoMensaje(d.id, d.data({ serverTimestamps: 'estimate' }))).reverse();
            setMensajes((p) => ({ ...p, [room]: lista }));
            setErrores((p) => (p[room] ? { ...p, [room]: '' } : p));
          },
          (err) => {
            if (!vivo) return;
            // Sin sesión no se puede crear la sala: si nadie la abrió todavía,
            // las reglas no dejan leerla. Para un anónimo es una sala vacía.
            if (!uid && (err as { code?: string }).code === 'permission-denied') {
              setMensajes((p) => ({ ...p, [room]: [] }));
              return;
            }
            setErrores((p) => ({ ...p, [room]: mensajeDeError(err) }));
          }
        );
        if (vivo) cortes.push(cortar);
        else cortar();
      };
      void abrir();
    }
    return () => {
      vivo = false;
      cortes.forEach((cortar) => cortar());
    };
  }, [clave, uid]);

  const enviar = async (room: string, body: string) => {
    const texto = body.trim();
    if (!texto) return;
    if (!user) throw new Error('Tenés que entrar para escribir.');
    const roomId = await asegurarSala(room);
    await addDoc(collection(firestore, 'rooms', roomId, 'messages'), {
      body: texto.slice(0, 2000),
      system: 0,
      created_at: serverTimestamp(),
      user: { id: user.id, display_name: user.display_name, avatar_url: user.avatar_url },
    }).catch((err) => {
      throw new Error(mensajeDeError(err));
    });
  };

  return { mensajes, errores, enviar };
}

/**
 * Vuelve a pedir el partido cuando cambia el documento o un draft. El primero
 * no dispara: la página ya cargó. No escribe, así que no rearma un loop.
 */
export function useLive(matchId: string | undefined, onCambio: () => void) {
  const handler = useRef(onCambio);
  handler.current = onCambio;

  useEffect(() => {
    if (!matchId) return;
    let listoMatch = false;
    let listoDraft = false;
    const avisar = (cual: 'match' | 'draft') => {
      if (cual === 'match') {
        if (!listoMatch) {
          listoMatch = true;
          return;
        }
      } else if (!listoDraft) {
        listoDraft = true;
        return;
      }
      handler.current();
    };
    const cortarMatch = onSnapshot(doc(firestore, 'matches', matchId), () => avisar('match'));
    const cortarDraft = onSnapshot(collection(firestore, 'matches', matchId, 'drafts'), () => avisar('draft'));
    return () => {
      cortarMatch();
      cortarDraft();
    };
  }, [matchId]);
}

/** ¿Hay conexión con Firebase? (lo sabe Realtime Database). La lista de quién está es usePresencia. */
export function useConectado() {
  const [conectado, setConectado] = useState(false);
  useEffect(() => onValue(ref(database, '.info/connected'), (s) => setConectado(!!s.val())), []);
  return conectado;
}
