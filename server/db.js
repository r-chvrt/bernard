import { DatabaseSync } from 'node:sqlite';
import { guessCategory } from '../public/catalog.js';

const MIGRATIONS = [
  `
  CREATE TABLE spaces (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
    expires_on TEXT,
    opened_on TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX products_space ON products(space_id);
  -- Noms déjà utilisés : alimente l'autocomplétion même après consommation.
  CREATE TABLE name_history (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    unit TEXT NOT NULL,
    used_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT INTO spaces (name, position) VALUES ('Placard', 0), ('Frigo', 1), ('Congélateur', 2);
  `,
  // v2 : catégories et niveau restant des produits entamés
  `
  ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'autre';
  ALTER TABLE products ADD COLUMN remaining INTEGER CHECK (remaining IS NULL OR (remaining > 0 AND remaining <= 100));
  ALTER TABLE name_history ADD COLUMN category TEXT;
  `,
];

// Traitements JavaScript associés à une migration (exécutés juste après elle).
const POST_MIGRATION = {
  2(db) {
    const upd = db.prepare('UPDATE products SET category = ? WHERE id = ?');
    for (const { id, name } of db.prepare('SELECT id, name FROM products').all()) upd.run(guessCategory(name), id);
  },
};

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      POST_MIGRATION[v + 1]?.(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => new Date().toISOString();

/* ---------- Paramètres ---------- */

export const SETTING_DEFAULTS = {
  webhook_url: '',
  alert_expiring: true,
  alert_expired: true,
  alert_open: true,
  expiry_days: 3,
  open_days: 5,
  frequency: 'daily', // 'daily' | 'weekly'
  weekday: 1, // 1 = lundi … 7 = dimanche (fréquence hebdomadaire)
  time: '09:00',
  timezone: process.env.TZ || 'Europe/Paris',
  skip_unchanged: false,
};

// Clés internes (jamais modifiables via l'API).
export const INTERNAL_KEYS = ['last_digest_period', 'last_digest_signature', 'last_digest_at', 'last_digest_status'];

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...SETTING_DEFAULTS };
  for (const { key, value } of rows) {
    try {
      s[key] = JSON.parse(value);
    } catch {
      /* valeur corrompue : on garde la valeur par défaut */
    }
  }
  return s;
}

export function setSettings(db, values) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const [k, v] of Object.entries(values)) stmt.run(k, JSON.stringify(v));
}

/** URL du webhook effective : la variable d'environnement a priorité. */
export function webhookUrl(settings) {
  return process.env.DISCORD_WEBHOOK_URL || settings.webhook_url || '';
}

/** Paramètres renvoyés au navigateur : l'URL du webhook n'en sort jamais. */
export function publicSettings(settings) {
  const { webhook_url, ...rest } = settings;
  return {
    ...rest,
    webhook_configured: Boolean(webhookUrl(settings)),
    webhook_from_env: Boolean(process.env.DISCORD_WEBHOOK_URL),
  };
}

/* ---------- Lecture ---------- */

export function listSpaces(db) {
  return db
    .prepare(
      `SELECT s.id, s.name, s.position, COUNT(p.id) AS product_count
       FROM spaces s LEFT JOIN products p ON p.space_id = s.id
       GROUP BY s.id ORDER BY s.position, s.name`,
    )
    .all()
    .map((r) => ({ ...r }));
}

export function listProducts(db) {
  return db
    .prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE, id')
    .all()
    .map((r) => ({ ...r }));
}

export function getProduct(db, id) {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  return row ? { ...row } : null;
}

export function listHistory(db) {
  return db
    .prepare('SELECT name, unit, category FROM name_history ORDER BY used_at DESC LIMIT 500')
    .all()
    .map((r) => ({ ...r }));
}

export function rememberName(db, name, unit, category = null) {
  db.prepare(
    `INSERT INTO name_history (name, unit, category, used_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET unit = excluded.unit, category = excluded.category, used_at = excluded.used_at`,
  ).run(name, unit, category, now());
}

export function insertProduct(db, p, ts = now()) {
  return Number(
    db
      .prepare(
        `INSERT INTO products (name, space_id, quantity, unit, state, expires_on, opened_on, category, remaining, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.name, p.space_id, p.quantity, p.unit, p.state, p.expires_on ?? null, p.opened_on ?? null,
        p.category, p.remaining ?? null, p.created_at ?? ts, ts).lastInsertRowid,
  );
}
