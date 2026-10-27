import { createHmac, timingSafeEqual } from 'node:crypto';
/** Validate signed Telegram initData; browser-supplied identity is never trusted on its own. */
export function validateInitData(raw, token, now = Math.floor(Date.now() / 1000)) {
  if (!token) throw new Error('Бот ещё не подключён');
  if (typeof raw !== 'string' || !raw || raw.length > 16000)
    throw new Error('Открой приложение через Telegram');
  const p = new URLSearchParams(raw),
    seen = new Set();
  for (const [k] of p) {
    if (seen.has(k)) throw new Error('Некорректная авторизация');
    seen.add(k);
  }
  const hash = p.get('hash');
  if (!/^[a-f0-9]{64}$/i.test(hash || '')) throw new Error('Некорректная подпись Telegram');
  p.delete('hash');
  const check = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex')))
    throw new Error('Некорректная подпись Telegram');
  const authDate = Number(p.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate > now + 30 || now - authDate > 3600)
    throw new Error('Сессия истекла. Открой мини-приложение заново');
  let user;
  try {
    user = JSON.parse(p.get('user'));
  } catch {
    throw new Error('Не удалось прочитать пользователя');
  }
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new Error('Некорректный пользователь');
  let photoUrl = '';
  try {
    const u = new URL(user.photo_url);
    if (u.protocol === 'https:' && !u.username && !u.password) photoUrl = u.href;
  } catch {}
  return {
    photoUrl,
    username: typeof user.username === 'string' ? user.username : '',
    id: String(user.id),
    name: [user.last_name, user.first_name].filter(Boolean).join(' ').slice(0, 160) || 'Студент',
  };
}
