// Contrat HTTP public : aucune dépendance aux détails du stockage SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

test('contrat v1 : stock vide, entrées et regroupement disponibles par HTTP', async (t) => {
  const db = openDb(':memory:');
  const server = createServer(createApp({ db, publicDir, log: { error() {} } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, headers: res.headers, data: await res.json() };
  }
  const key = (await request('/api/api-key', { method: 'POST', body: {} })).data.key;
  const headers = { 'X-API-Key': key };
  const empty = await request('/api/v1/stock', { headers });
  assert.equal(empty.status, 200);
  assert.match(empty.headers.get('content-type'), /^application\/json/);
  assert.equal(empty.headers.get('cache-control'), 'no-store');
  assert.equal(empty.data.version, 1);
  assert.deepEqual(empty.data.foods, []);
  assert.deepEqual(empty.data.items, []);
  assert.match(empty.data.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(empty.data.generated_at)));
  assert.equal(typeof empty.data.timezone, 'string');
  assert.equal(typeof empty.data.expiry_days, 'number');

  const spaces = (await request('/api/state')).data.spaces;
  const space = spaces[0];
  const common = { space_id: space.id, unit: 'paquet', category: 'feculents', merge: false };
  const first = await request('/api/products', { method: 'POST', body: { ...common, name: 'Pâtes', quantity: 2, state: 'closed', expires_on: '2000-01-01' } });
  const second = await request('/api/products', { method: 'POST', body: { ...common, name: 'pâtes', quantity: 1, state: 'open', remaining: 50 } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const stock = await request('/api/v1/stock', { headers });
  assert.equal(stock.status, 200);
  assert.equal(stock.data.foods.length, 1);
  assert.equal(stock.data.items.length, 2);
  const food = stock.data.foods[0];
  assert.equal(food.quantity, 3);
  assert.equal(food.estimated_quantity, 2.5);
  assert.equal(food.open_quantity, 1);
  assert.equal(food.closed_quantity, 2);
  assert.equal(food.unit, 'paquet');
  assert.equal(food.category, 'feculents');
  assert.equal(typeof food.category_label, 'string');
  assert.equal(typeof food.unit_label, 'string');
  assert.deepEqual(food.spaces, [space.name]);
  assert.equal(food.next_expiry, '2000-01-01');
  assert.equal(food.expiry_status, 'expired');
  assert.ok(food.days_left < 0);
  assert.deepEqual(new Set(food.item_ids), new Set([first.data.id, second.data.id]));
  const closed = stock.data.items.find((item) => item.id === first.data.id);
  const open = stock.data.items.find((item) => item.id === second.data.id);
  assert.deepEqual({ name: closed.name, category: closed.category, space: closed.space, quantity: closed.quantity, unit: closed.unit, state: closed.state, remaining: closed.remaining, opened_on: closed.opened_on, expires_on: closed.expires_on, expiry_status: closed.expiry_status, estimated_quantity: closed.estimated_quantity },
    { name: 'Pâtes', category: 'feculents', space: space.name, quantity: 2, unit: 'paquet', state: 'closed', remaining: null, opened_on: null, expires_on: '2000-01-01', expiry_status: 'expired', estimated_quantity: 2 });
  assert.equal(typeof closed.category_label, 'string');
  assert.equal(typeof closed.unit_label, 'string');
  assert.ok(closed.days_left < 0);
  assert.equal(open.state, 'open');
  assert.equal(open.remaining, 50);
  assert.equal(open.estimated_quantity, 0.5);
  assert.equal(open.expires_on, null);
  assert.equal(open.days_left, null);
  assert.equal(open.expiry_status, 'unknown');
});
