import { transaction, now, rememberName, insertProduct } from './db.js';
import { guessCategory } from '../public/catalog.js';
import { addDays } from './dates.js';

/** Jeu de données d'exemple, dates relatives à aujourd'hui. */
export function loadDemo(db, today) {
  return transaction(db, () => {
    const spaceId = (name, position) => {
      const row = db.prepare('SELECT id FROM spaces WHERE name = ?').get(name);
      if (row) return row.id;
      return Number(db.prepare('INSERT INTO spaces (name, position) VALUES (?, ?)').run(name, position).lastInsertRowid);
    };
    const placard = spaceId('Placard', 0);
    const frigo = spaceId('Frigo', 1);
    const congel = spaceId('Congélateur', 2);
    const cellier = spaceId('Cellier', 3);
    const d = (n) => (n === null ? null : addDays(today, n));

    const items = [
      ['Pâtes', placard, 2, 'paquet', 'closed', 300, null],
      ['Pâtes', placard, 1, 'paquet', 'open', 280, -12, 50],
      ['Couscous', placard, 1, 'paquet', 'open', 240, -6, 25],
      ['Penne', placard, 2, 'paquet', 'closed', 320, null],
      ['Riz', placard, 1, 'kg', 'closed', 400, null],
      ['Sauce tomate', placard, 3, 'pot', 'closed', 2, null],
      ['Conserve de thon', placard, 4, 'boîte', 'closed', 700, null],
      ['Farine', placard, 1, 'kg', 'open', 120, -20, 75],
      ['Lait', frigo, 1, 'brique', 'open', 6, -4, 10],
      ['Lait', cellier, 6, 'brique', 'closed', 90, null],
      ['Yaourt nature', frigo, 4, 'unité', 'closed', 1, null],
      ['Jambon', frigo, 1, 'barquette', 'open', -1, -3],
      ['Beurre', frigo, 1, 'unité', 'open', 25, -9],
      ['Moutarde', frigo, 1, 'pot', 'open', 200, -40],
      ['Petits pois surgelés', congel, 1, 'sachet', 'closed', 180, null],
      ['Pizza', congel, 2, 'unité', 'closed', 60, null],
      ["Huile d'olive", cellier, 1, 'bouteille', 'open', null, -30],
      ['Eau gazeuse', cellier, 6, 'bouteille', 'closed', null, null],
    ];
    const ts = now();
    for (const [name, space, qty, unit, state, exp, opened, remaining = null] of items) {
      const category = guessCategory(name);
      insertProduct(db, {
        name, space_id: space, quantity: qty, unit, state, category,
        expires_on: d(exp), opened_on: state === 'open' ? d(opened) : null, remaining,
      }, ts);
      rememberName(db, name, unit, category);
    }
    return items.length;
  });
}
