import { icon, escapeHtml, initials, field, select, download, formatDate } from './ui.js';
import {
  seed,
  today,
  parity,
  lessonsOn,
  grade,
  attendanceSummary,
  reportRows,
  STATUS,
  DAYS,
  appliesTo,
} from './model.js';
import { realName, greeting, sortMembers, attendanceDays, validateExcuse } from './profile.js';
import {
  VERSION,
  RELEASE_NOTES,
  DEFAULT_PREFS,
  validatePreferences,
  announcementState,
  validatePhoto,
  moscowTime,
} from './features.js';
import { makeXlsx } from './xlsx.js';
import { applyAction } from './actions.js';

const app = document.querySelector('#app'),
  modal = document.querySelector('#modal');
const tg = window.Telegram?.WebApp;
try {
  tg?.ready();
  tg?.expand();
  tg?.setHeaderColor('#0c0d12');
  tg?.setBackgroundColor('#0c0d12');
  tg?.setBottomBarColor?.('#111219');
} catch {}
const demo = !tg?.initData;
let state,
  role = 'head',
  page = 'home',
  week = 'odd',
  journalDate = today(),
  month = today().slice(0, 7),
  period = 'week',
  search = '',
  busy = false;
const greetingRoll = Math.random();
let studentSort = 'az',
  announcementFilter = 'active',
  whatsNewShown = false;
const launchParams = new URLSearchParams(location.search);
const cacheKey = 'misis-starosta-demo-v1';
// Transport and navigation. Live identity comes only from signed Telegram initData.
async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `tma ${tg?.initData || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'Сервис недоступен. Попробуйте позже.' }));
    throw new Error(err.error || 'Не удалось выполнить действие');
  }
  return r.json();
}
async function init() {
  try {
    if (demo) {
      try {
        state = JSON.parse(localStorage.getItem(cacheKey));
      } catch {}
      if (!state?.group) state = seed();
      role = 'head';
    } else {
      state = await api(
        '/api/state' +
          (launchParams.get('group')
            ? '?groupId=' + encodeURIComponent(launchParams.get('group'))
            : ''),
      );
      role = state.role || 'student';
    }
    week = state.group ? parity(today(), state.group) : 'odd';
    render();
    handleLaunch();
    maybeWhatsNew();
  } catch (err) {
    app.innerHTML = /* HTML */ `<main class="loading">
      <h2>Не удалось открыть группу</h2>
      <p>${escapeHtml(err.message)}</p>
      <button class="btn primary" data-action="reload">Попробовать снова</button>
    </main>`;
  }
}
function saveDemo(next) {
  localStorage.setItem(cacheKey, JSON.stringify(next));
  state = next;
}
async function mutate(type, payload) {
  if (busy) return;
  busy = true;
  try {
    if (demo) {
      const next = structuredClone(state);
      applyAction(next, type, payload, { role, userId: state.currentMemberId, demo: true });
      saveDemo(next);
    } else state = await api('/api/action', { groupId: state.group.id, type, payload });
    render();
    return true;
  } finally {
    busy = false;
  }
}
function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('visible'), 3500);
}
function navigate(to) {
  page = to;
  search = '';
  render();
  window.scrollTo(0, 0);
  tg?.HapticFeedback?.selectionChanged();
}
// Page rendering. Escape text at interpolation boundaries with escapeHtml().
const header = () =>
  /* HTML */ `<header class="topbar">
      <a href="#" class="wordmark" data-page="home">МИСИС<span>СТАРОСТА</span></a>
      <div class="header-profile">
        <span class="edition">BETA</span
        ><button
          class="profile-button"
          data-page="profile"
          aria-label="Мой профиль"
          ${!state.profile?.complete ? 'disabled' : ''}
        >
          ${avatarMarkup()}
        </button>
      </div>
    </header>
    ${
      demo
        ? /* HTML */ `<div class="demo-panel">
            <div class="demo-line">
              <span class="demo-pill">▷ ДЕМО</span
              ><span>Учебные данные · изменения только у тебя</span>
            </div>
            <div class="role-switch">
              <div class="segmented">
                <button
                  data-action="role"
                  data-role="head"
                  class="${role === 'head' ? 'active' : ''}"
                >
                  ♛ Староста</button
                ><button
                  data-action="role"
                  data-role="student"
                  class="${role === 'student' ? 'active' : ''}"
                >
                  ♙ Студент
                </button>
              </div>
              <button class="btn primary compact" data-action="group">+ Своя группа</button>
            </div>
          </div>`
        : ''
    }`;
const nav = () => {
  const items =
    role === 'head'
      ? [
          ['home', 'home', 'Главная'],
          ['students', 'users', 'Студенты'],
          ['schedule', 'calendar', 'Расписание'],
          ['settings', 'settings', 'Настройки'],
        ]
      : [
          ['poll', 'poll', 'Отметиться'],
          ['schedule', 'calendar', 'Расписание'],
          ['announcements', 'speaker', `Объявления${unreadCount() ? ' · ' + unreadCount() : ''}`],
          ['materials', 'book', 'Материалы'],
          ['stats', 'chart', 'Статистика'],
        ];
  return /* HTML */ `<nav class="bottom-nav" aria-label="Основная навигация">
    ${items.map(([id, ic, label]) => /* HTML */ `<button data-page="${id}" class="${page === id ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''}>${icon(ic)}${label}</button>`).join('')}
  </nav>`;
};
const back = () =>
  /* HTML */ `<button class="back" data-page="${role === 'head' ? 'home' : 'poll'}">
    ${icon('back')} Главная
  </button>`;
const heading = (title, sub = '', extra = '') =>
  /* HTML */ `<div class="page-head">
    <div>
      <h1>${title}</h1>
      ${sub ? /* HTML */ `<p>${sub}</p>` : ''}
    </div>
    ${extra}
  </div>`;
const fab = (action, label) =>
  /* HTML */ `<button class="fab" data-action="${action}" aria-label="${label}">
    ${icon('plus')}
  </button>`;
const empty = (title, body, ic = 'calendar') =>
  /* HTML */ `<div class="empty">
    ${icon(ic)}
    <h3>${title}</h3>
    <p>${body}</p>
  </div>`;
function render() {
  applyAppearance();
  if (!state.profile?.complete) {
    app.innerHTML = header() + nameOnboarding();
    return;
  }
  if (!state.group && !['profile', 'bugReports'].includes(page)) {
    app.innerHTML = header() + onboarding();
    return;
  }
  if (
    role === 'student' &&
    ['home', 'students', 'settings', 'journal', 'day', 'reports', 'risk', 'excuses'].includes(page)
  )
    page = 'poll';
  const views = {
    profile,
    groupCard,
    requests,
    bugReports,
    excuses,
    home,
    students,
    schedule,
    journal,
    day,
    reports,
    risk,
    announcements,
    materials,
    settings,
    poll,
    stats,
  };
  app.innerHTML =
    header() +
    /* HTML */ `<main class="page">${(views[page] || home)()}</main>` +
    (state.group ? nav() : '');
  requestAnimationFrame(() => {
    const grid = document.querySelector('.heatmap-scroll');
    if (grid) grid.scrollLeft = grid.scrollWidth;
  });
  try {
    if (!['home', 'poll'].includes(page)) tg?.BackButton.show();
    else tg?.BackButton.hide();
  } catch {}
}
tg?.BackButton.onClick(() => navigate(role === 'head' ? 'home' : 'poll'));
function onboarding() {
  return /* HTML */ `<main class="onboarding">
    <div class="brand-mark">М</div>
    <h1>Твоя группа.<br />Всё под рукой.</h1>
    <p>Расписание, отметки, объявления и материалы<br />в одном мини-приложении.</p>
    <button class="btn primary wide" data-action="group">${icon('plus')} Создать группу</button
    ><button class="btn wide" data-action="join">Вступить по приглашению</button>
  </main>`;
}
function currentLesson() {
  const lessons = lessonsOn(state, today()).filter(
    (l) =>
      role === 'head' ||
      appliesTo(
        l,
        state.members.find((m) => m.id === state.currentMemberId),
      ),
  );
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  return lessons.find((l) => l.end >= now) || lessons.at(-1);
}
function home() {
  const l = currentLesson(),
    counts = { present: 0, late: 0, absent: 0, unknown: 0 };
  if (l)
    for (const m of state.members.filter((m) => appliesTo(l, m))) {
      const s = grade(state, today(), l.id, m.id);
      counts[s === 'excused' ? 'absent' : s]++;
    }
  return /* HTML */ `<p class="greeting">${escapeHtml(greet())}</p>
    <div class="group-card">
      <div class="brand-mark">М</div>
      <div>
        <h2>${escapeHtml(state.group.name)}</h2>
        <small>МИСИС · ${state.members.length} студентов</small>
      </div>
      <button class="icon-btn" data-page="settings" aria-label="Настройки группы">
        ${icon('settings')}
      </button>
    </div>
    <section class="card hero">
      <div class="eyebrow">
        <span class="live-dot"></span> ПОСЕЩАЕМОСТЬ
        <span style="margin-left:auto;font-size:8px"
          >${new Date(today() + 'T12:00:00Z').toLocaleDateString('ru', { day: 'numeric', month: 'short' })}</span
        >
      </div>
      <h2>${l ? escapeHtml(l.subject) : 'Сегодня без занятий'}</h2>
      <p class="time">
        ${l ? `${l.start} — ${l.end} · ${escapeHtml(l.room)}` : 'Можно подготовиться к следующей неделе'}
      </p>
      ${
        l
          ? /* HTML */ `<div class="counts">
              <div><strong class="green">${counts.present}</strong><small>на паре</small></div>
              <div><strong class="amber">${counts.late}</strong><small>опоздали</small></div>
              <div><strong class="red">${counts.absent}</strong><small>не пришли</small></div>
              <div><strong>${counts.unknown}</strong><small>не ответили</small></div>
            </div>`
          : ''
      }<button class="hero-link" data-action="today">Весь день и отметки ${icon('arrow')}</button>
    </section>
    <section class="section">
      <div class="section-title">
        <h2 class="eyebrow">БЫСТРЫЕ ДЕЙСТВИЯ</h2>
        <span class="muted" style="font-size:9px">Всё для старосты</span>
      </div>
      <div class="quick-grid">
        ${[
          ['groupCard', 'users', 'Карточка группы', 'Информация, ссылки и фото'],
          ['requests', 'speaker', 'Обращения', 'Вопросы студентов и ответы'],
          ['excuses', 'file', 'Причины пропусков', 'Объяснения и вложения студентов'],
          ['students', 'users', 'Студенты', 'Список группы и приглашения'],
          ['schedule', 'calendar', 'Расписание', 'Пары, семестр и каникулы'],
          ['reports', 'chart', 'Отчёты', 'Выгрузка для деканата'],
          ['risk', 'alert', 'Пропуски', 'Кому нужно твоё внимание'],
          ['journal', 'calendar', 'Журнал', 'Посещаемость по дням'],
          ['announcements', 'speaker', 'Объявления', 'Важное для всей группы'],
          ['materials', 'book', 'База знаний', 'Конспекты, файлы и ссылки по предметам'],
        ]
          .map(
            ([id, ic, title, sub]) =>
              /* HTML */ `<button class="quick" data-page="${id}">
                <div class="tile-icon">${icon(ic)}</div>
                <div>
                  <h3>${title}</h3>
                  <p>${sub}</p>
                </div>
              </button>`,
          )
          .join('')}
      </div>
    </section>
    <p class="footer-note">
      ${demo ? 'Демонстрационные данные · не расписание МИСИС' : 'Сделано для твоей группы'}
    </p>`;
}
function students() {
  const found = state.members.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));
  const members =
    studentSort === 'az'
      ? sortMembers(found)
      : studentSort === 'za'
        ? sortMembers(found).reverse()
        : found;
  return (
    heading(
      'Студенты',
      `${state.members.length} в группе · ${state.members.filter((m) => m.active).length} активных`,
      /* HTML */ `<button class="icon-btn" data-action="invite" aria-label="Пригласить студентов">
        ${icon('plus')}
      </button>`,
    ) +
    /* HTML */ `<div class="card student-info">
        <h3>Собери свою группу</h3>
        <p>
          Отправь приглашение одногруппникам. После входа через Telegram они появятся в журнале.
        </p>
        <button class="btn primary wide" data-action="invite">
          ${icon('link')} Пригласить студентов
        </button>
      </div>
      <div class="search">
        ${icon('search')}<input
          id="student-search"
          aria-label="Поиск студента"
          placeholder="Найти студента"
          value="${escapeHtml(search)}"
        />
      </div>
      <div class="sort-row">
        <label for="student-sort">Порядок списка</label
        ><select id="student-sort">
          <option value="az" ${studentSort === 'az' ? 'selected' : ''}>Фамилия: А–Я</option>
          <option value="za" ${studentSort === 'za' ? 'selected' : ''}>Фамилия: Я–А</option>
          <option value="joined" ${studentSort === 'joined' ? 'selected' : ''}>
            По вступлению
          </option>
        </select>
      </div>
      <div class="card list-card">
        ${members.map((m, i) => /* HTML */ `<div class="student"><span class="index">${i + 1}</span><span class="avatar">${escapeHtml(initials(m.name))}</span><span class="name">${escapeHtml(m.name)}</span><span class="badge ${m.role === 'head' ? 'violet' : ''}">${m.active === false ? 'вышел' : m.role === 'head' ? '♛ староста' : '● активен'}</span>${state.dayAnswers?.some((a) => a.user_id === m.id && a.date === today()) ? '<span class="badge violet">авто · день</span>' : ''}</div>`).join('') || empty('Никого не нашли', 'Попробуй другое имя', 'search')}
      </div>`
  );
}
function schedule() {
  return (
    heading(
      'Расписание',
      `${escapeHtml(state.group.name)} · учебная неделя`,
      role === 'head'
        ? /* HTML */ `<button
            class="icon-btn"
            data-action="sync"
            aria-label="Подключить расписание МИСИС"
          >
            ${icon('refresh')}
          </button>`
        : '',
    ) +
    /* HTML */ `<div class="card">
        <div class="eyebrow">СЕМЕСТР</div>
        <div style="font-size:12px">
          ${formatDate(state.group.semesterStart)} — ${formatDate(state.group.semesterEnd)}
        </div>
      </div>
      <div class="segmented" style="margin:18px 0 8px">
        <button data-action="week" data-value="odd" class="${week === 'odd' ? 'active' : ''}">
          Числитель</button
        ><button data-action="week" data-value="even" class="${week === 'even' ? 'active' : ''}">
          Знаменатель
        </button>
      </div>
      <p class="source-note" style="text-align:center">
        Сейчас идёт ${parity(today(), state.group) === 'odd' ? 'числитель' : 'знаменатель'}
      </p>
      ${demo ? /* HTML */ `<div class="notice warning" style="margin-top:16px">${state.group.source ? 'Импортирована копия файла МИСИС. Участники и отметки — демонстрационные.' : 'Показан учебный пример. Импорт расписания МИСИС — через кнопку ↻.'}</div>` : !state.group.source ? /* HTML */ `<div class="notice" style="margin-top:16px">Источник МИСИС ещё не подключён. ${role === 'head' ? 'Нажми ↻, чтобы выбрать его.' : ''}</div>` : /* HTML */ `<p class="source-note">МИСИС · обновлено ${escapeHtml(formatDate(state.group.source.syncedAt?.slice(0, 10)))}</p>`}${
        [1, 2, 3, 4, 5, 6]
          .map((d) => {
            const ls = state.lessons
              .filter(
                (l) =>
                  !l.date &&
                  (!l.validTo || l.validTo >= today()) &&
                  l.day === d &&
                  (l.week === week || l.week === 'all'),
              )
              .sort((a, b) => a.start.localeCompare(b.start));
            return ls.length
              ? /* HTML */ `<h2 class="weekday">${DAYS[d]}</h2>
                  <div class="card list-card">${ls.map(lessonCard).join('')}</div>`
              : '';
          })
          .join('') ||
        empty('Расписание пока пустое', 'Подключи источник МИСИС или добавь первую пару.')
      }${
        state.lessons.some((l) => l.date)
          ? /* HTML */ `<h2 class="weekday">Пары по датам</h2>
              <div class="card list-card">
                ${state.lessons
                  .filter((l) => l.date)
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map(lessonCard)
                  .join('')}
              </div>`
          : ''
      }
      <section class="section">
        <h2 class="eyebrow">КАНИКУЛЫ И СЕССИИ</h2>
        ${
          state.breaks
            .map(
              (b) =>
                /* HTML */ `<div class="card" style="margin-bottom:8px">
                  <h3>${escapeHtml(b.name)}</h3>
                  <p class="source-note">${formatDate(b.start)} — ${formatDate(b.end)}</p>
                </div>`,
            )
            .join('') ||
          /* HTML */ `<p class="hint" style="text-align:center;margin:25px 0">Периодов пока нет</p>`
        }${role === 'head' ? /* HTML */ `<button class="btn outline wide" data-action="break">Добавить каникулы / сессию</button>` : ''}
      </section>
      ${role === 'head' ? fab('lesson', 'Добавить пару') : ''}`
  );
}
function lessonCard(l) {
  return /* HTML */ `<button
    class="lesson"
    data-action="lesson-detail"
    data-id="${escapeHtml(l.id)}"
  >
    <div class="lesson-time">${l.start}<small>${l.end}</small></div>
    <div class="lesson-body">
      <h3>${escapeHtml(l.subject)}</h3>
      <p>${escapeHtml(l.room)} · ${escapeHtml(l.teacher || 'Преподаватель не указан')}</p>
      <div class="lesson-meta">
        <span
          class="lesson-type ${l.type === 'Практика' ? 'practice' : l.type === 'Лабораторная' ? 'lab' : ''}"
          >${escapeHtml(l.type)}</span
        >${l.subgroups?.length === 1 ? /* HTML */ `<span class="badge violet">Подгруппа ${l.subgroups[0]}</span>` : ''}${l.week !== 'all' ? /* HTML */ `<span class="badge violet">${l.week === 'odd' ? 'Числитель' : 'Знаменатель'}</span>` : ''}${l.date ? /* HTML */ `<span class="badge violet">${formatDate(l.date)}</span>` : ''}
      </div>
    </div>
    ${icon('chevron', 'chevron')}
  </button>`;
}

function journal() {
  const first = month + '-01',
    count = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate(),
    offset = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
  return (
    back() +
    heading('Журнал', 'Выбери день, чтобы посмотреть и поправить отметки') +
    /* HTML */ `<div class="calendar-toolbar">
        <button class="icon-btn" data-action="month" data-value="-1" aria-label="Предыдущий месяц">
          ${icon('back')}</button
        ><strong
          >${new Date(first + 'T12:00:00Z').toLocaleDateString('ru', { month: 'long', year: 'numeric' })}</strong
        ><button class="icon-btn" data-action="month" data-value="1" aria-label="Следующий месяц">
          ${icon('chevron')}
        </button>
      </div>
      <div class="calendar">
        ${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => /* HTML */ `<div class="dow">${d}</div>`).join('')}${'<span></span>'.repeat(offset)}${Array.from(
          { length: count },
          (_, i) => {
            const date = month + '-' + String(i + 1).padStart(2, '0');
            const has = Object.keys(state.marks).some((k) => k.startsWith(date + '|'));
            return /* HTML */ `<button
              class="day ${has ? 'has' : ''} ${date === today() ? 'today' : ''}"
              data-action="day"
              data-date="${date}"
              ${date > today() ? 'disabled' : ''}
            >
              ${i + 1}
            </button>`;
          },
        ).join('')}
      </div>
      <p class="hint">
        Точкой отмечены дни с отметками. Открой прошедший день, чтобы проверить посещаемость или
        внести исправление.
      </p>`
  );
}
function day() {
  const ls = lessonsOn(state, journalDate);
  return (
    /* HTML */ `<button class="back" data-page="journal">${icon('back')} Журнал</button>` +
    heading(formatDate(journalDate), DAYS[new Date(journalDate + 'T12:00:00Z').getUTCDay()]) +
    (ls.length
      ? /* HTML */ `<div class="table-wrap">
            <table class="attendance">
              <thead>
                <tr>
                  <th>Студент</th>
                  ${ls.map((l, i) => /* HTML */ `<th title="${escapeHtml(l.subject)}">${i + 1} пара<br />${l.start}<br />${escapeHtml(l.subject)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${sortMembers(state.members)
                  .map(
                    (m) =>
                      /* HTML */ `<tr>
                        <td>
                          ${escapeHtml(m.name.split(' ')[0] + ' ' + (m.name.split(' ')[1]?.[0] || '') + '.')}
                        </td>
                        ${ls
                          .map((l) => {
                            const s = grade(state, journalDate, l.id, m.id);
                            if (!appliesTo(l, m)) return '<td class="muted">—</td>';
                            return /* HTML */ `<td>
                              <button
                                class="mark ${s}"
                                data-action="mark"
                                data-member="${m.id}"
                                data-lesson="${l.id}"
                                aria-label="${escapeHtml(m.name)}, ${escapeHtml(l.subject)}: ${STATUS[s][1]}"
                              >
                                ${STATUS[s][0]}${state.autoAttendance?.some((a) => a.date === journalDate && a.lesson_id === l.id && a.user_id === m.id) ? '<sup title="Автоотметка студента на весь день">а</sup>' : ''}
                              </button>
                            </td>`;
                          })
                          .join('')}
                      </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
          <div class="legend">
            ${Object.entries(STATUS)
              .map(
                ([s, [sym, title]]) =>
                  /* HTML */ `<span><i class="${s}">${sym}</i>${title.toLowerCase()}</span>`,
              )
              .join('')}
          </div>
          <p class="hint" style="text-align:center">
            Нажми на ячейку, чтобы изменить отметку. «а» — автоотметка студента на день.<br />Отсутствие
            ответа не считается прогулом.
          </p>`
      : empty('В этот день нет пар', 'Можно добавить занятие вручную.')) +
    /* HTML */ `<button
      class="btn outline wide"
      style="margin-top:20px"
      data-action="manual-lesson"
    >
      ${icon('plus')} Добавить пару на этот день
    </button>`
  );
}
function reports() {
  const rows = reportRows(state, period);
  return (
    back() +
    heading('Отчёты', 'Посещаемость группы для деканата') +
    /* HTML */ `<div class="segmented">
        ${[
          ['week', 'Неделя'],
          ['month', 'Месяц'],
          ['semester', 'Семестр'],
        ]
          .map(
            ([v, t]) =>
              /* HTML */ `<button
                data-action="period"
                data-value="${v}"
                class="${period === v ? 'active' : ''}"
              >
                ${t}
              </button>`,
          )
          .join('')}
      </div>
      <div class="card" style="margin:16px 0">
        <div class="eyebrow">EXCEL-ТАБЛИЦА</div>
        <p class="muted" style="font-size:12px">
          Строки — студенты, столбцы — пары. В каждой ячейке отметка, в конце — итоги за период.
        </p>
        <div class="stats-grid" style="margin:22px 0 0">
          <div><strong>${state.members.length}</strong><small>студентов</small></div>
          <div><strong>${rows[0].length - 6}</strong><small>пар</small></div>
          <div><strong style="font-size:21px">.xlsx</strong><small>формат</small></div>
        </div>
      </div>
      <button class="btn primary wide" data-action="export">
        ${icon('download')} Скачать Excel</button
      ><button class="btn outline wide" style="margin-top:10px" data-action="send-report">
        ${icon('file')} Прислать отчёт в чат
      </button>
      <p class="hint">
        ${demo ? 'В демо файл скачивается на устройство. Отправка в Telegram появится после подключения бота.' : 'Бот отправит файл в твой личный чат. Сначала нажми /start в боте.'}
      </p>`
  );
}
function bars(s) {
  return /* HTML */ `<div class="progress">
    ${['present', 'late', 'absent', 'excused'].map((k) => /* HTML */ `<span class="${k}" style="width:${s.total ? (100 * s[k]) / s.total : 0}%"></span>`).join('')}
  </div>`;
}
function risk() {
  const values = state.members
    .map((m) => ({ m, s: attendanceSummary(state, m.id) }))
    .sort((a, b) => b.s.absent - a.s.absent);
  const isRisk = (s) => Object.values(s.subjects).some((v) => v.absent >= state.group.threshold);
  return (
    back() +
    heading('Пропуски', `Порог внимания: ${state.group.threshold} пропуска по предмету`) +
    /* HTML */ `<div class="stats-grid">
        <div class="card">
          <strong class="red">${values.filter((v) => isRisk(v.s)).length}</strong
          ><small>требуют внимания</small>
        </div>
        <div class="card"><strong>${values.length}</strong><small>студентов</small></div>
        <div class="card">
          <strong>${Math.max(0, ...values.map((v) => v.s.total))}</strong
          ><small>пар за семестр</small>
        </div>
      </div>
      ${values
        .map(
          ({ m, s }) =>
            /* HTML */ `<div class="card risk ${isRisk(s) ? '' : 'safe'}">
              <div class="risk-title">
                <span>${escapeHtml(m.name)}</span
                ><span class="badge ${isRisk(s) ? 'red' : 'violet'}">${s.absent} проп.</span>
              </div>
              ${bars(s)}<small
                >был ${s.present + s.late} из ${s.total} · уважительных ${s.excused} · без ответа
                ${s.unknown}</small
              >
            </div>`,
        )
        .join('')}
      <p class="hint">
        Это настраиваемый индикатор для старосты, а не официальный критерий отчисления МИСИС.
      </p>`
  );
}
function unreadCount() {
  return (state.announcements || []).filter((a) => announcementState(a) === 'active' && !a.read)
    .length;
}
function announcements() {
  const all = state.announcements || [],
    items = all
      .filter((a) => {
        const status = announcementState(a);
        return announcementFilter === 'unread'
          ? status === 'active' && !a.read
          : status === announcementFilter;
      })
      .toSorted(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          (b.publishAt || b.createdAt).localeCompare(a.publishAt || a.createdAt),
      );
  return (
    (role === 'head' ? back() : '') +
    heading('Объявления', 'Важное для всей группы') +
    /* HTML */ `<div class="announcement-tabs">
        ${[['active', 'Актуальные'], ['unread', 'Непрочитанные · ' + unreadCount()], ['archived', 'Архив'], ...(role === 'head' ? [['scheduled', 'Запланированы']] : [])].map(([id, label]) => /* HTML */ `<button class="btn compact ${announcementFilter === id ? 'primary' : ''}" data-action="announcement-filter" data-filter="${id}">${label}</button>`).join('')}
      </div>
      ${
        items
          .map(
            (a) =>
              /* HTML */ `<article class="card announcement">
                ${a.pinned ? '<div class="pin">Закреплено</div>' : ''}${!a.read && announcementState(a) === 'active' ? '<span class="badge violet">Новое</span>' : ''}
                <h3>${escapeHtml(a.title)}</h3>
                <p class="announcement-preview">${escapeHtml(a.text)}</p>
                <small
                  >${displayTime(a.publishAt || a.createdAt)}${a.expiresAt ? ' · до ' + displayTime(a.expiresAt) : ''}</small
                ><button
                  class="btn outline wide"
                  style="margin-top:12px"
                  data-action="read-announcement"
                  data-id="${escapeHtml(a.id)}"
                >
                  ${announcementState(a) === 'scheduled' ? 'Просмотреть' : a.acknowledged ? 'Ознакомление подтверждено' : 'Открыть'}</button
                >${a.requireAck && role === 'head' ? /* HTML */ `<button class="back" data-action="ack-list" data-id="${escapeHtml(a.id)}">Ознакомились: ${(a.acknowledgements || []).filter((m) => m.ackAt).length} / ${(a.acknowledgements || []).length}</button>` : ''}${role === 'head' ? /* HTML */ `<button class="back" data-action="pin" data-id="${escapeHtml(a.id)}">${a.pinned ? 'Открепить' : 'Закрепить'}</button>` : ''}
              </article>`,
          )
          .join('') ||
        empty('Здесь пока пусто', 'Объявления появятся в выбранном разделе.', 'speaker')
      }` +
    (role === 'head' ? fab('announcement', 'Новое объявление') : '')
  );
}

function materials() {
  return (
    (role === 'head' ? back() : '') +
    heading('База знаний', 'Конспекты, методички и полезные ссылки') +
    state.materials
      .map(
        (m) =>
          /* HTML */ `<div class="card material">
            <div class="tile-icon">${icon(m.url ? 'link' : 'file')}</div>
            <div class="material-body">
              <h3>${escapeHtml(m.title)}</h3>
              <p>${escapeHtml(m.subject)}${m.filename ? ' · ' + escapeHtml(m.filename) : ''}</p>
            </div>
            <button
              class="icon-btn"
              data-action="open-material"
              data-id="${m.id}"
              aria-label="Открыть ${escapeHtml(m.title)}"
            >
              ${icon(m.url ? 'arrow' : 'download')}
            </button>
          </div>`,
      )
      .join('') +
    (state.materials.length
      ? ''
      : empty(
          'Все знания — в одном месте',
          'Добавь первый материал: файл или ссылку.<br>Его увидит вся группа.',
          'book',
        )) +
    (role === 'head' ? fab('material', 'Добавить материал') : '')
  );
}
function setting(ic, title, subtitle, action, extra = '') {
  return /* HTML */ `<button class="setting" data-action="${action}">
    ${icon(ic)}<span>${title}</span><small>${subtitle}</small>${extra || icon('chevron', 'chevron')}
  </button>`;
}
function settings() {
  return (
    heading('Настройки', 'Твоя группа, твои правила') +
    /* HTML */ `<div class="card group-card" style="padding:17px">
        <div class="brand-mark">М</div>
        <div>
          <h2>${escapeHtml(state.group.name)}</h2>
          <small>МИСИС</small>
        </div>
        <button class="btn compact" style="margin-left:auto" data-action="edit-group">
          Изменить
        </button>
      </div>
      <section class="section">
        <h2 class="eyebrow">ГРУППА</h2>
        <div class="card list-card">
          ${setting('users', 'Пригласить студентов', 'Код группы', 'invite')}${setting('bell', 'Опросы перед парой', `за ${state.group.pollMinutes} мин`, 'poll-settings')}${setting('calendar', 'Плавающее расписание', '', 'floating', /* HTML */ `<i class="toggle ${state.group.floating ? 'on' : ''}"></i>`)}${setting('clock', 'Часовой пояс', 'Москва', 'timezone')}${setting('refresh', 'Расписание МИСИС', state.group.source ? 'Подключено' : 'Подключить', 'sync')}${setting('alert', 'Порог пропусков', `${state.group.threshold} по предмету`, 'threshold')}
        </div>
      </section>
      <section class="section">
        <h2 class="eyebrow">ПРИЛОЖЕНИЕ</h2>
        <div class="card list-card">
          ${setting('users', 'Мои группы', `${state.groups?.length || 1}`, 'groups')}${setting('help', 'Как пользоваться', '', 'help')}${demo ? setting('refresh', 'Сбросить демо', '', 'reset') : ''}
        </div>
      </section>
      <p class="footer-note">МИСИС · Староста v0.3.0<br />Независимый студенческий проект</p>`
  );
}
function poll() {
  const ls = lessonsOn(state, today()).filter((l) =>
      appliesTo(
        l,
        state.members.find((m) => m.id === state.currentMemberId),
      ),
    ),
    l = currentLesson();
  return (
    heading(
      escapeHtml(greet()),
      `${escapeHtml(state.group.name)} · ${new Date(today() + 'T12:00:00Z').toLocaleDateString('ru', { day: 'numeric', month: 'long' })}`,
    ) +
    (state.group.subgroups?.length
      ? /* HTML */ `<button
          class="btn outline wide"
          style="margin-bottom:16px"
          data-action="subgroup"
        >
          Подгруппа:
          ${state.members.find((m) => m.id === state.currentMemberId)?.subgroup || 'выбрать'}
        </button>`
      : '') +
    personalWarnings() +
    /* HTML */ `<div class="student-links">
      <button class="btn outline" data-page="groupCard">Карточка группы</button
      ><button class="btn outline" data-page="requests">Написать старосте</button>
    </div>` +
    dayAnswerButton() +
    (l
      ? /* HTML */ `<section class="card hero">
          <div class="eyebrow"><span class="live-dot"></span> ОТМЕТКА НА ПАРУ</div>
          <h2>${escapeHtml(l.subject)}</h2>
          <p class="time">${l.start} — ${l.end} · ${escapeHtml(l.room)}</p>
          <div class="poll-options">
            ${[
              ['present', '✓ На паре'],
              ['late', '◷ Опаздываю'],
              ['absent', '× Не приду'],
              ['excused', 'Уважительная'],
            ]
              .map(
                ([s, label]) =>
                  /* HTML */ `<button
                    class="btn ${grade(state, today(), l.id, state.currentMemberId) === s ? 'selected' : ''}"
                    data-action="self-mark"
                    data-status="${s}"
                    data-lesson="${l.id}"
                  >
                    ${label}
                  </button>`,
              )
              .join('')}
          </div>
          <p class="source-note">Ответ видит староста. Отметку можно изменить до окончания пары.</p>
        </section>`
      : empty('Сегодня без занятий', 'Загляни в расписание на неделю.')) +
    /* HTML */ `<section class="section">
      <div class="section-title">
        <h2 class="eyebrow">ПАРЫ СЕГОДНЯ</h2>
        <button data-page="schedule">Вся неделя →</button>
      </div>
      <div class="card list-card">${ls.map(lessonCard).join('')}</div>
    </section>`
  );
}
function stats() {
  const s = attendanceSummary(state, state.currentMemberId);
  return (
    heading('Моя статистика', 'Посещаемость по твоим отметкам') +
    /* HTML */ `<div class="card hero">
        <div class="eyebrow">БЫЛ НА ПАРЕ В ЭТОМ СЕМЕСТРЕ</div>
        <div class="big-stat">${s.present + s.late} <small>из ${s.total} пар</small></div>
        <p class="source-note" style="margin-bottom:16px">
          Пропусков ${s.absent + s.excused}, из них по уважительной причине — ${s.excused}. Без
          ответа — ${s.unknown}.
        </p>
        ${bars(s)}
      </div>
      <section class="section">
        <h2 class="eyebrow">ПО ПРЕДМЕТАМ</h2>
        ${
          Object.entries(s.subjects)
            .map(
              ([title, v]) =>
                /* HTML */ `<details class="card" style="margin-bottom:10px">
                  <summary style="font-size:12px;cursor:pointer">
                    ${escapeHtml(title)}
                    <span class="muted">· ${v.present + v.late}/${v.total}</span>
                  </summary>
                  <div style="margin-top:12px">
                    ${bars(v)}${
                      v.records
                        .filter((r) => r.status !== 'present')
                        .map(
                          (r) =>
                            /* HTML */ `<p class="source-note">
                              ${formatDate(r.date)} · ${STATUS[r.status][1]}
                            </p>`,
                        )
                        .join('') || '<p class="source-note">Все пары посещены</p>'
                    }
                  </div>
                </details>`,
            )
            .join('') || empty('Пока нет статистики', 'Она появится после первых занятий.', 'chart')
        }
      </section>`
  );
}

function dialog(title, body, submit) {
  modal.innerHTML = /* HTML */ `<button
      class="close"
      type="button"
      data-action="close"
      aria-label="Закрыть"
    >
      ×
    </button>
    <h2 id="modal-title">${title}</h2>
    <form>
      ${body}${
        submit
          ? /* HTML */ `<div class="form-error" role="alert"></div>
              <div class="modal-actions">
                <button class="btn" type="button" data-action="close">Отмена</button
                ><button class="btn primary" type="submit">Сохранить</button>
              </div>`
          : ''
      }
    </form>`;
  modal.showModal();
  const form = modal.querySelector('form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!submit) return;
    const b = form.querySelector('[type=submit]');
    b.disabled = true;
    try {
      const done = await submit(Object.fromEntries(new FormData(form)), form);
      if (done !== false) {
        modal.close();
        toast('Готово');
      }
    } catch (err) {
      form.querySelector('.form-error').textContent = err.message;
    } finally {
      b.disabled = false;
    }
  });
}
function lessonForm(existing = {}, dated = false) {
  dialog(
    existing.id ? 'Изменить пару' : 'Добавить пару',
    field('Предмет', 'subject', existing.subject, 'text', 'required maxlength="160"') +
      field('Преподаватель', 'teacher', existing.teacher) +
      field('Аудитория', 'room', existing.room) +
      /* HTML */ `<div class="field-row">
        ${field('Начало', 'start', existing.start || '09:00', 'time', 'required')}${field('Конец', 'end', existing.end || '10:35', 'time', 'required')}
      </div>` +
      (dated || existing.date
        ? field('Дата', 'date', existing.date || journalDate, 'date', 'required')
        : select(
            'День недели',
            'day',
            DAYS.map((d, i) => [i, d]).filter(([i]) => i > 0),
            existing.day || 1,
          )) +
      select(
        'Тип недели',
        'week',
        [
          ['all', 'Каждую неделю'],
          ['odd', 'Числитель'],
          ['even', 'Знаменатель'],
        ],
        existing.week || 'all',
      ) +
      select(
        'Вид занятия',
        'type',
        [
          ['Лекция', 'Лекция'],
          ['Практика', 'Практика'],
          ['Лабораторная', 'Лабораторная'],
          ['Семинар', 'Семинар'],
        ],
        existing.type || 'Лекция',
      ),
    async (p) => {
      if (p.date) p.day = new Date(p.date + 'T12:00:00Z').getUTCDay();
      await mutate('lesson', { ...p, ...(existing.id ? { id: existing.id } : {}) });
    },
  );
}

let misisCatalog;
async function syncDialog() {
  toast('Загружаю каталог МИСИС…');
  const response = await fetch('/misis-data.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Каталог ещё загружается. Попробуй позже.');
  misisCatalog = await response.json();
  const available = misisCatalog.sources.filter((s) => s.groups?.length);
  if (!available.length) {
    dialog(
      'Расписание МИСИС',
      /* HTML */ `<p class="hint">Каталог расписаний ещё не загружен.</p>
        ${!demo ? '<button type="button" class="btn primary wide" data-action="refresh-misis">Загрузить с сайта МИСИС</button>' : '<p class="hint">В демо доступны учебные примеры. Открой приложение через Telegram, чтобы загрузить расписание своей группы.</p>'}`,
      () => {},
    );
    modal.querySelector('[type=submit]').textContent = 'Закрыть';
    return;
  }
  const source =
    available.find((s) => s.groups.some((g) => g.name === state.group.name)) || available[0];
  dialog(
    'Расписание МИСИС',
    /* HTML */ `<p class="hint" style="margin:8px 0 16px">
        Выбери институт и группу. Перед импортом покажем найденные занятия.
      </p>
      ${select(
        'Институт',
        'sourceId',
        available.map((s) => [s.id, s.name]),
        source.id,
      )}${select(
        'Учебная группа',
        'academicGroup',
        source.groups.map((g) => [g.name, g.name + ' · ' + g.sheet]),
        state.group.source?.academicGroup || state.group.name,
      )}
      <p class="source-note">
        Снимок официальных файлов: ${new Date(misisCatalog.fetchedAt).toLocaleDateString('ru')}.
        ${demo ? 'В демо используется сохранённая копия.' : 'Для свежих файлов нажми «Обновить с сайта».'}
      </p>
      ${!demo ? '<button type="button" class="btn outline wide" style="margin-top:12px" data-action="refresh-misis">Обновить с сайта МИСИС</button>' : ''}${misisCatalog.sources
        .filter((s) => !s.groups?.length)
        .map(
          (s) =>
            /* HTML */ `<p class="source-note">
              ${escapeHtml(s.name)}: ручной формат, автоматический импорт пока недоступен.
            </p>`,
        )
        .join('')}<a
        href="https://misis.ru/students/schedule/"
        target="_blank"
        rel="noopener"
        class="source-note"
        style="display:block"
        >Официальный источник ↗</a
      >`,
    async (p) => {
      showImportPreview(p);
      return false;
    },
  );
  modal.querySelector('[type=submit]').textContent = 'Проверить пары';
}
function showImportPreview(p) {
  const source = misisCatalog.sources.find((s) => s.id === p.sourceId),
    academic = source.groups.find((g) => g.name === p.academicGroup);
  if (!academic?.lessons.length) throw new Error('В этой группе не распознаны занятия');
  dialog(
    'Проверка расписания',
    /* HTML */ `<p class="hint" style="margin:8px 0">
        ${escapeHtml(academic.name)} · ${academic.lessons.length} занятий в шаблоне недели
      </p>
      ${source.stale ? '<div class="notice warning">Не удалось обновить этот файл. Используется предыдущая копия.</div>' : ''}
      <div class="notice">
        Проверь чередование недель и подгруппы.
        ${demo ? 'Импорт заменит учебный пример; отметки демо будут очищены.' : 'Импорт обновит пары МИСИС. Вручную добавленные занятия сохранятся.'}
      </div>
      ${select(
        'Верхняя строка в Excel — это',
        'upperWeek',
        [
          ['odd', 'Числитель'],
          ['even', 'Знаменатель'],
        ],
        'odd',
      )}
      <div class="card list-card" style="max-height:260px;overflow:auto;margin-top:14px">
        ${academic.lessons
          .map(
            (l) =>
              /* HTML */ `<div class="lesson">
                <div class="lesson-body">
                  <h3>${escapeHtml(l.subject)}</h3>
                  <p>${DAYS[l.day]} · ${l.start}–${l.end} · ${escapeHtml(l.room)}</p>
                  <p>
                    ${l.week === 'all' ? 'Каждую неделю' : l.week === 'odd' ? 'Верхняя строка' : 'Нижняя строка'}
                    · подгруппа ${l.subgroups.join(', ')}
                  </p>
                </div>
              </div>`,
          )
          .join('')}
      </div>
      ${
        academic.unparsed?.length
          ? /* HTML */ `<div class="notice warning" style="margin-top:12px">
                ${academic.unparsed.length} записей требуют ручной проверки и не попадут в импорт.
                <details>
                  <summary>Посмотреть</summary>
                  ${academic.unparsed.map((x) => /* HTML */ `<p>${escapeHtml(x.text)} — ${escapeHtml(x.reason)}</p>`).join('')}
                </details>
              </div>
              <label
                ><input
                  type="checkbox"
                  name="acceptPartial"
                  required
                  style="width:auto;min-height:auto"
                />
                Проверю эти занятия вручную</label
              >`
          : ''
      }
      <p class="source-note">
        Файл получен ${new Date(source.fetchedAt).toLocaleDateString('ru')}.
        <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">Открыть оригинал</a>
      </p>`,
    async (fields) => {
      if (demo) {
        const next = structuredClone(state);
        next.lessons = academic.lessons.map((l) => ({
          ...l,
          source: 'misis',
          week:
            fields.upperWeek === 'odd'
              ? l.week
              : l.week === 'all'
                ? 'all'
                : l.week === 'odd'
                  ? 'even'
                  : 'odd',
        }));
        next.marks = {};
        next.group.name = academic.name;
        next.group.subgroups = academic.subgroups;
        next.group.source = {
          url: source.url,
          name: source.name,
          academicGroup: academic.name,
          fetchedAt: source.fetchedAt,
          syncedAt: new Date().toISOString(),
        };
        saveDemo(next);
      } else
        state = await api('/api/misis/import', {
          groupId: state.group.id,
          sourceId: source.id,
          academicGroup: academic.name,
          upperWeek: fields.upperWeek,
          acceptPartial: fields.acceptPartial === 'on',
        });
      navigate('schedule');
    },
  );
  modal.querySelector('[type=submit]').textContent = 'Импортировать пары';
}

function me() {
  return state.profile || {};
}
function avatarMarkup() {
  const name = me().name || state.members?.find((m) => m.id === state.currentMemberId)?.name || 'М';
  return /* HTML */ `<span class="avatar-fallback">${escapeHtml(initials(name))}</span
    >${me().photoUrl ? /* HTML */ `<img src="${escapeHtml(me().photoUrl)}" alt="" referrerpolicy="no-referrer" />` : ''}`;
}
document.addEventListener(
  'error',
  (ev) => {
    if (ev.target.matches?.('.profile-button img,.profile-avatar img')) ev.target.remove();
  },
  true,
);
function greet() {
  return greeting(
    me().firstName ||
      state.members?.find((m) => m.id === state.currentMemberId)?.name.split(' ')[1] ||
      'студент',
    new Date(),
    greetingRoll,
  );
}
function nameFields() {
  return (
    field(
      'Имя',
      'firstName',
      me().firstName || '',
      'text',
      'required minlength="2" maxlength="70" autocomplete="given-name" placeholder="Иван"',
    ) +
    field(
      'Фамилия',
      'lastName',
      me().lastName || '',
      'text',
      'required minlength="2" maxlength="70" autocomplete="family-name" placeholder="Иванов"',
    )
  );
}
function nameOnboarding() {
  return /* HTML */ `<main class="page identity-page">
    <div class="brand-mark">М</div>
    <h1>Давай познакомимся</h1>
    <p class="muted">
      Укажи настоящие имя и фамилию — так староста узнает тебя в списке и журнале. Эти данные будут
      общими для всех твоих групп.
    </p>
    <form id="identity-form">
      ${nameFields()}
      <div class="form-error" role="alert"></div>
      <button class="btn primary wide" type="submit">Продолжить</button>
    </form>
  </main>`;
}
async function updateIdentity(p) {
  const firstName = realName(p.firstName, 'Имя'),
    lastName = realName(p.lastName, 'Фамилия');
  if (demo) {
    const next = structuredClone(state);
    next.profile = {
      ...next.profile,
      complete: true,
      firstName,
      lastName,
      name: lastName + ' ' + firstName,
    };
    next.members.find((m) => m.id === next.currentMemberId).name = next.profile.name;
    saveDemo(next);
  } else
    state = await api('/api/profile', {
      firstName,
      lastName,
      ...(state.group ? { groupId: state.group.id } : {}),
    });
  role = state.role || 'student';
  render();
}
document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'identity-form') return;
  ev.preventDefault();
  const form = ev.target,
    b = form.querySelector('button');
  b.disabled = true;
  try {
    await updateIdentity(Object.fromEntries(new FormData(form)));
    handleLaunch();
    maybeWhatsNew();
  } catch (err) {
    form.querySelector('.form-error').textContent = err.message;
  } finally {
    b.disabled = false;
  }
});
function handleLaunch() {
  if (!state.profile?.complete || !state.group || !launchParams.has('excuse')) return;
  const lid = launchParams.get('excuse'),
    date = launchParams.get('date');
  launchParams.delete('excuse');
  if (state.lessons.some((l) => l.id === lid) && date === today())
    excuseForm('selfMark', { date, lessonId: lid });
  else toast('Это занятие уже прошло. Для исправления обратись к старосте.');
}
function profile() {
  const days = state.group ? attendanceDays(state, state.currentMemberId) : [],
    total = days.reduce((n, d) => n + d.total, 0),
    visited = days.reduce((n, d) => n + d.visited, 0);
  return (
    heading('Мой профиль') +
    /* HTML */ `<section class="card profile-card">
        <div class="profile-avatar">${avatarMarkup()}</div>
        <h2>${escapeHtml(me().name)}</h2>
        <p class="muted">
          ${state.group ? (role === 'head' ? 'Староста' : 'Студент') + ' · ' + escapeHtml(state.group.name) : 'Выбери или создай свою группу'}
        </p>
        <button class="btn outline compact" data-action="edit-name">Изменить имя и фамилию</button>
      </section>
      <button class="btn wide" data-action="groups" style="margin-top:12px">
        ${icon('users')} Мои группы
      </button>
      <section class="card heatmap-card">
        <h2>Посещаемость</h2>
        <p class="source-note">
          ${state.group ? 'За семестр · ' + escapeHtml(state.group.name) : 'Статистика появится после вступления в группу'}
        </p>
        ${
          days.length
            ? /* HTML */ `<div
                  class="heatmap-scroll"
                  tabindex="0"
                  aria-label="Календарь посещаемости, прокручивается по горизонтали"
                >
                  <div class="heatmap-months">
                    ${days
                      .filter((d, i) => i % 7 === 0)
                      .map(
                        (d, i, ds) =>
                          /* HTML */ `<span
                            >${i === 0 || d.date.slice(0, 7) !== ds[i - 1].date.slice(0, 7) ? escapeHtml(new Date(d.date + 'T12:00:00Z').toLocaleDateString('ru', { month: 'short' })) : ''}</span
                          >`,
                      )
                      .join('')}
                  </div>
                  <div class="heatmap">
                    ${days.map((d) => /* HTML */ `<button class="heat-cell ${d.tone}" data-action="heat-day" data-date="${d.date}" aria-label="${formatDate(d.date)}: посещено ${d.visited} из ${d.total}" title="${formatDate(d.date)}: ${d.visited}/${d.total}"></button>`).join('')}
                  </div>
                </div>
                <div class="heat-legend">
                  <span><i class="heat-cell level-4"></i>Посещение</span
                  ><span><i class="heat-cell missed"></i>Пропуск</span
                  ><span><i class="heat-cell excused"></i>Уважительная</span
                  ><span><i class="heat-cell unanswered"></i>Нет ответа</span>
                </div>
                <p class="hint">
                  ${visited} из ${total} завершённых пар посещено, включая опоздания. Чем ярче
                  зелёный, тем больше доля посещённых пар за день. Пустая клетка — занятий нет.
                  Нажми на день для подробностей.
                </p>`
            : empty('Пока нет статистики', 'Здесь появятся завершённые занятия текущего семестра.')
        }
      </section>
      ${profileTools()}`
  );
}
function excuses() {
  const items = state.excuses || [];
  return (
    back() +
    heading('Причины пропусков', 'Объяснения и вложения студентов') +
    /* HTML */ `<p class="hint">
        Уважительная отметка сохраняется сразу. Здесь можно прочитать объяснение и скачать файл.
      </p>
      ${
        items
          .map((x) => {
            const member = state.members.find((m) => m.id === x.user_id),
              lesson = state.lessons.find((l) => l.id === x.lesson_id);
            return /* HTML */ `<article class="card excuse-card">
              <h3>${escapeHtml(member?.name || 'Студент')}</h3>
              <p class="source-note">
                ${formatDate(x.date)} · ${escapeHtml(lesson?.subject || 'Занятие')} ·
                ${escapeHtml(lesson?.start || '')}
              </p>
              <p class="excuse-reason">${escapeHtml(x.reason || 'Причина во вложении')}</p>
              ${grade(state, x.date, x.lesson_id, x.user_id) !== 'excused' ? '<p class="hint">Отметка позже изменена. Объяснение сохранено.</p>' : ''}${x.hasFile ? /* HTML */ `<button class="btn outline wide" data-action="excuse-file" data-id="${escapeHtml(x.id)}">${icon('download')} ${escapeHtml(x.filename)}</button>` : ''}
            </article>`;
          })
          .join('') || empty('Объяснений пока нет', 'Здесь будут причины пропусков твоей группы.')
      }`
  );
}
async function readUpload(file) {
  if (!file || !file.size) return null;
  if (file.size > 2 * 1024 * 1024) throw new Error('Файл должен быть не больше 2 МБ');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw = '';
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { filename: file.name, data: 'data:application/octet-stream;base64,' + btoa(raw) };
}
function excuseForm(type, p) {
  const mid = type === 'selfMark' ? state.currentMemberId : p.memberId,
    old = state.excuses?.find(
      (x) => x.user_id === mid && x.lesson_id === p.lessonId && x.date === p.date,
    ),
    l = state.lessons.find((l) => l.id === p.lessonId);
  dialog(
    'Уважительная причина',
    /* HTML */ `<p class="hint">
        ${escapeHtml(l?.subject)} · ${formatDate(p.date)}. Напиши причину или приложи файл. Староста
        получит объяснение.
      </p>
      <label for="excuse-reason">Причина</label
      ><textarea
        id="excuse-reason"
        name="reason"
        maxlength="2000"
        placeholder="Например: посещение врача"
      >
${escapeHtml(old?.reason || '')}</textarea
      >${field('Документ или фото до 2 МБ', 'file', '', 'file')}
      <p class="source-note">
        ${old?.hasFile ? 'При повторной отправке приложи файл заново. ' : ''}Файл увидит староста и
        ты.
      </p>`,
    async (fields, form) => {
      const file = await readUpload(form.querySelector('[type=file]').files[0]),
        payload = { ...p, status: 'excused', reason: fields.reason, file };
      validateExcuse(payload);
      await mutate(type, payload);
      if (demo) {
        const next = structuredClone(state);
        next.excuses = (next.excuses || []).filter(
          (x) => !(x.user_id === mid && x.lesson_id === p.lessonId && x.date === p.date),
        );
        next.excuses.unshift({
          id: crypto.randomUUID(),
          user_id: mid,
          lesson_id: p.lessonId,
          date: p.date,
          reason: fields.reason,
          hasFile: !!file,
          filename: file?.filename,
          data: file?.data,
        });
        saveDemo(next);
      }
      toast(demo ? 'Сохранено в демо' : 'Сохранено. Бот отправит старосте уведомление.');
    },
  );
  modal.querySelector('[type=submit]').textContent = 'Отправить';
}
function groupDialog() {
  const groups = demo
    ? [
        {
          id: state.group.id,
          name: state.group.name,
          role,
          preferred: me().defaultGroupId === state.group.id,
        },
      ]
    : state.groups || [];
  dialog(
    'Мои группы',
    /* HTML */ `<p class="hint">
        Звезда выбирает группу, которая открывается при запуске. Переключение вручную не меняет этот
        выбор.
      </p>
      ${
        groups
          .map(
            (g) =>
              /* HTML */ `<div class="group-choice">
                <button
                  class="group-open"
                  type="button"
                  data-action="switch-group"
                  data-id="${escapeHtml(g.id)}"
                >
                  <strong>${escapeHtml(g.name)}</strong
                  ><small
                    >${g.role === 'head' ? 'Староста' : 'Студент'}${g.id === state.group?.id ? ' · открыта' : ''}</small
                  ></button
                ><button
                  type="button"
                  class="icon-btn ${g.preferred ? 'preferred' : ''}"
                  data-action="prefer-group"
                  data-id="${escapeHtml(g.id)}"
                  aria-label="${g.preferred ? 'Убрать приоритет' : 'Открывать при запуске'}: ${escapeHtml(g.name)}"
                  aria-pressed="${!!g.preferred}"
                >
                  ${g.preferred ? '★' : '☆'}</button
                ><button
                  type="button"
                  class="btn compact danger"
                  data-action="remove-group"
                  data-id="${escapeHtml(g.id)}"
                >
                  ${g.role === 'head' ? 'Удалить' : 'Выйти'}
                </button>
              </div>`,
          )
          .join('') || '<p class="hint">Ты пока не состоишь в группах.</p>'
      }<button
        class="btn primary wide"
        type="button"
        style="margin-top:16px"
        data-action="new-group"
      >
        + Создать группу</button
      ><button class="btn wide" type="button" style="margin-top:8px" data-action="new-join">
        Вступить по коду
      </button>`,
    null,
  );
}

function prefs() {
  return { ...DEFAULT_PREFS, ...me().preferences };
}
function applyAppearance() {
  const p = prefs(),
    theme = p.theme === 'telegram' ? (tg?.colorScheme === 'light' ? 'light' : 'dark') : p.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.large = String(p.largeText);
  try {
    tg?.setHeaderColor(theme === 'light' ? '#f5f4fa' : '#0c0d12');
    tg?.setBackgroundColor(theme === 'light' ? '#f5f4fa' : '#0c0d12');
    tg?.setBottomBarColor?.(theme === 'light' ? '#ffffff' : '#111219');
  } catch {}
}
tg?.onEvent?.('themeChanged', () => {
  if (state) applyAppearance();
});
async function savePreferences(p) {
  if (demo) {
    const next = structuredClone(state);
    next.profile.preferences = validatePreferences(p, prefs());
    saveDemo(next);
  } else {
    const result = await api('/api/preferences', p);
    state.profile.preferences = result.preferences;
  }
  render();
}
const checkField = (label, name, checked) =>
  /* HTML */ `<label class="check-field"
    ><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} /><span
      >${label}</span
    ></label
  >`;
function profileTools() {
  return /* HTML */ `<section class="section">
    <h2 class="eyebrow">НАСТРОЙКИ И ПОМОЩЬ</h2>
    <div class="card list-card">
      ${setting('bell', 'Уведомления и тихие часы', '', 'notification-settings')}${setting('settings', 'Тема и размер текста', '', 'appearance-settings')}${setting('help', 'Сообщить об ошибке', '', 'report-bug')}${setting('file', 'Мои сообщения об ошибках', '', 'bug-reports')}${setting('refresh', 'Что нового', 'v' + VERSION, 'whats-new')}
    </div>
  </section>`;
}
function personalWarnings() {
  return (state.absenceWarnings || []).length
    ? /* HTML */ `<section class="notice warning">
        <h3>Обрати внимание на пропуски</h3>
        ${state.absenceWarnings.map((w) => /* HTML */ `<p>${escapeHtml(w.subject)}: ${w.count} без уважительной причины (порог ${w.threshold}).</p>`).join('')}
        <p>Если отметка неверна, напиши старосте.</p>
      </section>`
    : '';
}
function dayAnswerButton() {
  const active = state.dayAnswers?.some(
    (a) => a.user_id === state.currentMemberId && a.date === today(),
  );
  if (
    !active &&
    !lessonsOn(state, today()).some(
      (l) =>
        appliesTo(
          l,
          state.members.find((m) => m.id === state.currentMemberId),
        ) && l.end >= moscowTime(),
    )
  )
    return '';
  return /* HTML */ `<div class="daily-answer">
    <button
      class="btn ${active ? 'outline' : 'primary'} wide"
      data-action="day-answer"
      data-enabled="${!active}"
    >
      ${active ? '✓ Автоотметка на день включена' : 'Буду на всех парах'}</button
    >${active ? '<p class="hint">Повторные опросы отключены. Нажми, чтобы отменить автоотметки. Отдельные исправления сохранятся.</p>' : ''}
  </div>`;
}
function displayTime(value) {
  return value
    ? new Date(value).toLocaleString('ru', {
        timeZone: 'Europe/Moscow',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }) + ' МСК'
    : '—';
}
function linkText(value) {
  return String(value || '')
    .split(/(https:\/\/[^\s]+)/g)
    .map((part) => {
      if (!part.startsWith('https://')) return escapeHtml(part);
      try {
        const u = new URL(part);
        if (u.username || u.password) return escapeHtml(part);
        return /* HTML */ `<a href="${escapeHtml(u.href)}" target="_blank" rel="noopener noreferrer"
          >${escapeHtml(part)}</a
        >`;
      } catch {
        return escapeHtml(part);
      }
    })
    .join('');
}
function groupCard() {
  const c = state.group.card || {};
  return (
    heading('Карточка группы', escapeHtml(state.group.name)) +
    (c.photo
      ? /* HTML */ `<img class="group-photo" src="${escapeHtml(c.photo)}" alt="Фото группы" />`
      : '') +
    /* HTML */ `<section class="card">
        <h2>${escapeHtml(state.group.name)}</h2>
        <p class="card-description">
          ${linkText(c.text || 'Староста пока не добавил информацию.')}
        </p>
      </section>
      ${role === 'head' ? '<button class="btn primary wide" style="margin-top:16px" data-action="edit-card">Настроить карточку</button>' : ''}`
  );
}
function requests() {
  return (
    heading(
      role === 'head' ? 'Обращения студентов' : 'Мои обращения',
      'Вопросы, вложения и ответы старосты',
    ) +
    /* HTML */ `<button class="btn primary wide" data-action="new-request">Написать старосте</button
      >${requestCards(state.requests || [], false)}`
  );
}
let ownBugReports = [];
function bugReports() {
  return (
    heading('Мои сообщения об ошибках', 'Сохраняются на сервере для владельца приложения') +
    /* HTML */ `<button class="btn primary wide" data-action="report-bug">Сообщить об ошибке</button
      >${requestCards(ownBugReports, true)}`
  );
}
function requestCards(items, bugs) {
  return (
    items
      .map(
        (x) =>
          /* HTML */ `<article class="card request-card">
            <h3>${escapeHtml(x.title)}</h3>
            <small>${escapeHtml(x.author_name || me().name)} · ${displayTime(x.created_at)}</small>
            <p>${escapeHtml(x.text)}</p>
            ${x.hasFile ? /* HTML */ `<button class="btn outline wide" data-action="request-file" data-id="${escapeHtml(x.id)}">${icon('download')} ${escapeHtml(x.filename)}</button>` : ''}${
              x.reply
                ? /* HTML */ `<div class="request-reply">
                    <strong>Ответ старосты</strong>
                    <p>${escapeHtml(x.reply)}</p>
                    <small>${displayTime(x.replied_at)}</small>
                  </div>`
                : !bugs && role === 'head'
                  ? /* HTML */ `<button
                      class="btn primary wide"
                      data-action="reply-request"
                      data-id="${escapeHtml(x.id)}"
                    >
                      Ответить
                    </button>`
                  : '<p class="hint">' +
                    (bugs ? 'Сохранено для разработчика' : 'Ожидает ответа') +
                    '</p>'
            }
          </article>`,
      )
      .join('') || empty('Обращений пока нет', 'Новые обращения будут отображаться здесь.')
  );
}
function requestForm(kind) {
  dialog(
    kind === 'bug' ? 'Сообщить об ошибке' : 'Написать старосте',
    /* HTML */ `<p class="hint">
        ${kind === 'bug' ? 'Опиши, что произошло и что ожидалось. На сервере сохранятся твоё имя, Telegram ID и время обращения.' : 'Укажи тему и вопрос. Обращение увидит только староста и ты.'}
      </p>
      ${field('Тема', 'title', '', 'text', 'required maxlength="160"')}<label for="request-text"
        >Описание</label
      ><textarea id="request-text" name="text" required maxlength="2000"></textarea
      >${field(kind === 'bug' ? 'Скриншот или файл до 2 МБ' : 'Вложение до 2 МБ', 'file', '', 'file')}`,
    async (p, form) => {
      if (demo) throw new Error('Обращения доступны в Telegram');
      const file = await readUpload(form.querySelector('[type=file]').files[0]);
      await api('/api/requests', {
        kind,
        title: p.title,
        text: p.text,
        file,
        ...(kind === 'head' ? { groupId: state.group.id } : {}),
      });
      if (kind === 'head') {
        state = await api('/api/state?groupId=' + encodeURIComponent(state.group.id));
        navigate('requests');
      } else {
        ownBugReports = await api('/api/requests');
        navigate('bugReports');
      }
    },
  );
  modal.querySelector('[type=submit]').textContent = 'Отправить';
}
function whatsNew() {
  whatsNewShown = true;
  dialog(
    'Что нового · ' + VERSION,
    /* HTML */ `<p class="hint">Обновление МИСИС · Староста</p>
      <ul class="release-list">
        ${RELEASE_NOTES.map((x) => /* HTML */ `<li>${escapeHtml(x)}</li>`).join('')}
      </ul>`,
    () => savePreferences({ seenVersion: VERSION }),
  );
  modal.querySelector('[type=submit]').textContent = 'Понятно';
}
function maybeWhatsNew() {
  if (state.profile?.complete && !modal.open && !whatsNewShown && prefs().seenVersion !== VERSION)
    whatsNew();
}

// Delegated UI commands: demo changes stay local; live writes go through the server.
const actions = {
  'notification-settings': () => {
    const p = prefs();
    dialog(
      'Уведомления',
      /* HTML */ `<p class="hint">Настройки действуют во всех твоих группах.</p>
        ${checkField('Опросы перед парами', 'polls', p.polls)}${checkField('Объявления группы', 'announcements', p.announcements)}${checkField('Личные предупреждения о пропусках', 'absence', p.absence)}${checkField('Обращения, ответы и причины пропусков', 'messages', p.messages)}
        <hr />
        ${checkField('Включить тихие часы', 'quietEnabled', p.quietEnabled)}
        <div class="field-row">
          ${field('С (Москва)', 'quietStart', p.quietStart, 'time', 'required')}${field('До (Москва)', 'quietEnd', p.quietEnd, 'time', 'required')}
        </div>
        <p class="hint">
          Во время тихих часов уведомления ждут окончания периода. Опросы по уже завершившимся парам
          не отправляются.
        </p>`,
      (fields) =>
        savePreferences({
          ...Object.fromEntries(
            ['polls', 'announcements', 'absence', 'messages', 'quietEnabled'].map((k) => [
              k,
              fields[k] === 'on',
            ]),
          ),
          quietStart: fields.quietStart,
          quietEnd: fields.quietEnd,
        }),
    );
  },
  'appearance-settings': () =>
    dialog(
      'Оформление',
      select(
        'Тема',
        'theme',
        [
          ['dark', 'Тёмная'],
          ['light', 'Светлая'],
          ['telegram', 'Как в Telegram'],
        ],
        prefs().theme,
      ) + checkField('Крупный текст и кнопки', 'largeText', prefs().largeText),
      (p) => savePreferences({ theme: p.theme, largeText: p.largeText === 'on' }),
    ),
  'whats-new': whatsNew,
  'report-bug': () => requestForm('bug'),
  'bug-reports': async () => {
    ownBugReports = demo ? [] : await api('/api/requests');
    navigate('bugReports');
  },
  'new-request': () => requestForm('head'),
  'request-file': async (b) => {
    const x = await api('/api/request-file?id=' + encodeURIComponent(b.dataset.id));
    if (!x.data) throw new Error('Файл не найден');
    download(
      Uint8Array.from(atob(x.data.split(',')[1]), (c) => c.charCodeAt(0)),
      x.filename,
      'application/octet-stream',
    );
  },
  'reply-request': (b) =>
    dialog(
      'Ответить студенту',
      '<label for="reply-text">Ответ</label><textarea id="reply-text" name="reply" required maxlength="2000"></textarea>',
      async (p) => {
        await api('/api/requests/reply', { id: b.dataset.id, reply: p.reply });
        state = await api('/api/state?groupId=' + encodeURIComponent(state.group.id));
        render();
      },
    ),
  'announcement-filter': (b) => {
    announcementFilter = b.dataset.filter;
    render();
  },
  'read-announcement': async (b) => {
    let a = state.announcements.find((a) => a.id === b.dataset.id);
    if (announcementState(a) !== 'scheduled') {
      if (demo) {
        a.read = true;
        saveDemo(state);
      } else state = await api('/api/announcements/read', { groupId: state.group.id, id: a.id });
      a = state.announcements.find((x) => x.id === a.id);
      render();
    }
    dialog(
      escapeHtml(a.title),
      /* HTML */ `<p class="announcement-full">${escapeHtml(a.text)}</p>
        <p class="source-note">${displayTime(a.publishAt || a.createdAt)}</p>
        ${a.acknowledged ? '<p class="notice">Ты подтвердил ознакомление.</p>' : ''}`,
      a.requireAck && !a.acknowledged && announcementState(a) === 'active'
        ? async () => {
            if (demo) {
              a.acknowledged = true;
              saveDemo(state);
            } else
              state = await api('/api/announcements/read', {
                groupId: state.group.id,
                id: a.id,
                ack: true,
              });
            render();
          }
        : null,
    );
    if (modal.querySelector('[type=submit]'))
      modal.querySelector('[type=submit]').textContent = 'Ознакомился';
  },
  'ack-list': (b) => {
    const a = state.announcements.find((a) => a.id === b.dataset.id);
    dialog(
      'Ознакомление',
      /* HTML */ `<p class="hint">${escapeHtml(a.title)}</p>
        ${(a.acknowledgements || []).map((m) => /* HTML */ `<div class="ack-row"><span>${escapeHtml(m.name)}</span><small>${m.ackAt ? displayTime(m.ackAt) : 'Пока не подтвердил'}</small></div>`).join('')}`,
      null,
    );
  },
  'edit-card': () => {
    const c = state.group.card || {};
    dialog(
      'Карточка группы',
      /* HTML */ `<label for="card-text">Текст, контакты и ссылки</label
        ><textarea id="card-text" name="text" maxlength="5000">${escapeHtml(c.text || '')}</textarea
        >${field('Одно фото: JPEG, PNG или WebP до 2 МБ', 'photo', '', 'file', 'accept="image/jpeg,image/png,image/webp"')}${c.photo ? checkField('Удалить текущее фото', 'removePhoto', false) : ''}`,
      async (p, form) => {
        const file = form.querySelector('[type=file]').files[0],
          payload = { text: p.text };
        if (file) {
          if (file.size > 2 * 1024 * 1024) throw new Error('Фото должно быть не больше 2 МБ');
          payload.photo = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Не удалось прочитать фото'));
            reader.readAsDataURL(file);
          });
          validatePhoto(payload.photo);
        } else if (p.removePhoto === 'on') payload.photo = null;
        await mutate('groupCard', payload);
      },
    );
  },
  'day-answer': (b) => {
    const enabled = b.dataset.enabled === 'true';
    dialog(
      enabled ? 'Буду на всех парах' : 'Отключить автоотметку?',
      /* HTML */ `<p class="hint">
        ${enabled ? 'На сегодняшние пары твоей подгруппы поставим «На паре», где ещё нет ответа. Уже внесённые отметки сохранятся. Повторные опросы сегодня не придут. Староста увидит, что это автоотметка.' : 'Автоматические отметки будут сняты, а опросы по оставшимся парам возобновятся. Отдельные исправления старосты и твои ответы сохранятся.'}
      </p>`,
      async () => {
        if (demo) throw new Error('Автоотметки доступны в Telegram');
        state = await api('/api/day-answer', { groupId: state.group.id, date: today(), enabled });
        render();
      },
    );
    modal.querySelector('[type=submit]').textContent = enabled
      ? 'Включить на сегодня'
      : 'Отключить';
  },
  'edit-name': () => dialog('Имя и фамилия', nameFields(), (p) => updateIdentity(p)),
  'heat-day': (b) => {
    const d = attendanceDays(state, state.currentMemberId).find((d) => d.date === b.dataset.date);
    if (!d) return;
    dialog(
      formatDate(d.date),
      /* HTML */ `<p class="hint">${d.total ? 'Завершённые пары' : 'Завершённых занятий нет'}</p>
        <div class="day-counts">
          ${Object.entries(d.counts)
            .map(
              ([s, n]) => /* HTML */ `<div><span>${STATUS[s][1]}</span><strong>${n}</strong></div>`,
            )
            .join('')}
        </div>`,
      null,
    );
  },
  'excuse-file': async (b) => {
    const x = demo
      ? state.excuses.find((x) => x.id === b.dataset.id)
      : await api(
          '/api/excuse-file?groupId=' +
            encodeURIComponent(state.group.id) +
            '&id=' +
            encodeURIComponent(b.dataset.id),
        );
    if (!x?.data) throw new Error('Файл не найден');
    download(
      Uint8Array.from(atob(x.data.split(',')[1]), (c) => c.charCodeAt(0)),
      x.filename,
      'application/octet-stream',
    );
  },
  'prefer-group': async (b) => {
    const selected = me().defaultGroupId === b.dataset.id ? null : b.dataset.id;
    if (demo) {
      const next = structuredClone(state);
      next.profile.defaultGroupId = selected;
      saveDemo(next);
    } else {
      await api('/api/groups/prefer', { groupId: selected });
      state = await api(
        '/api/state' + (state.group ? '?groupId=' + encodeURIComponent(state.group.id) : ''),
      );
    }
    groupDialog();
  },
  'remove-group': (b) => {
    if (demo) {
      toast('Удаление групп доступно в Telegram');
      return;
    }
    const g = state.groups.find((g) => g.id === b.dataset.id);
    dialog(
      g.role === 'head' ? 'Удалить группу?' : 'Выйти из группы?',
      /* HTML */ `<p class="notice warning">
          ${g.role === 'head' ? 'Группа, расписание, отметки и материалы будут удалены для всех участников. Отменить это действие нельзя.' : 'Ты потеряешь доступ к группе. Твои прошлые отметки останутся в журнале старосты. Вернуться можно по приглашению.'}
        </p>
        <p class="hint">Для подтверждения введи: <strong>${escapeHtml(g.name)}</strong></p>
        ${field('Название группы', 'confirmation', '', 'text', 'required autocomplete="off"')}`,
      async (p) => {
        state = await api('/api/groups/remove', { groupId: g.id, confirmation: p.confirmation });
        role = state.role || 'student';
        week = state.group ? parity(today(), state.group) : 'odd';
        navigate(role === 'head' ? 'home' : 'poll');
      },
    );
    modal.querySelector('[type=submit]').textContent =
      g.role === 'head' ? 'Удалить навсегда' : 'Выйти';
  },
  close: () => modal.close(),
  reload: () => location.reload(),
  role: (b) => {
    role = b.dataset.role;
    page = role === 'head' ? 'home' : 'poll';
    render();
  },
  today: () => {
    journalDate = today();
    navigate('day');
  },
  day: (b) => {
    journalDate = b.dataset.date;
    navigate('day');
  },
  month: (b) => {
    const d = new Date(month + '-01T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + Number(b.dataset.value));
    month = d.toISOString().slice(0, 7);
    render();
  },
  week: (b) => {
    week = b.dataset.value;
    render();
  },
  period: (b) => {
    period = b.dataset.value;
    render();
  },
  group: () => {
    if (demo) {
      dialog(
        'Твоя группа в Telegram',
        /* HTML */ `<p class="hint">
            Сейчас открыта демонстрация. Настоящие группы будут доступны после подключения нового
            Telegram-бота.
          </p>
          <p class="hint">Создатель группы становится старостой и приглашает студентов по коду.</p>
          <button
            class="btn primary wide"
            type="button"
            style="margin-top:20px"
            data-action="close"
          >
            Понятно
          </button>`,
        null,
      );
      return;
    }
    dialog(
      'Создать группу',
      field(
        'Название группы',
        'name',
        '',
        'text',
        'placeholder="Например, БИВТ-24-1" required maxlength="50"',
      ) + field('Институт', 'institute', '', 'text', 'required maxlength="160"'),
      async (p) => {
        state = await api('/api/groups', p);
        role = state.role;
        page = 'home';
        render();
      },
    );
  },
  join: () =>
    dialog(
      'Вступить в группу',
      field('Код приглашения', 'code', '', 'text', 'required autocomplete="off"'),
      async (p) => {
        state = await api('/api/join', p);
        role = state.role;
        page = 'poll';
        render();
      },
    ),
  invite: () =>
    dialog(
      'Пригласить студентов',
      /* HTML */ `<p class="hint" style="margin-top:10px">
          ${demo ? 'Пример кода. В демо вступление отключено.' : 'Отправь этот код одногруппникам. Они смогут вступить в твою группу через бота.'}
        </p>
        <div
          class="card"
          style="text-align:center;margin-top:15px;font-size:22px;letter-spacing:2px"
        >
          ${escapeHtml(state.group.inviteCode)}
        </div>
        <button
          class="btn primary wide"
          type="button"
          style="margin-top:16px"
          data-action="copy-invite"
        >
          ${icon('link')} Скопировать приглашение
        </button>`,
      null,
    ),
  'copy-invite': async () => {
    const message = demo
      ? 'Демо · МИСИС · Староста'
      : `${state.group.name} · МИСИС\nВступи в нашу группу: ${state.botUsername ? 'https://t.me/' + state.botUsername + '?start=' + state.group.inviteCode : state.group.inviteCode}`;
    try {
      await navigator.clipboard.writeText(message);
      toast('Приглашение скопировано');
    } catch {
      toast('Выдели и скопируй код выше');
    }
  },
  lesson: () => lessonForm(),
  'manual-lesson': () => lessonForm({}, true),
  'lesson-detail': (b) => {
    const l = state.lessons.find((l) => l.id === b.dataset.id);
    if (role === 'head') lessonForm(l);
    else
      dialog(
        escapeHtml(l.subject),
        /* HTML */ `<p class="hint">
          ${l.start} — ${l.end}<br />${escapeHtml(l.room)}<br />${escapeHtml(l.teacher)}
        </p>`,
        null,
      );
  },
  mark: (b) => {
    const m = state.members.find((m) => m.id === b.dataset.member),
      l = state.lessons.find((l) => l.id === b.dataset.lesson);
    dialog(
      escapeHtml(m.name),
      /* HTML */ `<p class="hint" style="margin:5px 0 15px">
          ${escapeHtml(l.subject)} · ${formatDate(journalDate)}
        </p>
        <div style="display:grid;gap:8px">
          ${Object.entries(STATUS)
            .map(
              ([s, [sym, title]]) =>
                /* HTML */ `<button
                  type="button"
                  class="btn ${grade(state, journalDate, l.id, m.id) === s ? 'primary' : ''}"
                  data-action="set-mark"
                  data-member="${m.id}"
                  data-lesson="${l.id}"
                  data-status="${s}"
                >
                  ${sym} ${title}
                </button>`,
            )
            .join('')}
        </div>`,
      null,
    );
  },
  'set-mark': async (b) => {
    if (b.dataset.status === 'excused') {
      excuseForm('mark', {
        date: journalDate,
        memberId: b.dataset.member,
        lessonId: b.dataset.lesson,
      });
      return;
    }
    await mutate('mark', {
      date: journalDate,
      memberId: b.dataset.member,
      lessonId: b.dataset.lesson,
      status: b.dataset.status,
    });
    modal.close();
    toast('Отметка сохранена');
  },
  'self-mark': async (b) => {
    if (b.dataset.status === 'excused') {
      excuseForm('selfMark', { date: today(), lessonId: b.dataset.lesson });
      return;
    }
    await mutate('selfMark', {
      date: today(),
      lessonId: b.dataset.lesson,
      status: b.dataset.status,
    });
    toast(demo ? 'Ответ сохранён в демо' : 'Староста увидит твой ответ');
  },
  export: () => {
    download(
      makeXlsx(reportRows(state, period)),
      `МИСИС-${state.group.name}-${period}-${today()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    toast('Отчёт готов');
  },
  'send-report': async () => {
    if (demo) {
      toast('Отправка в чат будет доступна после подключения бота');
      return;
    }
    await api('/api/report', { groupId: state.group.id, period });
    toast('Отчёт отправлен в личный чат');
  },
  announcement: () =>
    dialog(
      'Новое объявление',
      field('Заголовок', 'title', '', 'text', 'required maxlength="160"') +
        '<label for="f-text">Сообщение</label><textarea id="f-text" name="text" required maxlength="3000"></textarea>' +
        select(
          'Закрепление',
          'pinned',
          [
            ['false', 'Обычное'],
            ['true', 'Закрепить'],
          ],
          'false',
        ) +
        checkField('Нужно подтверждение «Ознакомился»', 'requireAck', false) +
        field('Опубликовать (Москва), пусто — сейчас', 'publishAt', '', 'datetime-local') +
        field('Убрать в архив (Москва), необязательно', 'expiresAt', '', 'datetime-local'),
      async (p) => {
        await mutate('announcement', {
          ...p,
          pinned: p.pinned === 'true',
          requireAck: p.requireAck === 'on',
          publishAt: p.publishAt ? p.publishAt + ':00+03:00' : null,
          expiresAt: p.expiresAt ? p.expiresAt + ':00+03:00' : null,
        });
        announcementFilter = p.publishAt ? 'scheduled' : 'active';
        render();
      },
    ),
  pin: async (b) => {
    await mutate('pin', { id: b.dataset.id });
  },
  material: () =>
    dialog(
      'Добавить материал',
      field('Название', 'title', '', 'text', 'required maxlength="160"') +
        field('Предмет', 'subject', '', 'text', 'required maxlength="160"') +
        field('Ссылка на материал', 'url', '', 'url', 'placeholder="https://…"') +
        '<p class="source-note">Или выбери файл до 2 МБ</p>' +
        field('Файл', 'file', '', 'file'),
      async (p, form) => {
        const file = form.querySelector('[type=file]').files[0];
        if (!p.url && !file) throw new Error('Добавь ссылку или файл');
        const payload = { title: p.title, subject: p.subject, url: p.url };
        if (!p.url && file) {
          if (file.size > 2 * 1024 * 1024) throw new Error('Файл должен быть меньше 2 МБ');
          const bytes = new Uint8Array(await file.arrayBuffer());
          let str = '';
          for (let i = 0; i < bytes.length; i += 8192)
            str += String.fromCharCode(...bytes.subarray(i, i + 8192));
          payload.data = 'data:application/octet-stream;base64,' + btoa(str);
          payload.filename = file.name;
        }
        await mutate('material', payload);
      },
    ),
  'open-material': async (b) => {
    const m = state.materials.find((m) => m.id === b.dataset.id);
    if (m.url) {
      try {
        const u = new URL(m.url);
        if (u.protocol !== 'https:') throw new Error();
        if (tg?.initData) tg.openLink(u.href);
        else window.open(u.href, '_blank', 'noopener');
      } catch {
        toast('Некорректная ссылка');
      }
      return;
    }
    let data = m.data;
    if (!data) {
      const r = await api(
        '/api/material?groupId=' +
          encodeURIComponent(state.group.id) +
          '&id=' +
          encodeURIComponent(m.id),
      );
      data = r.data;
    }
    const bytes = Uint8Array.from(atob(data.split(',')[1]), (c) => c.charCodeAt(0));
    download(bytes, m.filename, 'application/octet-stream');
  },
  'edit-group': () =>
    dialog(
      'Настройки группы',
      field('Название группы', 'name', state.group.name, 'text', 'required maxlength="50"') +
        field('Институт', 'institute', state.group.institute, 'text', 'required') +
        /* HTML */ `<div class="field-row">
          ${field('Начало семестра', 'semesterStart', state.group.semesterStart, 'date', 'required')}${field('Конец семестра', 'semesterEnd', state.group.semesterEnd, 'date', 'required')}
        </div>` +
        select(
          'Первая неделя семестра',
          'firstWeek',
          [
            ['odd', 'Числитель'],
            ['even', 'Знаменатель'],
          ],
          state.group.firstWeek,
        ),
      (p) => mutate('settings', p),
    ),
  'poll-settings': () =>
    dialog(
      'Опросы перед парой',
      '<p class="hint" style="margin-top:8px">Бот отправляет личное сообщение с кнопками ответа. Студенту нужно сначала нажать /start.</p>' +
        field(
          'За сколько минут до начала',
          'pollMinutes',
          state.group.pollMinutes,
          'number',
          'min="0" max="60" required',
        ),
      (p) => mutate('settings', p),
    ),
  threshold: () =>
    dialog(
      'Порог внимания',
      '<p class="hint">Когда студент пропустит столько занятий по одному предмету без уважительной причины, он попадёт в список внимания.</p>' +
        field(
          'Количество пропусков',
          'threshold',
          state.group.threshold,
          'number',
          'min="1" max="30" required',
        ),
      (p) => mutate('settings', p),
    ),
  floating: () =>
    dialog(
      'Плавающее расписание',
      /* HTML */ `<p class="hint">
        ${state.group.floating ? 'Включить регулярные пары по дням недели?' : 'В плавающем режиме в журнал попадают только пары с конкретной датой. Регулярные пары временно не используются.'}
      </p>`,
      () => mutate('settings', { floating: !state.group.floating }),
    ),
  timezone: () => toast('Часовой пояс: Москва, UTC+3'),
  break: () =>
    dialog(
      'Каникулы или сессия',
      '<p class="hint">В этот период обычные пары не попадают в журнал.</p>' +
        field('Название', 'name', '', 'text', 'required') +
        field('Начало', 'start', today(), 'date', 'required') +
        field('Конец', 'end', today(), 'date', 'required'),
      (p) => mutate('break', p),
    ),
  sync: syncDialog,
  'refresh-misis': async (b) => {
    b.disabled = true;
    b.textContent = 'Обновляем…';
    try {
      misisCatalog = await api('/api/misis/refresh', { groupId: state.group.id });
      modal.close();
      await syncDialog();
    } finally {
      b.disabled = false;
      b.textContent = 'Обновить с сайта МИСИС';
    }
  },
  subgroup: () =>
    dialog(
      'Моя подгруппа',
      select(
        'Подгруппа',
        'subgroup',
        (state.group.subgroups || []).map((s) => [s, 'Подгруппа ' + s]),
        state.members.find((m) => m.id === state.currentMemberId)?.subgroup,
      ),
      (p) => mutate('profile', p),
    ),
  groups: groupDialog,
  'new-group': () => {
    modal.close();
    actions.group();
  },
  'new-join': () => {
    modal.close();
    actions.join();
  },
  'switch-group': async (b) => {
    if (!demo) {
      state = await api('/api/state?groupId=' + encodeURIComponent(b.dataset.id));
      role = state.role;
    }
    modal.close();
    week = state.group ? parity(today(), state.group) : 'odd';
    navigate(role === 'head' ? 'home' : 'poll');
  },
  help: () =>
    dialog(
      'Как пользоваться',
      /* HTML */ `<p class="hint">
        1. Создай группу и подключи расписание.<br /><br />2. Пригласи студентов по коду — каждый
        открывает бота и нажимает /start.<br /><br />3. Перед парой бот спрашивает о посещении.
        Студенты отвечают, староста видит сводку.<br /><br />4. Исправляй отметки в журнале и
        выгружай Excel за нужный период.<br /><br />5. Делись объявлениями и материалами со всей
        группой.
      </p>`,
      null,
    ),
  reset: () =>
    dialog(
      'Сбросить демонстрацию?',
      '<p class="hint">Твои изменения демо будут удалены, учебные данные восстановятся.</p>',
      () => {
        saveDemo(seed());
        navigate('home');
      },
    ),
};
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-action],[data-page]');
  if (!b) return;
  ev.preventDefault();
  if (b.disabled) return;
  try {
    if (b.dataset.page) {
      navigate(b.dataset.page);
      return;
    }
    await actions[b.dataset.action]?.(b);
  } catch (err) {
    toast(
      err.name === 'QuotaExceededError'
        ? 'Недостаточно места для демо. Добавь ссылку вместо файла.'
        : err.message || 'Не удалось выполнить действие',
    );
  }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'student-search') {
    const pos = ev.target.selectionStart;
    search = ev.target.value;
    render();
    const next = document.querySelector('#student-search');
    next.focus();
    next.setSelectionRange(pos, pos);
  }
});
modal.addEventListener('click', (ev) => {
  if (ev.target === modal) {
    const r = modal.getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom)
      modal.close();
  }
});
init();

document.addEventListener('change', (ev) => {
  if (ev.target.id === 'student-sort') {
    studentSort = ev.target.value;
    render();
  }
  if (ev.target.name === 'sourceId' && misisCatalog) {
    const source = misisCatalog.sources.find((s) => s.id === ev.target.value);
    modal.querySelector('[name=academicGroup]').innerHTML = source.groups
      .map(
        (g) =>
          /* HTML */ `<option value="${escapeHtml(g.name)}">
            ${escapeHtml(g.name)} · ${escapeHtml(g.sheet)}
          </option>`,
      )
      .join('');
  }
});

async function refreshVisibleState() {
  if (
    demo ||
    !state?.profile?.complete ||
    !state.group ||
    busy ||
    modal.open ||
    document.hidden ||
    document.activeElement?.matches('input,textarea,select')
  )
    return;
  const groupId = state.group.id;
  try {
    const next = await api('/api/state?groupId=' + encodeURIComponent(groupId));
    if (state.group?.id === groupId && !modal.open && !busy) {
      state = next;
      role = state.role;
      render();
    }
  } catch {}
}
setInterval(refreshVisibleState, 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshVisibleState();
});
