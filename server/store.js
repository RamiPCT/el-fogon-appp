// Almacenamiento en SQLite (incluido en Node ≥ 22.5, sin dependencias ni coste).
//
// - Un único archivo: DATA_DIR/fogon.sqlite (modo WAL, transacciones ACID).
// - Las colecciones de siempre (mesas, carta, pedidos, reservas…) se guardan como filas
//   JSON en la tabla `docs`: el código existente no cambia y cada guardado es una transacción.
// - Los módulos nuevos (empleados, auditoría y, más adelante, pagos, caja y facturas) usan
//   tablas relacionales con restricciones.
// - SQL estándar para poder pasar a PostgreSQL en el futuro (docs.data → JSONB).
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (_) {
  console.error('\n❌ Esta versión de Node no incluye SQLite. Instala Node 22.13 o superior (https://nodejs.org) y vuelve a ejecutar «npm start».\n');
  process.exit(1);
}

const SCHEMA_VERSION = 1;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS docs (
     coll TEXT NOT NULL,
     id   TEXT NOT NULL,
     pos  INTEGER NOT NULL DEFAULT 0,
     data TEXT NOT NULL,
     PRIMARY KEY (coll, id)
   )`,
  `CREATE INDEX IF NOT EXISTS docs_coll_pos ON docs (coll, pos)`,
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS employees (
     id            TEXT PRIMARY KEY,
     name          TEXT NOT NULL,
     username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL,
     role          TEXT NOT NULL,
     active        INTEGER NOT NULL DEFAULT 1,
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL,
     last_login_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     at            TEXT NOT NULL,
     employee_id   TEXT,
     employee_name TEXT,
     action        TEXT NOT NULL,
     entity        TEXT,
     entity_id     TEXT,
     before        TEXT,
     after         TEXT,
     result        TEXT NOT NULL DEFAULT 'ok',
     ip            TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS audit_at ON audit_log (at)`,
  `CREATE INDEX IF NOT EXISTS audit_entity ON audit_log (entity, entity_id)`,
  // La auditoría es de solo escritura: nadie puede modificarla ni borrarla
  `CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
     BEGIN SELECT RAISE(ABORT, 'El historial de actividad no se puede modificar'); END`,
  `CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
     BEGIN SELECT RAISE(ABORT, 'El historial de actividad no se puede borrar'); END`
];

function open(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function integrityOk(db) {
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    return row && Object.values(row)[0] === 'ok';
  } catch (_) {
    return false;
  }
}

function migrateSchema(db) {
  db.exec('BEGIN');
  try {
    for (const sql of SCHEMA) db.exec(sql);
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('schema_version', String(SCHEMA_VERSION));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Ejecuta fn dentro de una transacción (todo o nada)
const inTx = new WeakSet();
function tx(db, fn) {
  if (inTx.has(db)) return fn(); // transacción anidada: forma parte de la exterior
  db.exec('BEGIN IMMEDIATE');
  inTx.add(db);
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ya deshecha */ }
    throw err;
  } finally {
    inTx.delete(db);
  }
}

module.exports = { open, integrityOk, migrateSchema, tx, SCHEMA_VERSION };
