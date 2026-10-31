// Protection facultative par mot de passe unique (sans utilisateurs ni droits).
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { getSettings, setSettings } from './db.js';

export const COOKIE = 'bernard_sid';
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

export const authEnabled = (db) => Boolean(getSettings(db).auth_password);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => Boolean(req.socket?.encrypted) || String(req.headers['x-forwarded-proto'] || '').startsWith('https');

function cookie(req, value, maxAge) {
  return [
    `${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`,
    ...(isHttps(req) ? ['Secure'] : []),
  ].join('; ');
}

/** Session valide associée à la requête (prolongée si elle a plus d'un jour). */
export function currentSession(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const hash = sha256(token);
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash);
  if (!row) return null;
  const nowMs = Date.now();
  if (Date.parse(row.expires_at) < nowMs) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  const renewAt = Date.parse(row.expires_at) - (SESSION_DAYS - 1) * 86400000;
  if (nowMs > renewAt) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(nowMs + SESSION_DAYS * 86400000).toISOString(), hash);
  }
  return { hash };
}

/** Crée une session et pose le cookie sur la réponse. */
export function startSession(db, req, res) {
  const token = randomBytes(32).toString('base64url');
  const nowMs = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date(nowMs).toISOString());
  db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), new Date(nowMs).toISOString(), new Date(nowMs + SESSION_DAYS * 86400000).toISOString());
  res.setHeader('Set-Cookie', cookie(req, token, SESSION_DAYS * 86400));
}

export function endSession(db, req, res) {
  const session = currentSession(db, req);
  if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.hash);
  res.setHeader('Set-Cookie', cookie(req, '', 0));
}

export function setPassword(db, password) {
  setSettings(db, { auth_password: hashPassword(password) });
  db.exec('DELETE FROM sessions');
}

export function clearPassword(db) {
  db.prepare("DELETE FROM settings WHERE key = 'auth_password'").run();
  db.exec('DELETE FROM sessions');
}

/**
 * Limitation des essais par adresse : après 5 échecs, attente de 30 s,
 * doublée à chaque nouvel échec (15 min maximum).
 */
export function createLimiter() {
  const attempts = new Map();
  return {
    check(ip) {
      const a = attempts.get(ip);
      if (a && a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 1000);
      return 0;
    },
    fail(ip) {
      const a = attempts.get(ip) || { fails: 0, until: 0 };
      a.fails++;
      if (a.fails >= 5) a.until = Date.now() + Math.min(30000 * 2 ** (a.fails - 5), 15 * 60000);
      attempts.set(ip, a);
      if (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
    },
    success(ip) {
      attempts.delete(ip);
    },
  };
}
