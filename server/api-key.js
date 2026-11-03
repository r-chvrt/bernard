// Clé d'API unique pour les applications externes (ex. Lulu) : accès en lecture seule à /api/v1/*.
// Seule l'empreinte SHA-256 est conservée ; la clé n'est affichée qu'une fois, à sa création.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { getSettings, setSettings } from './db.js';

const PREFIX = 'brn_';
const KEYS = ['api_key_hash', 'api_key_hint', 'api_key_created_at', 'api_key_last_used_at'];
// La date de dernière utilisation n'est réécrite qu'au plus une fois par minute.
const TOUCH_MS = 60_000;

const sha256 = (s) => createHash('sha256').update(s).digest();

export const apiKeyEnabled = (settings) => Boolean(settings.api_key_hash);

/** Crée (ou remplace) la clé et la renvoie en clair : c'est la seule fois où elle est visible. */
export function createApiKey(db) {
  const key = PREFIX + randomBytes(32).toString('base64url');
  setSettings(db, {
    api_key_hash: sha256(key).toString('hex'),
    api_key_hint: `${key.slice(0, PREFIX.length + 4)}…${key.slice(-4)}`,
    api_key_created_at: new Date().toISOString(),
    api_key_last_used_at: '',
  });
  return key;
}

export function revokeApiKey(db) {
  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  for (const k of KEYS) del.run(k);
}

/** Clé présentée par la requête : `Authorization: Bearer <clé>` ou `X-API-Key: <clé>`. */
export function presentedKey(req) {
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (m) return m[1];
  const header = req.headers['x-api-key'];
  return typeof header === 'string' && header.trim() ? header.trim() : null;
}

/** Vrai si `key` correspond à la clé enregistrée (comparaison à temps constant). */
export function checkApiKey(db, key) {
  const { api_key_hash: stored, api_key_last_used_at: lastUsed } = getSettings(db);
  if (!stored || typeof key !== 'string' || key.length > 200) return false;
  const expected = Buffer.from(stored, 'hex');
  const actual = sha256(key);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  if (!lastUsed || Date.now() - Date.parse(lastUsed) > TOUCH_MS) {
    setSettings(db, { api_key_last_used_at: new Date().toISOString() });
  }
  return true;
}
