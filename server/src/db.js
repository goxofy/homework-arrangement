// 数据库层:使用 Node 内置 sqlite(node:sqlite),无需任何原生编译。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');

fs.mkdirSync(AUDIO_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'homework.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 3000;');

db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  code       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  room_code  TEXT NOT NULL,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_code, id)
);

CREATE TABLE IF NOT EXISTS tasks (
  room_code   TEXT NOT NULL,
  id          TEXT NOT NULL,
  for_date    TEXT NOT NULL,
  subject_id  TEXT NOT NULL,
  content     TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  audio_path  TEXT,
  audio_mime  TEXT,
  audio_size  INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (room_code, id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_room_date    ON tasks (room_code, for_date);
CREATE INDEX IF NOT EXISTS idx_subjects_room_sort ON subjects (room_code, sort_order);
`);

/**
 * 老库补列:SQLite 支持 ADD COLUMN,已存在则跳过。
 * 这样升级服务端不需要手动跑迁移,直接覆盖代码重启即可(数据不丢)。
 */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// v1.1 新增:任务完成状态(0/1)
ensureColumn('tasks', 'done', 'done INTEGER NOT NULL DEFAULT 0');

export const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const now = () => Date.now();

/** 首次创建房间时默认种入 语文/数学/英语/其他 四个分组 */
export function ensureDefaultSubjects(roomCode) {
  const existing = db
    .prepare('SELECT COUNT(*) AS n FROM subjects WHERE room_code = ?')
    .get(roomCode).n;
  if (existing > 0) return;

  const defaults = [
    ['语文', '#E5484D'],
    ['数学', '#3B82F6'],
    ['英语', '#10B981'],
    ['其他', '#F59E0B'],
  ];
  const ts = now();
  const stmt = db.prepare(
    'INSERT INTO subjects (room_code, id, name, color, sort_order, archived, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  );
  defaults.forEach(([name, color], i) => {
    stmt.run(roomCode, id(), name, color, i, ts);
  });
}

export function createRoom(code) {
  db.prepare('INSERT INTO rooms (code, created_at) VALUES (?, ?)').run(code, now());
  ensureDefaultSubjects(code);
}

export function roomExists(code) {
  return !!db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code);
}

export function listSubjects(roomCode) {
  return db
    .prepare(
      'SELECT id, name, color, sort_order, archived FROM subjects WHERE room_code = ? ORDER BY sort_order, created_at'
    )
    .all(roomCode);
}

export function getSubject(roomCode, subjectId) {
  return db
    .prepare('SELECT id, name, color, sort_order, archived FROM subjects WHERE room_code = ? AND id = ?')
    .get(roomCode, subjectId);
}

export function listTasks(roomCode, date) {
  return db
    .prepare(
      `SELECT t.id, t.for_date, t.subject_id, t.content, t.done,
              t.audio_path, t.audio_mime, t.audio_size,
              t.created_at, t.updated_at,
              s.name AS subject_name, s.color AS subject_color
         FROM tasks t
         LEFT JOIN subjects s ON s.room_code = t.room_code AND s.id = t.subject_id
        WHERE t.room_code = ? AND t.for_date = ?
        ORDER BY t.created_at`
    )
    .all(roomCode, date)
    .map((t) => ({
      id: t.id,
      for_date: t.for_date,
      subject_id: t.subject_id,
      subject_name: t.subject_name ?? null,
      subject_color: t.subject_color ?? null,
      content: t.content,
      done: !!t.done,
      has_audio: !!t.audio_path,
      audio_url: t.audio_path ? `/api/rooms/${roomCode}/audio/${t.id}` : null,
      audio_mime: t.audio_mime ?? null,
      audio_size: t.audio_size ?? null,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));
}

export function getTask(roomCode, taskId) {
  return db
    .prepare('SELECT * FROM tasks WHERE room_code = ? AND id = ?')
    .get(roomCode, taskId);
}

/** 删除任务时顺带清理音频文件 */
export function deleteTask(roomCode, taskId) {
  const task = getTask(roomCode, taskId);
  if (!task) return false;
  db.prepare('DELETE FROM tasks WHERE room_code = ? AND id = ?').run(roomCode, taskId);
  if (task.audio_path) {
    const abs = path.join(DATA_DIR, task.audio_path);
    fs.rm(abs, { force: true }, () => {});
  }
  return true;
}
