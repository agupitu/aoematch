import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = join(SRC_DIR, '..');
export const ROOT_DIR = join(SERVER_DIR, '..');

const DB_PATH = process.env.AOEMATCH_DB || join(SERVER_DIR, 'data', 'aoematch.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(readFileSync(join(SRC_DIR, 'schema.sql'), 'utf8'));

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

/** `?, ?, ?` para una lista de n elementos. */
export function marks(n) {
  return Array.from({ length: n }, () => '?').join(', ');
}
