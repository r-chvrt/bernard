// Copie cohérente de la base, même pendant que l'application tourne :
//   node server/backup.js            -> $DATA_DIR/backups/stock-AAAAMMJJ-HHMMSS.db
//   node server/backup.js chemin.db  -> chemin choisi
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR || join(root, 'data');
const source = join(dataDir, 'stock.db');
if (!existsSync(source)) {
  console.error(`Base introuvable : ${source}`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const target = process.argv[2] || join(dataDir, 'backups', `stock-${stamp}.db`);
mkdirSync(dirname(target), { recursive: true });
if (existsSync(target)) {
  console.error(`Le fichier existe déjà : ${target}`);
  process.exit(1);
}
const db = new DatabaseSync(source);
db.exec('PRAGMA busy_timeout = 5000');
db.prepare('VACUUM INTO ?').run(target);
db.close();
console.log(`Sauvegarde créée : ${target}`);
