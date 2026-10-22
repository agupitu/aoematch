import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = join(SRC_DIR, '..');
export const ROOT_DIR = join(SERVER_DIR, '..');

const DB_PATH = process.env.AOEMATCH_DB || join(SERVER_DIR, 'data', 'aoematch.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

// En el emulador la base la abren a la vez el proceso que descubre las funciones
// y el que atiende pedidos: sin espera, el segundo choca con "database is locked".
export const db = new DatabaseSync(DB_PATH, { timeout: 5000 });
db.exec(readFileSync(join(SRC_DIR, 'schema.sql'), 'utf8'));

// schema.sql solo crea tablas que falten; las columnas agregadas después van acá
// para que una base vieja siga funcionando sin borrarla.
const COLUMNAS_AGREGADAS = [
  ['tournaments', 'prize_pool_mode', "TEXT NOT NULL DEFAULT 'ninguno'"],
  ['tournaments', 'prize_pool_cents', 'INTEGER NOT NULL DEFAULT 0'],
  ['tournaments', 'prize_pool_pct', 'INTEGER NOT NULL DEFAULT 100'],
  ['tournaments', 'prize_notes', 'TEXT'],
  ['tournaments', 'first_map_id', 'INTEGER REFERENCES maps(id)'],
  ['users', 'google_sub', 'TEXT'],
  ['users', 'google_email', 'TEXT'],
];

for (const [tabla, columna, definicion] of COLUMNAS_AGREGADAS) {
  const existe = db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(tabla, columna);
  if (!existe) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
}

/** Una fila, o undefined. */
export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

/** Todas las filas. */
export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

/** INSERT/UPDATE/DELETE. Devuelve { changes, lastInsertRowid }. */
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

/** Ejecuta fn dentro de una transacción. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Usuarios con su horario semanal sacado de la tabla `availability`, con la
 * forma que espera availability.js. Para las rutas que siguen en SQLite.
 */
export function usuariosConHorario(userIds) {
  return userIds.map((id) => ({
    id,
    availability: all('SELECT start_min, end_min FROM availability WHERE user_id = ?', id),
  }));
}

/** `?, ?, ?` para una lista de n elementos. */
export function marks(n) {
  return Array.from({ length: n }, () => '?').join(', ');
}
