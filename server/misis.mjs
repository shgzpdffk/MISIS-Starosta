import { readCatalog, saveCatalog } from './catalog-storage.mjs';
import { readFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { dateAdd, today } from '../public/model.js';
import { validateLesson } from '../public/actions.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  run = promisify(execFile);
let refreshing = null,
  lastAttempt = 0;
export async function catalog() {
  return readCatalog();
}
export async function refresh() {
  if (refreshing) return refreshing;
  if (Date.now() - lastAttempt < 60000) throw new Error('Повторить обновление можно через минуту');
  lastAttempt = Date.now();
  refreshing = (async () => {
    const tmp = resolve(tmpdir(), 'misis-' + randomUUID() + '.json');
    try {
      await run(
        process.env.PYTHON_BIN || 'python3',
        [resolve(root, 'scripts/misis.py'), '--output', tmp],
        { timeout: 150000, maxBuffer: 1024 * 1024 },
      );
      const next = JSON.parse(await readFile(tmp, 'utf8'));
      const previous = await catalog().catch(() => ({ sources: [] }));
      for (const source of next.sources) {
        if (source.error) {
          const old = previous.sources.find((s) => s.id === source.id);
          if (old?.groups?.length) {
            source.groups = old.groups;
            source.fetchedAt = old.fetchedAt;
            source.stale = true;
          }
        }
      }
      if (!next.sources.some((s) => s.groups?.length))
        throw new Error('МИСИС временно недоступен. Предыдущая версия расписания сохранена.');
      await saveCatalog(next);
      return next;
    } finally {
      await unlink(tmp).catch(() => {});
    }
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}
export function importSchedule(store, user, groupId, p, source, academic) {
  return store.transaction(() => {
    const s = store.read(groupId, user);
    if (s.role !== 'head')
      throw Object.assign(new Error('Импорт доступен только старосте'), { status: 403 });
    if (!['odd', 'even'].includes(p.upperWeek)) throw new Error('Укажи тип верхней строки');
    if (academic.unparsed?.length && !p.acceptPartial)
      throw new Error('В файле есть нераспознанные занятия. Проверь их перед импортом.');
    const start = today(),
      previousEnd = dateAdd(start, -1);
    // Preserve historical lessons and marks; apply refreshed templates from today.
    const imported = academic.lessons.map((raw) => {
      const l = validateLesson({
        ...raw,
        id: raw.id + '-' + start,
        week:
          p.upperWeek === 'odd'
            ? raw.week
            : raw.week === 'all'
              ? 'all'
              : raw.week === 'odd'
                ? 'even'
                : 'odd',
      });
      return {
        ...l,
        subgroups: raw.subgroups,
        sourceCell: raw.sourceCell,
        source: 'misis',
        validFrom: start,
      };
    });
    const historical = s.lessons
      .filter((l) => l.source !== 'misis' || l.validFrom < start)
      .map((l) =>
        l.source === 'misis' && (!l.validTo || l.validTo >= start)
          ? { ...l, validTo: previousEnd }
          : l,
      );
    if (historical.length + imported.length > 2000)
      throw new Error('Слишком много версий расписания. Нужен новый семестр.');
    s.lessons = [...historical, ...imported];
    s.group.source = {
      name: source.name,
      url: source.url,
      academicGroup: academic.name,
      upperWeek: p.upperWeek,
      syncedAt: new Date().toISOString(),
      fetchedAt: source.fetchedAt,
    };
    s.group.subgroups = academic.subgroups;
    s.group.name = academic.name;
    s.group.institute = source.name;
    store.save(s);
    return s;
  });
}
