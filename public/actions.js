import { today, lessonsOn, markKey, STATUS, appliesTo } from './model.js';
import { announcementTiming, validatePhoto } from './features.js';
import { validateExcuse } from './profile.js';
export function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new Error(`${label}: от 1 до ${max} символов`);
  return value.trim();
}
export function date(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new Error('Укажи корректную дату');
  return value;
}
export function time(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error('Укажи время в формате ЧЧ:ММ');
  return value;
}
export function integer(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}: от ${min} до ${max}`);
  return n;
}
const id = () => globalThis.crypto.randomUUID();
export function validateLesson(p) {
  const l = {
    id: p.id || id(),
    subject: text(p.subject, 'Предмет'),
    teacher: typeof p.teacher === 'string' ? p.teacher.trim().slice(0, 160) : '',
    room: typeof p.room === 'string' ? p.room.trim().slice(0, 100) : '',
    start: time(p.start),
    end: time(p.end),
    day: integer(p.day, 0, 6, 'День недели'),
    week: p.week || 'all',
    type: p.type || 'Лекция',
    note: typeof p.note === 'string' ? p.note.slice(0, 2000) : '',
  };
  if (l.end <= l.start) throw new Error('Конец пары должен быть позже начала');
  if (!['odd', 'even', 'all'].includes(l.week)) throw new Error('Неизвестный тип недели');
  if (!['Лекция', 'Практика', 'Лабораторная', 'Семинар'].includes(l.type))
    throw new Error('Неизвестный тип занятия');
  if (p.date) l.date = date(p.date);
  if (p.validFrom) l.validFrom = date(p.validFrom);
  if (p.validTo) l.validTo = date(p.validTo);
  return l;
}
/** Validate and mutate one group state. The caller supplies the authenticated role and user ID. */
export function applyAction(state, type, p, actor) {
  if (!p || typeof p !== 'object') throw new Error('Некорректные данные');
  if (!['selfMark', 'profile'].includes(type) && actor.role !== 'head')
    throw new Error('Это действие доступно только старосте');
  switch (type) {
    case 'mark':
    case 'selfMark': {
      const d = date(p.date);
      if (d > today()) throw new Error('Нельзя отмечать будущие дни');
      if (!STATUS[p.status]) throw new Error('Неизвестная отметка');
      const mid = type === 'selfMark' ? actor.userId : p.memberId;
      if (!state.members.some((m) => m.id === mid)) throw new Error('Студент не найден');
      const lesson = lessonsOn(state, d).find((l) => l.id === p.lessonId);
      if (!lesson) throw new Error('Пара на эту дату не найдена');
      if (
        !appliesTo(
          lesson,
          state.members.find((m) => m.id === mid),
        )
      )
        throw new Error('Эта пара относится к другой подгруппе. Сначала выбери свою подгруппу.');
      if (type === 'selfMark' && !actor.demo) {
        if (d !== today()) throw new Error('Свою отметку можно поставить только за сегодня');
        const now = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/Moscow',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date());
        const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
        if (toMinutes(now) < toMinutes(lesson.start) - state.group.pollMinutes || now > lesson.end)
          throw new Error(
            'Отметки доступны перед началом и до конца пары. Для исправления обратись к старосте.',
          );
        if (p.status === 'unknown') throw new Error('Выбери ответ');
      }
      if (p.status === 'excused') validateExcuse(p);
      state.marks[markKey(d, p.lessonId, mid)] = p.status;
      break;
    }
    case 'profile': {
      const member = state.members.find((m) => m.id === actor.userId);
      const sg = integer(p.subgroup, 1, 20, 'Подгруппа');
      if (!state.group.subgroups?.includes(sg)) throw new Error('Подгруппа не найдена');
      member.subgroup = sg;
      break;
    }
    case 'lesson': {
      if (state.lessons.length >= 300) throw new Error('Достигнут лимит занятий');
      const l = validateLesson(p);
      if (p.id) {
        const index = state.lessons.findIndex((x) => x.id === p.id);
        if (index < 0) throw new Error('Пара не найдена');
        state.lessons[index] = l;
      } else state.lessons.push(l);
      break;
    }
    case 'announcement': {
      if (state.announcements.length >= 500) throw new Error('Достигнут лимит объявлений');
      state.announcements.push({
        id: id(),
        title: text(p.title, 'Заголовок'),
        text: text(p.text, 'Объявление', 3000),
        pinned: !!p.pinned,
        createdAt: new Date().toISOString(),
        author: 'Староста',
        ...announcementTiming(p),
        requireAck: !!p.requireAck,
      });
      break;
    }
    case 'pin': {
      const a = state.announcements.find((x) => x.id === p.id);
      if (!a) throw new Error('Объявление не найдено');
      a.pinned = !a.pinned;
      break;
    }
    case 'material': {
      if (state.materials.length >= 100) throw new Error('Достигнут лимит материалов');
      const m = {
        id: id(),
        title: text(p.title, 'Название'),
        subject: text(p.subject, 'Предмет'),
        createdAt: new Date().toISOString(),
      };
      if (p.url) {
        let u;
        try {
          u = new URL(p.url);
        } catch {
          throw new Error('Укажи полную ссылку https://…');
        }
        if (u.protocol !== 'https:' || u.username || u.password)
          throw new Error('Нужна HTTPS-ссылка без логина и пароля');
        m.url = u.href;
      } else {
        if (
          typeof p.data !== 'string' ||
          !/^data:application\/octet-stream;base64,[A-Za-z0-9+/]*={0,2}$/.test(p.data) ||
          p.data.length > 2800000
        )
          throw new Error('Выбери файл размером до 2 МБ');
        m.filename = text(p.filename, 'Имя файла', 180);
        m.data = p.data;
      }
      state.materials.push(m);
      break;
    }
    case 'settings': {
      const g = state.group;
      if (p.name !== undefined) g.name = text(p.name, 'Группа', 50);
      if (p.institute !== undefined) g.institute = text(p.institute, 'Институт', 160);
      if (p.semesterStart !== undefined || p.semesterEnd !== undefined) {
        const start = date(p.semesterStart ?? g.semesterStart),
          end = date(p.semesterEnd ?? g.semesterEnd);
        if (end < start || new Date(end) - new Date(start) > 366 * 86400000)
          throw new Error('Семестр должен длиться не больше года');
        g.semesterStart = start;
        g.semesterEnd = end;
      }
      if (p.firstWeek !== undefined) {
        if (!['odd', 'even'].includes(p.firstWeek)) throw new Error('Неизвестный тип недели');
        g.firstWeek = p.firstWeek;
      }
      if (p.pollMinutes !== undefined)
        g.pollMinutes = integer(p.pollMinutes, 0, 60, 'Минут до пары');
      if (p.threshold !== undefined) g.threshold = integer(p.threshold, 1, 30, 'Порог пропусков');
      if (p.floating !== undefined) g.floating = !!p.floating;
      break;
    }
    case 'groupCard': {
      const previous = state.group.card || {};
      const body = typeof p.text === 'string' ? p.text.trim() : previous.text || '';
      if (body.length > 5000) throw new Error('Текст карточки: не больше 5000 символов');
      state.group.card = {
        text: body,
        photo: p.photo === undefined ? previous.photo || null : validatePhoto(p.photo),
        updatedAt: new Date().toISOString(),
      };
      break;
    }
    case 'break': {
      const start = date(p.start),
        end = date(p.end);
      if (end < start) throw new Error('Проверь даты периода');
      state.breaks.push({ id: id(), name: text(p.name, 'Название'), start, end });
      break;
    }
    default:
      throw new Error('Неизвестное действие');
  }
  return state;
}
