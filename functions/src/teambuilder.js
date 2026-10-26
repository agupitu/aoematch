// Armador de equipos sobre Firestore. El algoritmo vive en la web (plan
// Spark): web/src/logica/armador.js; acá se leen los sueltos y se guarda.

import { proponerEquipos as proponer } from '../../web/src/logica/armador.js';
import { enTransaccion, ordenarPor } from './data/base.js';
import { guardarEquipo, refEquipo } from './data/equipos.js';
import { actualizarInscripcion, leerInscripcion, listarInscripciones, vigente } from './data/inscripciones.js';
import { guardarSalaDeEquipo } from './data/salas.js';
import { leerTorneo, sumarContadores } from './data/torneos.js';
import { mapaDeUsuarios } from './data/usuarios.js';

/** Propuesta de equipos para los inscriptos solos del torneo. */
export async function proponerEquipos(slug, opciones = {}) {
  const torneo = await leerTorneo(slug);
  if (!torneo) throw new Error('Torneo inexistente.');
  if (torneo.team_size < 2) throw new Error('El armador de equipos es para torneos por equipos.');

  // Inscriptos solos, no retirados y sin equipo, por id como antes.
  const inscripciones = (await listarInscripciones(slug)).filter((r) => r.kind === 'solo' && vigente(r) && !r.team_id);
  const ids = ordenarPor(inscripciones, 'user_id').map((r) => r.user_id);
  const usuarios = await mapaDeUsuarios(ids);
  return proponer(torneo, ids.map((id) => ({ ...usuarios.get(id), id })), opciones);
}

/**
 * Guarda una propuesta, en una transacción: crea los equipos (el primero de
 * cada uno es el capitán) con su sala, engancha las inscripciones y suma los
 * equipos al contador del torneo. Devuelve los ids nuevos.
 */
export function confirmarEquipos(slug, propuesta) {
  return enTransaccion(async (tx) => {
    const torneo = await leerTorneo(slug, tx);
    if (!torneo) throw new Error('Torneo inexistente.');
    const equipos = propuesta.teams.map((t) => ({
      ref: refEquipo(),
      name: String(t.name || 'Equipo').slice(0, 60),
      ids: [...new Set((t.members ?? []).map((m) => String(m.id)))],
    })).filter((e) => e.ids.length);
    const inscripciones = await Promise.all(
      equipos.map((e) => Promise.all(e.ids.map((uid) => leerInscripcion(slug, uid, tx))))
    );

    const escrituras = [];
    equipos.forEach((e, i) => {
      escrituras.push(guardarEquipo({
        tournament_id: slug,
        name: e.name,
        captain_id: e.ids[0],
        auto_built: 1,
        members: e.ids.map((uid, j) => ({ user_id: uid, role: j === 0 ? 'capitan' : 'jugador' })),
      }, tx, e.ref));
      inscripciones[i].forEach((r, j) => {
        if (r) actualizarInscripcion(slug, e.ids[j], { team_id: e.ref.id }, tx);
      });
      guardarSalaDeEquipo(e.ref.id, e.name, e.ids, torneo, tx);
    });
    sumarContadores(slug, { equipos: equipos.length }, tx);
    await Promise.all(escrituras);
    return equipos.map((e) => e.ref.id);
  });
}
