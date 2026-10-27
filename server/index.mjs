import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { catalog, refresh, importSchedule } from './misis.mjs';
import { validateInitData } from './auth.mjs';
import { startBot, sendDocument } from './telegram.mjs';
import { makeXlsx } from '../public/xlsx.js';
import { reportRows, today } from '../public/model.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
export function createServer({ store, token = '', appUrl = '', getBotUsername = () => '' }) {
  const buckets = new Map();
  const cleanup = setInterval(() => {
    for (const [key, b] of buckets) if (b.until < Date.now()) buckets.delete(key);
  }, 60000);
  cleanup.unref();
  function json(res, status, data) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
  }
  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 3 * 1024 * 1024)
        throw Object.assign(new Error('Запрос слишком большой'), { status: 413 });
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw Object.assign(new Error('Некорректный запрос'), { status: 400 });
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') {
        json(res, 200, { ok: true, botConfigured: !!token, version: '0.3.0' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/misis-data.json') {
        json(res, 200, await catalog());
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && appUrl && origin !== new URL(appUrl).origin)
          throw Object.assign(new Error('Недопустимый источник запроса'), { status: 403 });
        let user;
        try {
          user = validateInitData(req.headers.authorization?.replace(/^tma /, ''), token);
        } catch (err) {
          err.status = 401;
          throw err;
        }
        const now = Date.now(),
          b = buckets.get(user.id) || { n: 0, until: now + 60000 };
        if (b.until < now) {
          b.n = 0;
          b.until = now + 60000;
        }
        b.n++;
        buckets.set(user.id, b);
        if (b.n > 180)
          throw Object.assign(new Error('Слишком много запросов. Подожди минуту.'), {
            status: 429,
          });
        const p = req.method === 'POST' ? await body(req) : {};
        const snapshot = (id) => ({ ...store.snapshot(id, user), botUsername: getBotUsername() });
        const current = () => {
          const id = store.list(user)[0]?.id;
          return id
            ? snapshot(id)
            : {
                group: null,
                groups: [],
                profile: store.profile(user),
                botUsername: getBotUsername(),
              };
        };
        if (req.method === 'POST' && url.pathname === '/api/profile') {
          store.saveProfile(user, p);
          json(res, 200, p.groupId ? snapshot(p.groupId) : current());
          return;
        }
        if (req.method === 'POST' && !store.profile(user).complete)
          throw new Error('Сначала укажи настоящие имя и фамилию');
        if (req.method === 'POST' && url.pathname === '/api/preferences') {
          store.setPreferences(user, p);
          json(res, 200, { preferences: store.preferences(user) });
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/announcements/read') {
          store.announcementRead(p.groupId, user, p.id, !!p.ack);
          json(res, 200, snapshot(p.groupId));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/day-answer') {
          store.answerDay(p.groupId, user, p);
          json(res, 200, snapshot(p.groupId));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/requests') {
          json(res, 201, store.createRequest(user, p));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/requests') {
          json(res, 200, store.requestsFor(user, url.searchParams.get('groupId')));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/requests/reply') {
          store.replyRequest(user, p.id, p.reply);
          json(res, 200, { ok: true });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/request-file') {
          json(res, 200, store.requestFile(user, url.searchParams.get('id')));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/groups/prefer') {
          store.prefer(user, p.groupId);
          json(res, 200, current());
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/groups/remove') {
          store.removeGroup(user, p.groupId, p.confirmation);
          json(res, 200, current());
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/excuse-file') {
          json(
            res,
            200,
            store.excuseFile(url.searchParams.get('groupId'), user, url.searchParams.get('id')),
          );
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/misis/refresh') {
          const s = store.read(p.groupId, user);
          if (s.role !== 'head')
            throw Object.assign(new Error('Обновление доступно старосте'), { status: 403 });
          json(res, 200, await refresh());
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/misis/import') {
          const data = await catalog();
          const source = data.sources.find((s) => s.id === p.sourceId),
            academic = source?.groups.find((g) => g.name === p.academicGroup);
          if (!academic) throw new Error('Группа не найдена в каталоге');
          importSchedule(store, user, p.groupId, p, source, academic);
          json(res, 200, snapshot(p.groupId));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/state') {
          const groups = store.list(user);
          const id = url.searchParams.get('groupId') || groups[0]?.id;
          json(
            res,
            200,
            id
              ? snapshot(id)
              : {
                  group: null,
                  groups,
                  profile: store.profile(user),
                  botUsername: getBotUsername(),
                },
          );
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/groups') {
          json(res, 201, snapshot(store.create(user, p)));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/join') {
          json(res, 200, snapshot(store.join(user, p.code)));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/action') {
          store.action(p.groupId, user, p.type, p.payload);
          json(res, 200, snapshot(p.groupId));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/material') {
          const s = store.read(url.searchParams.get('groupId'), user);
          const m = s.materials.find((m) => m.id === url.searchParams.get('id'));
          if (!m) throw Object.assign(new Error('Материал не найден'), { status: 404 });
          json(res, 200, { data: m.data });
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/report') {
          const s = store.read(p.groupId, user);
          if (s.role !== 'head')
            throw Object.assign(new Error('Отчёт доступен только старосте'), { status: 403 });
          if (!['week', 'month', 'semester'].includes(p.period))
            throw new Error('Неизвестный период');
          const chat = store.db.prepare('SELECT chat_id FROM chats WHERE user_id=?').get(user.id);
          if (!chat) throw new Error('Сначала нажми /start в боте');
          await sendDocument(
            token,
            chat.chat_id,
            makeXlsx(reportRows(s, p.period)),
            `misis-${today()}.xlsx`,
          );
          json(res, 200, { ok: true });
          return;
        }
        json(res, 404, { error: 'Неизвестный запрос' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: 'Метод не поддерживается' });
        return;
      }
      const path = resolve(
        root,
        '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
      );
      if (!path.startsWith(root + '/')) {
        json(res, 403, { error: 'Нет доступа' });
        return;
      }
      let content;
      try {
        if (!(await stat(path)).isFile()) throw new Error();
        content = await readFile(path);
      } catch {
        json(res, 404, { error: 'Страница не найдена' });
        return;
      }
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, {
        'Content-Type': types[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (err) {
      const status = err.status || 400;
      json(res, status, { error: status >= 500 ? 'Ошибка сервера' : err.message });
    }
  });
  server.on('close', () => clearInterval(cleanup));
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = process.env.BOT_TOKEN || '',
    appUrl = process.env.APP_URL || '',
    enabled = process.env.BOT_ENABLED === 'true';
  if (enabled && (!token || !/^https:\/\//.test(appUrl)))
    throw new Error('Для запуска бота нужны BOT_TOKEN и публичный HTTPS APP_URL');
  const store = new Store(process.env.DATABASE_PATH || './data/misis.sqlite');
  let botUsername = '';
  const server = createServer({ store, token, appUrl, getBotUsername: () => botUsername });
  server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () =>
    console.log(
      `Приложение: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`,
    ),
  );
  const stop = enabled
    ? startBot(store, { token, appUrl, onUsername: (name) => (botUsername = name) })
    : () => {};
  function shutdown() {
    stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
