// WebSocket: salas de chat y empuje del estado del draft.
//
// Protocolo (JSON por mensaje):
//   cliente -> { type:'join',  rooms:[ 'match:3', 'team:5', 'tournament:1' ] }
//   cliente -> { type:'chat',  room:'team:5', body:'...' }
//   cliente -> { type:'typing', room }
//   servidor -> { type:'chat'|'draft'|'presence'|'system'|'error', ... }

import { WebSocketServer } from 'ws';
import { all, get, run } from './db.js';
import { bus } from './bus.js';
import { userForToken, publicUser, COOKIE } from './auth.js';
import { estadoDraft } from './draft.js';

/** room id -> Set<ws> */
const salas = new Map();

function unirse(ws, room) {
  if (!salas.has(room)) salas.set(room, new Set());
  salas.get(room).add(ws);
  ws._rooms.add(room);
}

function salir(ws, room) {
  salas.get(room)?.delete(ws);
  ws._rooms.delete(room);
}

function enviar(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function aSala(room, msg, filtro = null) {
  const set = salas.get(room);
  if (!set) return;
  for (const ws of set) {
    if (filtro && !filtro(ws)) continue;
    enviar(ws, msg);
  }
}

function presencia(room) {
  const set = salas.get(room);
  if (!set) return;
  const vistos = new Map();
  for (const ws of set) if (ws._user) vistos.set(ws._user.id, publicUser(ws._user));
  aSala(room, { type: 'presence', room, users: [...vistos.values()] });
}

// ------------------------------------------------------------------ permisos

function esMiembroEquipo(userId, teamId) {
  return !!get('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?', teamId, userId);
}

function esStaff(userId, tournamentId) {
  const t = get('SELECT organizer_id FROM tournaments WHERE id = ?', tournamentId);
  if (!t) return false;
  if (t.organizer_id === userId) return true;
  return !!get(
    'SELECT 1 FROM tournament_admins WHERE tournament_id = ? AND user_id = ?',
    tournamentId,
    userId
  );
}

/** ¿Puede este usuario ver/escribir en la sala? */
export function puedeAcceder(user, room) {
  const [kind, rawId] = room.split(':');
  const id = Number(rawId);
  if (!Number.isInteger(id)) return false;

  if (kind === 'tournament') {
    return !!get('SELECT 1 FROM tournaments WHERE id = ?', id); // sala general: abierta
  }
  if (kind === 'team') {
    if (!user) return false;
    const team = get('SELECT * FROM teams WHERE id = ?', id);
    if (!team) return false;
    return esMiembroEquipo(user.id, id) || esStaff(user.id, team.tournament_id);
  }
  if (kind === 'match') {
    const m = get('SELECT * FROM matches WHERE id = ?', id);
    if (!m) return false;
    if (!user) return true; // la sala del partido se puede mirar
    return true;
  }
  return false;
}

/** ¿Puede escribir? La sala de equipo y la de partido son solo para los suyos. */
export function puedeEscribir(user, room) {
  if (!user) return false;
  const [kind, rawId] = room.split(':');
  const id = Number(rawId);
  if (kind === 'team') return puedeAcceder(user, room);
  if (kind === 'tournament') {
    return !!get(
      `SELECT 1 FROM registrations WHERE tournament_id = ? AND user_id = ? AND status != 'retirada'`,
      id,
      user.id
    ) || esStaff(user.id, id);
  }
  if (kind === 'match') {
    const m = get('SELECT * FROM matches WHERE id = ?', id);
    if (!m) return false;
    if (esStaff(user.id, m.tournament_id)) return true;
    return (
      (m.team_a_id && esMiembroEquipo(user.id, m.team_a_id)) ||
      (m.team_b_id && esMiembroEquipo(user.id, m.team_b_id))
    );
  }
  return false;
}

/** Devuelve (creando si hace falta) la sala de chat persistida de un room id. */
export function salaDeChat(room) {
  const [kind, rawId] = room.split(':');
  const id = Number(rawId);
  if (kind === 'team') {
    let r = get("SELECT * FROM chat_rooms WHERE team_id = ? AND kind = 'equipo'", id);
    if (!r) {
      const team = get('SELECT * FROM teams WHERE id = ?', id);
      if (!team) return null;
      const info = run(
        "INSERT INTO chat_rooms (tournament_id, team_id, kind, name) VALUES (?, ?, 'equipo', ?)",
        team.tournament_id, id, team.name
      );
      r = get('SELECT * FROM chat_rooms WHERE id = ?', info.lastInsertRowid);
    }
    return r;
  }
  if (kind === 'match') {
    let r = get("SELECT * FROM chat_rooms WHERE match_id = ? AND kind = 'partido'", id);
    if (!r) {
      const m = get('SELECT * FROM matches WHERE id = ?', id);
      if (!m) return null;
      const info = run(
        "INSERT INTO chat_rooms (tournament_id, match_id, kind, name) VALUES (?, ?, 'partido', ?)",
        m.tournament_id, id, m.label || `Partido #${id}`
      );
      r = get('SELECT * FROM chat_rooms WHERE id = ?', info.lastInsertRowid);
    }
    return r;
  }
  if (kind === 'tournament') {
    let r = get("SELECT * FROM chat_rooms WHERE tournament_id = ? AND kind = 'torneo'", id);
    if (!r) {
      const t = get('SELECT * FROM tournaments WHERE id = ?', id);
      if (!t) return null;
      const info = run(
        "INSERT INTO chat_rooms (tournament_id, kind, name) VALUES (?, 'torneo', 'General')",
        id
      );
      r = get('SELECT * FROM chat_rooms WHERE id = ?', info.lastInsertRowid);
    }
    return r;
  }
  return null;
}

export function historial(room, limite = 80) {
  const sala = salaDeChat(room);
  if (!sala) return [];
  const filas = all(
    `SELECT m.id, m.body, m.system, m.created_at,
            u.id AS user_id, u.display_name, u.avatar_url, u.steam_avatar
       FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ? ORDER BY m.id DESC LIMIT ?`,
    sala.id,
    limite
  );
  return filas.reverse().map(formatearMensaje);
}

function formatearMensaje(r) {
  return {
    id: r.id,
    body: r.body,
    system: !!r.system,
    created_at: r.created_at,
    user: r.user_id
      ? { id: r.user_id, display_name: r.display_name, avatar_url: r.avatar_url || r.steam_avatar || null }
      : null,
  };
}

export function publicarMensaje(room, userId, body, system = 0) {
  const sala = salaDeChat(room);
  if (!sala) return null;
  const info = run(
    'INSERT INTO chat_messages (room_id, user_id, body, system) VALUES (?, ?, ?, ?)',
    sala.id,
    userId,
    body,
    system
  );
  const r = get(
    `SELECT m.id, m.body, m.system, m.created_at,
            u.id AS user_id, u.display_name, u.avatar_url, u.steam_avatar
       FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?`,
    info.lastInsertRowid
  );
  const msg = formatearMensaje(r);
  aSala(room, { type: 'chat', room, message: msg });
  return msg;
}

/** Mensaje del sistema en una sala (ej: "Se definió el mapa"). */
export function avisoSistema(room, texto) {
  return publicarMensaje(room, null, texto, 1);
}

// -------------------------------------------------------------------- setup

function leerCookie(header, nombre) {
  if (!header) return null;
  for (const parte of header.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function montarWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  bus.on('publish', ({ room, type, payload }) => {
    aSala(room, { type, room, payload });
  });

  wss.on('connection', (ws, req) => {
    ws._rooms = new Set();
    ws._user = userForToken(leerCookie(req.headers.cookie, COOKIE));
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    enviar(ws, { type: 'hello', user: publicUser(ws._user) });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'join') {
        for (const room of ws._rooms) salir(ws, room);
        for (const room of msg.rooms || []) {
          if (!puedeAcceder(ws._user, room)) {
            enviar(ws, { type: 'error', room, error: 'Sin acceso a esa sala.' });
            continue;
          }
          unirse(ws, room);
          enviar(ws, { type: 'history', room, messages: historial(room) });
          if (room.startsWith('match:')) {
            const matchId = Number(room.split(':')[1]);
            const d = get('SELECT id FROM drafts WHERE match_id = ? ORDER BY game_no DESC LIMIT 1', matchId);
            if (d) {
              const equipo = equipoDelUsuario(ws._user, matchId);
              enviar(ws, { type: 'draft', room, payload: estadoDraft(d.id, equipo) });
            }
          }
          presencia(room);
        }
        return;
      }

      if (msg.type === 'chat') {
        const { room, body } = msg;
        if (!ws._rooms.has(room)) return enviar(ws, { type: 'error', error: 'No estás en esa sala.' });
        if (!puedeEscribir(ws._user, room)) {
          return enviar(ws, { type: 'error', room, error: 'No podés escribir acá.' });
        }
        const texto = String(body || '').trim().slice(0, 2000);
        if (!texto) return;
        publicarMensaje(room, ws._user.id, texto);
        return;
      }

      if (msg.type === 'typing') {
        if (!ws._user || !ws._rooms.has(msg.room)) return;
        aSala(msg.room, { type: 'typing', room: msg.room, user: publicUser(ws._user) }, (o) => o !== ws);
        return;
      }
    });

    ws.on('close', () => {
      const rooms = [...ws._rooms];
      for (const room of rooms) salir(ws, room);
      for (const room of rooms) presencia(room);
    });
  });

  const latido = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  latido.unref();

  return wss;
}

function equipoDelUsuario(user, matchId) {
  if (!user) return null;
  const m = get('SELECT team_a_id, team_b_id FROM matches WHERE id = ?', matchId);
  if (!m) return null;
  if (m.team_a_id && esMiembroEquipo(user.id, m.team_a_id)) return m.team_a_id;
  if (m.team_b_id && esMiembroEquipo(user.id, m.team_b_id)) return m.team_b_id;
  return null;
}

export { equipoDelUsuario };
