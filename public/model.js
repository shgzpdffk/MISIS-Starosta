// Pure attendance model shared by the browser and server. Calendar dates use Moscow time.
export const STATUS = {
  present: ['✓', 'На паре'],
  late: ['О', 'Опоздал'],
  absent: ['Н', 'Не был'],
  excused: ['У', 'Уважительная'],
  unknown: ['−', 'Не ответил'],
};
export const DAYS = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];
export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function dateAdd(value, n) {
  const d = new Date(value + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monday(value) {
  const day = new Date(value + 'T12:00:00Z').getUTCDay();
  return dateAdd(value, -((day + 6) % 7));
}
export function parity(date, group) {
  const weeks = Math.round(
    (new Date(monday(date) + 'T12:00:00Z') - new Date(monday(group.semesterStart) + 'T12:00:00Z')) /
      604800000,
  );
  return ((weeks % 2) + 2) % 2 === 0 ? group.firstWeek : group.firstWeek === 'odd' ? 'even' : 'odd';
}
export function lessonsOn(state, date) {
  if (date < state.group.semesterStart || date > state.group.semesterEnd) return [];
  if (state.breaks?.some((b) => date >= b.start && date <= b.end)) return [];
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  return state.lessons
    .filter((l) =>
      l.date
        ? l.date === date
        : !state.group.floating &&
          l.day === day &&
          (l.week === 'all' || l.week === parity(date, state.group)) &&
          (!l.validFrom || date >= l.validFrom) &&
          (!l.validTo || date <= l.validTo),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
}
export function appliesTo(lesson, member) {
  return (
    !lesson.subgroups?.length ||
    (lesson.subgroups.length > 1 && !member?.subgroup) ||
    lesson.subgroups.includes(Number(member?.subgroup))
  );
}
/** Stable key for one attendance cell; absence of a key means unknown, never absent. */
export function markKey(date, lessonId, memberId) {
  return `${date}|${lessonId}|${memberId}`;
}
export function grade(state, date, lid, mid) {
  return state.marks[markKey(date, lid, mid)] || 'unknown';
}
export function attendanceSummary(state, memberId, from = state.group.semesterStart, to = today()) {
  const counts = { present: 0, late: 0, absent: 0, excused: 0, unknown: 0, total: 0, subjects: {} };
  const end = to < state.group.semesterEnd ? to : state.group.semesterEnd;
  for (let date = from; date <= end; date = dateAdd(date, 1))
    for (const lesson of lessonsOn(state, date)) {
      const member = state.members.find((m) => m.id === memberId);
      if (!appliesTo(lesson, member)) continue;
      if (member?.joinedDate && date < member.joinedDate) continue;
      const status = grade(state, date, lesson.id, memberId);
      counts[status]++;
      counts.total++;
      const subject = (counts.subjects[lesson.subject] ||= {
        present: 0,
        late: 0,
        absent: 0,
        excused: 0,
        unknown: 0,
        total: 0,
        records: [],
      });
      subject[status]++;
      subject.total++;
      subject.records.push({ date, lessonId: lesson.id, status });
    }
  return counts;
}
export function seed() {
  const now = today(),
    year = Number(now.slice(0, 4));
  const term = Number(now.slice(5, 7)) >= 8 ? `${year}-09-01` : `${year}-02-01`;
  const names = [
    'Андреев Максим',
    'Белова Анна',
    'Васильев Илья',
    'Григорьева Полина',
    'Давыдов Артём',
    'Егорова Софья',
    'Жуков Михаил',
    'Зайцева Дарья',
    'Иванова Мария',
    'Ильин Никита',
    'Козлова Алиса',
    'Кузнецов Даниил',
    'Лебедева Виктория',
    'Морозов Александр',
    'Новикова Анастасия',
    'Павлов Дмитрий',
    'Романова Ева',
    'Сергеев Матвей',
    'Тихонова Ксения',
    'Устинов Глеб',
    'Фёдорова Вероника',
    'Харитонов Лев',
    'Цветкова Алёна',
    'Чернов Арсений',
    'Шубина Ульяна',
    'Яковлев Марк',
  ];
  const group = {
    id: 'demo',
    name: 'БИВТ-24-1',
    institute: 'Институт компьютерных наук',
    university: 'МИСИС',
    inviteCode: 'DEMO-MISIS',
    semesterStart: term,
    semesterEnd: `${year}-${Number(now.slice(5, 7)) >= 8 ? '12-31' : '06-30'}`,
    firstWeek: 'odd',
    pollMinutes: 15,
    floating: false,
    threshold: 3,
    timezone: 'Europe/Moscow',
    source: null,
  };
  const members = names.map((name, i) => ({
    id: `m${i + 1}`,
    name,
    active: true,
    role: i === 0 ? 'head' : 'student',
    joinedDate: term,
  }));
  const specs = [
    [1, '09:00', '10:35', 'Математический анализ', 'Лекция', 'Б-412', 'all'],
    [1, '10:50', '12:25', 'Алгоритмы и структуры данных', 'Практика', 'Г-508', 'all'],
    [1, '12:40', '14:15', 'Физическая культура', 'Практика', 'Спорткомплекс', 'all'],
    [2, '09:00', '10:35', 'Физика', 'Лекция', 'Б-616', 'all'],
    [2, '10:50', '12:25', 'Иностранный язык', 'Практика', 'А-205', 'all'],
    [3, '10:50', '12:25', 'Программирование', 'Лабораторная', 'Г-407', 'odd'],
    [3, '12:40', '14:15', 'Дискретная математика', 'Практика', 'Б-308', 'all'],
    [4, '09:00', '10:35', 'Физика', 'Лабораторная', 'Б-602', 'even'],
    [4, '10:50', '12:25', 'Математический анализ', 'Практика', 'Б-412', 'all'],
    [5, '09:00', '10:35', 'Алгоритмы и структуры данных', 'Лекция', 'Г-508', 'all'],
    [5, '10:50', '12:25', 'История России', 'Практика', 'А-301', 'all'],
  ];
  const lessons = specs.map((r, i) => ({
    id: `l${i + 1}`,
    day: r[0],
    start: r[1],
    end: r[2],
    subject: r[3],
    type: r[4],
    room: r[5],
    week: r[6],
    teacher: 'Преподаватель · пример',
    note: 'Учебный пример. Не официальное расписание МИСИС.',
  }));
  const state = {
    group,
    members,
    lessons,
    marks: {},
    breaks: [],
    announcements: [
      {
        id: 'a1',
        title: 'Встреча группы',
        text: 'В среду после последней пары обсудим подготовку к сессии. Собираемся у аудитории Г-407.',
        pinned: true,
        createdAt: dateAdd(now, -1) + 'T15:00:00Z',
        author: 'Староста',
      },
      {
        id: 'a2',
        title: 'Материалы к практике',
        text: 'Конспект по алгоритмам добавлен в базу знаний. Перед занятием повторите тему сортировок.',
        pinned: false,
        createdAt: dateAdd(now, -2) + 'T14:00:00Z',
        author: 'Староста',
      },
    ],
    materials: [],
    currentMemberId: 'm1',
    role: 'head',
    groups: [],
  };
  let n = 0;
  for (let date = term; date <= now; date = dateAdd(date, 1))
    for (const l of lessonsOn(state, date)) {
      members.forEach((m, i) => {
        const v = (n * 17 + i * 7) % 29;
        state.marks[markKey(date, l.id, m.id)] =
          v < 2
            ? 'unknown'
            : v < 4
              ? 'late'
              : v < 5
                ? 'excused'
                : v < (i === 2 || i === 7 || i === 9 || i === 25 ? 13 : 7)
                  ? 'absent'
                  : 'present';
      });
      n++;
    }
  return state;
}
export function reportRows(state, period = 'week', now = today()) {
  const from =
    period === 'month'
      ? now.slice(0, 8) + '01'
      : period === 'semester'
        ? state.group.semesterStart
        : monday(now);
  const columns = [];
  for (let d = from; d <= now; d = dateAdd(d, 1))
    for (const l of lessonsOn(state, d)) columns.push({ date: d, lesson: l });
  const rows = [
    [
      'Студент',
      ...columns.map((c) => `${c.date} ${c.lesson.start} ${c.lesson.subject}`),
      'На паре',
      'Опоздал',
      'Не был',
      'Уважительная',
      'Не ответил',
    ],
  ];
  for (const member of state.members) {
    const counts = { present: 0, late: 0, absent: 0, excused: 0, unknown: 0 };
    const cells = columns.map((c) => {
      if (!appliesTo(c.lesson, member) || (member.joinedDate && c.date < member.joinedDate))
        return '—';
      const s = grade(state, c.date, c.lesson.id, member.id);
      counts[s]++;
      return STATUS[s][1];
    });
    rows.push([member.name, ...cells, ...Object.values(counts)]);
  }
  return rows;
}
