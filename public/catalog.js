// Catalogue partagé entre le navigateur et le serveur :
// catégories, produits génériques (autocomplétion) et déduction de la catégorie d'un nom libre.

export const CATEGORIES = [
  { id: 'feculents', label: 'Pâtes, riz & féculents', icon: '🍝' },
  { id: 'conserves', label: 'Conserves & plats préparés', icon: '🥫' },
  { id: 'condiments', label: 'Sauces, huiles & condiments', icon: '🧂' },
  { id: 'sucre', label: 'Sucré & petit-déjeuner', icon: '🍪' },
  { id: 'aperitif', label: 'Apéritif & snacks', icon: '🥨' },
  { id: 'boulangerie', label: 'Pain & pâtisserie', icon: '🥖' },
  { id: 'laitier', label: 'Produits laitiers & œufs', icon: '🧀' },
  { id: 'viande', label: 'Viandes, poissons & traiteur', icon: '🍗' },
  { id: 'fruits-legumes', label: 'Fruits & légumes', icon: '🥕' },
  { id: 'surgeles', label: 'Surgelés', icon: '🧊' },
  { id: 'boissons', label: 'Boissons', icon: '🧃' },
  { id: 'autre', label: 'Autre', icon: '📦' },
];
export const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
export const DEFAULT_CATEGORY = 'autre';

/** Niveaux proposés pour le reste d'un produit entamé (en %). */
export const REMAINING_LEVELS = [
  { value: 100, label: 'Plein', short: 'plein' },
  { value: 75, label: '¾', short: '¾' },
  { value: 50, label: '½', short: '½' },
  { value: 25, label: '¼', short: '¼' },
  { value: 10, label: 'Presque vide', short: 'un fond' },
];

const D = (category, unit, names) => names.map((name) => [name, unit, category]);

// Format : [nom, unité par défaut, catégorie]
export const DICTIONARY = [
  ...D('feculents', 'paquet', ['Pâtes', 'Spaghetti', 'Penne', 'Fusilli', 'Coquillettes', 'Macaronis', 'Tagliatelles', 'Lasagnes',
    'Riz', 'Riz basmati', 'Riz rond', 'Semoule', 'Couscous', 'Quinoa', 'Boulgour', 'Lentilles', 'Pois cassés', 'Purée en flocons',
    'Nouilles', 'Gnocchis', 'Polenta']),
  ...D('feculents', 'kg', ['Farine', 'Pommes de terre']),
  ...D('conserves', 'boîte', ['Pois chiches', 'Haricots rouges', 'Haricots blancs', 'Haricots verts', 'Maïs', 'Petits pois',
    'Champignons', 'Tomates pelées', 'Concentré de tomate', 'Conserve de thon', 'Thon', 'Sardines', 'Maquereaux', 'Raviolis',
    'Cassoulet', 'Chili con carne', 'Lait de coco', 'Lait concentré', 'Plat préparé']),
  ...D('conserves', 'brique', ['Soupe']),
  ...D('condiments', 'pot', ['Sauce tomate', 'Pesto', 'Moutarde', 'Mayonnaise', 'Cornichons', 'Olives', 'Poivre',
    'Herbes de Provence', 'Épices', 'Curry', 'Cumin', 'Paprika', 'Cannelle', 'Câpres']),
  ...D('condiments', 'bouteille', ["Huile d'olive", 'Huile de tournesol', 'Vinaigre', 'Vinaigre balsamique', 'Ketchup',
    'Sauce soja', 'Sauce barbecue']),
  ...D('condiments', 'paquet', ['Sel', 'Bouillon cube', 'Fécule de maïs', 'Chapelure']),
  ...D('sucre', 'paquet', ['Sucre', 'Sucre glace', 'Cassonade', 'Chocolat en poudre', 'Céréales', 'Flocons d’avoine', 'Biscuits',
    'Gâteaux', 'Café', 'Café moulu', 'Capsules de café', 'Thé', 'Tisane', 'Muesli']),
  ...D('sucre', 'pot', ['Miel', 'Confiture', 'Pâte à tartiner', 'Compote']),
  ...D('sucre', 'sachet', ['Levure chimique', 'Levure boulangère', 'Sucre vanillé', 'Fruits secs', 'Amandes', 'Noisettes',
    'Noix', 'Raisins secs', 'Pépites de chocolat']),
  ...D('sucre', 'unité', ['Chocolat', 'Tablette de chocolat']),
  ...D('aperitif', 'sachet', ['Chips', 'Cacahuètes', 'Pistaches', 'Bretzels']),
  ...D('aperitif', 'paquet', ['Crackers', 'Biscuits apéritif', 'Galettes de riz']),
  ...D('boulangerie', 'paquet', ['Pain de mie', 'Biscottes', 'Pain grillé', 'Brioche', 'Tortillas', 'Pains burger']),
  ...D('boulangerie', 'unité', ['Pain', 'Baguette', 'Pâte feuilletée', 'Pâte brisée', 'Pâte à pizza']),
  ...D('laitier', 'brique', ['Lait', 'Lait végétal', 'Crème liquide']),
  ...D('laitier', 'unité', ['Beurre', 'Yaourt', 'Yaourt nature', 'Œufs', 'Emmental', 'Comté', 'Camembert', 'Mozzarella',
    'Parmesan', 'Feta', 'Chèvre', 'Fromage', 'Dessert lacté']),
  ...D('laitier', 'pot', ['Crème fraîche', 'Fromage blanc', 'Faisselle']),
  ...D('laitier', 'sachet', ['Fromage râpé']),
  ...D('viande', 'barquette', ['Jambon', 'Lardons', 'Saucisses', 'Poulet', 'Steak haché', 'Saumon fumé', 'Viande hachée',
    'Escalopes', 'Filet de poisson', 'Charcuterie', 'Houmous', 'Taboulé', 'Surimi']),
  ...D('viande', 'unité', ['Tofu', 'Saucisson']),
  ...D('fruits-legumes', 'kg', ['Pommes', 'Bananes', 'Oranges', 'Poires', 'Tomates', 'Carottes', 'Oignons', 'Raisin']),
  ...D('fruits-legumes', 'unité', ['Citrons', 'Ail', 'Échalotes', 'Courgettes', 'Salade', 'Concombre', 'Poivrons', 'Avocat',
    'Aubergine', 'Brocoli', 'Chou-fleur', 'Melon', 'Kiwis']),
  ...D('surgeles', 'sachet', ['Légumes surgelés', 'Épinards surgelés', 'Haricots verts surgelés', 'Frites surgelées',
    'Fruits rouges surgelés', 'Poêlée surgelée']),
  ...D('surgeles', 'paquet', ['Poisson pané', 'Filets de poisson surgelés', 'Nuggets']),
  ...D('surgeles', 'unité', ['Pizza surgelée', 'Pizza']),
  ...D('surgeles', 'pot', ['Glace']),
  ...D('boissons', 'bouteille', ['Eau', 'Eau gazeuse', 'Sirop', 'Soda', 'Vin rouge', 'Vin blanc', 'Vin rosé', 'Bière', 'Limonade']),
  ...D('boissons', 'brique', ['Jus d’orange', 'Jus de pomme', 'Jus de fruits']),
];

export const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/œ/g, 'oe')
    .toLowerCase().replace(/\s+/g, ' ').trim();

// Mots-clés reconnus dans un nom libre (sur des débuts de mots).
const KEYWORDS = [
  ['surgel', 'surgeles'], ['congel', 'surgeles'], ['glace', 'surgeles'],
  ['jus', 'boissons'], ['vin', 'boissons'], ['biere', 'boissons'], ['eau', 'boissons'], ['soda', 'boissons'], ['cafe', 'sucre'], ['the ', 'sucre'],
  ['sauce', 'condiments'], ['huile', 'condiments'], ['vinaigre', 'condiments'], ['epice', 'condiments'], ['moutarde', 'condiments'],
  ['conserve', 'conserves'], ['boite', 'conserves'], ['soupe', 'conserves'], ['veloute', 'conserves'],
  ['pate a', 'boulangerie'], ['pain', 'boulangerie'], ['brioche', 'boulangerie'],
  ['pate', 'feculents'], ['spaghet', 'feculents'], ['penne', 'feculents'], ['fusill', 'feculents'], ['tagliatel', 'feculents'],
  ['macaron', 'feculents'], ['coquillet', 'feculents'], ['riz', 'feculents'], ['couscous', 'feculents'], ['semoule', 'feculents'],
  ['nouille', 'feculents'], ['lentille', 'feculents'], ['farine', 'feculents'], ['quinoa', 'feculents'],
  ['lait', 'laitier'], ['yaourt', 'laitier'], ['fromage', 'laitier'], ['creme', 'laitier'], ['beurre', 'laitier'], ['oeuf', 'laitier'],
  ['jambon', 'viande'], ['poulet', 'viande'], ['boeuf', 'viande'], ['porc', 'viande'], ['saucisse', 'viande'], ['poisson', 'viande'],
  ['saumon', 'viande'], ['steak', 'viande'],
  ['chocolat', 'sucre'], ['biscuit', 'sucre'], ['gateau', 'sucre'], ['confiture', 'sucre'], ['cereale', 'sucre'], ['sucre', 'sucre'],
  ['chips', 'aperitif'], ['cacahuete', 'aperitif'],
  ['pomme', 'fruits-legumes'], ['legume', 'fruits-legumes'], ['fruit', 'fruits-legumes'], ['salade', 'fruits-legumes'],
];

const EXACT = new Map(DICTIONARY.map(([name, , category]) => [norm(name), category]));

/** Catégorie probable d'un nom saisi librement ('autre' si rien ne correspond). */
export function guessCategory(name) {
  const n = norm(name);
  if (!n) return DEFAULT_CATEGORY;
  if (EXACT.has(n)) return EXACT.get(n);
  const padded = ` ${n} `;
  // Le mot-clé qui apparaît le plus tôt l'emporte (« Gâteau au yaourt » → sucré) ; à égalité, le plus long.
  let hit = null;
  for (const [kw, cat] of KEYWORDS) {
    const at = padded.indexOf(` ${kw}`);
    if (at >= 0 && (!hit || at < hit.at || (at === hit.at && kw.length > hit.kw.length))) hit = { at, kw, cat };
  }
  if (hit) return hit.cat;
  // Nom du dictionnaire présent comme mot complet (« Penne complètes » → Penne)
  let best = null;
  for (const [key, cat] of EXACT) {
    if (padded.includes(` ${key} `) && (!best || key.length > best[0].length)) best = [key, cat];
  }
  return best ? best[1] : DEFAULT_CATEGORY;
}
