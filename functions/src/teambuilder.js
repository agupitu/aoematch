// Armador de equipos para jugadores sueltos.
//
// Reparte a los inscriptos solos en equipos del tamaño del torneo buscando dos
// cosas a la vez: que los equipos queden parejos de nivel y que sus integrantes
// tengan horarios en común. Primero reparto en serpiente por rating y después
// afino con intercambios mientras el puntaje mejore.

import { all, get, run, tx } from './db.js';
import { mascaraUsuario, BLOQUES_SEMANA, BLOQUE_MIN } from './availability.js';

const RATING_BASE = 1000;

function ratingDe(u, torneo) {
  const r = torneo.team_size > 1 ? u.rating_team ?? u.rating_1v1 : u.rating_1v1 ?? u.rating_team;
  return r ?? RATING_BASE;
}

/** Minutos semanales en los que coincide todo un equipo. */
function solapeEquipo(miembros, cache) {
  if (miembros.length < 2) return 24 * 60;
  let n = 0;
  for (let i = 0; i < BLOQUES_SEMANA; i++) {
    let todos = true;
    for (const m of miembros) {
      if (!cache.get(m.id)[i]) { todos = false; break; }
    }
    if (todos) n++;
  }
  return n * BLOQUE_MIN;
}

function puntaje(equipos, cache, pesoSolape) {
  const medias = equipos.map((e) => e.reduce((s, m) => s + m._rating, 0) / Math.max(1, e.length));
  const prom = medias.reduce((a, b) => a + b, 0) / Math.max(1, medias.length);
  const desvio = Math.sqrt(medias.reduce((s, m) => s + (m - prom) ** 2, 0) / Math.max(1, medias.length));

  const solapes = equipos.map((e) => solapeEquipo(e, cache));
  const solapeMin = Math.min(...solapes);
  const solapeProm = solapes.reduce((a, b) => a + b, 0) / Math.max(1, solapes.length);

  // Penaliza el desvío de rating y premia el solape (en horas), dando más peso
  // al equipo peor servido para que nadie quede sin horario posible.
  return -desvio + pesoSolape * (solapeMin / 60) * 2 + pesoSolape * (solapeProm / 60) * 0.5;
}

/**
 * Propone equipos. No escribe nada en la base: devuelve la propuesta para que
 * el organizador la revise y después confirme.
 */
export function proponerEquipos(tournamentId, { pesoSolape = 1.5, iteraciones = 4000 } = {}) {
  const torneo = get('SELECT * FROM tournaments WHERE id = ?', tournamentId);
  if (!torneo) throw new Error('Torneo inexistente.');
  const size = torneo.team_size;
  if (size < 2) throw new Error('El armador de equipos es para torneos por equipos.');

  const sueltos = all(
    `SELECT u.* FROM registrations r JOIN users u ON u.id = r.user_id
      WHERE r.tournament_id = ? AND r.kind = 'solo' AND r.status != 'retirada'
        AND (r.team_id IS NULL)
      ORDER BY u.id`,
    tournamentId
  );

  if (sueltos.length < size) {
    return { teams: [], leftovers: sueltos.map(resumen), score: 0, note: 'No alcanzan los jugadores para un equipo.' };
  }

  const cache = new Map();
  for (const u of sueltos) {
    cache.set(u.id, mascaraUsuario(u.id));
    u._rating = ratingDe(u, torneo);
  }

  const cantidad = Math.floor(sueltos.length / size);
  const ordenados = [...sueltos].sort((a, b) => b._rating - a._rating);
  const usados = ordenados.slice(0, cantidad * size);
  const sobran = ordenados.slice(cantidad * size);

  // Reparto en serpiente: 1→N, N→1, 1→N...
  const equipos = Array.from({ length: cantidad }, () => []);
  usados.forEach((u, i) => {
    const vuelta = Math.floor(i / cantidad);
    const pos = i % cantidad;
    const idx = vuelta % 2 === 0 ? pos : cantidad - 1 - pos;
    equipos[idx].push(u);
  });

  // Afinado por intercambios.
  let mejor = puntaje(equipos, cache, pesoSolape);
  for (let it = 0; it < iteraciones && cantidad > 1; it++) {
    const t1 = Math.floor(Math.random() * cantidad);
    let t2 = Math.floor(Math.random() * cantidad);
    if (t1 === t2) t2 = (t2 + 1) % cantidad;
    const i1 = Math.floor(Math.random() * equipos[t1].length);
    const i2 = Math.floor(Math.random() * equipos[t2].length);

    [equipos[t1][i1], equipos[t2][i2]] = [equipos[t2][i2], equipos[t1][i1]];
    const nuevo = puntaje(equipos, cache, pesoSolape);
    if (nuevo > mejor) {
      mejor = nuevo;
    } else {
      [equipos[t1][i1], equipos[t2][i2]] = [equipos[t2][i2], equipos[t1][i1]];
    }
  }

  return {
    score: Number(mejor.toFixed(2)),
    teams: equipos.map((miembros, i) => ({
      name: `Equipo ${i + 1}`,
      avg_rating: Math.round(miembros.reduce((s, m) => s + m._rating, 0) / miembros.length),
      overlap_min: solapeEquipo(miembros, cache),
      members: miembros.map(resumen),
    })),
    leftovers: sobran.map(resumen),
  };
}

function resumen(u) {
  return {
    id: u.id,
    display_name: u.display_name,
    avatar_url: u.avatar_url || u.steam_avatar || null,
    rating: u._rating ?? u.rating_team ?? u.rating_1v1 ?? null,
    timezone: u.timezone,
  };
}

/** Persiste una propuesta: crea los equipos y engancha las inscripciones. */
export function confirmarEquipos(tournamentId, propuesta) {
  return tx(() => {
    const creados = [];
    for (const t of propuesta.teams) {
      const captain = t.members[0]?.id ?? null;
      const info = run(
        'INSERT INTO teams (tournament_id, name, captain_id, auto_built) VALUES (?, ?, ?, 1)',
        tournamentId,
        t.name,
        captain
      );
      const teamId = info.lastInsertRowid;
      for (const m of t.members) {
        run(
          'INSERT OR REPLACE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)',
          teamId,
          m.id,
          m.id === captain ? 'capitan' : 'jugador'
        );
        run(
          'UPDATE registrations SET team_id = ? WHERE tournament_id = ? AND user_id = ?',
          teamId,
          tournamentId,
          m.id
        );
      }
      run(
        "INSERT INTO chat_rooms (tournament_id, team_id, kind, name) VALUES (?, ?, 'equipo', ?)",
        tournamentId,
        teamId,
        t.name
      );
      creados.push(teamId);
    }
    return creados;
  });
}
