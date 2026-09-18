// 迁移测试:模拟「升级前就已存在的老库」(tasks 表没有 done 列),
// 验证 db.js 启动时能自动补列,并且老任务读出来是未完成。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = '/tmp/hw-migrate-data';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });

// 1. 老库:完全按 v1.0 的表结构建(没有 done 列)
const old = new DatabaseSync(path.join(dir, 'homework.db'));
old.exec(`
CREATE TABLE rooms (code TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE subjects (room_code TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  PRIMARY KEY (room_code, id));
CREATE TABLE tasks (room_code TEXT NOT NULL, id TEXT NOT NULL, for_date TEXT NOT NULL, subject_id TEXT NOT NULL,
  content TEXT NOT NULL, audio_path TEXT, audio_mime TEXT, audio_size INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (room_code, id));
`);
old.prepare('INSERT INTO rooms (code, created_at) VALUES (?, ?)').run('OLDC0DE1', 1);
old.prepare(
  'INSERT INTO subjects (room_code, id, name, color, sort_order, archived, created_at) VALUES (?,?,?,?,?,0,?)'
).run('OLDC0DE1', 'su1', '语文', '#E5484D', 0, 1);
old.prepare(
  'INSERT INTO tasks (room_code, id, for_date, subject_id, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
).run('OLDC0DE1', 't1', '2026-09-18', 'su1', '老库里已经布置好的作业', 1, 1);
old.close();

// 2. 以老库为数据目录加载 db.js → 应自动 ALTER 补列
process.env.DATA_DIR = dir;
const dbUrl = pathToFileURL(path.resolve('src/db.js')).href;
const { listTasks } = await import(dbUrl);

const tasks = listTasks('OLDC0DE1', '2026-09-18');
const ok = tasks.length === 1 && tasks[0].content === '老库里已经布置好的作业' && tasks[0].done === false;
console.log(ok ? '✅ 老库自动补列:通过(老任务 done=false,内容完整)' : `❌ 老库迁移失败: ${JSON.stringify(tasks)}`);
process.exit(ok ? 0 : 1);
