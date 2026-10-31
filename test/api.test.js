import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

const publicDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public');
const WEBHOOK = 'https://discord.com/api/webhooks/123456789/secret-token_ABC';
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

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const state = async () => (await call('GET', '/api/state')).data;

test('espaces par défaut créés au premier lancement', async () => {
  const s = await state();
  assert.deepEqual(s.spaces.map((x) => x.name), ['Placard', 'Frigo', 'Congélateur']);
  assert.equal(s.products.length, 0);
});

test('ajout avec les seuls champs obligatoires et validation', async () => {
  const { spaces } = await state();
  const ok = await call('POST', '/api/products', { name: '  Pâtes ', space_id: spaces[0].id, quantity: 3, state: 'closed' });
  assert.equal(ok.status, 200);
  const p = (await state()).products.find((x) => x.id === ok.data.id);
  assert.equal(p.name, 'Pâtes');
  assert.equal(p.unit, 'unité'); // unité par défaut
  assert.equal(p.expires_on, null);

  assert.equal((await call('POST', '/api/products', { name: '', space_id: spaces[0].id, quantity: 1, state: 'closed' })).status, 400);
  assert.equal((await call('POST', '/api/products', { name: 'Riz', space_id: 999, quantity: 1, state: 'closed' })).status, 400);
  assert.equal((await call('POST', '/api/products', { name: 'Riz', space_id: spaces[0].id, quantity: 0, state: 'closed' })).status, 400);
  assert.equal((await call('POST', '/api/products', { name: 'Riz', space_id: spaces[0].id, quantity: 1, state: 'closed', expires_on: '2026-02-30' })).status, 400);
  // Le nom saisi est mémorisé pour l'autocomplétion
  assert.ok((await state()).history.some((h) => h.name === 'Pâtes'));
});

test('ouvrir une partie du stock fermé (fusion avec l’entrée ouverte existante)', async () => {
  const { spaces } = await state();
  const placard = spaces[0].id;
  const closed = (await call('POST', '/api/products', {
    name: 'Riz', space_id: placard, quantity: 3, unit: 'paquet', state: 'closed', expires_on: '2027-01-01',
  })).data.id;

  const r1 = await call('POST', `/api/products/${closed}/open`, { quantity: 1, opened_on: '2026-10-30' });
  assert.equal(r1.status, 200);
  let rice = (await state()).products.filter((p) => p.name === 'Riz');
  assert.equal(rice.find((p) => p.state === 'closed').quantity, 2);
  const open = rice.find((p) => p.state === 'open');
  assert.equal(open.quantity, 1);
  assert.equal(open.opened_on, '2026-10-30');
  assert.equal(open.expires_on, '2027-01-01'); // la date de péremption est conservée

  // Même jour d'ouverture : la quantité ouverte est mise à jour
  await call('POST', `/api/products/${closed}/open`, { quantity: 1, opened_on: '2026-10-30' });
  rice = (await state()).products.filter((p) => p.name === 'Riz');
  assert.equal(rice.find((p) => p.state === 'open').quantity, 2);

  // Dernier paquet ouvert sans date : l'entrée fermée disparaît
  await call('POST', `/api/products/${closed}/open`, { quantity: 1, opened_on: null });
  rice = (await state()).products.filter((p) => p.name === 'Riz');
  assert.equal(rice.filter((p) => p.state === 'closed').length, 0);
  assert.equal(rice.reduce((n, p) => n + p.quantity, 0), 3);

  // On ne peut pas ouvrir plus que le stock
  const other = (await call('POST', '/api/products', { name: 'Thon', space_id: placard, quantity: 1, unit: 'boîte', state: 'closed' })).data.id;
  assert.equal((await call('POST', `/api/products/${other}/open`, { quantity: 2 })).status, 400);
});

test('un ajout identique fusionne les quantités, modification et suppression', async () => {
  const { spaces } = await state();
  const body = { name: 'Lait', space_id: spaces[1].id, quantity: 2, unit: 'brique', state: 'closed' };
  const a = await call('POST', '/api/products', body);
  const b = await call('POST', '/api/products', { ...body, name: 'lait' });
  assert.equal(b.data.merged, true);
  assert.equal(b.data.id, a.data.id);
  assert.equal((await state()).products.find((p) => p.id === a.data.id).quantity, 4);

  // Déplacement vers un autre espace et passage à l'état ouvert
  assert.equal((await call('PATCH', `/api/products/${a.data.id}`, { space_id: spaces[2].id, quantity: 1.5, state: 'open', opened_on: '2026-10-01' })).status, 200);
  const p = (await state()).products.find((x) => x.id === a.data.id);
  assert.equal(p.space_id, spaces[2].id);
  assert.equal(p.quantity, 1.5);
  // Repasser à fermé efface la date d'ouverture
  await call('PATCH', `/api/products/${a.data.id}`, { state: 'closed' });
  assert.equal((await state()).products.find((x) => x.id === a.data.id).opened_on, null);

  assert.equal((await call('DELETE', `/api/products/${a.data.id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/products/${a.data.id}`)).status, 404);
});

test('suppression d’un espace non vide : confirmation, déplacement ou suppression', async () => {
  const sp = (await call('POST', '/api/spaces', { name: 'Cellier' })).data.id;
  const sp2 = (await call('POST', '/api/spaces', { name: 'Garage' })).data.id;
  assert.equal((await call('POST', '/api/spaces', { name: 'cellier' })).status, 400); // doublon
  assert.equal((await call('PATCH', `/api/spaces/${sp}`, { name: 'Cave' })).status, 200);
  await call('POST', '/api/products', { name: 'Eau', space_id: sp, quantity: 6, unit: 'bouteille', state: 'closed' });
  await call('POST', '/api/products', { name: 'Vin', space_id: sp2, quantity: 2, unit: 'bouteille', state: 'closed' });

  assert.equal((await call('DELETE', `/api/spaces/${sp}`)).status, 409);
  const moved = await call('DELETE', `/api/spaces/${sp}?products=move&target=${sp2}`);
  assert.equal(moved.data.affected, 1);
  let s = await state();
  assert.equal(s.products.find((p) => p.name === 'Eau').space_id, sp2);
  assert.ok(!s.spaces.some((x) => x.id === sp));

  await call('DELETE', `/api/spaces/${sp2}?products=delete`);
  s = await state();
  assert.ok(!s.products.some((p) => p.name === 'Eau' || p.name === 'Vin'));
});

test('le webhook est conservé côté serveur et jamais renvoyé', async () => {
  assert.equal((await call('PUT', '/api/settings', { webhook_url: 'https://example.com/hook' })).status, 400);
  const r = await call('PUT', '/api/settings', { webhook_url: WEBHOOK, expiry_days: 5, frequency: 'weekly', weekday: 6, time: '18:30', timezone: 'Europe/Paris' });
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.webhook_configured, true);
  const raw = JSON.stringify(await state());
  assert.ok(!raw.includes('secret-token'));
  assert.ok(!raw.includes('webhook_url'));
  assert.equal((await state()).settings.expiry_days, 5);
  assert.equal((await call('PUT', '/api/settings', { time: '25:00' })).status, 400);
  assert.equal((await call('PUT', '/api/settings', { timezone: 'Mars/Olympus' })).status, 400);
});

test('les requêtes d’écriture doivent être en JSON', async () => {
  const res = await fetch(`${base}/api/products/1`, { method: 'DELETE' });
  assert.equal(res.status, 415);
});

test('fichiers statiques servis avec une politique de sécurité', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 403);
});

test('chargement des exemples refusé si le stock n’est pas vide', async () => {
  assert.equal((await call('POST', '/api/demo', {})).status, 400);
});
