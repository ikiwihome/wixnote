import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'wixnote-browser-'));
const app = createApp({ dataDir: dir, allowRegistration: true });
const server = app.listen(3100, '127.0.0.1', () =>
  console.log('Browser test server: http://127.0.0.1:3100'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      app.locals.db.close();
      rmSync(dir, { recursive: true, force: true });
      process.exit(0);
    }),
  );
