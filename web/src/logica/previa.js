// Vista previa de un torneo: arma con el mismo generador de llaves lo que va a
// salir con la configuración del formulario, usando equipos de prueba. No toca
// la base ni los equipos reales (web/src/logica/llaves.js).

import { cuadroDeClasificados, generarCuadro } from './llaves.js';

/** Más que esto no se dibuja: una eliminación doble de 64 equipos ya son 126 partidos. */
export const MAX_EQUIPOS_PREVIA = 64;

const TIPICOS = { eliminacion_simple: 8, eliminacion_doble: 8, liga: 6, suizo: 8 };

const acotar = (n) => Math.max(2, Math.min(MAX_EQUIPOS_PREVIA, Math.floor(n) || 2));

/** Equipos con los que se muestra la vista previa: el tope del torneo si lo hay, y si no uno típico del formato. */
export function equiposPorDefecto(b) {
  const tope = Number(b.max_teams);
  if (tope >= 2) return acotar(tope);
  if (b.format === 'grupos_playoff') return acotar((Number(b.group_count) || 2) * 4);
  return TIPICOS[b.format] ?? 8;
}

/**
 * Lo que sale de `b` (el borrador del formulario) con `cantidad` equipos. Los
 * primeros se llaman como `nombres` y el resto "Equipo N". Devuelve los
 * equipos, las etapas, los partidos con el nombre de cada lado y, por etapa,
 * cuántos partidos se juegan de verdad (los pasajes libres no cuentan).
 */
export function armarPrevia(b, cantidad, nombres = []) {
  const n = acotar(cantidad);
  const torneo = {
    id: 'previa',
    format: b.format,
    team_size: Number(b.team_size) || 1,
    best_of: Number(b.best_of) || 3,
    best_of_final: Number(b.best_of_final) || null,
    series_mode: b.series_mode,
    group_count: Number(b.group_count) || 2,
    group_advance: Math.max(1, Number(b.group_advance) || 1),
    swiss_rounds: Number(b.swiss_rounds) || 0,
    third_place: b.third_place ? 1 : 0,
  };
  let k = 0;
  const ids = { nuevoId: () => `p${++k}`, nuevoIdEtapa: () => `s${++k}` };

  const equipos = Array.from({ length: n }, (_, i) => ({
    id: `e${i + 1}`,
    name: nombres[i] || `Equipo ${i + 1}`,
    seed: null,
  }));
  const nombreDe = new Map(equipos.map((e) => [e.id, e.name]));

  const cuadro = generarCuadro(torneo, equipos, ids);
  let etapas = cuadro.etapas;
  let partidos = cuadro.partidos;

  if (torneo.format === 'grupos_playoff') {
    // Primeros de cada grupo arriba, después los segundos...: como siembra los playoffs de verdad.
    const clasificados = [];
    for (let pos = 1; pos <= torneo.group_advance; pos++) {
      for (const g of etapas[0].groups) {
        if (g.team_ids.length >= pos) clasificados.push({ id: `c${pos}${g.id}`, name: `${pos}º ${g.name}` });
      }
    }
    if (clasificados.length >= 2) {
      const playoffs = cuadroDeClasificados(torneo, clasificados, ids);
      etapas = [...etapas, ...playoffs.etapas];
      partidos = [...partidos, ...playoffs.partidos];
      for (const c of clasificados) nombreDe.set(c.id, c.name);
    }
  }

  // Un partido que se cierra sin equipos (en una llave con byes) no se juega ni se ve.
  const visibles = partidos
    .filter((m) => !(m.status === 'walkover' && !m.team_a_id && !m.team_b_id))
    .map((m) => ({
      ...m,
      team_a_name: nombreDe.get(m.team_a_id) ?? null,
      team_b_name: nombreDe.get(m.team_b_id) ?? null,
    }));

  const fases = etapas.map((e) => ({
    id: e.id,
    nombre: e.name,
    partidos: visibles.filter((m) => m.stage_id === e.id && m.status === 'pendiente').length,
  }));

  return { cantidad: n, equipos, etapas, partidos: visibles, fases };
}
