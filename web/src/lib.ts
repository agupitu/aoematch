export const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const MINUTOS_SEMANA = 7 * 24 * 60;
export const BLOQUE = 30;

/** Minutos a sumarle a UTC para obtener la hora local de esa zona, hoy. */
export function offsetZona(tz: string, ref = new Date()): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(fmt.formatToParts(ref).map((x) => [x.type, x.value]));
    const comoUtc = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour) % 24, Number(p.minute), Number(p.second)
    );
    return Math.round((comoUtc - ref.getTime()) / 60000);
  } catch {
    return 0;
  }
}

export function zonaDelNavegador(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Convierte un minuto de la semana UTC al minuto de la semana en zona local. */
export const utcALocal = (min: number, offset: number) => mod(min + offset, MINUTOS_SEMANA);
export const localAUtc = (min: number, offset: number) => mod(min - offset, MINUTOS_SEMANA);

export function etiquetaSemana(min: number, offset = 0): string {
  const local = utcALocal(min, offset);
  const dia = Math.floor(local / 1440);
  const h = Math.floor((local % 1440) / 60);
  const m = local % 60;
  return `${DIAS[dia]} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function rangoSemana(start: number, end: number, offset = 0): string {
  const a = etiquetaSemana(start, offset);
  const b = etiquetaSemana(end, offset).split(' ')[1];
  return `${a}–${b}`;
}

export function fechaCorta(iso: string | null, tz?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: tz,
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export function plata(centavos: number, moneda: string): string {
  if (!centavos) return 'Gratis';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda, maximumFractionDigits: 0 })
    .format(centavos / 100);
}

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

export const ETIQUETA_PASO: Record<string, string> = {
  ban_mapa: 'Banear mapa',
  pick_mapa: 'Elegir mapa',
  ban_civ: 'Banear civilización',
  pick_civ: 'Elegir civilización',
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

export function horas(min: number | null | undefined): string {
  if (min == null) return '—';
  if (min === 0) return 'sin cruce';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
