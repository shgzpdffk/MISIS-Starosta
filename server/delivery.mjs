import { quietUntil, moscowDate, moscowTime, announcementState } from '../public/features.js';
import { lessonsOn, appliesTo } from '../public/model.js';
import { absenceWarnings } from './features.mjs';

// Evaluated immediately before each delivery: settings and group membership may
// have changed since a notification entered the durable queue.
/** Re-check current consent, membership and relevance immediately before sending a queued item. */
export function deliveryDecision(store, row, now = new Date()) {
  const p = JSON.parse(row.payload),
    prefs = store.preferences({ id: row.user_id });
  let s = null;
  const gid = p.groupId || p.poll?.groupId;
  if (gid) {
    try {
      s = store.read(gid, { id: row.user_id });
    } catch {
      return { status: 'expired' };
    }
  }
  if (p.announcementId) {
    const a = s?.announcements.find((a) => a.id === p.announcementId);
    if (!a || announcementState(a, now) !== 'active') return { status: 'expired' };
  }
  if (p.requestId && !store.db.prepare('SELECT 1 FROM requests WHERE id=?').get(p.requestId))
    return { status: 'expired' };
  if (
    p.warning &&
    !absenceWarnings(s, row.user_id, now).some(
      (w) => w.subject === p.warning.subject && w.threshold === p.warning.threshold,
    )
  )
    return { status: 'expired' };
  if (p.poll) {
    const date = moscowDate(now),
      l = s && lessonsOn(s, p.poll.date).find((l) => l.id === p.poll.lessonId),
      member = s?.members.find((m) => m.id === row.user_id);
    if (
      p.poll.date !== date ||
      !l ||
      !member?.active ||
      !appliesTo(l, member) ||
      moscowTime(now) > l.end
    )
      return { status: 'expired' };
    if (store.answeredDay(gid, row.user_id, date)) return { status: 'suppressed' };
    if (
      s.marks[`${date}|${l.id}|${row.user_id}`] &&
      s.marks[`${date}|${l.id}|${row.user_id}`] !== 'unknown'
    )
      return { status: 'suppressed' };
  }
  const category =
    p.category ||
    (p.poll
      ? 'polls'
      : p.announcementId || row.dedupe?.startsWith('announcement:')
        ? 'announcements'
        : 'messages');
  if (prefs[category] === false) return { status: 'suppressed' };
  const until = quietUntil(prefs, now);
  if (until) {
    if (p.poll) {
      const l = lessonsOn(s, p.poll.date).find((l) => l.id === p.poll.lessonId);
      if (until > new Date(p.poll.date + 'T' + l.end + ':00+03:00').getTime())
        return { status: 'expired' };
    }
    return { status: 'deferred', until };
  }
  return { status: 'ready' };
}
