import { useEffect, useRef, useState } from 'react';

type Entrante =
  | { type: 'hello'; user: unknown }
  | { type: 'history'; room: string; messages: unknown[] }
  | { type: 'chat'; room: string; message: unknown }
  | { type: 'presence'; room: string; users: unknown[] }
  | { type: 'typing'; room: string; user: unknown }
  | { type: 'draft'; room: string; payload: unknown }
  | { type: 'match'; room: string; payload: unknown }
  | { type: 'votes'; room: string; payload: unknown }
  | { type: 'error'; room?: string; error: string };

/**
 * Conexión única al backend. Se reconecta sola y vuelve a entrar a las salas.
 * `onMessage` se guarda en un ref para no reabrir el socket en cada render.
 */
export function useSocket(rooms: string[], onMessage: (msg: Entrante) => void) {
  const [conectado, setConectado] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const clave = rooms.join('|');

  useEffect(() => {
    if (!rooms.length) return;
    let vivo = true;
    let reintento: ReturnType<typeof setTimeout>;

    const abrir = () => {
      if (!vivo) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConectado(true);
        ws.send(JSON.stringify({ type: 'join', rooms }));
      };
      ws.onmessage = (ev) => {
        try {
          handler.current(JSON.parse(ev.data));
        } catch {
          /* mensaje ilegible: lo ignoramos */
        }
      };
      ws.onclose = () => {
        setConectado(false);
        if (vivo) reintento = setTimeout(abrir, 1500);
      };
      ws.onerror = () => ws.close();
    };

    abrir();
    return () => {
      vivo = false;
      clearTimeout(reintento);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const enviar = (msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  return { conectado, enviar };
}
