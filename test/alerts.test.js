import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSettings, getSettings } from '../server/db.js';
import { computeAlerts, buildDigest, runDigest, createScheduler, sendWebhook, isDiscordWebhook } from '../server/alerts.js';
import { localParts } from '../server/dates.js';

const WEBHOOK = 'https://discord.com/api/webhooks/123/abc-DEF';
const settings = { expiry_days: 3, open_days: 5, alert_expired: true, alert_expiring: true, alert_open: true };
const P = (o) => ({ id: Math.random(), name: 'X', space_id: 1, quantity: 1, unit: 'unité', state: 'closed', expires_on: null, opened_on: null, ...o });

test('règles des alertes', () => {
  const today = '2026-10-31';
  const products = [
    P({ id: 1, name: 'Périmé', expires_on: '2026-10-29' }),
    P({ id: 2, name: 'Aujourd’hui', expires_on: '2026-10-31' }),
    P({ id: 3, name: 'Dans 3 jours', expires_on: '2026-11-03' }),
    P({ id: 4, name: 'Dans 4 jours', expires_on: '2026-11-04' }),
    P({ id: 5, name: 'Sans date' }),
    P({ id: 6, name: 'Ouvert 5 j', state: 'open', opened_on: '2026-10-26' }),
    P({ id: 7, name: 'Ouvert 4 j', state: 'open', opened_on: '2026-10-27' }),
    P({ id: 8, name: 'Ouvert sans date', state: 'open' }),
  ];
  const a = computeAlerts(products, settings, today);
  assert.deepEqual(a.expired.map((x) => x.product.id), [1]);
  assert.deepEqual(a.expiring.map((x) => x.product.id), [2, 3]);
  assert.deepEqual(a.openLong.map((x) => x.product.id), [6]);

  const off = computeAlerts(products, { ...settings, alert_expired: false }, today);
  assert.equal(off.expired.length, 0);

  const msg = buildDigest(a, [{ id: 1, name: 'Frigo' }], today);
  assert.equal(msg.embeds.length, 3);
  assert.match(msg.embeds[0].description, /périmé depuis 2 jours/);
  assert.match(msg.embeds[1].description, /périme aujourd'hui/);
  assert.deepEqual(msg.allowed_mentions, { parse: [] });
  assert.equal(buildDigest(computeAlerts([P({})], settings, today), [], today), null);
});

test('validation des URL de webhook Discord', () => {
  assert.ok(isDiscordWebhook(WEBHOOK));
  assert.ok(isDiscordWebhook('https://discordapp.com/api/webhooks/1/x_y'));
  assert.ok(!isDiscordWebhook('http://discord.com/api/webhooks/1/x'));
  assert.ok(!isDiscordWebhook('https://evil.com/discord.com/api/webhooks/1/x'));
});

test('les erreurs d’envoi ne divulguent pas l’URL', async () => {
  const fetchImpl = async () => new Response('{}', { status: 404 });
  await assert.rejects(sendWebhook(WEBHOOK, {}, { fetchImpl }), (err) => !err.message.includes('abc-DEF'));
});

function setup() {
  const db = openDb(':memory:');
  const tz = 'Europe/Paris';
  const today = localParts(tz).date;
  db.prepare(
    `INSERT INTO products (name, space_id, quantity, unit, state, expires_on, opened_on, created_at, updated_at)
     VALUES ('Yaourt', 1, 2, 'unité', 'closed', ?, NULL, '', '')`,
  ).run(today);
  setSettings(db, { webhook_url: WEBHOOK, timezone: tz, time: '00:00' });
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return new Response('{}', { status: 200 });
  };
  return { db, calls, fetchImpl };
}

test('le planificateur envoie un seul récapitulatif par période', async () => {
  const { db, calls, fetchImpl } = setup();
  const scheduler = createScheduler(db, { fetchImpl, log: {} });
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\?wait=true$/);
  assert.match(calls[0].body.embeds[0].description, /Yaourt/);
  assert.equal(getSettings(db).last_digest_period, localParts('Europe/Paris').date);

  // Le lendemain, un nouveau récapitulatif part
  await scheduler.tick(new Date(Date.now() + 86400000));
  assert.equal(calls.length, 2);
});

test('pas d’envoi avant l’heure prévue ni sans webhook', async () => {
  const { db, calls, fetchImpl } = setup();
  setSettings(db, { time: '23:59' });
  const scheduler = createScheduler(db, { fetchImpl, log: {} });
  const at = new Date();
  if (localParts('Europe/Paris', at).time < '23:59') {
    await scheduler.tick(at);
    assert.equal(calls.length, 0);
  }
  setSettings(db, { time: '00:00', webhook_url: '' });
  await scheduler.tick(at);
  assert.equal(calls.length, 0);
});

test('option « ne pas renvoyer un récapitulatif identique »', async () => {
  const { db, calls, fetchImpl } = setup();
  setSettings(db, { skip_unchanged: true });
  assert.equal((await runDigest(db, { fetchImpl })).sent, true);
  assert.equal((await runDigest(db, { fetchImpl })).sent, false);
  assert.equal((await runDigest(db, { fetchImpl, force: true })).sent, true);
  assert.equal(calls.length, 2);
});
