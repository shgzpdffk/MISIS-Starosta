import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const seedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/misis-data.json');
export function catalogPath() {
  return resolve(
    process.env.MISIS_CATALOG_PATH ||
      resolve(dirname(process.env.DATABASE_PATH || './data/misis.sqlite'), 'misis-data.json'),
  );
}
export async function readCatalog(options = {}) {
  const target = options.persistentPath || catalogPath();
  let raw;
  try {
    raw = await readFile(target, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      raw = await readFile(options.seedPath || seedPath, 'utf8');
    } catch (seedError) {
      if (seedError.code !== 'ENOENT') throw seedError;
      // Fresh checkouts contain no official timetable data. The head loads it on demand.
      return { page: 'https://misis.ru/students/schedule/', fetchedAt: null, sources: [] };
    }
  }
  return JSON.parse(raw);
}
export async function saveCatalog(data, target = catalogPath()) {
  const serialized = JSON.stringify(data);
  await mkdir(dirname(target), { recursive: true });
  const temp = target + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, serialized, { mode: 0o600 });
    await rename(temp, target);
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
