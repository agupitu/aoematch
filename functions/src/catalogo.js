// Catálogo fijo de civilizaciones y mapas. Lo genera `npm run assets` en
// functions/data/ y viaja con las funciones: no vive en la base.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

function leer(archivo) {
  return JSON.parse(readFileSync(DATA_DIR + archivo, 'utf8'));
}

// Mismo orden que daba SQLite con ORDER BY name_es (comparación binaria, no por idioma).
const porNombre = (a, b) => (a.name_es < b.name_es ? -1 : a.name_es > b.name_es ? 1 : 0);

const CIVS = leer('civs.json')
  .map(({ id, slug, name_es, name_en, group, flag }) => ({ id, slug, name_es, name_en, grp: group, flag }))
  .sort(porNombre);

const MAPAS = leer('maps.json')
  .map(({ id, slug, name_es, img }) => ({ id, slug, name_es, img }))
  .sort(porNombre);

const CIV_POR_ID = new Map(CIVS.map((c) => [c.id, c]));
const MAPA_POR_ID = new Map(MAPAS.map((m) => [m.id, m]));

/** Todas las civs, ordenadas por nombre. */
export const civs = () => CIVS;

/** Todos los mapas, ordenados por nombre. */
export const maps = () => MAPAS;

export const civPorId = (id) => CIV_POR_ID.get(Number(id)) ?? null;

export const mapaPorId = (id) => MAPA_POR_ID.get(Number(id)) ?? null;
