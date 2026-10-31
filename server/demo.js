import { transaction, now, rememberName } from './db.js';
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
      ['Pâtes', placard, 1, 'paquet', 'open', 280, -12],
      ['Riz', placard, 1, 'kg', 'closed', 400, null],
      ['Sauce tomate', placard, 3, 'pot', 'closed', 2, null],
      ['Conserve de thon', placard, 4, 'boîte', 'closed', 700, null],
      ['Farine', placard, 1, 'kg', 'open', 120, -20],
      ['Lait', frigo, 1, 'brique', 'open', 6, -4],
      ['Lait', cellier, 6, 'brique', 'closed', 90, null],
      ['Yaourt nature', frigo, 4, 'unité', 'closed', 1, null],
      ['Jambon', frigo, 1, 'barquette', 'open', -1, -3],
      ['Beurre', frigo, 1, 'unité', 'open', 25, -9],
      ['Moutarde', frigo, 1, 'pot', 'open', 200, -40],
      ['Petits pois', congel, 1, 'sachet', 'closed', 180, null],
      ['Pizza', congel, 2, 'unité', 'closed', 60, null],
      ["Huile d'olive", cellier, 1, 'bouteille', 'open', null, -30],
      ['Eau gazeuse', cellier, 6, 'bouteille', 'closed', null, null],
    ];
    const insert = db.prepare(
      `INSERT INTO products (name, space_id, quantity, unit, state, expires_on, opened_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ts = now();
    for (const [name, space, qty, unit, state, exp, opened] of items) {
      insert.run(name, space, qty, unit, state, d(exp), state === 'open' ? d(opened) : null, ts, ts);
      rememberName(db, name, unit);
    }
    return items.length;
  });
}
