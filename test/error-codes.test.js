import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSettings } from '../server/db.js';
import { createApp } from '../server/app.js';
import { runDigest, sendWebhook } from '../server/alerts.js';

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

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const spaces = async () => (await call('GET', '/api/state')).data.spaces;

test('espaces : doublon, introuvable, non vide', async () => {
  const [placard, frigo] = await spaces();
  assert.deepEqual(await call('POST', '/api/spaces', { name: 'Placard' }),
    { status: 400, data: { error: 'Cet espace existe déjà', code: 'space_exists' } });
  assert.deepEqual(await call('PATCH', '/api/spaces/9999', { name: 'X' }),
    { status: 404, data: { error: 'Espace introuvable', code: 'space_not_found' } });
  await call('POST', '/api/products', { name: 'Riz', space_id: placard.id, quantity: 2, unit: 'paquet', state: 'closed' });
  const r = await call('DELETE', `/api/spaces/${placard.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'space_not_empty');
  assert.deepEqual(r.data.params, { count: 1 });
  assert.equal((await call('DELETE', `/api/spaces/${placard.id}?products=move&target=${placard.id}`)).data.code, 'space_target_invalid');
  assert.ok(frigo);
});

test('produits : introuvable, déjà ouvert, quantité à ouvrir trop grande', async () => {
  const [placard] = await spaces();
  const { data } = await call('POST', '/api/products', { name: 'Farine', space_id: placard.id, quantity: 1.5, unit: 'kg', state: 'closed' });
  assert.deepEqual(await call('POST', `/api/products/${data.id}/open`, { quantity: 3 }), {
    status: 400,
    data: { error: "Il n'y a que 1.5 kg en stock", code: 'open_quantity_exceeds', params: { available: 1.5, unit: 'kg' } },
  });
  const open = await call('POST', '/api/products', { name: 'Lait', space_id: placard.id, quantity: 1, unit: 'brique', state: 'open' });
  assert.equal((await call('POST', `/api/products/${open.data.id}/open`, {})).data.code, 'product_already_open');
  assert.deepEqual(await call('DELETE', '/api/products/99999'),
    { status: 404, data: { error: 'Produit introuvable', code: 'product_not_found' } });
  assert.equal((await call('POST', '/api/demo')).data.code, 'demo_stock_not_empty');
});

test('import : la cause d’un produit invalide garde son code', async () => {
  const data = { format: 'bernard-export', products: [{ name: 'Riz', quantity: 1, unit: 'tonneau', state: 'closed' }] };
  const r = await call('POST', '/api/import', { mode: 'merge', data });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'import_product_invalid');
  assert.deepEqual(r.data.params, { index: 1, name: 'Riz', reason: 'Unité inconnue', reason_code: 'unit_unknown' });
  assert.equal((await call('POST', '/api/import', { mode: 'x', data })).data.code, 'import_mode_invalid');
  assert.equal((await call('POST', '/api/import', { mode: 'merge', data: {} })).data.code, 'import_not_export');
});

test('réglages, purge et requêtes invalides', async () => {
  assert.deepEqual((await call('PUT', '/api/settings', { open_days: 0 })).data,
    { error: 'Valeur invalide pour open_days (entre 1 et 365)', code: 'setting_out_of_range', params: { key: 'open_days', min: 1, max: 365 } });
  assert.equal((await call('PUT', '/api/settings', { time: '25:00' })).data.code, 'time_invalid');
  assert.equal((await call('PUT', '/api/settings', { webhook_url: 'https://exemple.fr' })).data.code, 'webhook_url_invalid');
  assert.equal((await call('POST', '/api/notifications/test', {})).data.code, 'webhook_missing');
  assert.equal((await call('POST', '/api/purge', { scope: 'all', confirm: 'non' })).data.code, 'purge_confirm_required');
  assert.deepEqual(await call('GET', '/api/inconnue'), { status: 404, data: { error: 'Route inconnue', code: 'route_unknown' } });
  const res = await fetch(`${base}/api/spaces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.deepEqual(await res.json(), { error: 'JSON invalide', code: 'json_invalid' });
  const text = await fetch(`${base}/api/spaces`, { method: 'POST', body: 'x' });
  assert.equal((await text.json()).code, 'json_content_type_required');
});

test('l’API externe v1 garde ses erreurs sans code', async () => {
  const r = await call('GET', '/api/v1/stock');
  assert.equal(r.status, 401);
  assert.deepEqual(Object.keys(r.data), ['error']);
  const unknown = await call('GET', '/api/v1/inconnue');
  assert.deepEqual(unknown, { status: 404, data: { error: 'Route inconnue' } });
});

test('récapitulatif : raison et dernier statut codés', async () => {
  assert.deepEqual(await call('POST', '/api/notifications/send'),
    { status: 200, data: { sent: false, count: 0, reason: 'Aucun webhook configuré', reason_code: 'no_webhook' } });
  const local = openDb(':memory:');
  const fetchImpl = async () => new Response('{}', { status: 200 });
  local.prepare("INSERT INTO settings (key, value) VALUES ('webhook_url', ?)").run(JSON.stringify('https://discord.com/api/webhooks/1/x'));
  const r = await runDigest(local, { fetchImpl });
  assert.equal(r.reason_code, 'nothing_to_report');
  assert.equal(getSettings(local).last_digest_code, 'nothing_to_report');
  await assert.rejects(sendWebhook('https://discord.com/api/webhooks/1/x', {}, { fetchImpl: async () => new Response('', { status: 500 }) }),
    (err) => err.code === 'webhook_rejected' && err.params.status === 500);
  await assert.rejects(sendWebhook('https://discord.com/api/webhooks/1/x', {}, { fetchImpl: async () => new Response('', { status: 404 }) }),
    (err) => err.code === 'webhook_not_found');
});

test('connexion : codes du mot de passe', async () => {
  assert.deepEqual((await call('PUT', '/api/auth', { new_password: 'court' })).data,
    { error: 'Le mot de passe doit contenir au moins 6 caractères', code: 'password_too_short', params: { min: 6 } });
  const set = await fetch(`${base}/api/auth`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_password: 'secret123' }),
  });
  assert.equal(set.status, 200);
  assert.deepEqual(await call('GET', '/api/state'),
    { status: 401, data: { error: 'Connexion requise', code: 'auth_required', auth_required: true } });
  assert.deepEqual(await call('POST', '/api/login', { password: 'mauvais1' }),
    { status: 401, data: { error: 'Mot de passe incorrect', code: 'password_incorrect' } });
});
