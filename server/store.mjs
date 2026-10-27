import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { today } from '../public/model.js';
import { realName, validateExcuse } from '../public/profile.js';
import { featureMethods } from './features.mjs';
import { CORE_SCHEMA, FEATURE_SCHEMA } from './schema.mjs';
import { applyAction, text } from '../public/actions.js';
/** SQLite unit of work. Internal read() results must be filtered through snapshot() for clients. */
export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // Snapshot the legacy SQLite database, including its WAL, before adding tables.
    if (
      path !== ':memory:' &&
      this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='groups'").get() &&
      !this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_profiles'")
        .get() &&
      !existsSync(path + '.pre-v0.2.0-backup')
    ) {
      const temp = path + '.backup-' + randomUUID();
      try {
        this.db.exec("VACUUM INTO '" + temp.replaceAll("'", "''") + "'");
        renameSync(temp, path + '.pre-v0.2.0-backup');
      } catch (err) {
        if (existsSync(temp)) unlinkSync(temp);
        this.db.close();
        throw err;
      }
    }
    if (
      path !== ':memory:' &&
      this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='groups'").get() &&
      !this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='preferences'")
        .get() &&
      !existsSync(path + '.pre-v0.3.0-backup')
    ) {
      const temp = path + '.backup-' + randomUUID();
      try {
        this.db.exec("VACUUM INTO '" + temp.replaceAll("'", "''") + "'");
        renameSync(temp, path + '.pre-v0.3.0-backup');
      } catch (err) {
        if (existsSync(temp)) unlinkSync(temp);
        this.db.close();
        throw err;
      }
    }
    this.db.exec(CORE_SCHEMA);
    this.db.exec(FEATURE_SCHEMA);
  }
  /** Run synchronous mutations atomically. Callbacks must not return a Promise. */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  list(user) {
    return this.db
      .prepare(
        'SELECT g.id,g.data,m.role FROM groups g JOIN members m ON g.id=m.group_id WHERE m.user_id=?',
      )
      .all(user.id)
      .map((r) => ({
        id: r.id,
        name: JSON.parse(r.data).group.name,
        role: r.role,
        preferred: r.id === this.profile(user).defaultGroupId,
      }))
      .sort(
        (a, b) => Number(b.preferred) - Number(a.preferred) || a.name.localeCompare(b.name, 'ru'),
      );
  }
  /** Check membership and return complete internal group data (including private fields). */
  read(groupId, user) {
    const row = this.db
      .prepare(
        'SELECT g.data,m.role FROM groups g JOIN members m ON g.id=m.group_id WHERE g.id=? AND m.user_id=?',
      )
      .get(groupId, user.id);
    if (!row) throw Object.assign(new Error('Нет доступа к группе'), { status: 403 });
    return { ...JSON.parse(row.data), role: row.role, currentMemberId: user.id };
  }
  /** Build a role-filtered API response; attachment bodies have separate authorized endpoints. */
  snapshot(groupId, user) {
    const s = this.read(groupId, user);
    s.groups = this.list(user);
    s.profile = this.profile(user);
    s.excuses = this.excuses(groupId, user);
    this.featureSnapshot(s, user);
    s.materials = s.materials.map(({ data, ...m }) => m);
    if (s.role !== 'head') {
      delete s.group.inviteCode;
      s.members = s.members.filter((m) => m.id === user.id);
      s.marks = Object.fromEntries(
        Object.entries(s.marks).filter(([k]) => k.endsWith('|' + user.id)),
      );
    }
    return s;
  }
  /** Persist group-owned state, excluding request-specific presentation and identity fields. */
  save(s) {
    const {
      role,
      currentMemberId,
      groups,
      botUsername,
      profile,
      excuses,
      dayAnswers,
      autoAttendance,
      requests,
      absenceWarnings,
      ...data
    } = s;
    const raw = JSON.stringify(data);
    if (Buffer.byteLength(raw) > 25 * 1024 * 1024)
      throw new Error('Хранилище группы заполнено (25 МБ). Используйте ссылки на материалы.');
    this.db.prepare('UPDATE groups SET data=? WHERE id=?').run(raw, s.group.id);
  }
  create(user, p) {
    return this.transaction(() => {
      if (this.list(user).length >= 10) throw new Error('Можно состоять не более чем в 10 группах');
      const now = today(),
        year = Number(now.slice(0, 4)),
        autumn = Number(now.slice(5, 7)) >= 8;
      const group = {
        id: randomUUID(),
        name: text(p.name, 'Группа', 50),
        institute: text(p.institute, 'Институт'),
        university: 'МИСИС',
        inviteCode: randomBytes(9).toString('base64url'),
        semesterStart: `${year}-${autumn ? '09-01' : '02-01'}`,
        semesterEnd: `${year}-${autumn ? '12-31' : '06-30'}`,
        firstWeek: 'odd',
        pollMinutes: 15,
        threshold: 3,
        floating: false,
        timezone: 'Europe/Moscow',
        source: null,
      };
      const s = {
        group,
        members: [
          {
            id: user.id,
            name: this.displayName(user),
            role: 'head',
            active: true,
            joinedDate: now,
          },
        ],
        lessons: [],
        marks: {},
        announcements: [],
        materials: [],
        breaks: [],
      };
      this.db
        .prepare('INSERT INTO groups(id,code,data) VALUES(?,?,?)')
        .run(group.id, group.inviteCode, JSON.stringify(s));
      this.db.prepare('INSERT INTO members VALUES(?,?,?)').run(group.id, user.id, 'head');
      return group.id;
    });
  }
  join(user, code) {
    return this.transaction(() => {
      const row = this.db
        .prepare('SELECT id,data FROM groups WHERE code=?')
        .get(text(code, 'Код', 50));
      if (!row) throw new Error('Группа с таким кодом не найдена');
      const s = JSON.parse(row.data);
      if (
        this.db.prepare('SELECT 1 FROM members WHERE group_id=? AND user_id=?').get(row.id, user.id)
      )
        return row.id;
      if (this.list(user).length >= 10) throw new Error('Можно состоять не более чем в 10 группах');
      if (s.members.length >= 200) throw new Error('В группе уже 200 участников');
      const former = s.members.find((m) => m.id === user.id);
      if (former) {
        former.active = true;
        former.name = this.displayName(user);
      } else
        s.members.push({
          id: user.id,
          name: this.displayName(user),
          role: 'student',
          active: true,
          joinedDate: today(),
        });
      this.db.prepare('INSERT INTO members VALUES(?,?,?)').run(row.id, user.id, 'student');
      this.save(s);
      return row.id;
    });
  }
  action(groupId, user, type, p) {
    return this.transaction(() => {
      const s = this.read(groupId, user);
      if (type === 'selfMark' && !this.profile(user).complete)
        throw new Error('Сначала укажи настоящие имя и фамилию в приложении');
      applyAction(s, type, p, { role: s.role, userId: user.id });
      this.save(s);
      if (['mark', 'selfMark'].includes(type) && p.status === 'excused')
        this.saveExcuse(s, user, type, p);
      this.db.prepare('INSERT INTO audit(group_id,user_id,action,created_at) VALUES(?,?,?,?)').run(
        groupId,
        user.id,
        JSON.stringify({
          type,
          ...(type === 'mark' || type === 'selfMark'
            ? {
                date: p.date,
                lessonId: p.lessonId,
                memberId: type === 'selfMark' ? user.id : p.memberId,
                status: p.status,
              }
            : {}),
        }),
        new Date().toISOString(),
      );
      if (type === 'announcement') {
        this.queueAnnouncement(s, s.announcements.at(-1));
        this.save(s);
      }
      if (['mark', 'selfMark'].includes(type))
        this.db
          .prepare(
            'DELETE FROM auto_marks WHERE group_id=? AND user_id=? AND date=? AND lesson_id=?',
          )
          .run(groupId, type === 'selfMark' ? user.id : p.memberId, p.date, p.lessonId);
      return s;
    });
  }
  enqueue(key, userId, payload) {
    this.db
      .prepare('INSERT OR IGNORE INTO outbox(dedupe,user_id,payload) VALUES(?,?,?)')
      .run(key, userId, JSON.stringify(payload));
  }

  profile(user) {
    const r = this.db.prepare('SELECT * FROM user_profiles WHERE user_id=?').get(user.id);
    return {
      id: user.id,
      complete: !!r,
      firstName: r?.first_name || '',
      lastName: r?.last_name || '',
      name: r ? `${r.last_name} ${r.first_name}` : user.name || 'Студент',
      defaultGroupId: r?.default_group_id || null,
      photoUrl: user.photoUrl || '',
      username: user.username || '',
      preferences: this.preferences(user),
    };
  }
  displayName(user) {
    return this.profile(user).name;
  }
  saveProfile(user, p) {
    const first = realName(p.firstName, 'Имя'),
      last = realName(p.lastName, 'Фамилия');
    return this.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO user_profiles(user_id,first_name,last_name,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,updated_at=excluded.updated_at',
        )
        .run(user.id, first, last, new Date().toISOString());
      // Also update historical membership rows kept after a student leaves.
      for (const row of this.db.prepare('SELECT data FROM groups').all()) {
        const s = JSON.parse(row.data),
          m = s.members.find((m) => m.id === user.id);
        if (m) {
          m.name = `${last} ${first}`;
          this.save(s);
        }
      }
      return this.profile(user);
    });
  }
  prefer(user, groupId) {
    if (!this.profile(user).complete) throw new Error('Сначала заполни профиль');
    if (groupId !== null) this.read(groupId, user);
    this.db
      .prepare('UPDATE user_profiles SET default_group_id=? WHERE user_id=?')
      .run(groupId, user.id);
  }
  removeGroup(user, groupId, confirmation) {
    return this.transaction(() => {
      const s = this.read(groupId, user);
      if (confirmation !== s.group.name) throw new Error('Для подтверждения введи название группы');
      const isHead = s.role === 'head';
      if (isHead) {
        this.db.prepare('DELETE FROM members WHERE group_id=?').run(groupId);
        this.db.prepare('DELETE FROM audit WHERE group_id=?').run(groupId);
        this.db.prepare('DELETE FROM groups WHERE id=?').run(groupId);
        this.db
          .prepare('UPDATE user_profiles SET default_group_id=NULL WHERE default_group_id=?')
          .run(groupId);
      } else {
        this.db
          .prepare('DELETE FROM day_answers WHERE group_id=? AND user_id=?')
          .run(groupId, user.id);
        s.members.find((m) => m.id === user.id).active = false;
        this.save(s);
        this.db.prepare('DELETE FROM members WHERE group_id=? AND user_id=?').run(groupId, user.id);
        this.db
          .prepare(
            'UPDATE user_profiles SET default_group_id=NULL WHERE user_id=? AND default_group_id=?',
          )
          .run(user.id, groupId);
      }
      for (const row of this.db.prepare('SELECT id,user_id,payload FROM outbox').all()) {
        const p = JSON.parse(row.payload);
        if ((p.groupId || p.poll?.groupId) === groupId && (isHead || row.user_id === user.id))
          this.db.prepare('DELETE FROM outbox WHERE id=?').run(row.id);
      }
    });
  }
  excuses(groupId, user) {
    const role = this.read(groupId, user).role;
    const rows =
      role === 'head'
        ? this.db
            .prepare('SELECT * FROM excuses WHERE group_id=? ORDER BY created_at DESC')
            .all(groupId)
        : this.db
            .prepare(
              'SELECT * FROM excuses WHERE group_id=? AND user_id=? ORDER BY created_at DESC',
            )
            .all(groupId, user.id);
    return rows.map(({ data, ...r }) => ({ ...r, hasFile: !!data }));
  }
  excuseFile(groupId, user, id) {
    const s = this.read(groupId, user),
      r = this.db.prepare('SELECT * FROM excuses WHERE id=? AND group_id=?').get(id, groupId);
    if (!r || (s.role !== 'head' && r.user_id !== user.id))
      throw Object.assign(new Error('Нет доступа к вложению'), { status: 403 });
    return { data: r.data, filename: r.filename };
  }
  saveExcuse(s, user, type, p) {
    const { reason, file } = validateExcuse(p),
      mid = type === 'selfMark' ? user.id : p.memberId,
      id = randomUUID(),
      created = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO excuses(id,group_id,user_id,lesson_id,date,reason,filename,data,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(group_id,user_id,lesson_id,date) DO UPDATE SET id=excluded.id,reason=excluded.reason,filename=excluded.filename,data=excluded.data,created_at=excluded.created_at',
      )
      .run(
        id,
        s.group.id,
        mid,
        p.lessonId,
        p.date,
        reason,
        file?.filename || null,
        file?.data || null,
        created,
      );
    const member = s.members.find((m) => m.id === mid),
      lesson = s.lessons.find((l) => l.id === p.lessonId);
    for (const head of s.members.filter((m) => m.role === 'head' && m.active)) {
      const message = `${s.group.name} · Уважительная причина\n${member.name}\n${p.date} · ${lesson.start} · ${lesson.subject}\n\n${reason || 'Причина во вложении'}${file ? '\nФайл: ' + file.filename : ''}`;
      this.enqueue('excuse:' + id + ':text', head.id, {
        groupId: s.group.id,
        excuseId: id,
        text: message,
      });
      if (file)
        this.enqueue('excuse:' + id + ':file', head.id, {
          groupId: s.group.id,
          excuseId: id,
          document: true,
        });
    }
  }
  close() {
    this.db.close();
  }
}

Object.assign(Store.prototype, featureMethods);
