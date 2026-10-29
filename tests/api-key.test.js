import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../server/index.js';

const exec = promisify(execFile);
test('API keys and CLI respect account boundaries, versions and revocation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wixnote-key-'));
  const app = createApp({ dataDir: dir, allowRegistration: true });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(route, { method = 'GET', body, cookie, key } = {}) {
    const response = await fetch(base + '/api' + route, {
      method,
      headers: {
        'X-Wix-Request': '1',
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: body && JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }
  try {
    const a = await call('/auth/register', {
      method: 'POST',
      body: { email: 'a@example.com', name: 'A', password: 'password1234' },
    });
    const b = await call('/auth/register', {
      method: 'POST',
      body: { email: 'b@example.com', name: 'B', password: 'password1234' },
    });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const created = await call('/api-keys', {
      method: 'POST',
      cookie: a.cookie,
      body: { name: 'test' },
    });
    assert.equal(created.status, 201);
    const key = created.data.token;
    const listed = await call('/api-keys', { cookie: a.cookie });
    assert.equal(JSON.stringify(listed.data).includes(key), false);
    assert.equal((await call('/api-keys', { key })).status, 401);
    const note = await call('/notes', {
      method: 'POST',
      key,
      body: { title: 'CLI', type: 'markdown', content: 'one' },
    });
    assert.equal(note.status, 201);
    assert.equal((await call('/notes/' + note.data.id, { cookie: b.cookie })).status, 404);
    assert.equal(
      (
        await call('/notes/' + note.data.id, {
          method: 'PATCH',
          key,
          body: { version: note.data.version, content: 'two' },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call('/notes/' + note.data.id, {
          method: 'PATCH',
          key,
          body: { version: note.data.version, content: 'stale' },
        })
      ).status,
      409,
    );
    const file = path.join(dir, 'note.md');
    await writeFile(file, 'from cli');
    const env = { ...process.env, WIXNOTE_URL: base, WIXNOTE_API_KEY: key };
    const output = await exec(
      process.execPath,
      ['scripts/wixnote-cli.js', 'update', note.data.id, file],
      { env },
    );
    assert.equal(JSON.parse(output.stdout).content, 'from cli');
    assert.equal(
      (await call('/api-keys/' + created.data.id, { method: 'DELETE', cookie: b.cookie })).status,
      404,
    );
    assert.equal(
      (await call('/api-keys/' + created.data.id, { method: 'DELETE', cookie: a.cookie })).status,
      200,
    );
    assert.equal((await call('/notes', { key })).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
