import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

const publicDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public');
let server;
let base;

before(async () => {
  server = createServer(createApp({ db: openDb(':memory:'), publicDir, log: { error() {} } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, body, cookie) {
  const headers = {};
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, cookie: setCookie?.split(';')[0], setCookie };
}

test('sans mot de passe, tout est accessible', async () => {
  assert.equal((await call('GET', '/api/state')).status, 200);
  assert.equal((await call('GET', '/api/state')).data.settings.auth_enabled, false);
  assert.match((await call('GET', '/')).data, /id="view-list"/);
  assert.equal((await call('GET', '/login.html')).status, 302);
});

test('activation, connexion, changement et désactivation du mot de passe', async () => {
  assert.equal((await call('PUT', '/api/auth', { new_password: '123' })).status, 400);
  const on = await call('PUT', '/api/auth', { new_password: 'pâtes-au-beurre' });
  assert.equal(on.status, 200);
  assert.equal(on.data.settings.auth_enabled, true);
  assert.ok(!JSON.stringify(on.data).includes('scrypt'), 'le hash ne sort jamais');
  assert.match(on.setCookie, /HttpOnly/);
  assert.match(on.setCookie, /SameSite=Lax/);
  const mine = on.cookie; // l'appareil qui active reste connecté

  // Sans session : API refusée, page de connexion à la place de l'application
  const anon = await call('GET', '/api/state');
  assert.equal(anon.status, 401);
  assert.equal(anon.data.auth_required, true);
  assert.equal((await call('GET', '/api/export')).status, 401);
  assert.match((await call('GET', '/')).data, /id="login-form"/);
  assert.equal((await call('GET', '/app.css')).status, 200);
  assert.equal((await call('GET', '/api/health')).status, 200);

  // Avec la session : accès normal
  assert.equal((await call('GET', '/api/state', null, mine)).status, 200);
  assert.match((await call('GET', '/', null, mine)).data, /id="view-list"/);

  // Connexion
  assert.equal((await call('POST', '/api/login', { password: 'faux' })).status, 401);
  const ok = await call('POST', '/api/login', { password: 'pâtes-au-beurre' });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/state', null, ok.cookie)).status, 200);

  // Changement : mot de passe actuel exigé, les autres sessions sont fermées
  assert.equal((await call('PUT', '/api/auth', { new_password: 'nouveau-mdp' }, mine)).status, 400);
  const changed = await call('PUT', '/api/auth', { current_password: 'pâtes-au-beurre', new_password: 'nouveau-mdp' }, mine);
  assert.equal(changed.status, 200);
  assert.equal((await call('GET', '/api/state', null, ok.cookie)).status, 401);
  const renewed = changed.cookie;
  assert.equal((await call('GET', '/api/state', null, renewed)).status, 200);

  // Déconnexion
  await call('POST', '/api/logout', {}, renewed);
  assert.equal((await call('GET', '/api/state', null, renewed)).status, 401);

  // Désactivation (mot de passe actuel exigé)
  const again = (await call('POST', '/api/login', { password: 'nouveau-mdp' })).cookie;
  assert.equal((await call('DELETE', '/api/auth', { current_password: 'x' }, again)).status, 400);
  assert.equal((await call('DELETE', '/api/auth', { current_password: 'nouveau-mdp' }, again)).status, 200);
  assert.equal((await call('GET', '/api/state')).status, 200);
});

test('les essais répétés sont ralentis', async () => {
  await call('PUT', '/api/auth', { new_password: 'secret-123' });
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/login', { password: `x${i}` })).status, 401);
  const blocked = await call('POST', '/api/login', { password: 'secret-123' });
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.error, /réessayez dans \d+ s/);
});
