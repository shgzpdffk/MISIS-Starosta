import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PREFS,
  validatePreferences,
  announcementState,
  VERSION,
  moscowDate,
  moscowTime,
} from '../public/features.js';
import { validateExcuse } from '../public/profile.js';
import { text } from '../public/actions.js';
import { lessonsOn, appliesTo, attendanceSummary, markKey } from '../public/model.js';

// Store methods are installed on Store.prototype in store.mjs to share one transaction boundary.
// `this` is always a Store instance; this module does not import Store, avoiding an import cycle.
export const featureMethods = {
  preferences(user) {
    const row = this.db.prepare('SELECT data FROM preferences WHERE user_id=?').get(user.id);
    return { ...DEFAULT_PREFS, ...(row ? JSON.parse(row.data) : {}) };
  },
  setPreferences(user, p) {
    const prefs = validatePreferences(p, this.preferences(user));
    this.db
      .prepare(
        'INSERT INTO preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
      )
      .run(user.id, JSON.stringify(prefs));
    this.db
      .prepare("UPDATE outbox SET status='pending',next_at=0 WHERE user_id=? AND status='deferred'")
      .run(user.id);
    return prefs;
  },
  featureSnapshot(s, user, now = new Date()) {
    const head = s.role === 'head',
      reads = this.db.prepare('SELECT * FROM announcement_reads WHERE group_id=?').all(s.group.id);
    s.announcements = s.announcements
      .filter((a) => head || announcementState(a, now) !== 'scheduled')
      .map((a) => {
        const own = reads.find((r) => r.announcement_id === a.id && r.user_id === user.id),
          out = {
            ...a,
            state: announcementState(a, now),
            read: !!own,
            acknowledged: !!own?.ack_at,
          };
        if (head)
          out.acknowledgements = s.members
            .filter((m) => m.active)
            .map((m) => ({
              id: m.id,
              name: m.name,
              ackAt:
                reads.find((r) => r.announcement_id === a.id && r.user_id === m.id)?.ack_at || null,
            }));
        return out;
      });
    s.dayAnswers = this.db
      .prepare('SELECT user_id,date FROM day_answers WHERE group_id=? AND date=?')
      .all(s.group.id, moscowDate(now))
      .filter((r) => head || r.user_id === user.id);
    s.autoAttendance = this.db
      .prepare('SELECT user_id,date,lesson_id FROM auto_marks WHERE group_id=?')
      .all(s.group.id)
      .filter((r) => head || r.user_id === user.id);
    s.requests = this.requestsFor(user, s.group.id);
    s.absenceWarnings = absenceWarnings(s, user.id, now);
    return s;
  },
  announcementRead(groupId, user, id, ack = false) {
    return this.transaction(() => {
      const s = this.read(groupId, user),
        a = s.announcements.find((a) => a.id === id);
      if (!a || announcementState(a) === 'scheduled')
        throw new Error('Объявление ещё не опубликовано');
      if (ack && announcementState(a) !== 'active') throw new Error('Объявление уже в архиве');
      const now = new Date().toISOString();
      this.db
        .prepare(
          'INSERT INTO announcement_reads VALUES(?,?,?,?,?) ON CONFLICT(group_id,announcement_id,user_id) DO UPDATE SET ack_at=COALESCE(excluded.ack_at,announcement_reads.ack_at)',
        )
        .run(groupId, id, user.id, now, ack ? now : null);
    });
  },
  queueAnnouncement(s, a) {
    if (a.notificationQueued || announcementState(a) !== 'active') return;
    for (const m of s.members.filter((m) => m.active))
      this.enqueue('announcement:' + a.id + ':' + m.id, m.id, {
        groupId: s.group.id,
        announcementId: a.id,
        category: 'announcements',
        text: `${s.group.name}\n\n${a.title}\n\n${a.text}`,
      });
    a.notificationQueued = true;
  },
  answerDay(groupId, user, p, now = new Date()) {
    return this.transaction(() => {
      const s = this.read(groupId, user),
        date = moscowDate(now);
      if (!this.profile(user).complete) throw new Error('Сначала укажи имя и фамилию');
      if (p.date !== date) throw new Error('Ответ действует только сегодня');
      if (typeof p.enabled !== 'boolean') throw new Error('Некорректный ответ');
      if (p.enabled) {
        const member = s.members.find((m) => m.id === user.id),
          ls = lessonsOn(s, date).filter((l) => appliesTo(l, member));
        if (!ls.some((l) => l.end >= moscowTime(now)))
          throw new Error('На сегодня не осталось пар твоей подгруппы');
        this.db
          .prepare('INSERT OR IGNORE INTO day_answers VALUES(?,?,?,?)')
          .run(groupId, user.id, date, now.toISOString());
        this.fillDay(s, user.id, date);
        this.save(s);
        for (const row of this.db
          .prepare(
            "SELECT id,payload FROM outbox WHERE user_id=? AND status IN ('pending','deferred')",
          )
          .all(user.id)) {
          const q = JSON.parse(row.payload).poll;
          if (q?.groupId === groupId && q.date === date)
            this.db.prepare("UPDATE outbox SET status='suppressed' WHERE id=?").run(row.id);
        }
      } else {
        this.db
          .prepare('DELETE FROM day_answers WHERE group_id=? AND user_id=? AND date=?')
          .run(groupId, user.id, date);
        for (const a of this.db
          .prepare('SELECT lesson_id FROM auto_marks WHERE group_id=? AND user_id=? AND date=?')
          .all(groupId, user.id, date)) {
          const key = markKey(date, a.lesson_id, user.id);
          if (s.marks[key] === 'present') delete s.marks[key];
        }
        this.db
          .prepare('DELETE FROM auto_marks WHERE group_id=? AND user_id=? AND date=?')
          .run(groupId, user.id, date);
        this.save(s);
        for (const row of this.db
          .prepare("SELECT id,payload FROM outbox WHERE user_id=? AND status='suppressed'")
          .all(user.id)) {
          const q = JSON.parse(row.payload).poll;
          if (q?.groupId === groupId && q.date === date)
            this.db.prepare("UPDATE outbox SET status='pending',next_at=0 WHERE id=?").run(row.id);
        }
      }
    });
  },
  fillDay(s, userId, date) {
    const m = s.members.find((m) => m.id === userId);
    if (!m?.active) return;
    for (const l of lessonsOn(s, date).filter((l) => appliesTo(l, m))) {
      const key = markKey(date, l.id, userId);
      if (s.marks[key] === undefined || s.marks[key] === 'unknown') {
        s.marks[key] = 'present';
        this.db
          .prepare('INSERT OR IGNORE INTO auto_marks VALUES(?,?,?,?)')
          .run(s.group.id, userId, date, l.id);
      }
    }
  },
  answeredDay(groupId, userId, date) {
    return !!this.db
      .prepare('SELECT 1 FROM day_answers WHERE group_id=? AND user_id=? AND date=?')
      .get(groupId, userId, date);
  },
  createRequest(user, p) {
    return this.transaction(() => {
      if (!['bug', 'head'].includes(p.kind)) throw new Error('Неизвестный вид обращения');
      let group = null;
      if (p.kind === 'head') group = this.read(p.groupId, user);
      const title = text(p.title, 'Тема', 160),
        body = text(p.text, 'Описание', 2000),
        file = p.file ? validateExcuse({ reason: body, file: p.file }).file : null;
      const since = new Date(Date.now() - 86400000).toISOString(),
        count = this.db
          .prepare('SELECT COUNT(*) n FROM requests WHERE user_id=? AND kind=? AND created_at>?')
          .get(user.id, p.kind, since).n;
      if (count >= (p.kind === 'bug' ? 5 : 20))
        throw new Error('Лимит обращений за сутки исчерпан');
      const id = randomUUID(),
        now = new Date().toISOString();
      this.db
        .prepare(
          'INSERT INTO requests(id,kind,group_id,user_id,author_name,title,text,filename,data,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          p.kind,
          group?.group.id || null,
          user.id,
          this.displayName(user),
          title,
          body,
          file?.filename || null,
          file?.data || null,
          now,
        );
      const recipients = group
        ? group.members.filter((m) => m.role === 'head' && m.active).map((m) => m.id)
        : [];
      for (const uid of recipients) {
        const payload = {
          category: 'messages',
          ...(group ? { groupId: group.group.id } : {}),
          requestId: id,
          text: `${group ? group.group.name + ' · Обращение к старосте' : 'Ошибка приложения · v' + VERSION}\n${this.displayName(user)}\n${title}\n\n${body}`,
        };
        this.enqueue('request:' + id + ':text:' + uid, uid, payload);
        if (file)
          this.enqueue('request:' + id + ':file:' + uid, uid, {
            ...payload,
            text: undefined,
            document: true,
          });
      }
      return { id, saved: true, forwardingConfigured: recipients.length > 0 };
    });
  },
  requestsFor(user, groupId) {
    let rows;
    if (groupId) {
      const s = this.read(groupId, user);
      rows =
        s.role === 'head'
          ? this.db
              .prepare('SELECT * FROM requests WHERE group_id=? ORDER BY created_at DESC LIMIT 200')
              .all(groupId)
          : this.db
              .prepare(
                'SELECT * FROM requests WHERE group_id=? AND user_id=? ORDER BY created_at DESC LIMIT 200',
              )
              .all(groupId, user.id);
    } else
      rows = this.db
        .prepare(
          "SELECT * FROM requests WHERE kind='bug' AND user_id=? ORDER BY created_at DESC LIMIT 50",
        )
        .all(user.id);
    return rows.map(({ data, ...r }) => ({ ...r, hasFile: !!data }));
  },
  requestFile(user, id, adminId = '') {
    const r = this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
    if (!r) throw Object.assign(new Error('Обращение не найдено'), { status: 404 });
    if (r.user_id !== user.id) {
      if (r.kind === 'bug') {
        if (user.id !== adminId) throw Object.assign(new Error('Нет доступа'), { status: 403 });
      } else if (this.read(r.group_id, user).role !== 'head')
        throw Object.assign(new Error('Нет доступа'), { status: 403 });
    } else if (r.group_id) this.read(r.group_id, user);
    return { data: r.data, filename: r.filename };
  },
  replyRequest(user, id, reply) {
    return this.transaction(() => {
      const r = this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
      if (!r || r.kind !== 'head') throw new Error('Обращение не найдено');
      const s = this.read(r.group_id, user);
      if (s.role !== 'head')
        throw Object.assign(new Error('Ответить может только староста'), { status: 403 });
      if (r.reply) throw new Error('Ответ уже отправлен');
      const value = text(reply, 'Ответ', 2000);
      this.db
        .prepare('UPDATE requests SET reply=?,replied_at=? WHERE id=?')
        .run(value, new Date().toISOString(), id);
      this.enqueue('request-reply:' + id, r.user_id, {
        groupId: r.group_id,
        requestId: id,
        category: 'messages',
        text: `${s.group.name} · Ответ старосты\n${r.title}\n\n${value}`,
      });
    });
  },
};
export function absenceWarnings(s, userId, now = new Date()) {
  const date = moscowDate(now),
    summary = attendanceSummary(s, userId, s.group.semesterStart, date);
  return Object.entries(summary.subjects)
    .filter(([, v]) => v.absent >= s.group.threshold)
    .map(([subject, v]) => ({ subject, count: v.absent, threshold: s.group.threshold }));
}
export function scheduleAnnouncements(store, now = new Date()) {
  store.transaction(() => {
    for (const row of store.db.prepare('SELECT data FROM groups').all()) {
      const s = JSON.parse(row.data);
      let changed = false;
      for (const a of s.announcements) {
        if (a.publishAt && !a.notificationQueued && announcementState(a, now) === 'active') {
          // Explicit clock used by tests and restart catch-up.
          for (const m of s.members.filter((m) => m.active))
            store.enqueue('announcement:' + a.id + ':' + m.id, m.id, {
              groupId: s.group.id,
              announcementId: a.id,
              category: 'announcements',
              text: `${s.group.name}\n\n${a.title}\n\n${a.text}`,
            });
          a.notificationQueued = true;
          changed = true;
        }
      }
      if (changed) store.save(s);
    }
  });
}
export function scheduleAbsenceWarnings(store, now = new Date()) {
  for (const row of store.db.prepare('SELECT data FROM groups').all()) {
    const s = JSON.parse(row.data);
    for (const m of s.members.filter((m) => m.active))
      for (const w of absenceWarnings(s, m.id, now)) {
        const key = [
          'absence',
          s.group.id,
          s.group.semesterStart,
          m.id,
          w.subject,
          w.threshold,
        ].join(':');
        store.enqueue(key, m.id, {
          groupId: s.group.id,
          category: 'absence',
          warning: { subject: w.subject, threshold: w.threshold },
          text: `${s.group.name}\nПо предмету «${w.subject}» отмечено ${w.count} пропусков без уважительной причины. Проверь журнал; если есть ошибка, обратись к старосте.`,
        });
      }
  }
}
