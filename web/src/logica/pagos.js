// Medios de pago de un torneo, sin base de datos. Cada medio puede traer el medio
// ("Mercado Pago", "Transferencia"), el nombre del titular, un alias y un link,
// todos opcionales. Los usan el formulario, la ficha del torneo y la
// inscripción. Las reglas de Firestore aceptan hasta MAX_MEDIOS_DE_PAGO con esa
// misma forma.
//
//   { method?: string, name?: string, alias?: string, url?: string }

/** Cuántos medios de pago puede tener un torneo. */
export const MAX_MEDIOS_DE_PAGO = 5;

/** Para sugerir en el formulario; el campo es libre. */
export const MEDIOS_SUGERIDOS = ['Mercado Pago', 'Transferencia bancaria', 'PayPal', 'Ko-fi', 'Efectivo'];

const LARGOS = { method: 60, name: 100, alias: 100 };
const URL_MIN = 8;
const URL_MAX = 500;

const urlValida = (url) => url.length >= URL_MIN && url.length <= URL_MAX && /^https?:\/\/\S+$/i.test(url);

/**
 * Un medio sin campos vacíos ni espacios, recortado, y sin link si no es
 * http(s): lo guardado puede venir de cualquiera que edite el torneo y el link
 * termina en un href. null si no queda nada.
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
 * Los medios que carga el formulario, listos para guardar: sin campos ni medios
 * vacíos. Tira un Error si algún link no es una dirección http(s) o si hay de más.
 */
export function limpiarMediosDePago(medios) {
  const limpios = [];
  medios.forEach((m, i) => {
    const url = typeof m?.url === 'string' ? m.url.trim() : '';
    if (url && !urlValida(url)) {
      const quien = [m.method, m.name, m.alias].map((v) => String(v ?? '').trim()).find(Boolean) ?? `medio ${i + 1}`;
      throw new Error(`El link de «${quien}» tiene que empezar con http:// o https:// (hasta ${URL_MAX} caracteres).`);
    }
    const medio = sanear(m);
    if (medio) limpios.push(medio);
  });
  if (limpios.length > MAX_MEDIOS_DE_PAGO) throw new Error(`Hasta ${MAX_MEDIOS_DE_PAGO} medios de pago.`);
  return limpios;
}
