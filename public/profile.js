import { dateAdd, monday, lessonsOn, appliesTo, grade } from './model.js';

export function realName(value, label) {
  if (typeof value !== 'string') throw new Error(`Укажи ${label}`);
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 70 || !/^\p{L}[\p{L}\p{M} ’'ʼ-]*\p{L}$/u.test(name))
    throw new Error(`${label}: от 2 до 70 букв, допускаются пробел, дефис и апостроф`);
  return name;
}
export function greeting(name, now = new Date(), roll = Math.random()) {
  if (roll < 0.01) {
    const eggs = [
      `Ты сделал лабу по вычмашу? ${name}`,
      'Это че за эндерваси',
      'Это че за квартирант',
    ];
    return eggs[Math.min(2, Math.floor(Math.max(0, roll) * 300))];
  }
  if (roll < 0.26) return 'АНООООООООНС';
  if (roll < 0.41) return 'Однажды у меня был глюк, что я стал лавочкой';
  if (roll < 0.66) return 'tgk: shgzpdffkk';
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  const phrase =
    hour < 5
      ? 'Доброй ночи'
      : hour < 12
        ? 'Доброе утро'
        : hour < 18
          ? 'Добрый день'
          : hour < 23
            ? 'Добрый вечер'
            : 'Доброй ночи';
  return `${phrase}, ${name}`;
}
export function sortMembers(members) {
  return [...members].sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
}
export function attendanceDays(state, memberId, now = new Date()) {
  const end = todayAt(now),
    member = state.members.find((m) => m.id === memberId);
  const start = state.group.semesterStart;
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  const days = [];
  const last = state.group.semesterEnd < end ? state.group.semesterEnd : end;
  // At most a year, including for pre-existing malformed settings.
  const bounded = start < dateAdd(last, -365) ? dateAdd(last, -365) : start;
  if (bounded > last) return days;
  for (let date = monday(bounded); date <= last; date = dateAdd(date, 1)) {
    const lessons =
      date < bounded || (member?.joinedDate && date < member.joinedDate)
        ? []
        : lessonsOn(state, date).filter(
            (l) => appliesTo(l, member) && (date !== end || l.end <= clock),
          );
    const counts = { present: 0, late: 0, absent: 0, excused: 0, unknown: 0 };
    for (const l of lessons) counts[grade(state, date, l.id, memberId)]++;
    const total = lessons.length,
      visited = counts.present + counts.late;
    const level = visited ? Math.max(1, Math.ceil((visited / total) * 4)) : 0;
    const tone = visited
      ? 'level-' + level
      : counts.absent
        ? 'missed'
        : counts.excused
          ? 'excused'
          : total
            ? 'unanswered'
            : 'empty';
    days.push({ date, total, visited, counts, tone });
  }
  return days;
}
function todayAt(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function validateExcuse(p) {
  const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
  if (reason.length > 2000) throw new Error('Причина: не больше 2000 символов');
  let file = null;
  if (p.file) {
    const f = p.file;
    if (
      typeof f.data !== 'string' ||
      !/^data:application\/octet-stream;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        f.data,
      )
    )
      throw new Error('Некорректное вложение');
    const raw = f.data.split(',')[1],
      size = (raw.length / 4) * 3 - (raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0);
    if (!size || size > 2 * 1024 * 1024) throw new Error('Выбери файл размером до 2 МБ');
    if (
      typeof f.filename !== 'string' ||
      !f.filename.trim() ||
      f.filename.length > 180 ||
      // Reject control characters and path separators in attachment names.
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1f/\\]/.test(f.filename)
    )
      throw new Error('Некорректное имя файла');
    file = { filename: f.filename.trim(), data: f.data, size };
  }
  if (!reason && !file) throw new Error('Напиши причину или приложи файл');
  return { reason, file };
}
