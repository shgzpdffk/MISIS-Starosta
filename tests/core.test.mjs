import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateInitData } from '../server/auth.mjs';
import { Store } from '../server/store.mjs';
import { applyAction } from '../public/actions.js';
import {
  seed,
  parity,
  lessonsOn,
  attendanceSummary,
  dateAdd,
  today,
  reportRows,
} from '../public/model.js';
import { makeXlsx } from '../public/xlsx.js';
import { schedulePolls } from '../server/telegram.mjs';
const token = '123:test-token';
const head = { id: '100', name: 'Староста Тест' },
  student = { id: '200', name: 'Студент Тест' },
  stranger = { id: '300', name: 'Другой Тест' };
function signed(overrides = {}) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 100, first_name: 'Тест' }),
    ...overrides,
  });
  const check = [...p]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}
function fixture() {
  const db = new Store(':memory:');
  const id = db.create(head, { name: 'БИВТ-24-1', institute: 'ИКН' });
  const s = db.read(id, head);
  db.join(student, s.group.inviteCode);
  return { db, id };
}
test('Telegram: valid signature returns verified user', () =>
  assert.equal(validateInitData(signed(), token).id, '100'));
test('Telegram: forged user rejected', () =>
  assert.throws(() => validateInitData(signed().replace('100', '101'), token), /подпись/));
test('Telegram: expired, future, malformed and duplicate auth rejected', () => {
  for (const raw of [
    signed({ auth_date: '1' }),
    signed({ auth_date: String(Math.floor(Date.now() / 1000) + 3600) }),
    signed() + '&user={}',
    'hash=bad',
  ])
    assert.throws(() => validateInitData(raw, token));
  assert.throws(() => validateInitData(signed(), ''));
});
test('Creator becomes head, joining user becomes student; duplicate join is idempotent', () => {
  const { db, id } = fixture();
  assert.equal(db.read(id, head).role, 'head');
  assert.equal(db.read(id, student).role, 'student');
  db.join(student, db.read(id, head).group.inviteCode);
  assert.equal(db.read(id, head).members.length, 2);
  db.close();
});
test('Group data cannot be read by a stranger', () => {
  const { db, id } = fixture();
  assert.throws(() => db.read(id, stranger), /доступа/);
  db.close();
});
test('Student cannot edit group or impersonate role in payload', () => {
  const { db, id } = fixture();
  assert.throws(
    () => db.action(id, student, 'settings', { role: 'head', name: 'Взлом' }),
    /старосте/,
  );
  assert.equal(db.read(id, head).group.name, 'БИВТ-24-1');
  db.close();
});
test('Student snapshot hides other students, invitation and attendance', () => {
  const { db, id } = fixture();
  const s = db.read(id, head);
  s.marks['2026-10-01|l1|100'] = 'absent';
  s.marks['2026-10-01|l1|200'] = 'present';
  db.save(s);
  const view = db.snapshot(id, student);
  assert.equal(view.group.inviteCode, undefined);
  assert.deepEqual(
    view.members.map((m) => m.id),
    ['200'],
  );
  assert.deepEqual(Object.keys(view.marks), ['2026-10-01|l1|200']);
  db.close();
});
test('Failed mutation rolls back database transaction', () => {
  const { db, id } = fixture();
  assert.throws(() =>
    db.action(id, head, 'settings', {
      name: 'New',
      semesterStart: '2026-01-01',
      semesterEnd: '2030-01-01',
    }),
  );
  assert.equal(db.read(id, head).group.name, 'БИВТ-24-1');
  db.close();
});
test('Self mark cannot target another user even when payload includes their id', () => {
  const s = seed();
  let l = lessonsOn(s, today())[0];
  if (!l) {
    l = { ...s.lessons[0], id: 'extra', date: today() };
    s.lessons.push(l);
  }
  applyAction(
    s,
    'selfMark',
    { date: today(), memberId: 'm2', lessonId: l.id, status: 'late' },
    { userId: 'm1', role: 'student', demo: true },
  );
  assert.equal(s.marks[`${today()}|${l.id}|m1`], 'late');
});
test('Server self mark rejects a past day', () => {
  const s = seed();
  const d = dateAdd(today(), -7),
    l = lessonsOn(s, d)[0];
  if (l)
    assert.throws(
      () =>
        applyAction(
          s,
          'selfMark',
          { date: d, lessonId: l.id, status: 'present' },
          { userId: 'm1', role: 'student' },
        ),
      /сегодня/,
    );
});
test('Attendance rejects invalid status, future date, unknown student and lesson', () => {
  const s = seed();
  for (const p of [
    { date: dateAdd(today(), 1), memberId: 'm1', lessonId: 'l1', status: 'present' },
    { date: today(), memberId: 'missing', lessonId: 'l1', status: 'present' },
    { date: today(), memberId: 'm1', lessonId: 'bad', status: 'present' },
    { date: today(), memberId: 'm1', lessonId: 'l1', status: 'bad' },
  ])
    assert.throws(() => applyAction(s, 'mark', p, { role: 'head', userId: 'm1' }));
});
test('Week parity changes on Monday and honors firstWeek', () => {
  const g = { semesterStart: '2026-09-01', firstWeek: 'odd' };
  assert.equal(parity('2026-09-06', g), 'odd');
  assert.equal(parity('2026-09-07', g), 'even');
  assert.equal(parity('2026-09-14', g), 'odd');
});
test('Timetable respects semester, breaks, dated lessons and floating mode', () => {
  const s = seed();
  s.group.semesterStart = '2026-09-01';
  s.group.semesterEnd = '2026-12-31';
  assert.equal(lessonsOn(s, '2026-08-31').length, 0);
  assert.ok(lessonsOn(s, '2026-10-26').length);
  s.breaks = [{ start: '2026-10-26', end: '2026-10-30' }];
  assert.equal(lessonsOn(s, '2026-10-26').length, 0);
  s.breaks = [];
  s.group.floating = true;
  assert.equal(lessonsOn(s, '2026-10-26').length, 0);
  s.lessons.push({ id: 'date', date: '2026-10-26', start: '09:00' });
  assert.equal(lessonsOn(s, '2026-10-26').length, 1);
});
test('Unknown responses stay separate from absences and membership start is respected', () => {
  const s = seed();
  s.marks = {};
  s.members[0].joinedDate = today();
  const v = attendanceSummary(s, 'm1');
  assert.equal(v.absent, 0);
  assert.equal(v.unknown, v.total);
  assert.equal(v.total, lessonsOn(s, today()).length);
});
test('Material URLs reject executable protocols', () => {
  const s = seed();
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'http://example.com'])
    assert.throws(() =>
      applyAction(s, 'material', { title: 'Test', subject: 'Test', url }, { role: 'head' }),
    );
});
test('New announcement queues one notification per member', () => {
  const { db, id } = fixture();
  db.action(id, head, 'announcement', { title: 'Тест', text: 'Сообщение' });
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM outbox').get().n, 2);
  db.close();
});
test('Poll scheduling survives repeated runs without duplicate messages', () => {
  const { db, id } = fixture(),
    s = db.read(id, head);
  s.group.semesterStart = '2026-09-01';
  s.group.semesterEnd = '2026-12-31';
  s.lessons = [
    { id: 'l1', date: '2026-10-26', start: '09:00', end: '10:35', subject: 'Test', room: '1' },
  ];
  db.save(s);
  const now = new Date('2026-10-26T05:50:00Z');
  schedulePolls(db, now);
  schedulePolls(db, now);
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM outbox').get().n, 1);
  db.close();
});
test('Excel export is a real ZIP workbook with UTF-8 data', () => {
  const bytes = makeXlsx([
    ['Имя', 'На паре'],
    ['=HYPERLINK("evil")', 3],
  ]);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const decoded = new TextDecoder().decode(bytes);
  assert.ok(decoded.includes('xl/worksheets/sheet1.xml'));
  assert.ok(decoded.includes('inlineStr'));
  assert.ok(!decoded.includes('<f>'));
  assert.ok(decoded.includes('Имя'));
});
test('Report totals and columns are consistent', () => {
  const s = seed(),
    rows = reportRows(s, 'week');
  assert.equal(rows.length, s.members.length + 1);
  for (const row of rows) assert.equal(row.length, rows[0].length);
  assert.equal(rows[0][0], 'Студент');
});

test('Student can choose own subgroup but cannot change another member', () => {
  const { db, id } = fixture(),
    s = db.read(id, head);
  s.group.subgroups = [1, 2];
  db.save(s);
  db.action(id, student, 'profile', { subgroup: 2, memberId: head.id });
  assert.equal(db.read(id, student).members.find((m) => m.id === student.id).subgroup, 2);
  assert.equal(db.read(id, head).members.find((m) => m.id === head.id).subgroup, undefined);
  assert.throws(() => db.action(id, student, 'profile', { subgroup: 3 }));
  db.close();
});
test('Statistics exclude lessons assigned to another subgroup', () => {
  const s = seed();
  s.members[0].subgroup = 1;
  s.lessons = s.lessons.map((l) => ({ ...l, subgroups: [2] }));
  assert.equal(attendanceSummary(s, 'm1').total, 0);
});
