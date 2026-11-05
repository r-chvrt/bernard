import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Processus isolé : une rejection non gérée ne doit pas faire tomber le lanceur de tests.
test('une cible HTTP absolue invalide ne termine pas le serveur', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { createServer, request } from 'node:http';
    import { once } from 'node:events';
    import { fileURLToPath } from 'node:url';
    import { createApp } from './server/app.js';
    import { openDb } from './server/db.js';
    const db = openDb(':memory:');
    const server = createServer(createApp({ db, publicDir: fileURLToPath(new URL('./public', import.meta.url)) }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const status = await new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: server.address().port, path: 'http://[' }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(status, 400);
      const health = await fetch('http://127.0.0.1:' + server.address().port + '/api/health');
      assert.equal(health.status, 200);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
