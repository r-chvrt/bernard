// Secours en cas d'oubli : désactive la protection par mot de passe.
//   docker compose exec bernard node server/reset-password.js
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { clearPassword } from './auth.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const db = openDb(join(process.env.DATA_DIR || join(root, 'data'), 'stock.db'));
clearPassword(db);
db.close();
console.log('Protection par mot de passe désactivée. Vous pouvez en définir un nouveau dans Paramètres → Administration.');
