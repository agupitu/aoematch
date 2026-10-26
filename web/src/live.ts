import { useEffect, useRef, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, type DocumentData } from 'firebase/firestore';
import { onValue, ref } from 'firebase/database';
import { api } from './api';
import { database, firestore } from './firebase';
import type { ChatMessage } from './types';

// Tiempo real con Firebase (reemplaza el WebSocket): los mensajes del chat y
// el aviso de cambios de cada partido se escuchan directo en Firestore, con
// las reglas de firestore.rules; escribir pasa por la API.

function comoMensaje(id: string, d: DocumentData): ChatMessage {
  return {
    id,
    body: d.body,
    system: !!d.system,
    // Un mensaje recién mandado llega antes de que el servidor le ponga hora.
    created_at: d.created_at?.toDate().toISOString() ?? new Date().toISOString(),
    user: d.user ?? null,
  };
}

/**
 * Mensajes en vivo de varias salas ('match:<id>', 'team:<id>',
 * 'tournament:<slug>'). Cada sala se abre primero en la API, que la crea si
 * hace falta (sin el documento de la sala las reglas no dejan leer), y
 * después se escuchan sus últimos 80 mensajes.
 */
export function useChat(salas: string[]) {
  const [mensajes, setMensajes] = useState<Record<string, ChatMessage[]>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const clave = salas.join('|');

  useEffect(() => {
    let vivo = true;
    const cortes: (() => void)[] = [];
    for (const room of clave ? clave.split('|') : []) {
      api
        .get<{ id: string }>(`/api/rooms/${encodeURIComponent(room)}`)
        .then((sala) => {
          if (!vivo) return;
          const q = query(collection(firestore, 'rooms', sala.id, 'messages'), orderBy('created_at', 'desc'), limit(80));
          cortes.push(
            onSnapshot(
              q,
              (snap) => {
                const lista = snap.docs.map((d) => comoMensaje(d.id, d.data({ serverTimestamps: 'estimate' }))).reverse();
                setMensajes((p) => ({ ...p, [room]: lista }));
              },
              (err) => setErrores((p) => ({ ...p, [room]: err.message }))
            )
          );
        })
        .catch((err: Error) => vivo && setErrores((p) => ({ ...p, [room]: err.message })));
    }
    return () => {
      vivo = false;
      cortes.forEach((cortar) => cortar());
    };
  }, [clave]);

  const enviar = (room: string, body: string) =>
    api.post(`/api/rooms/${encodeURIComponent(room)}/messages`, { body });

  return { mensajes, errores, enviar };
}

export type Cambio = 'draft' | 'match' | 'votes';

/**
 * Escucha live/{matchId}: cada vez que la API cambia el draft, el partido o
 * los votos, avisa el tipo para que la página vuelva a pedir el estado. El
 * aviso no trae datos: lo que ve cada uno lo decide la API.
 */
export function useLive(matchId: string | undefined, onCambio: (tipo: Cambio) => void) {
  const handler = useRef(onCambio);
  handler.current = onCambio;

  useEffect(() => {
    if (!matchId) return;
    let previo: Record<Cambio, number> | null = null;
    return onSnapshot(doc(firestore, 'live', matchId), (snap) => {
      const d = snap.data() ?? {};
      const actual = { draft: d.draft ?? 0, match: d.match ?? 0, votes: d.votes ?? 0 };
      // El primero solo marca desde dónde contar: la página ya cargó el estado.
      if (previo) {
        for (const tipo of ['draft', 'match', 'votes'] as Cambio[]) {
          if (actual[tipo] !== previo[tipo]) handler.current(tipo);
        }
      }
      previo = actual;
    });
  }, [matchId]);
}

/** ¿Hay conexión con Firebase? (lo sabe Realtime Database). */
export function useConectado() {
  const [conectado, setConectado] = useState(false);
  useEffect(() => onValue(ref(database, '.info/connected'), (s) => setConectado(!!s.val())), []);
  return conectado;
}
