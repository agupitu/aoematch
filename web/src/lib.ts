import type { Costo } from './types';

export function zonaDelNavegador(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Minúsculas y sin tildes, para que "decan" encuentre "Decán". */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** ¿Alguno de los campos contiene la búsqueda, ignorando tildes y mayúsculas? */
export function coincide(busqueda: string, ...campos: (string | null | undefined)[]): boolean {
  const q = normalizar(busqueda.trim());
  if (!q) return true;
  return campos.some((c) => c && normalizar(c).includes(q));
}

export function fechaCorta(iso: string | null, tz?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: tz,
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Siempre con símbolo: 0 se muestra como $ 0. */
export function monto(centavos: number, moneda: string): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda, maximumFractionDigits: 0 })
    .format(centavos / 100);
}

/** Un costo de inscripción: con centavos solo si los tiene (US$ 12,50). */
export function costo(centavos: number, moneda: string): string {
  const decimales = centavos % 100 ? 2 : 0;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(centavos / 100);
}

/** Los costos de inscripción en una línea ("$ 5.000 o US$ 5", como alternativas); "Gratis" si no hay. */
export function costosEnTexto(costos: Costo[]): string {
  return costos.length ? costos.map((c) => costo(c.amount_cents, c.currency)).join(' o ') : 'Gratis';
}

/** Bolsa que se reparte, según de dónde sale la plata. */
export function bolsaDe(
  modo: string,
  bolsaFijaCents: number,
  recaudadoCents: number,
  porcentaje: number
): number {
  if (modo === 'fijo') return bolsaFijaCents;
  if (modo === 'inscripciones') return Math.round((recaudadoCents * porcentaje) / 100);
  return 0;
}

export const ETIQUETA_POZO: Record<string, string> = {
  ninguno: 'Sin bolsa en plata',
  fijo: 'Monto fijo de la organización',
  inscripciones: 'Lo recaudado en inscripciones',
};

export const ETIQUETA_FORMATO: Record<string, string> = {
  eliminacion_simple: 'Eliminación simple',
  eliminacion_doble: 'Eliminación doble',
  liga: 'Liga (todos contra todos)',
  grupos_playoff: 'Grupos + playoff',
  suizo: 'Sistema suizo',
};

export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  inscripcion: 'Inscripciones abiertas',
  armado: 'Armando equipos',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};

export const ETIQUETA_MAPA: Record<string, string> = {
  fijo: 'Mapa fijo por partida',
  aleatorio: 'Mapa al azar',
  ban_hasta_uno: 'Bans alternados hasta que queda uno',
  ban_pick: 'Bans y después pick',
};

export const ETIQUETA_CIV: Record<string, string> = {
  libre: 'Civ libre (se declara después)',
  aleatorio: 'Civ al azar',
  snake: 'Draft en serpiente',
  ciega: 'Pick ciego simultáneo',
};

export const ETIQUETA_ESTADO_PARTIDO: Record<string, string> = {
  pendiente: 'Pendiente',
  agendado: 'Agendado',
  draft: 'En draft',
  en_juego: 'En juego',
  reportado: 'Reportado',
  finalizado: 'Finalizado',
  walkover: 'Walkover',
};

/** ¿El usuario cerró la ventana de Google? No es un error: no se avisa nada. */
export function popupCerrado(err: unknown): boolean {
  return ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes((err as { code?: string }).code ?? '');
}
