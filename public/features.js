import { dateAdd } from './model.js';
export const VERSION = '0.3.0';
export const RELEASE_NOTES = [
  'Уведомления по категориям, тихие часы и личные напоминания о пропусках.',
  'Тёмная и светлая темы, выбор темы Telegram и крупный текст.',
  'Объявления по расписанию, архив, непрочитанные и кнопка «Ознакомился».',
  'Обращения к старосте, сообщения об ошибках и карточка группы с одним фото.',
  'Ответ «Буду на всех парах» ставит автоотметки за день и отключает повторные опросы.',
];
export const DEFAULT_PREFS = {
  theme: 'dark',
  largeText: false,
  polls: true,
  announcements: true,
  absence: true,
  messages: true,
  quietEnabled: false,
  quietStart: '23:00',
  quietEnd: '08:00',
  seenVersion: '',
};
export function validatePreferences(p, previous = DEFAULT_PREFS) {
  const next = { ...DEFAULT_PREFS, ...previous };
  for (const k of ['largeText', 'polls', 'announcements', 'absence', 'messages', 'quietEnabled'])
    if (p[k] !== undefined) {
      if (typeof p[k] !== 'boolean') throw new Error('Некорректная настройка');
      next[k] = p[k];
    }
  if (p.theme !== undefined) {
    if (!['dark', 'light', 'telegram'].includes(p.theme)) throw new Error('Неизвестная тема');
    next.theme = p.theme;
  }
  for (const k of ['quietStart', 'quietEnd'])
    if (p[k] !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p[k])) throw new Error('Укажи время тихих часов');
      next[k] = p[k];
    }
  if (next.quietEnabled && next.quietStart === next.quietEnd)
    throw new Error('Начало и конец тихих часов должны отличаться');
  if (p.seenVersion !== undefined) {
    if (p.seenVersion !== VERSION) throw new Error('Неизвестная версия');
    next.seenVersion = VERSION;
  }
  return next;
}
export function moscowDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function moscowTime(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}
export function quietUntil(p, now = new Date()) {
  if (!p.quietEnabled) return null;
  const t = moscowTime(now),
    start = p.quietStart,
    end = p.quietEnd;
  const quiet = start < end ? t >= start && t < end : t >= start || t < end;
  if (!quiet) return null;
  const date = start > end && t >= start ? dateAdd(moscowDate(now), 1) : moscowDate(now);
  return new Date(date + 'T' + end + ':00+03:00').getTime();
}
export function announcementState(a, now = new Date()) {
  const t = now.getTime();
  if (a.expiresAt && Date.parse(a.expiresAt) <= t) return 'archived';
  return a.publishAt && Date.parse(a.publishAt) > t ? 'scheduled' : 'active';
}
export function announcementTiming(p, now = new Date()) {
  let publishAt = now.toISOString(),
    expiresAt = null;
  if (p.publishAt) {
    if (
      typeof p.publishAt !== 'string' ||
      !/(Z|[+-]\d\d:\d\d)$/.test(p.publishAt) ||
      !Number.isFinite(Date.parse(p.publishAt))
    )
      throw new Error('Укажи время публикации');
    publishAt = new Date(p.publishAt).toISOString();
    if (Date.parse(publishAt) < now.getTime() - 60000)
      throw new Error('Публикация не может быть в прошлом');
    if (Date.parse(publishAt) > now.getTime() + 366 * 86400000)
      throw new Error('Планировать можно не больше чем на год');
  }
  if (p.expiresAt) {
    if (
      typeof p.expiresAt !== 'string' ||
      !/(Z|[+-]\d\d:\d\d)$/.test(p.expiresAt) ||
      !Number.isFinite(Date.parse(p.expiresAt))
    )
      throw new Error('Укажи срок действия');
    expiresAt = new Date(p.expiresAt).toISOString();
    if (expiresAt <= publishAt) throw new Error('Срок действия должен быть позже публикации');
  }
  return { publishAt, expiresAt };
}
export function validatePhoto(photo) {
  if (photo === null) return null;
  if (typeof photo !== 'string' || photo.length > 2800000)
    throw new Error('Можно добавить одно фото до 2 МБ');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
  if (!match) throw new Error('Фото должно быть JPEG, PNG или WebP');
  let raw;
  try {
    raw = atob(match[2]);
  } catch {
    throw new Error('Повреждённое фото');
  }
  if (!raw.length || raw.length > 2 * 1024 * 1024)
    throw new Error('Фото должно быть не больше 2 МБ');
  const png = raw.startsWith('\x89PNG\r\n\x1a\n'),
    jpg = raw.startsWith('\xff\xd8\xff'),
    webp = raw.startsWith('RIFF') && raw.slice(8, 12) === 'WEBP';
  if (!(
    (match[1] === 'png' && png) ||
    (match[1] === 'jpeg' && jpg) ||
    (match[1] === 'webp' && webp)
  ))
    throw new Error('Содержимое файла не соответствует фото');
  return photo;
}
