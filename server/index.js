import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createScheduler } from './alerts.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.DATA_DIR || join(root, 'data');

mkdirSync(dataDir, { recursive: true });
const db = openDb(join(dataDir, 'stock.db'));
const scheduler = createScheduler(db);
const server = createServer(createApp({ db, publicDir: join(root, 'public') }));

server.listen(port, host, () => {
  console.log(`Bernard est disponible sur http://localhost:${port} (données : ${dataDir})`);
  scheduler.start();
});

function shutdown() {
  scheduler.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
