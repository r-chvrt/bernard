import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory, DICTIONARY, CATEGORY_IDS } from '../public/catalog.js';

test('déduction de la catégorie à partir d’un nom libre', () => {
  const cases = {
    Penne: 'feculents', 'penne rigate': 'feculents', 'Pâtes complètes': 'feculents', Couscous: 'feculents',
    'Pâte à tartiner': 'sucre', 'Pâte feuilletée': 'boulangerie', 'Boîte de thon': 'conserves',
    'Petits pois surgelés': 'surgeles', 'Jus de raisin': 'boissons', 'Gâteau au yaourt': 'sucre',
    'Lait demi-écrémé': 'laitier', 'Œufs bio': 'laitier', 'Sauce bolognaise': 'condiments', Pommes: 'fruits-legumes',
    'Truc bizarre': 'autre', '': 'autre',
  };
  for (const [name, cat] of Object.entries(cases)) assert.equal(guessCategory(name), cat, name);
});

test('le dictionnaire n’utilise que des catégories connues', () => {
  for (const [name, , cat] of DICTIONARY) assert.ok(CATEGORY_IDS.has(cat), name);
});
