// Read-only owner utility. Run where DATABASE_PATH points to the production DB.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'node scripts/requests.mjs [--id ID] [--file PATH]\nБез параметров: последние 100 сообщений об ошибках. --id: полное обращение. --file: сохранить его вложение в новый файл. DATABASE_PATH должен указывать на рабочую базу.',
  );
  process.exit(0);
}
const value = (key) => {
  const i = args.indexOf(key);
  if (i < 0) return null;
  if (!args[i + 1] || args[i + 1].startsWith('--'))
    throw new Error('После ' + key + ' нужно значение');
  return args[i + 1];
};
let db;
try {
  const path = process.env.DATABASE_PATH || './data/misis.sqlite';
  if (!existsSync(path)) throw new Error('База не найдена. Укажи DATABASE_PATH рабочей базы.');
  db = new DatabaseSync(path, { readOnly: true });
  const id = value('--id'),
    target = value('--file');
  if (target && !id) throw new Error('--file используется вместе с --id');
  if (id) {
    const r = db.prepare("SELECT * FROM requests WHERE id=? AND kind='bug'").get(id);
    if (!r) throw new Error('Сообщение об ошибке не найдено');
    if (target) {
      if (!r.data) throw new Error('Вложения нет');
      writeFileSync(target, Buffer.from(r.data.split(',')[1], 'base64'), {
        flag: 'wx',
        mode: 0o600,
      });
      console.log('Вложение сохранено: ' + target);
    }
    const { data, ...record } = r;
    console.log(JSON.stringify({ ...record, hasFile: !!data }, null, 2));
  } else
    console.log(
      JSON.stringify(
        db
          .prepare(
            "SELECT id,user_id,author_name,title,text,filename,created_at FROM requests WHERE kind='bug' ORDER BY created_at DESC LIMIT 100",
          )
          .all(),
        null,
        2,
      ),
    );
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  db?.close();
}
