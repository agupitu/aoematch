// Disponibilidad semanal y búsqueda de horarios en común.
//
// La semana se modela como 336 bloques de 30 minutos en UTC, empezando el
// lunes a las 00:00. El cliente traduce a la zona horaria de cada jugador.
//
// Todo trabaja sobre usuarios ya leídos: docs de users con su id y su
// `availability` ([{ start_min, end_min }], docs/firestore-modelo.md).

export const BLOQUE_MIN = 30;
export const BLOQUES_SEMANA = (7 * 24 * 60) / BLOQUE_MIN; // 336

/** Array de 336 booleanos con los bloques libres del usuario. */
export function mascaraUsuario(usuario) {
  const mask = new Array(BLOQUES_SEMANA).fill(false);
  for (const { start_min, end_min } of usuario?.availability ?? []) {
    const desde = Math.max(0, Math.floor(start_min / BLOQUE_MIN));
    const hasta = Math.min(BLOQUES_SEMANA, Math.ceil(end_min / BLOQUE_MIN));
    for (let i = desde; i < hasta; i++) mask[i] = true;
  }
  return mask;
}

/** Map id -> máscara. */
export function mascaras(usuarios) {
  const out = new Map();
  for (const u of usuarios) out.set(u.id, mascaraUsuario(u));
  return out;
}

/** Cuántos de los usuarios están libres en cada bloque. */
export function conteo(usuarios) {
  const ms = mascaras(usuarios);
  const c = new Array(BLOQUES_SEMANA).fill(0);
  for (const mask of ms.values()) {
    for (let i = 0; i < BLOQUES_SEMANA; i++) if (mask[i]) c[i]++;
  }
  return c;
}

/** Minutos de semana en los que todos coinciden. */
export function minutosEnComun(usuarios) {
  if (!usuarios.length) return 0;
  const c = conteo(usuarios);
  let n = 0;
  for (const v of c) if (v === usuarios.length) n++;
  return n * BLOQUE_MIN;
}

/**
 * Ventanas donde coinciden al menos `minimo` jugadores durante `duracionMin`.
 * Devuelve [{ start_min, end_min, count, missing: [userId] }] ordenado por
 * cantidad de gente y luego por horario.
 */
export function ventanas(usuarios, { duracionMin = 60, minimo = null, limite = 20 } = {}) {
  if (!usuarios.length) return [];
  const req = minimo ?? usuarios.length;
  const largo = Math.max(1, Math.ceil(duracionMin / BLOQUE_MIN));
  const ms = mascaras(usuarios);
  const c = conteo(usuarios);

  const out = [];
  for (let i = 0; i + largo <= BLOQUES_SEMANA; i++) {
    let min = Infinity;
    for (let k = 0; k < largo; k++) min = Math.min(min, c[i + k]);
    if (min < req) continue;
    const faltan = [];
    for (const [uid, mask] of ms) {
      let libre = true;
      for (let k = 0; k < largo; k++) if (!mask[i + k]) { libre = false; break; }
      if (!libre) faltan.push(uid);
    }
    out.push({
      start_min: i * BLOQUE_MIN,
      end_min: (i + largo) * BLOQUE_MIN,
      count: usuarios.length - faltan.length,
      missing: faltan,
    });
  }

  // Fusiona ventanas contiguas con la misma gente.
  const fusionadas = [];
  for (const v of out) {
    const prev = fusionadas[fusionadas.length - 1];
    if (prev && prev.end_min >= v.start_min && prev.count === v.count &&
        prev.missing.join() === v.missing.join()) {
      prev.end_min = Math.max(prev.end_min, v.end_min);
    } else {
      fusionadas.push({ ...v });
    }
  }

  fusionadas.sort((x, y) => y.count - x.count || (y.end_min - y.start_min) - (x.end_min - x.start_min));
  return fusionadas.slice(0, limite);
}

/** Convierte un minuto de semana UTC a la próxima fecha real en UTC. */
export function proximaFecha(startMin, desde = new Date()) {
  const base = new Date(Date.UTC(
    desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate(), 0, 0, 0, 0
  ));
  // getUTCDay(): 0 = domingo. Queremos 0 = lunes.
  const diaSemana = (base.getUTCDay() + 6) % 7;
  const lunes = new Date(base.getTime() - diaSemana * 86400_000);
  let fecha = new Date(lunes.getTime() + startMin * 60_000);
  if (fecha < desde) fecha = new Date(fecha.getTime() + 7 * 86400_000);
  return fecha;
}
