// Links de pago de un torneo, sin base de datos: cada uno lleva un nombre ("Mercado
// Pago", "PayPal") y una dirección http(s). Los usan el formulario, la ficha del
// torneo y la inscripción. Las reglas de Firestore aceptan hasta
// MAX_LINKS_DE_PAGO con esa misma forma.

/** Cuántos links de pago puede tener un torneo. */
export const MAX_LINKS_DE_PAGO = 5;

/** Nombre de un link al que el organizador no le puso uno (y del `payment_link` único de antes). */
export const NOMBRE_POR_DEFECTO = 'Pagar acá';

/** Los links de un torneo guardado: `payment_links`, o el `payment_link` único de antes. */
export function linksDePago(torneo) {
  if (Array.isArray(torneo.payment_links)) return torneo.payment_links;
  return torneo.payment_link ? [{ label: NOMBRE_POR_DEFECTO, url: torneo.payment_link }] : [];
}

/** Lo que dice el link en pantalla: "Pagar con Mercado Pago", o "Pagar acá" si no tiene nombre. */
export const textoDelLink = (link) => (link.label === NOMBRE_POR_DEFECTO ? NOMBRE_POR_DEFECTO : `Pagar con ${link.label}`);

/**
 * Los links que carga el formulario, listos para guardar: sin filas vacías ni
 * espacios, y con "Pagar acá" de nombre al que no lo tiene. Tira un Error si algún
 * link no es una dirección http(s) o si hay de más.
 */
export function limpiarLinksDePago(links) {
  const limpios = [];
  for (const l of links) {
    const label = String(l.label ?? '').trim();
    const url = String(l.url ?? '').trim();
    if (!label && !url) continue;
    if (url.length < 8 || url.length > 500 || !/^https?:\/\/\S+$/i.test(url)) {
      throw new Error(`El link de pago${label ? ` «${label}»` : ''} tiene que empezar con http:// o https://.`);
    }
    limpios.push({ label: (label || NOMBRE_POR_DEFECTO).slice(0, 60), url });
  }
  if (limpios.length > MAX_LINKS_DE_PAGO) throw new Error(`Hasta ${MAX_LINKS_DE_PAGO} links de pago.`);
  return limpios;
}
