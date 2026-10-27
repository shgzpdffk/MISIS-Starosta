import { deliveryDecision } from './delivery.mjs';
import { scheduleAnnouncements, scheduleAbsenceWarnings } from './features.mjs';
import { lessonsOn, today, appliesTo } from '../public/model.js';
export async function telegram(token, method, payload) {
  if (!token) throw new Error('Бот ещё не подключён');
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 15000),
    });
  } catch {
    throw new Error('Telegram временно недоступен');
  }
  const r = await response.json();
  if (!r.ok)
    throw Object.assign(new Error('Telegram не принял запрос'), {
      telegramCode: r.error_code,
      retryAfter: r.parameters?.retry_after,
    });
  return r.result;
}
export async function sendDocument(
  token,
  chatId,
  bytes,
  name,
  mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
) {
  const form = new FormData();
  form.set('chat_id', chatId);
  form.set('document', new Blob([bytes], { type: mime }), name);
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('Не удалось связаться с Telegram');
  }
  const r = await response.json();
  if (!r.ok) throw new Error('Не удалось отправить файл. Нажми /start в боте и попробуй снова.');
  return r.result;
}
export function schedulePolls(store, now = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
    }).format(now),
    minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  for (const row of store.db.prepare('SELECT data FROM groups').all()) {
    const s = JSON.parse(row.data);
    for (const l of lessonsOn(s, date)) {
      const delta = minutes(l.start) - minutes(clock);
      if (delta > s.group.pollMinutes || delta < 0) continue;
      for (const m of s.members) {
        if (
          m.role === 'head' ||
          !m.active ||
          !appliesTo(l, m) ||
          store.answeredDay(s.group.id, m.id, date)
        )
          continue;
        const key = `poll:${s.group.id}:${date}:${l.id}:${m.id}`;
        // Short opaque IDs keep Telegram callback_data below 64 bytes.
        store.enqueue(key, m.id, {
          category: 'polls',
          text: `${s.group.name} · ${l.subject}\n${l.start} — ${l.end} · ${l.room}\n\nТы будешь на паре?`,
          poll: { groupId: s.group.id, date, lessonId: l.id },
        });
      }
    }
  }
}
export function excuseUrl(appUrl, p) {
  const u = new URL(appUrl);
  u.searchParams.set('group', p.groupId);
  u.searchParams.set('excuse', p.lessonId);
  u.searchParams.set('date', p.date);
  return u.href;
}
export function startBot(store, { token, appUrl, onUsername }) {
  let stopped = false,
    lastRiskScan = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const webButton = {
    inline_keyboard: [[{ text: 'Открыть МИСИС · Староста', web_app: { url: appUrl } }]],
  };
  const send = (id, text, reply_markup = webButton) =>
    telegram(token, 'sendMessage', { chat_id: id, text, reply_markup });
  async function handle(update) {
    const msg = update.message;
    if (msg?.chat?.type === 'private' && msg.from) {
      const user = {
        id: String(msg.from.id),
        name: [msg.from.last_name, msg.from.first_name].filter(Boolean).join(' '),
      };
      store.db
        .prepare('INSERT OR REPLACE INTO chats VALUES(?,?)')
        .run(user.id, String(msg.chat.id));
      if (msg.text?.startsWith('/start')) {
        const code = msg.text.split(/\s+/)[1];
        if (code) {
          try {
            const gid = store.join(user, code);
            const s = store.read(gid, user);
            await send(
              msg.chat.id,
              `Ты в группе ${s.group.name}. Открой приложение, чтобы посмотреть расписание.`,
            );
          } catch (err) {
            await send(msg.chat.id, err.message);
          }
        } else
          await send(
            msg.chat.id,
            'Привет! Здесь можно создать свою группу МИСИС, отмечать посещаемость и делиться материалами. Открой приложение, чтобы начать.',
          );
      } else if (msg.text === '/help')
        await send(
          msg.chat.id,
          'Создай группу в мини-приложении и пригласи студентов по коду. Перед парами я присылаю опрос, а староста ведёт журнал и выгружает отчёты.',
        );
    }
    const q = update.callback_query;
    if (q) {
      let answer;
      try {
        const match = /^a:(\d+):(present|late|absent|excused|all)$/.exec(q.data || '');
        if (!match) throw new Error('Неизвестная кнопка');
        const row = store.db
          .prepare('SELECT * FROM outbox WHERE id=? AND user_id=?')
          .get(Number(match[1]), String(q.from.id));
        if (!row) throw new Error('Этот опрос предназначен другому студенту');
        const p = JSON.parse(row.payload).poll;
        if (!p) throw new Error('Опрос не найден');
        if (match[2] === 'all') {
          store.answerDay(p.groupId, { id: String(q.from.id) }, { date: p.date, enabled: true });
          answer = 'Посещение за сегодня отмечено. Повторных опросов не будет.';
        } else if (match[2] === 'excused') {
          await send(q.from.id, 'Укажи причину или приложи файл в мини-приложении.', {
            inline_keyboard: [
              [{ text: 'Объяснить пропуск', web_app: { url: excuseUrl(appUrl, p) } }],
            ],
          });
          throw new Error('Открой кнопку «Объяснить пропуск» в чате с ботом');
        } else {
          store.action(p.groupId, { id: String(q.from.id) }, 'selfMark', {
            date: p.date,
            lessonId: p.lessonId,
            status: match[2],
          });
          answer = 'Ответ сохранён. Староста его увидит.';
        }
      } catch (err) {
        answer = err.message;
      }
      await telegram(token, 'answerCallbackQuery', {
        callback_query_id: q.id,
        text: answer,
        show_alert: true,
      });
    }
  }
  async function updates() {
    while (!stopped) {
      try {
        const offset = Number(
          store.db.prepare("SELECT value FROM metadata WHERE key='telegram_offset'").get()?.value ||
            0,
        );
        const updates = await telegram(token, 'getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        });
        for (const u of updates) {
          await handle(u);
          store.db
            .prepare("INSERT OR REPLACE INTO metadata VALUES('telegram_offset',?)")
            .run(String(u.update_id + 1));
        }
      } catch {
        console.error('Не удалось обработать обновление Telegram; повтор через 5 секунд.');
        await sleep(5000);
      }
    }
  }
  async function queue() {
    while (!stopped) {
      try {
        schedulePolls(store);
        scheduleAnnouncements(store);
        if (Date.now() - lastRiskScan > 3600000) {
          scheduleAbsenceWarnings(store);
          lastRiskScan = Date.now();
        }
        const rows = store.db
          .prepare(
            "SELECT o.*,c.chat_id FROM outbox o JOIN chats c ON c.user_id=o.user_id WHERE o.status IN ('pending','deferred') AND o.next_at<=? ORDER BY o.id LIMIT 20",
          )
          .all(Date.now());
        for (const row of rows) {
          const decision = deliveryDecision(store, row);
          if (decision.status === 'deferred') {
            store.db
              .prepare("UPDATE outbox SET status='deferred',next_at=? WHERE id=?")
              .run(decision.until, row.id);
            continue;
          }
          if (decision.status !== 'ready') {
            store.db.prepare('UPDATE outbox SET status=? WHERE id=?').run(decision.status, row.id);
            continue;
          }
          const p = JSON.parse(row.payload);
          let buttons = p.groupId
            ? {
                inline_keyboard: [
                  [
                    {
                      text: 'Открыть группу',
                      web_app: { url: appUrl + '/?group=' + encodeURIComponent(p.groupId) },
                    },
                  ],
                ],
              }
            : webButton;
          if (p.poll) {
            const s = store.db.prepare('SELECT data FROM groups WHERE id=?').get(p.poll.groupId);
            const l =
              s && lessonsOn(JSON.parse(s.data), p.poll.date).find((l) => l.id === p.poll.lessonId);
            const clock = new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Europe/Moscow',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date());
            if (p.poll.date !== today() || !l || clock > l.end) {
              store.db.prepare("UPDATE outbox SET status='expired' WHERE id=?").run(row.id);
              continue;
            }
            buttons = {
              inline_keyboard: [
                [
                  { text: '✓ На паре', callback_data: `a:${row.id}:present` },
                  { text: 'Опаздываю', callback_data: `a:${row.id}:late` },
                ],
                [
                  { text: 'Не приду', callback_data: `a:${row.id}:absent` },
                  { text: 'Уважительная', web_app: { url: excuseUrl(appUrl, p.poll) } },
                ],
                [{ text: 'Буду на всех парах', callback_data: `a:${row.id}:all` }],
              ],
            };
          }
          try {
            if (
              p.excuseId &&
              !store.db.prepare('SELECT 1 FROM excuses WHERE id=?').get(p.excuseId)
            ) {
              store.db.prepare("UPDATE outbox SET status='expired' WHERE id=?").run(row.id);
              continue;
            }
            if (p.document) {
              const file = p.requestId
                ? store.db.prepare('SELECT data,filename FROM requests WHERE id=?').get(p.requestId)
                : store.db.prepare('SELECT data,filename FROM excuses WHERE id=?').get(p.excuseId);
              await sendDocument(
                token,
                row.chat_id,
                Buffer.from(file.data.split(',')[1], 'base64'),
                file.filename,
                'application/octet-stream',
              );
            } else await send(row.chat_id, p.text, buttons);
            store.db.prepare("UPDATE outbox SET status='sent' WHERE id=?").run(row.id);
          } catch (err) {
            const terminal = err.telegramCode === 403 || row.attempts >= 5;
            store.db
              .prepare('UPDATE outbox SET status=?,attempts=attempts+1,next_at=? WHERE id=?')
              .run(
                terminal ? 'failed' : 'pending',
                Date.now() +
                  Math.max(err.retryAfter || 0, Math.min(3600, 30 * 2 ** row.attempts)) * 1000,
                row.id,
              );
          }
          await sleep(100);
        }
      } catch {
        console.error('Очередь уведомлений: временная ошибка.');
      }
      await sleep(15000);
    }
  }
  async function run() {
    try {
      const me = await telegram(token, 'getMe', {});
      onUsername(me.username);
      await telegram(token, 'setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Моя группа', web_app: { url: appUrl } },
      });
      console.log('Бот подключён.');
      updates();
      queue();
    } catch {
      console.error('Не удалось подключить бота. Проверь BOT_TOKEN и APP_URL.');
    }
  }
  run();
  return () => {
    stopped = true;
  };
}
