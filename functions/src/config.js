// Configuración de las funciones en producción. Firebase pide los valores al
// desplegar y en ejecución llegan como variables de entorno con el mismo nombre
// (process.env.PUBLIC_URL, process.env.STEAM_API_KEY), que es como las lee el
// código. En los emuladores no hacen falta.

import { defineSecret, defineString } from 'firebase-functions/params';

/**
 * Origen que ve el navegador, por ejemplo https://aoe3draft.com. Vacío, se
 * deduce del pedido (sirve con el dominio de Firebase). Con dominio propio
 * conviene fijarlo (T31) para que la vuelta de Steam sea a ese dominio.
 */
export const PUBLIC_URL = defineString('PUBLIC_URL', {
  default: '',
  description: 'Origen público de la página (vacío: se deduce del pedido).',
});

/**
 * Clave de la API web de Steam, solo para traer nombre y avatar al entrar con
 * Steam. Va en Secret Manager: `firebase functions:secrets:set STEAM_API_KEY`.
 * Sin una clave válida el ingreso con Steam igual funciona.
 */
export const STEAM_API_KEY = defineSecret('STEAM_API_KEY');
