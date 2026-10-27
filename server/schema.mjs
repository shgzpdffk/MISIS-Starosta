// Additive schema initialization. Back up older databases before applying new tables.
export const CORE_SCHEMA = `
PRAGMA journal_mode=WAL;

PRAGMA foreign_keys=ON;

PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY(group_id,user_id)
);

CREATE TABLE IF NOT EXISTS chats (
  user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  default_group_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS excuses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  filename TEXT,
  data TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(group_id,user_id,lesson_id,date)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export const FEATURE_SCHEMA = `
CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  announcement_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  ack_at TEXT,
  PRIMARY KEY(group_id,announcement_id,user_id)
);

CREATE TABLE IF NOT EXISTS day_answers (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(group_id,user_id,date)
);

CREATE TABLE IF NOT EXISTS auto_marks (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  PRIMARY KEY(group_id,user_id,date,lesson_id)
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  filename TEXT,
  data TEXT,
  created_at TEXT NOT NULL,
  reply TEXT,
  replied_at TEXT
);

CREATE INDEX IF NOT EXISTS requests_by_user ON requests(user_id,kind,created_at);
`;
