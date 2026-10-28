// Calendario del torneo: las fases con sus fechas (inscripción, arranque y cada
// ronda con las fechas que fijó el staff) y los meses que hay que dibujar para
// verlas. Sin base de datos ni DOM: trabaja sobre lo que ya se leyó.

import { diaLocal } from './calendario.js';

const MAX_MESES = 12;
const dosCifras = (n) => String(n).padStart(2, '0');

/** Tipo de fase de una ronda, que decide su color: por la etapa y, en las eliminatorias, por el nombre. */
export function tipoDeRonda(ronda, etapa) {
  if (['grupos', 'liga', 'suizo'].includes(etapa?.type)) return 'grupos';
  const nombre = ronda.label ?? '';
  if (/^perdedores/i.test(nombre)) return 'perdedores';
  if (/final/i.test(nombre) && !/semi/i.test(nombre)) return 'final';
  if (/semi/i.test(nombre)) return 'semifinal';
  if (/cuartos/i.test(nombre)) return 'cuartos';
  if (/octavos/i.test(nombre)) return 'octavos';
  return 'ronda';
}

const aDia = (iso, zona) => (iso ? diaLocal(Date.parse(iso), zona) : null);

/**
 * Las fases del torneo en orden: inscripción, arranque y las rondas. Cada una
 * es `{ id, label, tipo, desde, hasta }` con días 'YYYY-MM-DD' en `zona`;
 * una ronda a la que el staff todavía no le fijó fechas va con `desde` y
 * `hasta` en null (el calendario no la pinta, la leyenda sí).
 * @param {{ reg_opens_at?: string|null, reg_closes_at?: string|null, starts_at?: string|null }} torneo
 * @param {{ id: string, stage_id: string, label: string }[]} rondas de `rondasDelCuadro`
 * @param {Map<string, { from_day: string, to_day: string }>} docs fechas fijadas, por id de ronda
 * @param {{ id: string, name: string, type: string }[]} etapas
 */
export function fasesDelCalendario(torneo, rondas, docs, etapas, zona) {
  const fases = [];

  const cierre = aDia(torneo.reg_closes_at, zona);
  const apertura = aDia(torneo.reg_opens_at, zona) ?? cierre;
  if (apertura) {
    fases.push({ id: 'inscripcion', label: 'Inscripción', tipo: 'inscripcion', desde: apertura, hasta: cierre && cierre > apertura ? cierre : apertura });
  }

  const arranque = aDia(torneo.starts_at, zona);
  if (arranque) fases.push({ id: 'arranque', label: 'Arranca', tipo: 'arranque', desde: arranque, hasta: arranque });

  const etapaDe = new Map(etapas.map((e) => [e.id, e]));
  for (const r of rondas) {
    const etapa = etapaDe.get(r.stage_id);
    const tipo = tipoDeRonda(r, etapa);
    const doc = docs.get(r.id);
    fases.push({
      id: r.id,
      label: tipo === 'grupos' && etapa ? `${etapa.name} · ${r.label}` : r.label,
      tipo,
      desde: doc?.from_day ?? null,
      hasta: doc?.to_day ?? null,
    });
  }
  return fases;
}

const aUtc = (dia) => {
  const [a, m, d] = dia.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
};

/**
 * Los meses que cubren las fases con fechas, de a semanas que empiezan el lunes.
 * Cada mes trae `dias`: el relleno del principio (`null`) y un `{ dia, fases }`
 * por día, con los ids de las fases que lo incluyen. Más de 12 meses se cortan.
 * @returns {{ anio: number, mes: number, dias: ({ dia: string, fases: string[] } | null)[] }[]}
 */
export function mesesDelCalendario(fases) {
  const conFechas = fases.filter((f) => f.desde && f.hasta);
  if (!conFechas.length) return [];

  const primero = conFechas.map((f) => f.desde).sort()[0];
  const ultimo = conFechas.map((f) => f.hasta).sort().at(-1);
  let [anio, mes] = primero.split('-').map(Number);
  const [anioFin, mesFin] = ultimo.split('-').map(Number);

  const meses = [];
  while ((anio < anioFin || (anio === anioFin && mes <= mesFin)) && meses.length < MAX_MESES) {
    const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const lunesPrimero = (new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay() + 6) % 7;
    const dias = Array.from({ length: lunesPrimero }, () => null);
    for (let d = 1; d <= diasDelMes; d++) {
      const dia = `${anio}-${dosCifras(mes)}-${dosCifras(d)}`;
      dias.push({ dia, fases: conFechas.filter((f) => f.desde <= dia && dia <= f.hasta).map((f) => f.id) });
    }
    meses.push({ anio, mes, dias });
    mes++;
    if (mes > 12) { mes = 1; anio++; }
  }
  return meses;
}

/** Rango legible de una fase ('3 nov' o '3 nov – 5 nov') a partir de sus días; null si no tiene fechas. */
export function rangoEnTexto(fase) {
  if (!fase.desde || !fase.hasta) return null;
  const f = (dia) => new Date(aUtc(dia)).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return fase.desde === fase.hasta ? f(fase.desde) : `${f(fase.desde)} – ${f(fase.hasta)}`;
}
