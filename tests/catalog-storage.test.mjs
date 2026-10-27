import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCatalog, saveCatalog } from '../server/catalog-storage.mjs';
import { Store } from '../server/store.mjs';

test('Persistent catalog survives source replacement and does not modify shipped seed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'misis-storage-'));
  try {
    const seed = join(dir, 'seed.json'),
      persistent = join(dir, 'data', 'misis-data.json');
    await writeFile(seed, JSON.stringify({ revision: 1 }));
    assert.equal((await readCatalog({ seedPath: seed, persistentPath: persistent })).revision, 1);
    await saveCatalog({ revision: 2 }, persistent);
    assert.equal(JSON.parse(await readFile(seed, 'utf8')).revision, 1);
    await writeFile(seed, JSON.stringify({ revision: 3 }));
    assert.equal((await readCatalog({ seedPath: seed, persistentPath: persistent })).revision, 2);
    await writeFile(persistent, 'broken');
    await assert.rejects(
      () => readCatalog({ seedPath: seed, persistentPath: persistent }),
      SyntaxError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('SQLite group and member persist after the database is closed and reopened', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'misis-db-'));
  try {
    const path = join(dir, 'misis.sqlite'),
      user = { id: '701', name: 'Тест' };
    let store = new Store(path);
    const id = store.create(user, { name: 'Тест-1', institute: 'ИКН' });
    store.close();
    store = new Store(path);
    try {
      assert.equal(store.read(id, user).group.name, 'Тест-1');
      assert.equal(store.read(id, user).role, 'head');
    } finally {
      store.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('A fresh checkout returns an empty catalog; corrupted seed is not silently hidden', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'misis-empty-'));
  try {
    const options = { seedPath: join(dir, 'seed.json'), persistentPath: join(dir, 'data.json') };
    assert.deepEqual((await readCatalog(options)).sources, []);
    await writeFile(options.seedPath, '{broken');
    await assert.rejects(() => readCatalog(options), SyntaxError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
