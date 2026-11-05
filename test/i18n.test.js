import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MESSAGES, LANGS, t, detectLang, errorMessage, pluralCategory, unitName, formatNumber,
} from '../public/i18n.js';
import { CATEGORIES, REMAINING_LEVELS } from '../public/catalog.js';
import { UNITS } from '../server/units.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const { fr, en } = MESSAGES;
const placeholders = (v) => new Set(
  (typeof v === 'string' ? [v] : Object.values(v)).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])),
);

test('le français et l’anglais ont exactement les mêmes clés, formes et paramètres', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const key of Object.keys(fr)) {
    assert.equal(typeof en[key], typeof fr[key], `forme de ${key}`);
    if (typeof fr[key] === 'object') {
      assert.deepEqual(Object.keys(en[key]).sort(), ['one', 'other'], `pluriel de ${key} (en)`);
      assert.deepEqual(Object.keys(fr[key]).sort(), ['one', 'other'], `pluriel de ${key} (fr)`);
    }
    assert.deepEqual([...placeholders(en[key])].sort(), [...placeholders(fr[key])].sort(), `paramètres de ${key}`);
  }
});

test('les clés utilisées par les pages et les scripts existent', () => {
  const used = new Set();
  for (const page of ['public/index.html', 'public/login.html']) {
    for (const m of read(page).matchAll(/data-i18n(?:-html|-aria|-title|-ph)?="([^"]+)"/g)) used.add(m[1]);
  }
  for (const script of ['public/app.js', 'public/login.js']) {
    for (const m of read(script).matchAll(/\bt\('([^'$]+)'/g)) used.add(m[1]);
  }
  // Clés construites dynamiquement.
  for (const v of ['all', 'open', 'closed', 'settings']) used.add(`view.${v}`);
  for (const v of ['any', 'expired', 'soon', 'alert', 'openlong', 'dated', 'undated']) used.add(`filter.expiry.${v}`);
  for (const v of ['expiry', 'name', 'category', 'space', 'opened', 'recent']) used.add(`sort.${v}`);
  for (const c of CATEGORIES) used.add(`category.${c.id}`);
  for (const u of UNITS) used.add(`unit.${u.id}`);
  for (const l of REMAINING_LEVELS) used.add(`level.${l.value}`).add(`level.${l.value}.short`);
  for (const v of ['off', 'change', 'enable']) for (const k of ['title', 'intro', 'submit']) used.add(`auth.${v}.${k}`);
  for (const v of ['no_webhook', 'nothing_to_report', 'unchanged']) used.add(`digest.reason.${v}`);
  for (let d = 1; d <= 7; d++) used.add(`weekday.${d}`);
  assert.ok(used.size > 150);
  const missing = [...used].filter((k) => fr[k] === undefined || en[k] === undefined);
  assert.deepEqual(missing, []);
});

test('le texte français écrit dans les pages correspond au dictionnaire', () => {
  const norm = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  for (const page of ['public/index.html', 'public/login.html']) {
    for (const m of read(page).matchAll(/<(\w+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)<\/\1>/g)) {
      assert.equal(norm(m[3]), norm(t(m[2], {}, 'fr')), `${page} : ${m[2]}`);
    }
    for (const m of read(page).matchAll(/<(\w+)[^>]*\sdata-i18n-html="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      assert.equal(norm(m[3]), norm(t(m[2], {}, 'fr')), `${page} : ${m[2]}`);
    }
  }
});

/** Codes passés en argument de bad(), notFound(), HttpError, WebhookError, coded() et cleanDate() dans le serveur. */
function serverCodes() {
  const codes = new Set();
  for (const file of readdirSync(join(root, 'server')).filter((f) => f.endsWith('.js'))) {
    const src = read(`server/${file}`);
    for (const m of src.matchAll(/\b(?:bad|notFound|HttpError|WebhookError|coded|cleanDate)\(/g)) {
      // Lecture des arguments jusqu'à la parenthèse fermante, chaînes et gabarits ignorés.
      let depth = 1;
      let i = m.index + m[0].length;
      let args = '';
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') {
          const end = src.indexOf(c, i + 1);
          args += src.slice(i, end + 1);
          i = end + 1;
          continue;
        }
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (depth > 0) args += c;
        i++;
      }
      for (const c of args.matchAll(/,\s*'([a-z]+(?:_[a-z]+)+)'/g)) codes.add(c[1]);
    }
    for (const c of src.matchAll(/(?:code|reason_code)(?::|\s*=)\s*'([a-z]+(?:_[a-z]+)*)'/g)) codes.add(c[1]);
  }
  return codes;
}

test('chaque code d’erreur du serveur est documenté et traduit', () => {
  const codes = serverCodes();
  for (const c of ['name_required', 'password_incorrect', 'space_not_empty', 'webhook_rejected', 'auth_required', 'internal_error']) {
    assert.ok(codes.has(c), `code ${c} repéré dans le serveur`);
  }
  const doc = read('docs/erreurs-i18n.md');
  const documented = new Set([...doc.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]));
  const digest = new Set(['no_webhook', 'nothing_to_report', 'unchanged', 'sent', 'failed']);
  for (const c of codes) {
    if (digest.has(c)) continue;
    assert.ok(documented.has(c), `code ${c} absent de docs/erreurs-i18n.md`);
    for (const l of LANGS) assert.ok(MESSAGES[l][`error.${c}`], `error.${c} (${l})`);
  }
  for (const c of documented) assert.ok(codes.has(c), `code documenté ${c} introuvable dans le serveur`);
});

test('interpolation et pluriels selon la langue', () => {
  assert.equal(t('toast.added', { name: 'Riz' }, 'fr'), 'Riz ajouté');
  assert.equal(t('toast.added', { name: 'Rice' }, 'en'), 'Rice added');
  assert.equal(t('spaces.count', { count: 0 }, 'fr'), '0 produit');
  assert.equal(t('spaces.count', { count: 0 }, 'en'), '0 products');
  assert.equal(t('spaces.count', { count: 1 }, 'en'), '1 product');
  assert.equal(t('spaces.count', { count: 2 }, 'fr'), '2 produits');
  assert.equal(pluralCategory(1.5, 'fr'), 'other');
  assert.equal(pluralCategory(1, 'en'), 'one');
  assert.equal(t('clé.inconnue', {}, 'en'), 'clé.inconnue');
  assert.equal(unitName('boîte', 2, 'en'), 'tins');
  assert.equal(unitName('boîte', 1, 'fr'), 'boîte');
  assert.equal(unitName('inconnue', 2, 'en'), 'inconnue');
  assert.equal(formatNumber(1.5, 'fr'), '1,5');
  assert.equal(formatNumber(1.5, 'en'), '1.5');
});

test('détection de la langue : choix enregistré, puis navigateur, puis français', () => {
  assert.equal(detectLang('en', ['fr-FR']), 'en');
  assert.equal(detectLang('fr', ['en-US']), 'fr');
  assert.equal(detectLang(null, ['en-US', 'fr']), 'en');
  assert.equal(detectLang(null, ['de-DE', 'fr-CA', 'en']), 'fr');
  assert.equal(detectLang('xx', ['EN_gb']), 'en');
  assert.equal(detectLang(null, ['de', 'es']), 'fr');
  assert.equal(detectLang(null, undefined), 'fr');
});

test('messages d’erreur : code traduit, sinon texte du serveur', () => {
  const tooLong = { error: 'Le nom ne doit pas dépasser 40 caractères', code: 'name_too_long', params: { max: 40 } };
  assert.equal(errorMessage(tooLong, 'en'), 'The name must not exceed 40 characters');
  assert.equal(errorMessage(tooLong, 'fr'), 'Le nom ne doit pas dépasser 40 caractères');
  assert.equal(errorMessage({ error: 'Message historique', code: 'code_futur' }, 'en'), 'Message historique');
  assert.equal(errorMessage({ error: 'Sans code' }, 'en'), 'Sans code');
  assert.equal(errorMessage({}, 'en'), 'Something went wrong');
  assert.equal(
    errorMessage({ error: '…', code: 'open_quantity_exceeds', params: { available: 1.5, unit: 'kg' } }, 'fr'),
    'Il n’y a que 1,5 kg en stock',
  );
  assert.equal(
    errorMessage({ error: '…', code: 'open_quantity_exceeds', params: { available: 2, unit: 'boîte' } }, 'en'),
    'There are only 2 tins in stock',
  );
  assert.equal(errorMessage({
    error: '…', code: 'import_product_invalid',
    params: { index: 3, name: 'Riz', reason: 'Unité inconnue', reason_code: 'unit_unknown' },
  }, 'en'), 'Product no. 3 (Riz): Unknown unit');
  assert.equal(errorMessage({
    error: '…', code: 'import_product_invalid', params: { index: 1, name: '?', reason: 'Raison sans code' },
  }, 'en'), 'Product no. 1 (?): Raison sans code');
  assert.equal(
    errorMessage({ error: '…', code: 'setting_out_of_range', params: { key: 'open_days', min: 1, max: 365 } }, 'en'),
    'Invalid value for the days after opening (between 1 and 365)',
  );
  assert.equal(errorMessage({ error: '…', code: 'space_not_empty', params: { count: 1 } }, 'en'),
    'This space contains 1 product: move it or confirm its deletion');
});

test('theme.js (anti-flash) applique la même règle de langue que detectLang', () => {
  const src = read('public/theme.js');
  const cases = [
    [null, ['en-US', 'fr']], [null, ['fr-FR']], ['en', ['fr-FR']], ['fr', ['en-GB']], [null, ['de', 'en_GB']], ['xx', ['es']], [null, []],
  ];
  for (const [stored, languages] of cases) {
    const classes = new Set();
    const root = { dataset: {}, lang: 'fr', classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
    const sandbox = {
      document: { documentElement: root },
      navigator: { languages, language: languages[0] },
      localStorage: { getItem: (k) => (k === 'bernard-lang' ? stored : null) },
      setTimeout: () => {},
      String,
    };
    runInNewContext(src, sandbox);
    const expected = detectLang(stored, languages);
    assert.equal(root.lang, expected, `${stored} ${languages}`);
    assert.equal(classes.has('i18n-pending'), expected !== 'fr');
  }
});
