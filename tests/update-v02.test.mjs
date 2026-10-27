import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.mjs';
import {
  greeting,
  realName,
  attendanceDays,
  sortMembers,
  validateExcuse,
} from '../public/profile.js';
import { today, markKey } from '../public/model.js';
import { excuseUrl, schedulePolls } from '../server/telegram.mjs';
const head = { id: '101', name: 'Telegram head' },
  student = { id: '202', name: 'Nickname' },
  other = { id: '303', name: 'Another' };
const file = { filename: 'справка.pdf', data: 'data:application/octet-stream;base64,JVBERi0=' };
function setup(t, path = ':memory:') {
  const db = new Store(path);
  t.after(() => db.close());
  for (const u of [head, student, other])
    db.saveProfile(u, { firstName: 'Иван', lastName: u === student ? 'Яковлев' : 'Андреев' });
  const id = db.create(head, { name: 'Тест-26', institute: 'ИКН' });
  const s = db.read(id, head);
  db.join(student, s.group.inviteCode);
  db.join(other, s.group.inviteCode);
  const state = db.read(id, head);
  state.group.semesterStart = today();
  state.group.semesterEnd = today();
  state.lessons = [
    {
      id: 'lesson',
      date: today(),
      start: '00:00',
      end: '23:59',
      subject: 'Математика',
      week: 'all',
      day: 1,
    },
  ];
  db.save(state);
  return { db, id };
}
const excuse = {
  date: today(),
  lessonId: 'lesson',
  status: 'excused',
  reason: 'Приём врача',
  file,
};
test('Profile requires real names, updates all rosters and never copies the Telegram nickname over them', (t) => {
  const { db, id } = setup(t);
  const second = db.create(student, { name: 'Вторая', institute: 'ИТ' });
  db.saveProfile(student, { firstName: 'Анна-Мария', lastName: 'Ёлкина' });
  assert.equal(
    db.read(id, head).members.find((m) => m.id === student.id).name,
    'Ёлкина Анна-Мария',
  );
  assert.equal(db.read(second, student).members[0].name, 'Ёлкина Анна-Мария');
  assert.equal(db.profile({ ...student, name: 'New nick' }).name, 'Ёлкина Анна-Мария');
  for (const x of ['', '@user', '123', '<script>', 'a'.repeat(71)])
    assert.throws(() => realName(x, 'Имя'));
  assert.equal(realName('  Иван  ', 'Имя'), 'Иван');
});
test('Default group is per user, persists, and cannot point to another user’s group', (t) => {
  const { db } = setup(t);
  const second = db.create(student, { name: 'Вторая', institute: 'ИТ' });
  db.prefer(student, second);
  assert.equal(db.list(student)[0].id, second);
  assert.equal(db.list(head)[0].preferred, false);
  assert.throws(() => db.prefer(head, second), /доступа/);
  db.saveProfile(student, { firstName: 'Пётр', lastName: 'Яковлев' });
  assert.equal(db.profile(student).defaultGroupId, second);
  db.prefer(student, null);
  assert.equal(db.profile(student).defaultGroupId, null);
});
test('Leaving keeps history, removes access/default/polls, stops scheduling and allows rejoining', (t) => {
  const { db, id } = setup(t);
  db.prefer(student, id);
  db.action(id, student, 'selfMark', { ...excuse, status: 'present' });
  db.enqueue('poll-before', student.id, { poll: { groupId: id } });
  assert.throws(() => db.removeGroup(student, id, 'wrong'), /подтверждения/);
  db.removeGroup(student, id, 'Тест-26');
  assert.throws(() => db.read(id, student), /доступа/);
  assert.equal(db.profile(student).defaultGroupId, null);
  const s = db.read(id, head);
  assert.equal(s.members.find((m) => m.id === student.id).active, false);
  assert.equal(s.marks[markKey(today(), 'lesson', student.id)], 'present');
  assert.equal(db.db.prepare('SELECT count(*) n FROM outbox WHERE user_id=?').get(student.id).n, 0);
  schedulePolls(db, new Date(today() + 'T00:00:00+03:00'));
  assert.equal(db.db.prepare('SELECT count(*) n FROM outbox WHERE user_id=?').get(student.id).n, 0);
  db.join(student, s.group.inviteCode);
  assert.equal(db.read(id, student).members.filter((m) => m.id === student.id).length, 1);
  assert.equal(db.read(id, student).members.find((m) => m.id === student.id).active, true);
});
test('Owner deletion removes group, membership, excuses, queue and all default pointers', (t) => {
  const { db, id } = setup(t);
  db.action(id, student, 'selfMark', excuse);
  db.prefer(head, id);
  db.prefer(student, id);
  assert.throws(() => db.removeGroup({ id: '999' }, id, 'Тест-26'), /доступа/);
  db.removeGroup(head, id, 'Тест-26');
  for (const table of ['groups', 'members', 'excuses', 'outbox'])
    assert.equal(db.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal(db.profile(student).defaultGroupId, null);
  assert.equal(db.profile(head).defaultGroupId, null);
});
test('Excuse saves mark and queues reason/document; other students cannot read the reason or file', (t) => {
  const { db, id } = setup(t);
  db.action(id, student, 'selfMark', excuse);
  const x = db.snapshot(id, head).excuses[0];
  assert.equal(x.reason, 'Приём врача');
  assert.equal(x.data, undefined);
  assert.ok(x.hasFile);
  assert.equal(db.snapshot(id, other).excuses.length, 0);
  assert.throws(() => db.excuseFile(id, other, x.id), /доступа/);
  assert.equal(db.excuseFile(id, student, x.id).data, file.data);
  assert.equal(db.excuseFile(id, head, x.id).data, file.data);
  const queue = db.db.prepare('SELECT * FROM outbox').all();
  assert.equal(queue.length, 2);
  assert.ok(queue.every((q) => q.user_id === head.id));
  assert.ok(queue.some((q) => JSON.parse(q.payload).document));
  assert.ok(queue.every((q) => !q.payload.includes('base64')));
  db.action(id, student, 'selfMark', { ...excuse, reason: 'Уточнение', file: null });
  assert.equal(db.snapshot(id, head).excuses.length, 1);
  assert.equal(db.snapshot(id, head).excuses[0].hasFile, false);
  assert.throws(() => db.excuseFile(id, student, x.id), /доступа/);
});
test('Empty/invalid excuses roll back marks, attachments enforce size and cannot target another student', (t) => {
  const { db, id } = setup(t);
  assert.throws(
    () => db.action(id, student, 'selfMark', { ...excuse, reason: '', file: null }),
    /причину/,
  );
  assert.equal(Object.keys(db.read(id, head).marks).length, 0);
  assert.throws(() => validateExcuse({ file: { filename: '../x', data: file.data } }), /имя/);
  assert.throws(
    () =>
      validateExcuse({
        file: {
          filename: 'x',
          data:
            'data:application/octet-stream;base64,' +
            Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'),
        },
      }),
    /2 МБ/,
  );
  db.action(id, student, 'selfMark', { ...excuse, memberId: other.id });
  assert.equal(db.snapshot(id, head).excuses[0].user_id, student.id);
});
test('Legacy database upgrade creates recoverable backup, preserves marks and asks existing users for names', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'starosta-upgrade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'db.sqlite');
  let db = new Store(path);
  const id = db.create(head, { name: 'Старая группа', institute: 'ИКН' });
  const s = db.read(id, head);
  s.marks['2026-10-01|old|101'] = 'present';
  db.save(s);
  db.db.exec('DROP TABLE excuses; DROP TABLE user_profiles');
  db.close();
  db = new Store(path);
  assert.ok(existsSync(path + '.pre-v0.2.0-backup'));
  assert.equal(db.profile(head).complete, false);
  assert.equal(db.read(id, head).marks['2026-10-01|old|101'], 'present');
  db.saveProfile(head, { firstName: 'Иван', lastName: 'Иванов' });
  db.prefer(head, id);
  db.close();
  db = new Store(path);
  assert.equal(db.profile(head).complete, true);
  assert.equal(db.profile(head).defaultGroupId, id);
  db.close();
  const old = new DatabaseSync(path + '.pre-v0.2.0-backup', { readOnly: true });
  assert.equal(old.prepare('SELECT count(*) n FROM groups').get().n, 1);
  assert.equal(
    old.prepare("SELECT 1 FROM sqlite_master WHERE name='user_profiles'").get(),
    undefined,
  );
  old.close();
});
test('Heatmap excludes future lessons, breaks, other subgroups, and dates before joining; unknown is not absent', () => {
  const s = {
    group: { semesterStart: '2026-10-01', semesterEnd: '2026-12-31', firstWeek: 'odd' },
    members: [{ id: '1', joinedDate: '2026-10-26', subgroup: 1 }],
    breaks: [],
    lessons: [
      { id: 'past', date: '2026-10-25', start: '09:00', end: '10:00' },
      { id: 'done', date: '2026-10-26', start: '09:00', end: '10:00' },
      { id: 'future', date: '2026-10-26', start: '20:00', end: '21:00' },
      { id: 'other', date: '2026-10-26', start: '09:00', end: '10:00', subgroups: [2] },
    ],
    marks: {},
  };
  const now = new Date('2026-10-26T12:00:00+03:00');
  const days = attendanceDays(s, '1', now);
  assert.equal(days.find((d) => d.date === '2026-10-25').total, 0);
  assert.equal(days.at(-1).total, 1);
  assert.equal(days.at(-1).tone, 'unanswered');
  assert.equal(days.at(-1).counts.absent, 0);
  s.marks['2026-10-26|done|1'] = 'late';
  assert.equal(attendanceDays(s, '1', now).at(-1).tone, 'level-4');
  s.breaks = [{ start: '2026-10-26', end: '2026-10-26' }];
  assert.equal(attendanceDays(s, '1', now).at(-1).total, 0);
});
test('Greeting uses Moscow time and all three Easter eggs occupy exactly one percent of draws', () => {
  assert.equal(greeting('Иван', new Date('2026-10-26T06:00:00Z'), 0.9), 'Доброе утро, Иван');
  assert.equal(greeting('Иван', new Date('2026-10-26T12:00:00Z'), 0.9), 'Добрый день, Иван');
  assert.match(greeting('Иван', new Date('2026-10-26T17:00:00Z'), 0.9), /^Добрый вечер/);
  assert.match(greeting('Иван', new Date('2026-10-26T22:00:00Z'), 0.9), /^Доброй ночи/);
  assert.equal(greeting('Иван', new Date(), 0), 'Ты сделал лабу по вычмашу? Иван');
  assert.equal(greeting('Иван', new Date(), 0.004), 'Это че за эндерваси');
  assert.equal(greeting('Иван', new Date(), 0.0099), 'Это че за квартирант');
  assert.ok(!greeting('Иван', new Date(), 0.01).startsWith('Это'));
  assert.deepEqual(
    sortMembers([{ name: 'Яковлев Иван' }, { name: 'Андреев Пётр' }]).map((x) => x.name),
    ['Андреев Пётр', 'Яковлев Иван'],
  );
});
test('Telegram excuse button links to the right group, lesson and day', () => {
  const u = new URL(
    excuseUrl('https://example.com/', { groupId: 'g', lessonId: 'l', date: '2026-10-26' }),
  );
  assert.equal(u.searchParams.get('group'), 'g');
  assert.equal(u.searchParams.get('excuse'), 'l');
  assert.equal(u.searchParams.get('date'), '2026-10-26');
});
