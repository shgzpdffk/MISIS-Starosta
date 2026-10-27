import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { importSchedule } from '../server/misis.mjs';
const source = {
  id: 'test-institute',
  name: 'Тестовый институт',
  url: 'https://misis.ru/students/schedule/',
  fetchedAt: '2026-09-01T00:00:00Z',
  groups: [
    {
      name: 'ТЕСТ-1',
      subgroups: [1, 2],
      unparsed: [],
      lessons: [
        {
          id: 'misis-test',
          day: 1,
          start: '10:50',
          end: '12:20',
          subject: 'Учебный предмет',
          type: 'Лекция',
          teacher: '',
          room: '101',
          week: 'odd',
          subgroups: [1, 2],
        },
      ],
    },
  ],
};
test('Official import is authorized, repeatable, and does not overwrite manual lessons', () => {
  const db = new Store(':memory:'),
    user = { id: '1', name: 'Test' },
    id = db.create(user, { name: 'Test', institute: 'Test' });
  const g = source.groups[0];
  const s = db.read(id, user);
  s.lessons = [
    {
      id: 'manual',
      day: 1,
      start: '08:00',
      end: '09:00',
      subject: 'Manual',
      week: 'all',
      type: 'Лекция',
    },
  ];
  db.save(s);
  const p = { upperWeek: 'odd', acceptPartial: false };
  importSchedule(db, user, id, p, source, g);
  const count = db.read(id, user).lessons.length;
  importSchedule(db, user, id, p, source, g);
  assert.equal(db.read(id, user).lessons.length, count);
  assert.ok(db.read(id, user).lessons.some((l) => l.id === 'manual'));
  assert.equal(db.read(id, user).group.source.academicGroup, g.name);
  db.close();
});
test('Partial official import requires explicit acknowledgement', () => {
  const db = new Store(':memory:'),
    user = { id: '1', name: 'Test' },
    id = db.create(user, { name: 'Test', institute: 'Test' });
  const g = {
    ...source.groups[0],
    unparsed: [{ text: 'Учебный предмет, 3 нед.', reason: 'Нужна ручная проверка' }],
  };
  assert.throws(
    () => importSchedule(db, user, id, { upperWeek: 'odd' }, source, g),
    /нераспознанные/,
  );
  db.close();
});
