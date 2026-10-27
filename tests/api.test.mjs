import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createServer } from '../server/index.mjs';
const token = '123:integration-test';
function auth(id) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Тест' }),
  });
  const check = [...p]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return 'tma ' + p;
}
test('HTTP API: authenticated group lifecycle, permissions, static app and data boundaries', async (t) => {
  const store = new Store(':memory:'),
    server = createServer({ store, token, appUrl: 'https://misis.example' });
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise((r) => server.close(r));
    store.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (url, id = 100, data) =>
    fetch(base + url, {
      method: data ? 'POST' : 'GET',
      headers: { Authorization: auth(id), 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/api/state')).status, 401);
  for (const uid of [100, 200])
    assert.equal(
      (await call('/api/profile', uid, { firstName: 'Иван', lastName: 'Тестов' })).status,
      200,
    );
  let response = await call('/api/groups', 100, { name: 'Тест-1', institute: 'ИКН' });
  assert.equal(response.status, 201);
  const head = await response.json();
  const id = head.group.id;
  assert.equal(head.role, 'head');
  response = await call('/api/join', 200, { code: head.group.inviteCode });
  const student = await response.json();
  assert.equal(student.role, 'student');
  assert.equal(student.group.inviteCode, undefined);
  response = await call('/api/action', 200, {
    groupId: id,
    type: 'settings',
    payload: { name: 'Wrong' },
  });
  assert.equal(response.status, 400);
  assert.equal((await call('/api/state?groupId=' + id, 300)).status, 403);
  response = await call('/api/action', 100, {
    groupId: id,
    type: 'announcement',
    payload: { title: 'Тест', text: 'Для группы' },
  });
  assert.equal(response.status, 200);
  response = await call('/api/state?groupId=' + id, 200);
  assert.equal((await response.json()).announcements.length, 1);
  assert.equal(
    (
      await fetch(base + '/api/state', {
        headers: { Authorization: auth(100), Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(base + '/.env')).status, 404);
});

test('HTTP catalog returns the persistent update rather than the bundled snapshot', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { saveCatalog } = await import('../server/catalog-storage.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'misis-http-')),
    previous = process.env.MISIS_CATALOG_PATH;
  process.env.MISIS_CATALOG_PATH = join(dir, 'catalog.json');
  const store = new Store(':memory:'),
    server = createServer({ store });
  t.after(async () => {
    if (server.listening) await new Promise((r) => server.close(r));
    store.close();
    if (previous === undefined) delete process.env.MISIS_CATALOG_PATH;
    else process.env.MISIS_CATALOG_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/misis-data.json';
  const bundled = await (await fetch(url)).json();
  assert.ok(Array.isArray(bundled.sources));
  await saveCatalog({ sources: [], revision: 'updated' });
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).revision, 'updated');
});

test('HTTP v0.2: profile gate, default group, scoped files and owner deletion', async (t) => {
  const store = new Store(':memory:'),
    server = createServer({ store, token });
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise((r) => server.close(r));
    store.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (url, id = 100, data) =>
    fetch(base + url, {
      method: data ? 'POST' : 'GET',
      headers: { Authorization: auth(id), 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
  assert.equal((await (await call('/api/state')).json()).profile.complete, false);
  assert.equal(
    (await call('/api/groups', 100, { name: 'Без имени', institute: 'ИКН' })).status,
    400,
  );
  for (const id of [100, 200, 300])
    assert.equal(
      (await call('/api/profile', id, { firstName: 'Иван', lastName: 'Иванов' })).status,
      200,
    );
  const first = await (await call('/api/groups', 100, { name: 'Первая', institute: 'ИКН' })).json();
  const second = await (
    await call('/api/groups', 100, { name: 'Вторая', institute: 'ИКН' })
  ).json();
  const id = first.group.id;
  await call('/api/join', 200, { code: first.group.inviteCode });
  await call('/api/join', 300, { code: first.group.inviteCode });
  assert.equal((await call('/api/groups/prefer', 200, { groupId: second.group.id })).status, 403);
  await call('/api/groups/prefer', 100, { groupId: id });
  assert.equal((await (await call('/api/state')).json()).group.id, id);
  const { today } = await import('../public/model.js');
  const s = store.read(id, { id: '100' });
  s.group.semesterStart = today();
  s.group.semesterEnd = today();
  s.lessons = [{ id: 'one', date: today(), start: '00:00', end: '23:59', subject: 'Test' }];
  store.save(s);
  let r = await call('/api/action', 200, {
    groupId: id,
    type: 'selfMark',
    payload: {
      date: today(),
      lessonId: 'one',
      status: 'excused',
      reason: 'По болезни',
      file: { filename: 'note.txt', data: 'data:application/octet-stream;base64,dGVzdA==' },
    },
  });
  assert.equal(r.status, 200);
  const x = (await r.json()).excuses[0];
  assert.equal((await call(`/api/excuse-file?groupId=${id}&id=${x.id}`, 300)).status, 403);
  const body = await (await call(`/api/excuse-file?groupId=${id}&id=${x.id}`, 100)).json();
  assert.equal(body.filename, 'note.txt');
  r = await call('/api/state?groupId=' + id, 300);
  assert.equal((await r.json()).excuses.length, 0);
  assert.equal(
    (await call('/api/groups/remove', 100, { groupId: id, confirmation: 'wrong' })).status,
    400,
  );
  assert.equal(
    (await call('/api/groups/remove', 100, { groupId: id, confirmation: 'Первая' })).status,
    200,
  );
  assert.equal((await call('/api/state?groupId=' + id, 200)).status, 403);
  assert.equal((await (await call('/api/state')).json()).group.id, second.group.id);
});
