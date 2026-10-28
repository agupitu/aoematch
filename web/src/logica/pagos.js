// Medios de pago de un torneo, sin base de datos. Cada medio trae su costo y su
// moneda, el medio ("Mercado Pago", "PayPal"), el nombre del titular, un alias y
// un link, todos opcionales: un torneo puede cobrar $5.000 por Mercado Pago y
// US$5 por PayPal. Los usan el formulario, la ficha del torneo y la inscripción.
// Las reglas de Firestore aceptan hasta MAX_MEDIOS_DE_PAGO con esa misma forma.
//
//   { amount_cents?: number, currency?: string, method?: string, name?: string, alias?: string, url?: string }
//
// Los torneos de antes tenían un único costo (`entry_fee_cents`, en `currency`)
// para todos los medios: mientras ningún medio traiga costo, ese vale para todos.

/** Cuántos medios de pago puede tener un torneo. */
export const MAX_MEDIOS_DE_PAGO = 5;

/** Para sugerir en el formulario; el campo es libre. */
export const MEDIOS_SUGERIDOS = ['Mercado Pago', 'Transferencia bancaria', 'PayPal', 'Ko-fi', 'Efectivo'];

/** Monedas que ofrece el formulario; la primera es la de siempre. */
export const MONEDAS = ['ARS', 'USD', 'EUR', 'BRL', 'CLP', 'MXN'];

/** Tope de un costo, en centavos (100 millones de pesos): lo que acepta Firestore. */
export const MAX_CENTAVOS = 10_000_000_000;

const LARGOS = { method: 60, name: 100, alias: 100 };
const URL_MIN = 8;
const URL_MAX = 500;

const urlValida = (url) => url.length >= URL_MIN && url.length <= URL_MAX && /^https?:\/\/\S+$/i.test(url);
const monedaDe = (moneda) => (MONEDAS.includes(moneda) ? moneda : MONEDAS[0]);
const centavosValidos = (n) => Number.isSafeInteger(n) && n > 0 && n <= MAX_CENTAVOS;

/** Cómo se llama un medio en pantalla: el medio, si no el nombre, si no el alias; null si no tiene ninguno. */
export function nombreDeMedio(m) {
  for (const campo of ['method', 'name', 'alias']) {
    const v = typeof m?.[campo] === 'string' ? m[campo].trim() : '';
    if (v) return v;
  }
  return null;
}

/**
 * Los centavos de un monto escrito a mano: "5000", "5.000", "5.000,50", "5000,5",
 * "50.5", "$ 5.000". El punto separa miles cuando le siguen tres dígitos; la coma
 * (o un punto con uno o dos dígitos) son los decimales. undefined si está vacío;
 * NaN si no se entiende o se pasa del tope.
 */
export function centavosDe(texto) {
  if (texto === undefined || texto === null) return undefined;
  const crudo = String(texto).trim();
  if (!crudo) return undefined;
  const limpio = crudo.replace(/^(?:US)?\$/i, '').replace(/\s+/g, '');
  const m = /^(\d+|\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(limpio) ?? /^(\d+)\.(\d{1,2})$/.exec(limpio);
  if (!m) return NaN;
  const centavos = Number(m[1].replace(/\./g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return centavos <= MAX_CENTAVOS ? centavos : NaN;
}

/** Los centavos como se escriben en el formulario (lo inverso de `centavosDe`); '' si no hay costo. */
export function montoEscrito(centavos) {
  if (!centavosValidos(centavos)) return '';
  const resto = centavos % 100;
  return `${Math.floor(centavos / 100)}${resto ? `,${String(resto).padStart(2, '0')}` : ''}`;
}

/**
 * Un medio sin campos vacíos ni espacios, recortado, con el costo solo si es un
 * entero positivo y sin link si no es http(s): lo guardado puede venir de
 * cualquiera que edite el torneo y el link termina en un href. null si no queda
 * nada.
 */
function sanear(m) {
  if (!m || typeof m !== 'object') return null;
  const medio = {};
  for (const [campo, max] of Object.entries(LARGOS)) {
    const v = typeof m[campo] === 'string' ? m[campo].trim().slice(0, max) : '';
    if (v) medio[campo] = v;
  }
  const url = typeof m.url === 'string' ? m.url.trim() : '';
  if (urlValida(url)) medio.url = url;
  if (centavosValidos(m.amount_cents)) {
    medio.amount_cents = m.amount_cents;
    medio.currency = monedaDe(m.currency);
  }
  return Object.keys(medio).length ? medio : null;
}

/**
 * Los medios de pago de un torneo guardado: `payment_methods`, o lo que dejaron
 * las versiones anteriores (`payment_links`, con nombre y link, y el
 * `payment_link` único).
 */
export function mediosDePago(torneo) {
  let crudos = [];
  if (Array.isArray(torneo.payment_methods)) crudos = torneo.payment_methods;
  else if (Array.isArray(torneo.payment_links)) crudos = torneo.payment_links.map((l) => ({ method: l?.label, url: l?.url }));
  else if (torneo.payment_link) crudos = [{ method: 'Link de pago', url: torneo.payment_link }];
  return crudos.map(sanear).filter(Boolean).slice(0, MAX_MEDIOS_DE_PAGO);
}

/**
 * Los medios con el costo que tiene cada uno. Si ninguno trae costo pero el
 * torneo es de los de antes (tiene `entry_fee_cents`), ese costo único vale para
 * todos los medios, o es un medio sin más datos si no hay ninguno. Sirve igual
 * con un torneo guardado que con uno ya pasado por acá.
 */
export function mediosConCosto(torneo) {
  const medios = mediosDePago(torneo);
  if (medios.some((m) => m.amount_cents)) return medios;
  if (!centavosValidos(torneo.entry_fee_cents)) return medios;
  const costo = { amount_cents: torneo.entry_fee_cents, currency: monedaDe(torneo.currency) };
  return medios.length ? medios.map((m) => ({ ...m, ...costo })) : [costo];
}

/**
 * Los medios que carga el formulario, listos para guardar: sin campos ni medios
 * vacíos y con el costo (`amount`, escrito a mano) en centavos. Tira un Error si
 * un costo no se entiende, si algún link no es una dirección http(s) o si hay de más.
 */
export function limpiarMediosDePago(medios) {
  const limpios = [];
  medios.forEach((m, i) => {
    const quien = nombreDeMedio(m) ?? `medio ${i + 1}`;
    const url = typeof m?.url === 'string' ? m.url.trim() : '';
    if (url && !urlValida(url)) {
      throw new Error(`El link de «${quien}» tiene que empezar con http:// o https:// (hasta ${URL_MAX} caracteres).`);
    }
    const centavos = centavosDe(m?.amount);
    if (Number.isNaN(centavos)) {
      throw new Error(`El costo de «${quien}» tiene que ser un número, por ejemplo 5000 o 12,50.`);
    }
    const medio = sanear({ ...m, amount_cents: centavos });
    if (medio) limpios.push(medio);
  });
  if (limpios.length > MAX_MEDIOS_DE_PAGO) throw new Error(`Hasta ${MAX_MEDIOS_DE_PAGO} medios de pago.`);
  return limpios;
}

/** Lo que cuesta inscribirse: cada combinación de monto y moneda de los medios, sin repetir. Vacío si es gratis. */
export function costosDe(torneo) {
  const costos = [];
  for (const m of mediosConCosto(torneo)) {
    if (!m.amount_cents) continue;
    if (!costos.some((c) => c.amount_cents === m.amount_cents && c.currency === m.currency)) {
      costos.push({ amount_cents: m.amount_cents, currency: m.currency });
    }
  }
  return costos;
}

/**
 * Por dónde puede haber pagado alguien, para que el staff elija al marcar un
 * pago: cada medio con su nombre y su costo, si lo tiene. Vacío si es gratis.
 */
export function opcionesDePago(torneo) {
  const medios = mediosConCosto(torneo);
  if (!medios.some((m) => m.amount_cents)) return [];
  return medios.map((m) => ({
    method: nombreDeMedio(m),
    ...(m.amount_cents ? { amount_cents: m.amount_cents, currency: m.currency } : {}),
  }));
}

/**
 * Lo que pagó una inscripción: lo que anotó el staff al marcarla paga o, si no
 * anotó nada (se marcó antes de que hubiera costos por medio), el costo del
 * torneo cuando es uno solo. null si no pagó, se retiró o no se sabe cuánto.
 */
export function pagoDe(registro, torneo) {
  if (!registro?.paid || registro.status === 'retirada') return null;
  if (centavosValidos(registro.paid_amount_cents)) {
    const moneda = MONEDAS.includes(registro.paid_currency) ? registro.paid_currency : monedaDe(torneo.currency);
    return { amount_cents: registro.paid_amount_cents, currency: moneda };
  }
  const costos = costosDe(torneo);
  return costos.length === 1 ? { ...costos[0] } : null;
}

/** Lo recaudado por cada moneda, sin mezclarlas, en el orden en que aparecen. */
export function recaudadoPorMoneda(registros, torneo) {
  const totales = [];
  for (const r of registros) {
    const pago = pagoDe(r, torneo);
    if (!pago) continue;
    const fila = totales.find((t) => t.currency === pago.currency);
    if (fila) fila.amount_cents += pago.amount_cents;
    else totales.push({ currency: pago.currency, amount_cents: pago.amount_cents });
  }
  return totales;
}

/** Lo recaudado en una sola moneda (la de los premios, por ejemplo). */
export function recaudadoEn(registros, torneo, moneda) {
  return recaudadoPorMoneda(registros, torneo).find((t) => t.currency === moneda)?.amount_cents ?? 0;
}

/**
 * Lo recaudado en la moneda de los premios sabiendo solo cuántas inscripciones
 * pagaron, para el listado, que no lee las inscripciones: alcanza si el costo es
 * uno solo. null si hay varios, porque no se sabe cuánto pagó cada una.
 */
export function recaudadoEstimado(torneo, pagas) {
  const costos = costosDe(torneo);
  if (costos.length > 1) return null;
  if (!costos.length) return 0;
  return costos[0].currency === monedaDe(torneo.currency) ? pagas * costos[0].amount_cents : 0;
}
