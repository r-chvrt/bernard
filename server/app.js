import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import {
  transaction, now, getSettings, setSettings, publicSettings, webhookUrl,
  listSpaces, listProducts, getProduct, listHistory, rememberName, insertProduct,
} from './db.js';
import { CATEGORIES, CATEGORY_IDS, REMAINING_LEVELS, guessCategory } from '../public/catalog.js';
import { UNITS, UNIT_IDS } from './units.js';
import { isValidDate, isValidTimeZone, localParts } from './dates.js';
import { isDiscordWebhook, sendWebhook, runDigest, WebhookError } from './alerts.js';
import { loadDemo } from './demo.js';
import {
  authEnabled, currentSession, startSession, endSession, setPassword, clearPassword, verifyPassword, createLimiter,
} from './auth.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (message) => new HttpError(400, message);
const notFound = (message = 'Introuvable') => new HttpError(404, message);

/* ---------- Validation ---------- */

const cleanName = (v, max = 80) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!s) throw bad('Le nom est obligatoire');
  if (s.length > max) throw bad(`Le nom ne doit pas dépasser ${max} caractères`);
  return s;
};

const cleanQuantity = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw bad('La quantité doit être supérieure à 0');
  if (n > 100000) throw bad('Quantité trop grande');
  return Math.round(n * 1000) / 1000;
};

const cleanDate = (v, label) => {
  if (v === null || v === undefined || v === '') return null;
  if (!isValidDate(v)) throw bad(`${label} invalide`);
  return v;
};

function cleanProduct(db, body, current = {}) {
  const p = { ...current, ...body };
  const out = {
    name: cleanName(p.name),
    space_id: Number(p.space_id),
    quantity: cleanQuantity(p.quantity),
    unit: p.unit || 'unité',
    state: p.state,
    expires_on: cleanDate(p.expires_on, 'Date de péremption'),
    opened_on: cleanDate(p.opened_on, "Date d'ouverture"),
    category: CATEGORY_IDS.has(p.category) ? p.category : guessCategory(p.name),
    remaining: p.remaining === undefined || p.remaining === null || p.remaining === '' ? null : Number(p.remaining),
  };
  if (out.remaining !== null && (!Number.isInteger(out.remaining) || out.remaining < 1 || out.remaining > 100)) {
    throw bad('Le reste doit être un pourcentage entre 1 et 100');
  }
  // Un produit entamé n'est pas « plein » : 100 % (anciens exports) équivaut à « non indiqué ».
  if (out.remaining === 100) out.remaining = null;
  if (!db.prepare('SELECT 1 FROM spaces WHERE id = ?').get(out.space_id)) throw bad('Espace de rangement inconnu');
  if (!UNIT_IDS.has(out.unit)) throw bad('Unité inconnue');
  if (out.state !== 'open' && out.state !== 'closed') throw bad("L'état doit être « ouvert » ou « fermé »");
  if (out.state === 'closed') {
    out.opened_on = null;
    out.remaining = null;
  }
  return out;
}

/** Entrée existante identique (même nom, espace, unité, état, dates et reste) avec laquelle fusionner. */
function findTwin(db, p, excludeId = 0) {
  return db
    .prepare(
      `SELECT * FROM products
       WHERE name = ? COLLATE NOCASE AND space_id = ? AND unit = ? AND state = ?
         AND expires_on IS ? AND opened_on IS ? AND remaining IS ? AND id <> ?
       ORDER BY id LIMIT 1`,
    )
    .get(p.name, p.space_id, p.unit, p.state, p.expires_on, p.opened_on, p.remaining ?? null, excludeId);
}

/* ---------- Routes ---------- */

const routes = [];
// `open: true` : route accessible sans être connecté quand le mot de passe est activé.
const route = (method, path, handler, { maxBody = 100_000, open = false } = {}) => {
  const keys = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '(\\d+)'))}$`);
  routes.push({ method, re, keys, handler, maxBody, open });
};
/** Valeur renvoyée par un gestionnaire qui a déjà écrit la réponse lui-même. */
const SENT = Symbol('sent');

function state(db) {
  const settings = getSettings(db);
  const tz = isValidTimeZone(settings.timezone) ? settings.timezone : 'UTC';
  return {
    spaces: listSpaces(db),
    products: listProducts(db),
    history: listHistory(db),
    units: UNITS,
    categories: CATEGORIES,
    remaining_levels: REMAINING_LEVELS,
    settings: publicSettings(settings),
    today: localParts(tz).date,
  };
}

route('GET', '/api/health', () => ({ ok: true }), { open: true });

/* Connexion (mot de passe unique, facultatif) */

const cleanPassword = (v) => {
  if (typeof v !== 'string' || v.length < 6) throw bad('Le mot de passe doit contenir au moins 6 caractères');
  if (v.length > 200) throw bad('Mot de passe trop long');
  return v;
};

route('POST', '/api/login', ({ db, body, req, res, limiter }) => {
  if (!authEnabled(db)) return { ok: true };
  const ip = req.socket.remoteAddress || '?';
  const wait = limiter.check(ip);
  if (wait) throw new HttpError(429, `Trop de tentatives : réessayez dans ${wait} s`);
  if (!verifyPassword(String(body.password ?? ''), getSettings(db).auth_password)) {
    limiter.fail(ip);
    throw new HttpError(401, 'Mot de passe incorrect');
  }
  limiter.success(ip);
  startSession(db, req, res);
  return { ok: true };
}, { open: true });

route('POST', '/api/logout', ({ db, req, res }) => {
  endSession(db, req, res);
  return { ok: true };
}, { open: true });

/** Vérifie le mot de passe actuel avant toute modification de la protection. */
function checkCurrent(db, body) {
  const stored = getSettings(db).auth_password;
  if (stored && !verifyPassword(String(body.current_password ?? ''), stored)) throw bad('Mot de passe actuel incorrect');
}

route('PUT', '/api/auth', ({ db, body, req, res }) => {
  checkCurrent(db, body);
  setPassword(db, cleanPassword(body.new_password));
  // Les autres appareils sont déconnectés ; celui-ci reste connecté.
  startSession(db, req, res);
  return { settings: publicSettings(getSettings(db)) };
});

route('DELETE', '/api/auth', ({ db, body, req, res }) => {
  checkCurrent(db, body);
  clearPassword(db);
  endSession(db, req, res);
  return { settings: publicSettings(getSettings(db)) };
});
route('GET', '/api/state', ({ db }) => state(db));

/* Espaces */

route('POST', '/api/spaces', ({ db, body }) => {
  const name = cleanName(body.name, 40);
  if (db.prepare('SELECT 1 FROM spaces WHERE name = ?').get(name)) throw bad('Cet espace existe déjà');
  const { pos } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM spaces').get();
  const id = Number(db.prepare('INSERT INTO spaces (name, position) VALUES (?, ?)').run(name, pos).lastInsertRowid);
  return { id };
});

route('PATCH', '/api/spaces/:id', ({ db, params, body }) => {
  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(params.id);
  if (!space) throw notFound('Espace introuvable');
  if (body.name !== undefined) {
    const name = cleanName(body.name, 40);
    if (db.prepare('SELECT 1 FROM spaces WHERE name = ? AND id <> ?').get(name, params.id)) throw bad('Cet espace existe déjà');
    db.prepare('UPDATE spaces SET name = ? WHERE id = ?').run(name, params.id);
  }
  if (body.move === 'up' || body.move === 'down') {
    transaction(db, () => {
      const ids = listSpaces(db).map((s) => s.id);
      const i = ids.indexOf(params.id);
      const j = body.move === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      const upd = db.prepare('UPDATE spaces SET position = ? WHERE id = ?');
      ids.forEach((id, pos) => upd.run(pos, id));
    });
  }
  return { ok: true };
});

route('DELETE', '/api/spaces/:id', ({ db, params, query }) => {
  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(params.id);
  if (!space) throw notFound('Espace introuvable');
  return transaction(db, () => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM products WHERE space_id = ?').get(params.id);
    if (n > 0) {
      const action = query.get('products');
      if (action === 'move') {
        const target = Number(query.get('target'));
        if (target === params.id || !db.prepare('SELECT 1 FROM spaces WHERE id = ?').get(target)) {
          throw bad('Choisissez un autre espace de destination');
        }
        db.prepare('UPDATE products SET space_id = ?, updated_at = ? WHERE space_id = ?').run(target, now(), params.id);
      } else if (action === 'delete') {
        db.prepare('DELETE FROM products WHERE space_id = ?').run(params.id);
      } else {
        throw new HttpError(409, `Cet espace contient ${n} produit(s) : déplacez-les ou confirmez leur suppression`);
      }
    }
    db.prepare('DELETE FROM spaces WHERE id = ?').run(params.id);
    return { ok: true, affected: n };
  });
});

/* Produits */

route('POST', '/api/products', ({ db, body }) => {
  const p = cleanProduct(db, body);
  return transaction(db, () => {
    rememberName(db, p.name, p.unit, p.category);
    const twin = body.merge === false ? null : findTwin(db, p);
    if (twin) {
      const quantity = cleanQuantity(twin.quantity + p.quantity);
      db.prepare('UPDATE products SET quantity = ?, updated_at = ? WHERE id = ?').run(quantity, now(), twin.id);
      return { id: twin.id, merged: true };
    }
    return { id: insertProduct(db, p), merged: false };
  });
});

route('PATCH', '/api/products/:id', ({ db, params, body }) => {
  const current = getProduct(db, params.id);
  if (!current) throw notFound('Produit introuvable');
  const p = cleanProduct(db, body, current);
  return transaction(db, () => {
    db.prepare(
      `UPDATE products SET name = ?, space_id = ?, quantity = ?, unit = ?, state = ?, expires_on = ?, opened_on = ?,
         category = ?, remaining = ?, updated_at = ?
       WHERE id = ?`,
    ).run(p.name, p.space_id, p.quantity, p.unit, p.state, p.expires_on, p.opened_on, p.category, p.remaining, now(), params.id);
    if (p.name !== current.name || p.unit !== current.unit || p.category !== current.category) {
      rememberName(db, p.name, p.unit, p.category);
    }
    return { id: params.id };
  });
});

route('DELETE', '/api/products/:id', ({ db, params }) => {
  const { changes } = db.prepare('DELETE FROM products WHERE id = ?').run(params.id);
  if (!changes) throw notFound('Produit introuvable');
  return { ok: true };
});

/**
 * Ouvre une partie d'un stock fermé : diminue la quantité fermée et crée
 * (ou complète) l'entrée ouverte correspondante.
 */
route('POST', '/api/products/:id/open', ({ db, params, body }) => {
  const src = getProduct(db, params.id);
  if (!src) throw notFound('Produit introuvable');
  if (src.state !== 'closed') throw bad('Ce produit est déjà ouvert');
  const qty = cleanQuantity(body.quantity ?? Math.min(1, src.quantity));
  if (qty > src.quantity + 1e-9) throw bad(`Il n'y a que ${src.quantity} ${src.unit} en stock`);
  const opened_on = cleanDate(body.opened_on, "Date d'ouverture");

  return transaction(db, () => {
    const ts = now();
    // Un produit fraîchement ouvert est plein : pas de niveau de reste indiqué.
    const target = { ...src, state: 'open', opened_on, remaining: null };
    const twin = findTwin(db, target, src.id);
    const left = Math.round((src.quantity - qty) * 1000) / 1000;
    let openId;
    if (twin) {
      db.prepare('UPDATE products SET quantity = ?, updated_at = ? WHERE id = ?').run(cleanQuantity(twin.quantity + qty), ts, twin.id);
      openId = twin.id;
    } else if (left <= 0) {
      // Tout le stock est ouvert : on transforme l'entrée elle-même.
      db.prepare("UPDATE products SET state = 'open', opened_on = ?, updated_at = ? WHERE id = ?").run(opened_on, ts, src.id);
      return { open_id: src.id, closed_id: null };
    } else {
      openId = insertProduct(db, { ...target, quantity: qty, created_at: undefined }, ts);
    }
    if (left <= 0) {
      db.prepare('DELETE FROM products WHERE id = ?').run(src.id);
      return { open_id: openId, closed_id: null };
    }
    db.prepare('UPDATE products SET quantity = ?, updated_at = ? WHERE id = ?').run(left, ts, src.id);
    return { open_id: openId, closed_id: src.id };
  });
});

route('POST', '/api/demo', ({ db }) => {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
  if (n > 0) throw bad("Les exemples ne peuvent être chargés que lorsque le stock est vide");
  const settings = getSettings(db);
  const tz = isValidTimeZone(settings.timezone) ? settings.timezone : 'UTC';
  return { inserted: loadDemo(db, localParts(tz).date) };
});


/* Administration : export, import, purge */

const EXPORT_FORMAT = 'bernard-export';
const EXPORTABLE_SETTINGS = ['alert_expiring', 'alert_expired', 'alert_open', 'expiry_days', 'open_days',
  'frequency', 'weekday', 'time', 'timezone', 'skip_unchanged'];

route('GET', '/api/export', ({ db, res }) => {
  const spaces = listSpaces(db);
  const spaceName = new Map(spaces.map((s) => [s.id, s.name]));
  const settings = getSettings(db);
  const data = {
    format: EXPORT_FORMAT,
    version: 1,
    exported_at: now(),
    spaces: spaces.map((s) => ({ name: s.name })),
    products: listProducts(db).map((p) => ({
      name: p.name, space: spaceName.get(p.space_id), category: p.category, quantity: p.quantity, unit: p.unit,
      state: p.state, remaining: p.remaining, expires_on: p.expires_on, opened_on: p.opened_on, created_at: p.created_at,
    })),
    history: listHistory(db),
    // L'URL du webhook n'est jamais exportée.
    settings: Object.fromEntries(EXPORTABLE_SETTINGS.map((k) => [k, settings[k]])),
  };
  const day = new Date().toISOString().slice(0, 10);
  send(res, 200, JSON.stringify(data, null, 2), {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="bernard-export-${day}.json"`,
    'Cache-Control': 'no-store',
  });
  return SENT;
});

route('POST', '/api/import', ({ db, body }) => {
  const { data, mode } = body;
  if (mode !== 'replace' && mode !== 'merge') throw bad('Mode d’import invalide');
  if (!data || data.format !== EXPORT_FORMAT || !Array.isArray(data.products)) {
    throw bad('Ce fichier n’est pas un export de Bernard');
  }
  if (data.products.length > 20000) throw bad('Fichier trop volumineux');

  return transaction(db, () => {
    if (mode === 'replace') db.exec('DELETE FROM products; DELETE FROM name_history; DELETE FROM spaces;');
    const spaceIds = new Map(listSpaces(db).map((s) => [s.name.toLowerCase(), s.id]));
    let createdSpaces = 0;
    const ensureSpace = (rawName) => {
      const name = cleanName(rawName || 'Sans espace', 40);
      const key = name.toLowerCase();
      if (!spaceIds.has(key)) {
        const { pos } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM spaces').get();
        spaceIds.set(key, Number(db.prepare('INSERT INTO spaces (name, position) VALUES (?, ?)').run(name, pos).lastInsertRowid));
        createdSpaces++;
      }
      return spaceIds.get(key);
    };
    for (const s of Array.isArray(data.spaces) ? data.spaces : []) ensureSpace(s?.name);

    const ts = now();
    data.products.forEach((raw, i) => {
      try {
        if (!raw || typeof raw !== 'object') throw bad('entrée invalide');
        const p = cleanProduct(db, { ...raw, space_id: ensureSpace(raw.space) });
        const created = typeof raw.created_at === 'string' && !Number.isNaN(Date.parse(raw.created_at)) ? raw.created_at : ts;
        insertProduct(db, { ...p, created_at: created }, ts);
      } catch (err) {
        throw bad(`Produit n° ${i + 1} (${String(raw?.name ?? '?').slice(0, 40)}) : ${err.message}`);
      }
    });
    for (const h of Array.isArray(data.history) ? data.history : []) {
      if (typeof h?.name === 'string' && h.name.trim() && UNIT_IDS.has(h.unit)) {
        rememberName(db, cleanName(h.name), h.unit, CATEGORY_IDS.has(h.category) ? h.category : null);
      }
    }
    if (mode === 'replace' && data.settings && typeof data.settings === 'object') {
      // Chaque réglage valide est repris ; les valeurs invalides sont ignorées.
      for (const k of EXPORTABLE_SETTINGS) {
        if (data.settings[k] === undefined) continue;
        try {
          setSettings(db, cleanSettings({ [k]: data.settings[k] }));
        } catch { /* ignoré */ }
      }
    }
    return { products: data.products.length, spaces_created: createdSpaces };
  });
}, { maxBody: 10_000_000 });

route('POST', '/api/purge', ({ db, body }) => {
  if (body.confirm !== 'PURGER') throw bad('Tapez PURGER pour confirmer');
  if (body.scope !== 'products' && body.scope !== 'all') throw bad('Type de purge invalide');
  return transaction(db, () => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
    db.exec('DELETE FROM products');
    if (body.scope === 'all') {
      db.exec(`DELETE FROM name_history; DELETE FROM spaces; DELETE FROM settings; DELETE FROM sessions;
        INSERT INTO spaces (name, position) VALUES ('Placard', 0), ('Frigo', 1), ('Congélateur', 2);`);
    }
    return { deleted: n };
  });
});

/* Paramètres & notifications */

function cleanSettings(body) {
  const out = {};
  for (const key of ['alert_expiring', 'alert_expired', 'alert_open', 'skip_unchanged']) {
    if (body[key] !== undefined) out[key] = Boolean(body[key]);
  }
  for (const [key, min, max] of [['expiry_days', 0, 365], ['open_days', 1, 365], ['weekday', 1, 7]]) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < min || n > max) throw bad(`Valeur invalide pour ${key} (entre ${min} et ${max})`);
    out[key] = n;
  }
  if (body.frequency !== undefined) {
    if (!['daily', 'weekly'].includes(body.frequency)) throw bad('Fréquence invalide');
    out.frequency = body.frequency;
  }
  if (body.time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) throw bad('Heure invalide (format HH:MM)');
    out.time = body.time;
  }
  if (body.timezone !== undefined) {
    if (!isValidTimeZone(body.timezone)) throw bad('Fuseau horaire inconnu');
    out.timezone = body.timezone;
  }
  if (body.webhook_url !== undefined && body.webhook_url !== '') {
    if (!isDiscordWebhook(body.webhook_url)) throw bad("L'URL ne ressemble pas à un webhook Discord (https://discord.com/api/webhooks/…)");
    out.webhook_url = body.webhook_url.trim();
  }
  if (body.clear_webhook === true) out.webhook_url = '';
  return out;
}

route('PUT', '/api/settings', ({ db, body }) => {
  const values = cleanSettings(body);
  // Changer la planification autorise un nouvel envoi aujourd'hui.
  if (['frequency', 'weekday', 'time', 'timezone'].some((k) => k in values)) values.last_digest_period = '';
  setSettings(db, values);
  return { settings: publicSettings(getSettings(db)) };
});

route('POST', '/api/notifications/test', async ({ db, body }) => {
  let url = webhookUrl(getSettings(db));
  if (body.webhook_url) {
    if (!isDiscordWebhook(body.webhook_url)) throw bad("L'URL ne ressemble pas à un webhook Discord");
    url = body.webhook_url;
  }
  if (!url) throw bad("Renseignez d'abord l'URL du webhook");
  await sendWebhook(url, {
    username: 'Bernard',
    content: '✅ **Test réussi** : les alertes du stock alimentaire arriveront ici.',
    allowed_mentions: { parse: [] },
  });
  return { ok: true };
});

route('POST', '/api/notifications/send', async ({ db }) => runDigest(db, { force: true }));

/* ---------- Serveur HTTP ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const sendJson = (res, status, data) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

async function readBody(req, maxBody) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBody) throw new HttpError(413, 'Requête trop volumineuse');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    throw bad('JSON invalide');
  }
}

export function createApp({ db, publicDir, log = console }) {
  const limiter = createLimiter();

  async function serveStatic(req, res, pathname, loggedIn) {
    let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    // Sans session valide, la page de l'application est remplacée par la page de connexion.
    // Les autres fichiers statiques ne contiennent aucune donnée : toutes les données passent par l'API.
    if (rel === 'login.html' && loggedIn) {
      return send(res, 302, '', { Location: '/' });
    }
    if (rel === 'index.html' && !loggedIn) rel = 'login.html';
    const file = normalize(join(publicDir, rel));
    if (!file.startsWith(publicDir + sep)) return send(res, 403, 'Interdit');
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error();
      const data = await readFile(file);
      send(res, 200, req.method === 'HEAD' ? undefined : data, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
    } catch {
      send(res, 404, 'Introuvable', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      const loggedIn = !authEnabled(db) || Boolean(currentSession(db, req));
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');
        return await serveStatic(req, res, url.pathname, loggedIn);
      }
      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      // Exiger du JSON bloque les requêtes inter-sites de formulaires simples (CSRF).
      if (mutating && !String(req.headers['content-type'] || '').startsWith('application/json')) {
        throw new HttpError(415, 'Content-Type application/json attendu');
      }
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.re);
        if (!m) continue;
        if (!loggedIn && !r.open) {
          return sendJson(res, 401, { error: 'Connexion requise', auth_required: true });
        }
        const params = Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])]));
        const body = mutating ? await readBody(req, r.maxBody) : {};
        const result = await r.handler({ db, params, body, query: url.searchParams, req, res, limiter });
        if (result !== SENT) sendJson(res, 200, result);
        return;
      }
      throw notFound('Route inconnue');
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      if (err instanceof WebhookError) return sendJson(res, 502, { error: err.message });
      log.error?.(`[erreur] ${req.method} ${url.pathname} : ${err?.message}`);
      return sendJson(res, 500, { error: 'Erreur interne du serveur' });
    }
  };
}
