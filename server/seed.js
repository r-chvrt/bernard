// Charge le jeu de données d'exemple : npm run seed
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, getSettings } from './db.js';
import { loadDemo } from './demo.js';
import { localParts, isValidTimeZone } from './dates.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR || join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const db = openDb(join(dataDir, 'stock.db'));
const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
if (n > 0) {
  console.error(`Le stock contient déjà ${n} produit(s) : exemples non chargés.`);
  process.exit(1);
}
const tz = getSettings(db).timezone;
const count = loadDemo(db, localParts(isValidTimeZone(tz) ? tz : 'UTC').date);
console.log(`${count} produits d'exemple ajoutés.`);
db.close();
