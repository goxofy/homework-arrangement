// 数据库层:使用 Node 内置 sqlite(node:sqlite),无需任何原生编译。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MEDIA_TTL_DAYS } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
/** 作业附件(图片 / 音视频 / 文件)的暂存目录:只保留 MEDIA_TTL_MS,到期自动删除 */
export const MEDIA_DIR = path.join(DATA_DIR, 'media');

fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

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

CREATE TABLE IF NOT EXISTS task_media (
  room_code  TEXT NOT NULL,
  id         TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,           -- image | audio | video | file
  name       TEXT,                    -- 原始文件名(展示用)
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  media_path TEXT NOT NULL,           -- 相对 DATA_DIR 的落盘路径
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,        -- created_at + MEDIA_TTL_MS
  deleted_at INTEGER,                 -- 到期清理后文件已删,行保留以便前端显示「已过期」
  PRIMARY KEY (room_code, id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_room_date    ON tasks (room_code, for_date);
CREATE INDEX IF NOT EXISTS idx_subjects_room_sort ON subjects (room_code, sort_order);
CREATE INDEX IF NOT EXISTS idx_media_task         ON task_media (room_code, task_id);
CREATE INDEX IF NOT EXISTS idx_media_expiry       ON task_media (expires_at);
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
  const tasks = db
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
    .all(roomCode, date);

  const mediaByTask = listMediaByTasks(
    roomCode,
    tasks.map((t) => t.id)
  );

  return tasks.map((t) => ({
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
    media: mediaByTask.get(t.id) ?? [],
    created_at: t.created_at,
    updated_at: t.updated_at,
  }));
}

export function getTask(roomCode, taskId) {
  return db
    .prepare('SELECT * FROM tasks WHERE room_code = ? AND id = ?')
    .get(roomCode, taskId);
}

/** 删除任务时顺带清理语音与附件文件 */
export function deleteTask(roomCode, taskId) {
  const task = getTask(roomCode, taskId);
  if (!task) return false;
  const media = listMediaByTask(roomCode, taskId);
  db.prepare('DELETE FROM task_media WHERE room_code = ? AND task_id = ?').run(roomCode, taskId);
  db.prepare('DELETE FROM tasks WHERE room_code = ? AND id = ?').run(roomCode, taskId);
  if (task.audio_path) {
    fs.rm(path.join(DATA_DIR, task.audio_path), { force: true }, () => {});
  }
  for (const m of media) removeMediaFile(m.media_path);
  return true;
}

// ---------- 作业附件 ----------

const MEDIA_TTL_MS = MEDIA_TTL_DAYS * 24 * 60 * 60 * 1000;

function removeMediaFile(mediaPath) {
  if (!mediaPath) return;
  fs.rm(path.join(DATA_DIR, mediaPath), { force: true }, () => {});
}

function serializeMedia(roomCode, row) {
  // 兼容旧配置创建的行:有效期不能超过当前服务端允许的最长保留期。
  const expiresAt = Math.min(row.expires_at, row.created_at + MEDIA_TTL_MS);
  return {
    id: row.id,
    kind: row.kind,
    name: row.name ?? null,
    mime: row.mime,
    size: row.size,
    created_at: row.created_at,
    expires_at: expiresAt,
    // 到点就立即告诉客户端「已过期」,不必等下一轮 10 分钟清理任务先写 deleted_at。
    expired: !!row.deleted_at || expiresAt <= now(),
    url: `/api/rooms/${encodeURIComponent(roomCode)}/media/${row.id}`,
  };
}

/** 新增附件行(文件由调用方先写盘);返回落盘路径与过期时间 */
export function createMedia(roomCode, taskId, { kind, name, mime, size, ext }) {
  const mid = id();
  const ts = now();
  const mediaPath = path.join('media', `${mid}${ext}`);
  const position = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM task_media WHERE room_code = ? AND task_id = ?')
    .get(roomCode, taskId).p;
  db.prepare(
    `INSERT INTO task_media (room_code, id, task_id, kind, name, mime, size, media_path, position, created_at, expires_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(roomCode, mid, taskId, kind, name ?? null, mime, size, mediaPath, position, ts, ts + MEDIA_TTL_MS);
  return { id: mid, media_path: mediaPath, expires_at: ts + MEDIA_TTL_MS };
}

/** 某天所有任务一起取附件(避免 N+1 查询);返回 taskId -> media[] */
export function listMediaByTasks(roomCode, taskIds) {
  const out = new Map();
  if (!taskIds || taskIds.length === 0) return out;
  const holes = taskIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM task_media WHERE room_code = ? AND task_id IN (${holes}) ORDER BY position, created_at`
    )
    .all(roomCode, ...taskIds);
  for (const r of rows) {
    const list = out.get(r.task_id) ?? [];
    list.push(serializeMedia(roomCode, r));
    out.set(r.task_id, list);
  }
  return out;
}

export function listMediaByTask(roomCode, taskId) {
  return db
    .prepare('SELECT * FROM task_media WHERE room_code = ? AND task_id = ? ORDER BY position, created_at')
    .all(roomCode, taskId);
}

export function getMedia(roomCode, mediaId) {
  return db
    .prepare('SELECT * FROM task_media WHERE room_code = ? AND id = ?')
    .get(roomCode, mediaId);
}

/** 家长主动删除某个附件:连文件一起删掉 */
export function deleteMedia(roomCode, mediaId) {
  const row = getMedia(roomCode, mediaId);
  if (!row) return false;
  db.prepare('DELETE FROM task_media WHERE room_code = ? AND id = ?').run(roomCode, mediaId);
  removeMediaFile(row.media_path);
  return true;
}

/** 到期的附件:先删文件,再打个 deleted_at 标记(行留着,客户端才能提示「已过期」) */
export function expireMedia(limit = 500) {
  const ts = now();
  const maxCreatedAt = ts - MEDIA_TTL_MS;
  const rows = db
    .prepare(
      `SELECT * FROM task_media
        WHERE deleted_at IS NULL AND (expires_at <= ? OR created_at <= ?)
        ORDER BY expires_at LIMIT ?`
    )
    .all(ts, maxCreatedAt, limit);
  if (rows.length === 0) return [];
  const mark = db.prepare('UPDATE task_media SET deleted_at = ? WHERE room_code = ? AND id = ?');
  const deletedAt = now();
  for (const r of rows) {
    removeMediaFile(r.media_path);
    mark.run(deletedAt, r.room_code, r.id);
    r.deleted_at = deletedAt;
  }
  return rows;
}

export { MEDIA_TTL_MS };
