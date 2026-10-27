import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.mjs';
import {
  DEFAULT_PREFS,
  quietUntil,
  announcementState,
  announcementTiming,
  validatePhoto,
  VERSION,
} from '../public/features.js';
import {
  scheduleAnnouncements,
  scheduleAbsenceWarnings,
  absenceWarnings,
} from '../server/features.mjs';
import { deliveryDecision } from '../server/delivery.mjs';
import { schedulePolls } from '../server/telegram.mjs';
import { today, dateAdd, markKey } from '../public/model.js';
import { greeting } from '../public/profile.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const head = { id: '100', name: 'Head' },
  student = { id: '200', name: 'Student' },
  other = { id: '300', name: 'Other' };
const file = { filename: 'example.txt', data: 'data:application/octet-stream;base64,dGVzdA==' };
const photo =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
function setup(t) {
  const db = new Store(':memory:');
  t.after(() => db.close());
  for (const u of [head, student, other])
    db.saveProfile(u, { firstName: 'Иван', lastName: 'Иванов' });
  const id = db.create(head, { name: 'Тест', institute: 'ИКН' });
  for (const u of [student, other]) db.join(u, db.read(id, head).group.inviteCode);
  const s = db.read(id, head);
  s.group.semesterStart = dateAdd(today(), -20);
  s.group.semesterEnd = dateAdd(today(), 20);
  s.members.forEach((m) => {
    m.joinedDate = s.group.semesterStart;
    m.subgroup = 1;
  });
  s.lessons = [
    { id: 'a', date: today(), start: '00:00', end: '23:59', subject: 'Математика', subgroups: [1] },
    { id: 'b', date: today(), start: '00:00', end: '23:59', subject: 'Физика', subgroups: [1] },
    { id: 'other', date: today(), start: '00:00', end: '23:59', subject: 'Чужая', subgroups: [2] },
  ];
  db.save(s);
  return { db, id };
}
function notification(id, p = {}) {
  return {
    user_id: student.id,
    payload: JSON.stringify({ groupId: id, category: 'announcements', text: 'notice', ...p }),
  };
}

test('Preferences are private, validated, persist and release notes acknowledgement does not erase settings', (t) => {
  const { db } = setup(t);
  db.setPreferences(student, { theme: 'light', largeText: true, polls: false, quietEnabled: true });
  assert.equal(db.profile(student).preferences.theme, 'light');
  assert.equal(db.profile(other).preferences.theme, 'dark');
  db.setPreferences(student, { seenVersion: VERSION });
  assert.equal(db.profile(student).preferences.polls, false);
  assert.equal(db.profile(student).preferences.seenVersion, VERSION);
  assert.throws(() => db.setPreferences(student, { polls: 'false' }));
  assert.throws(() => db.setPreferences(student, { theme: 'bad' }));
  assert.throws(() => db.setPreferences(student, { quietStart: '09:00', quietEnd: '09:00' }));
});
test('Quiet hours handle midnight, same-day intervals and exact boundaries in Moscow', () => {
  const p = { ...DEFAULT_PREFS, quietEnabled: true };
  assert.equal(
    quietUntil(p, new Date('2026-10-27T23:00:00+03:00')),
    Date.parse('2026-10-28T08:00:00+03:00'),
  );
  assert.equal(
    quietUntil(p, new Date('2026-10-28T07:59:00+03:00')),
    Date.parse('2026-10-28T08:00:00+03:00'),
  );
  assert.equal(quietUntil(p, new Date('2026-10-28T08:00:00+03:00')), null);
  assert.equal(
    quietUntil(
      { ...p, quietStart: '12:00', quietEnd: '14:00' },
      new Date('2026-10-28T13:00:00+03:00'),
    ),
    Date.parse('2026-10-28T14:00:00+03:00'),
  );
});
test('Delivery rechecks preferences, quiet hours, disabled legacy announcements and removed membership', (t) => {
  const { db, id } = setup(t),
    row = notification(id),
    now = new Date(today() + 'T23:10:00+03:00');
  assert.equal(deliveryDecision(db, row, now).status, 'ready');
  db.setPreferences(student, { quietEnabled: true });
  assert.equal(deliveryDecision(db, row, now).status, 'deferred');
  db.setPreferences(student, { announcements: false });
  assert.equal(deliveryDecision(db, row, now).status, 'suppressed');
  assert.equal(
    deliveryDecision(
      db,
      { ...notification(id, { category: undefined }), dedupe: 'announcement:legacy' },
      now,
    ).status,
    'suppressed',
  );
  db.removeGroup(student, id, 'Тест');
  assert.equal(deliveryDecision(db, row, now).status, 'expired');
});
test('Quiet polls that would outlive their lesson expire; changed quiet settings wake deferred rows', (t) => {
  const { db, id } = setup(t),
    s = db.read(id, head);
  s.lessons[0].start = '07:00';
  s.lessons[0].end = '07:50';
  db.save(s);
  db.setPreferences(student, { quietEnabled: true });
  const row = notification(id, {
    category: 'polls',
    poll: { groupId: id, date: today(), lessonId: 'a' },
  });
  assert.equal(deliveryDecision(db, row, new Date(today() + 'T06:55:00+03:00')).status, 'expired');
  db.enqueue('deferred', student.id, { text: 'x' });
  db.db.prepare("UPDATE outbox SET status='deferred',next_at=?").run(Date.now() + 86400000);
  db.setPreferences(student, { quietEnabled: false });
  assert.equal(db.db.prepare('SELECT status,next_at FROM outbox').get().status, 'pending');
  assert.equal(db.db.prepare('SELECT next_at FROM outbox').get().next_at, 0);
});
test('Scheduled announcements stay hidden until publication and enqueue once across scheduler retries', (t) => {
  const { db, id } = setup(t),
    later = new Date(Date.now() + 3600000),
    expiry = new Date(Date.now() + 7200000);
  db.action(id, head, 'announcement', {
    title: 'Завтра',
    text: 'Встреча',
    publishAt: later.toISOString(),
    expiresAt: expiry.toISOString(),
    requireAck: true,
  });
  assert.equal(db.snapshot(id, student).announcements.length, 0);
  assert.equal(db.db.prepare('SELECT count(*) n FROM outbox').get().n, 0);
  scheduleAnnouncements(db, new Date(later.getTime() + 1));
  scheduleAnnouncements(db, new Date(later.getTime() + 2));
  assert.equal(db.db.prepare('SELECT count(*) n FROM outbox').get().n, 3);
  const a = db.read(id, head).announcements[0];
  assert.equal(announcementState(a, expiry), 'archived');
  assert.equal(
    deliveryDecision(db, notification(id, { announcementId: a.id }), expiry).status,
    'expired',
  );
  assert.throws(() => db.announcementRead(id, student, a.id, true), /опубликовано/);
});
test('Publication validation rejects backwards expiry and invalid dates', () => {
  assert.throws(() => announcementTiming({ publishAt: 'not-a-date' }));
  assert.throws(() =>
    announcementTiming(
      { publishAt: '2026-10-27T12:00:00+03:00', expiresAt: '2026-10-27T11:00:00+03:00' },
      new Date('2026-10-27T09:00:00+03:00'),
    ),
  );
});
test('Read and acknowledgement are separate, idempotent and private to each student', (t) => {
  const { db, id } = setup(t);
  db.action(id, head, 'announcement', { title: 'Важно', text: 'Прочитай', requireAck: true });
  const a = db.read(id, head).announcements[0];
  db.announcementRead(id, student, a.id);
  const own = db.snapshot(id, student).announcements[0];
  assert.equal(own.read, true);
  assert.equal(own.acknowledged, false);
  assert.equal(own.acknowledgements, undefined);
  db.announcementRead(id, student, a.id, true);
  db.announcementRead(id, student, a.id, true);
  assert.equal(db.snapshot(id, student).announcements[0].acknowledged, true);
  assert.equal(db.snapshot(id, other).announcements[0].read, false);
  assert.equal(
    db.snapshot(id, head).announcements[0].acknowledgements.filter((m) => m.ackAt).length,
    1,
  );
  assert.throws(() => db.announcementRead(id, { id: '999' }, a.id), /доступа/);
});
test('Day answer marks only own subgroup, preserves prior marks and suppresses existing/future polls', (t) => {
  const { db, id } = setup(t),
    s = db.read(id, head);
  s.marks[markKey(today(), 'b', student.id)] = 'absent';
  db.save(s);
  db.enqueue('queued', student.id, { poll: { groupId: id, date: today(), lessonId: 'a' } });
  db.answerDay(id, student, { date: today(), enabled: true });
  const next = db.read(id, head);
  assert.equal(next.marks[markKey(today(), 'a', student.id)], 'present');
  assert.equal(next.marks[markKey(today(), 'b', student.id)], 'absent');
  assert.equal(next.marks[markKey(today(), 'other', student.id)], undefined);
  assert.equal(next.marks[markKey(today(), 'a', other.id)], undefined);
  assert.equal(db.db.prepare('SELECT status FROM outbox').get().status, 'suppressed');
  assert.equal(
    deliveryDecision(
      db,
      notification(id, { category: 'polls', poll: { groupId: id, date: today(), lessonId: 'a' } }),
    ).status,
    'suppressed',
  );
  schedulePolls(db, new Date(today() + 'T00:00:00+03:00'));
  assert.equal(db.db.prepare('SELECT count(*) n FROM outbox WHERE user_id=?').get(student.id).n, 1);
  assert.throws(
    () => db.answerDay(id, student, { date: dateAdd(today(), -1), enabled: true }),
    /сегодня/,
  );
  assert.equal(db.answeredDay(id, student.id, dateAdd(today(), 1)), false);
});
test('Cancelling day answer removes only auto marks, preserving head corrections even to present', (t) => {
  const { db, id } = setup(t);
  db.answerDay(id, student, { date: today(), enabled: true });
  db.action(id, head, 'mark', {
    date: today(),
    lessonId: 'a',
    memberId: student.id,
    status: 'present',
  });
  db.answerDay(id, student, { date: today(), enabled: false });
  const s = db.read(id, head);
  assert.equal(s.marks[markKey(today(), 'a', student.id)], 'present');
  assert.equal(s.marks[markKey(today(), 'b', student.id)], undefined);
  assert.equal(db.answeredDay(id, student.id, today()), false);
});
test('Group card supports one validated photo, replacement/removal, and only head edits', (t) => {
  const { db, id } = setup(t);
  assert.throws(() => db.action(id, student, 'groupCard', { text: 'hack' }), /старосте/);
  db.action(id, head, 'groupCard', { text: 'Контакты https://misis.ru', photo });
  assert.equal(db.snapshot(id, student).group.card.photo, photo);
  db.action(id, head, 'groupCard', { text: 'Изменённый текст' });
  assert.equal(db.read(id, head).group.card.photo, photo);
  assert.throws(() => validatePhoto([photo, photo]));
  assert.throws(() => validatePhoto('data:image/svg+xml;base64,PHN2Zz4='));
  assert.throws(() => validatePhoto('data:image/png;base64,dGVzdA=='));
  db.action(id, head, 'groupCard', { photo: null });
  assert.equal(db.read(id, head).group.card.photo, null);
});
test('Head requests, attachments and replies are visible only to sender and head', (t) => {
  const { db, id } = setup(t);
  const r = db.createRequest(student, {
    kind: 'head',
    groupId: id,
    title: 'Вопрос',
    text: 'Когда консультация?',
    file,
  });
  assert.equal(db.requestsFor(other, id).length, 0);
  assert.equal(db.requestsFor(head, id).length, 1);
  assert.equal(db.requestsFor(student, id)[0].data, undefined);
  assert.throws(() => db.requestFile(other, r.id), /доступа/);
  assert.equal(db.requestFile(head, r.id).data, file.data);
  assert.throws(() => db.replyRequest(other, r.id, 'Ответ'), /староста/);
  db.replyRequest(head, r.id, 'В среду');
  assert.equal(db.requestsFor(student, id)[0].reply, 'В среду');
  assert.throws(() => db.replyRequest(head, r.id, 'Повтор'), /уже/);
  assert.equal(db.db.prepare('SELECT count(*) n FROM outbox').get().n, 3);
});
test('Bug reports retain author identity and time, stay server-only and enforce daily limit', (t) => {
  const { db } = setup(t);
  const r = db.createRequest(student, {
    kind: 'bug',
    title: 'Ошибка',
    text: 'Не открывается',
    file,
  });
  assert.equal(r.forwardingConfigured, false);
  assert.equal(db.db.prepare('SELECT count(*) n FROM outbox').get().n, 0);
  const record = db.requestsFor(student)[0];
  assert.equal(record.author_name, 'Иванов Иван');
  assert.ok(record.created_at);
  assert.equal(record.user_id, student.id);
  db.saveProfile(student, { firstName: 'Пётр', lastName: 'Петров' });
  assert.equal(db.requestsFor(student)[0].author_name, 'Иванов Иван');
  assert.equal(db.requestsFor(head).length, 0);
  assert.throws(() => db.requestFile(head, r.id), /доступа/);
  for (let i = 0; i < 4; i++)
    db.createRequest(student, { kind: 'bug', title: 'Ошибка', text: 'Описание' });
  assert.throws(
    () => db.createRequest(student, { kind: 'bug', title: 'Ошибка', text: 'Описание' }),
    /Лимит/,
  );
});
test('Personal absence warnings ignore unknown/excused and queue only once per subject threshold per semester', (t) => {
  const { db, id } = setup(t),
    s = db.read(id, head);
  for (let i = 1; i <= 3; i++) {
    const date = dateAdd(today(), -i),
      lid = 'past' + i;
    s.lessons.push({ id: lid, date, start: '09:00', end: '10:00', subject: 'Математика' });
    s.marks[markKey(date, lid, student.id)] = 'absent';
    s.marks[markKey(date, lid, other.id)] = 'excused';
  }
  db.save(s);
  assert.equal(absenceWarnings(s, student.id)[0].count, 3);
  assert.deepEqual(absenceWarnings(s, other.id), []);
  scheduleAbsenceWarnings(db);
  scheduleAbsenceWarnings(db);
  assert.equal(db.db.prepare('SELECT count(*) n FROM outbox').get().n, 1);
  assert.equal(db.snapshot(id, other).absenceWarnings.length, 0);
  const row = db.db.prepare('SELECT * FROM outbox').get();
  s.marks[markKey(dateAdd(today(), -1), 'past1', student.id)] = 'present';
  db.save(s);
  assert.equal(deliveryDecision(db, row).status, 'expired');
});
test('New greeting probabilities: 1% rare, 25% announcement, 15% bench, 25% channel, 34% normal', () => {
  const counts = { rare: 0, announcement: 0, bench: 0, channel: 0, normal: 0 };
  for (let i = 0; i < 10000; i++) {
    const g = greeting('Иван', new Date('2026-10-27T09:00:00Z'), (i + 0.5) / 10000);
    if (g === 'АНООООООООНС') counts.announcement++;
    else if (g === 'Однажды у меня был глюк, что я стал лавочкой') counts.bench++;
    else if (g === 'tgk: shgzpdffkk') counts.channel++;
    else if (g.startsWith('Добрый')) counts.normal++;
    else counts.rare++;
  }
  assert.deepEqual(counts, {
    rare: 100,
    announcement: 2500,
    bench: 1500,
    channel: 2500,
    normal: 3400,
  });
});
test('Upgrade from v0.2 preserves groups and creates backup before new tables; preferences survive restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'misis-v03-')),
    path = join(dir, 'db.sqlite');
  let db;
  try {
    db = new Store(path);
    db.saveProfile(head, { firstName: 'Иван', lastName: 'Иванов' });
    const id = db.create(head, { name: 'Старая', institute: 'ИКН' });
    db.prefer(head, id);
    for (const table of [
      'preferences',
      'announcement_reads',
      'day_answers',
      'auto_marks',
      'requests',
    ])
      db.db.exec('DROP TABLE ' + table);
    db.close();
    db = new Store(path);
    assert.equal(db.profile(head).defaultGroupId, id);
    assert.ok(existsSync(path + '.pre-v0.3.0-backup'));
    const old = new DatabaseSync(path + '.pre-v0.3.0-backup', { readOnly: true });
    assert.equal(
      old.prepare("SELECT 1 FROM sqlite_master WHERE name='preferences'").get(),
      undefined,
    );
    assert.equal(old.prepare('SELECT count(*) n FROM groups').get().n, 1);
    old.close();
    db.setPreferences(head, { theme: 'telegram', largeText: true, seenVersion: VERSION });
    db.close();
    db = new Store(path);
    assert.equal(db.profile(head).preferences.theme, 'telegram');
    assert.equal(db.profile(head).preferences.seenVersion, VERSION);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Owner terminal utility lists bug author/time and exports attachment without overwriting files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'misis-support-')),
    path = join(dir, 'db.sqlite'),
    script = fileURLToPath(new URL('../scripts/requests.mjs', import.meta.url));
  let db;
  try {
    db = new Store(path);
    db.saveProfile(student, { firstName: 'Анна', lastName: 'Иванова' });
    const r = db.createRequest(student, { kind: 'bug', title: 'Проблема', text: 'Описание', file });
    const run = (args) =>
      execFileSync(process.execPath, [script, ...args], {
        env: { ...process.env, DATABASE_PATH: path },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const list = JSON.parse(run([]));
    assert.equal(list[0].author_name, 'Иванова Анна');
    assert.equal(list[0].user_id, student.id);
    assert.ok(list[0].created_at);
    assert.equal(list[0].data, undefined);
    const target = join(dir, 'attachment.txt');
    run(['--id', r.id, '--file', target]);
    assert.ok(existsSync(target));
    assert.throws(() => run(['--id', r.id, '--file', target]));
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
