// Exemples (POST /api/demo) : chargés une seule fois, dans un stock vide, avec des dates relatives à aujourd'hui.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { loadDemo } from '../server/demo.js';
import { CATEGORY_IDS } from '../public/catalog.js';

const publicDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public');
let server;
let base;

before(async () => {
  server = createServer(createApp({ db: openDb(':memory:'), publicDir, log: { error() {} } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path) => {
  const res = await fetch(base + path, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
  return { status: res.status, data: await res.json() };
};

test('exemples chargés dans un stock vide, puis refusés', async () => {
  const first = await call('POST', '/api/demo');
  assert.equal(first.status, 200);
  assert.equal(first.data.inserted, 18);

  const { data: s } = await call('GET', '/api/state');
  assert.equal(s.products.length, 18);
  assert.deepEqual(s.spaces.map((x) => x.name), ['Placard', 'Frigo', 'Congélateur', 'Cellier']); // espaces existants réutilisés
  for (const p of s.products) {
    assert.ok(CATEGORY_IDS.has(p.category), `${p.name} : catégorie ${p.category} inconnue`);
    if (p.state === 'closed') assert.equal(p.opened_on, null, `${p.name} fermé avec une date d'ouverture`);
  }

  const again = await call('POST', '/api/demo');
  assert.equal(again.status, 400);
  assert.equal(again.data.code, 'demo_stock_not_empty');
  assert.equal((await call('GET', '/api/state')).data.products.length, 18);
});

test('dates des exemples relatives au jour donné', () => {
  const db = openDb(':memory:');
  loadDemo(db, '2026-03-10');
  const ham = db.prepare("SELECT expires_on, opened_on, state FROM products WHERE name = 'Jambon'").get();
  assert.deepEqual({ ...ham }, { expires_on: '2026-03-09', opened_on: '2026-03-07', state: 'open' }); // déjà périmé
  const water = db.prepare("SELECT expires_on FROM products WHERE name = 'Eau gazeuse'").get();
  assert.equal(water.expires_on, null);
});
