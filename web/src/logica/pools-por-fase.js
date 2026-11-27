// Pool de mapas por fase.
//
// El organizador elige entre un solo pool para todo el torneo
// (`map_pool_mode: 'unico'`, lo de siempre: `map_ids`) o uno por fase
// (`map_pool_mode: 'por_fase'`): `map_pools` guarda, por clave de fase, los ids
// de mapas de esa fase. Una fase sin mapas propios usa `map_ids`, el pool base.
//
// Las fases salen del nombre de la ronda, no de la cantidad de equipos: así se
// pueden elegir al crear el torneo, antes de que haya llaves. Una fase que al
// final no se juega (octavos con 8 equipos) simplemente no se usa.

/** Claves de fase, en el orden en que se juegan, con su nombre. */
export const FASES_DE_MAPAS = [
  { id: 'grupos', label: 'Fase de grupos' },
  { id: 'ronda', label: 'Primeras rondas' },
  { id: 'octavos', label: 'Octavos' },
  { id: 'cuartos', label: 'Cuartos' },
  { id: 'semifinal', label: 'Semifinal' },
  { id: 'perdedores', label: 'Cuadro de perdedores' },
  { id: 'tercer', label: 'Tercer puesto' },
  { id: 'final', label: 'Final' },
];

const CLAVES = new Set(FASES_DE_MAPAS.map((f) => f.id));

export const MODOS_DE_POOL = ['unico', 'por_fase'];

/**
 * Las fases que puede tener un torneo según su formato. Liga y suizo son una
 * sola fase: no tienen pool por fase.
 * @param {{ format: string, third_place?: boolean | number }} torneo
 */
export function fasesDelFormato(torneo) {
  const eliminatoria = ['ronda', 'octavos', 'cuartos', 'semifinal'];
  const tercer = torneo.third_place ? ['tercer'] : [];
  switch (torneo.format) {
    case 'eliminacion_simple':
      return [...eliminatoria, ...tercer, 'final'];
    case 'eliminacion_doble':
      return [...eliminatoria, 'perdedores', 'final'];
    case 'grupos_playoff':
      return ['grupos', ...eliminatoria, ...tercer, 'final'];
    default:
      return [];
  }
}

/** ¿El torneo usa un pool por fase? Solo si lo eligió y el formato tiene fases. */
export function usaPoolPorFase(torneo) {
  return torneo.map_pool_mode === 'por_fase' && fasesDelFormato(torneo).length > 0;
}

/**
 * La fase de un partido: los de un grupo son 'grupos'; el resto sale del nombre
 * de la ronda ("Cuartos", "Perdedores · Ronda 2", "Gran final"...).
 * @param {{ group_id?: string | null, label?: string | null }} partido
 */
export function faseDelPartido(partido) {
  if (partido.group_id) return 'grupos';
  const nombre = partido.label ?? '';
  if (/^tercer/i.test(nombre)) return 'tercer';
  if (/^perdedores/i.test(nombre)) return 'perdedores';
  if (/semi/i.test(nombre)) return 'semifinal';
  if (/final/i.test(nombre)) return 'final';
  if (/cuartos/i.test(nombre)) return 'cuartos';
  if (/octavos/i.test(nombre)) return 'octavos';
  return 'ronda';
}

/**
 * Ids de los mapas que se juegan en un partido: los de su fase si el torneo
 * tiene pool por fase y esa fase tiene mapas; si no, el pool base.
 */
export function mapasDelPartido(torneo, partido) {
  const base = torneo.map_ids ?? [];
  if (!partido || !usaPoolPorFase(torneo)) return base;
  const propios = torneo.map_pools?.[faseDelPartido(partido)] ?? [];
  return propios.length ? propios : base;
}

/** Todos los mapas que se pueden jugar en el torneo (pool base y los de cada fase), sin repetir. */
export function todosLosMapas(torneo) {
  const ids = [...(torneo.map_ids ?? [])];
  if (usaPoolPorFase(torneo)) {
    for (const f of fasesDelFormato(torneo)) ids.push(...(torneo.map_pools?.[f] ?? []));
  }
  return [...new Set(ids)];
}

/**
 * `map_pools` limpio para guardar: solo claves de fase conocidas, ids enteros
 * sin repetir y sin fases vacías.
 */
export function poolsLimpios(pools) {
  if (!pools || typeof pools !== 'object' || Array.isArray(pools)) return {};
  const out = {};
  for (const [clave, ids] of Object.entries(pools)) {
    if (!CLAVES.has(clave) || !Array.isArray(ids)) continue;
    const limpios = [...new Set(ids.map((n) => parseInt(String(n), 10)).filter(Number.isInteger))];
    if (limpios.length) out[clave] = limpios;
  }
  return out;
}

/**
 * Lo que falta para que todas las partidas tengan mapas: un texto para mostrar,
 * o null si está todo bien.
 */
export function faltaDeMapas(torneo) {
  const base = torneo.map_ids ?? [];
  if (!usaPoolPorFase(torneo)) return base.length ? null : 'Elegí al menos un mapa.';
  if (base.length) return null;
  const sinMapas = FASES_DE_MAPAS.filter(
    (f) => fasesDelFormato(torneo).includes(f.id) && !(torneo.map_pools?.[f.id] ?? []).length
  );
  return sinMapas.length
    ? `Sin pool base, cada fase necesita sus mapas. Faltan: ${sinMapas.map((f) => f.label).join(', ')}.`
    : null;
}
