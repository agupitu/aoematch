import { EventEmitter } from 'node:events';

/**
 * Canal interno de eventos. La capa WebSocket se suscribe y reenvía a las salas.
 * Eventos: 'publish' con { room, type, payload }.
 *   room: 'match:<id>' | 'team:<id>' | 'tournament:<id>'
 */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(room, type, payload) {
  bus.emit('publish', { room, type, payload });
}
