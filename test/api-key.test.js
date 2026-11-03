import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { buildStock } from '../server/stock-api.js';

const publicDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public');
let server;
let base;
let db;

before(async () => {
  db = openDb(':memory:');
  server = createServer(createApp({ db, publicDir, log: { error() {} } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, { body, headers = {} } = {}) {
  const h = { ...headers };
  if (method !== 'GET') h['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers: h, body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const bearer = (key) => ({ Authorization: `Bearer ${key}` });

test('sans clé générée, l’API externe est fermée', async () => {
  const r = await call('GET', '/api/v1/stock');
  assert.equal(r.status, 401);
  assert.match(r.data.error, /API désactivée/);
  assert.equal((await call('GET', '/api/v1/stock', { headers: bearer('brn_nimportequoi') })).status, 401);
  assert.equal((await call('GET', '/api/state')).data.settings.api_key_enabled, false);
});

test('génération, utilisation, régénération et révocation de la clé', async () => {
  const created = await call('POST', '/api/api-key');
  assert.equal(created.status, 200);
  const key = created.data.key;
  assert.match(key, /^brn_[\w-]{43}$/);
  assert.equal(created.data.settings.api_key_enabled, true);
  assert.equal(created.data.settings.api_key_hash, undefined); // l'empreinte ne sort jamais
  assert.ok(!JSON.stringify((await call('GET', '/api/state')).data).includes(key));
  assert.ok(!JSON.stringify((await call('GET', '/api/export')).data).includes('api_key'));

  // Sans clé, avec une mauvaise clé, puis avec la bonne (Bearer et X-API-Key)
  assert.match((await call('GET', '/api/v1/stock')).data.error, /manquante/);
  assert.match((await call('GET', '/api/v1/stock', { headers: bearer(`${key}x`) })).data.error, /invalide/);
  const ok = await call('GET', '/api/v1/stock', { headers: bearer(key) });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.version, 1);
  assert.equal((await call('GET', '/api/v1/stock', { headers: { 'X-API-Key': key } })).status, 200);
  assert.ok((await call('GET', '/api/state')).data.settings.api_key_last_used_at);

  const k2 = (await call('POST', '/api/api-key')).data.key;
  assert.notEqual(k2, key);
  assert.equal((await call('GET', '/api/v1/stock', { headers: bearer(key) })).status, 401); // ancienne clé
  assert.equal((await call('GET', '/api/v1/stock', { headers: bearer(k2) })).status, 200);

  assert.equal((await call('DELETE', '/api/api-key')).data.settings.api_key_enabled, false);
  assert.equal((await call('GET', '/api/v1/stock', { headers: bearer(k2) })).status, 401);
});

test('avec mot de passe : la clé ouvre /api/v1 mais pas le reste, la session n’ouvre pas /api/v1', async () => {
  const key = (await call('POST', '/api/api-key')).data.key;
  const { cookie } = await call('PUT', '/api/auth', { body: { new_password: 'secret123' } });
  assert.ok(cookie);
  assert.equal((await call('GET', '/api/state', { headers: bearer(key) })).status, 401);
  assert.equal((await call('POST', '/api/api-key', { headers: bearer(key) })).status, 401);
  assert.equal((await call('GET', '/api/v1/stock', { headers: bearer(key) })).status, 200);
  assert.equal((await call('GET', '/api/v1/stock', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await call('POST', '/api/api-key', { headers: { Cookie: cookie } })).status, 200);
  await call('DELETE', '/api/auth', { body: { current_password: 'secret123' }, headers: { Cookie: cookie } });
  await call('DELETE', '/api/api-key');
});

test('blocage après 5 clés invalides', async () => {
  await call('POST', '/api/api-key');
  for (let i = 0; i < 5; i++) assert.equal((await call('GET', '/api/v1/stock', { headers: bearer('brn_faux') })).status, 401);
  assert.equal((await call('GET', '/api/v1/stock', { headers: bearer('brn_faux') })).status, 429);
});

test('stock : regroupement par aliment, quantités estimées et péremption', () => {
  const spaces = [{ id: 1, name: 'Placard' }, { id: 2, name: 'Frigo' }];
  const base = { state: 'closed', remaining: null, opened_on: null, expires_on: null, category: 'feculents' };
  const products = [
    { ...base, id: 1, name: 'Pâtes', space_id: 1, quantity: 2, unit: 'paquet', expires_on: '2027-01-01' },
    { ...base, id: 2, name: 'pâtes', space_id: 1, quantity: 1, unit: 'paquet', state: 'open', remaining: 50, opened_on: '2026-10-01' },
    { ...base, id: 3, name: 'Pâtes', space_id: 1, quantity: 500, unit: 'g' },
    { ...base, id: 4, name: 'Lait', space_id: 2, quantity: 1, unit: 'brique', category: 'laitier', state: 'open', expires_on: '2026-11-04' },
    { ...base, id: 5, name: 'Yaourt', space_id: 2, quantity: 4, unit: 'unité', category: 'laitier', expires_on: '2026-11-01' },
  ];
  const s = buildStock({ products, spaces, settings: { expiry_days: 3 }, today: '2026-11-03', timezone: 'Europe/Paris' });
  assert.equal(s.items.length, 5);
  assert.deepEqual(s.foods.map((f) => `${f.name}/${f.unit}`), ['Yaourt/unité', 'Lait/brique', 'Pâtes/paquet', 'Pâtes/g']);
  const pates = s.foods.find((f) => f.unit === 'paquet');
  assert.equal(pates.quantity, 3);
  assert.equal(pates.estimated_quantity, 2.5); // ½ paquet ouvert
  assert.equal(pates.open_quantity, 1);
  assert.equal(pates.closed_quantity, 2);
  assert.deepEqual(pates.item_ids, [1, 2]);
  assert.equal(pates.unit_label, 'paquets');
  assert.equal(pates.category_label, 'Pâtes, riz & féculents');
  assert.equal(s.foods[0].expiry_status, 'expired');
  assert.equal(s.foods[0].days_left, -2);
  assert.equal(s.foods[1].expiry_status, 'expiring');
  assert.equal(s.foods[1].estimated_quantity, 1); // ouvert sans niveau indiqué : quantité entière
  assert.equal(s.foods[3].expiry_status, 'unknown');
  assert.deepEqual(s.foods[1].spaces, ['Frigo']);
});
