// 作业布置 App 同步服务端入口。
// 职责:房间管理、分组管理、任务 CRUD、语音上传/下载、WebSocket 实时广播。
// 仅依赖 express / cors / ws,数据库用 Node 内置 node:sqlite。
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import {
  db,
  DATA_DIR,
  AUDIO_DIR,
  id,
  now,
  createRoom,
  roomExists,
  ensureDefaultSubjects,
  listSubjects,
  getSubject,
  listTasks,
  getTask,
  deleteTask,
} from './db.js';
import { attachWs, broadcast } from './ws.js';
import {
  ROOM_CODE_RE,
  isValidDate,
  CONTENT_MAX,
  SUBJECT_NAME_MAX,
  AUDIO_MAX_BYTES,
  AUDIO_MIME_EXT,
  badRequest,
  notFound,
} from './util.js';

const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' })); // 语音 base64 上传

const server = http.createServer(app);
attachWs(server);

/** 统一包装:确保房间存在,并返回 roomCode */
function withRoom(req, res) {
  const code = String(req.params.code || '');
  if (!ROOM_CODE_RE.test(code)) {
    badRequest(res, '房间号格式不正确(8-32 位字母/数字/连字符)');
    return null;
  }
  return code;
}

// ---------- 健康检查 ----------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: now() });
});

// ---------- 房间 ----------
// 家长创建房间(指定房间号)
app.post('/api/rooms', (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!ROOM_CODE_RE.test(code)) {
    return badRequest(res, '房间号需为 8-32 位字母、数字或连字符');
  }
  if (roomExists(code)) {
    return res.status(409).json({ error: '房间号已存在,请换一个' });
  }
  createRoom(code);
  res.json({ ok: true, code });
});

// 双方校验房间是否存在(儿童加入用)
app.get('/api/rooms/:code', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  if (!roomExists(code)) return notFound(res, '房间不存在,请核对房间号');
  res.json({ ok: true, code, subjects: listSubjects(code) });
});

// ---------- 分组(科目) ----------
app.get('/api/rooms/:code/subjects', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  if (!roomExists(code)) return notFound(res, '房间不存在');
  res.json(listSubjects(code));
});

app.post('/api/rooms/:code/subjects', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  if (!roomExists(code)) return notFound(res, '房间不存在');
  const name = String(req.body?.name || '').trim();
  if (!name) return badRequest(res, '分组名称不能为空');
  if (name.length > SUBJECT_NAME_MAX) return badRequest(res, `分组名称不能超过 ${SUBJECT_NAME_MAX} 个字符`);
  const color = typeof req.body?.color === 'string' ? req.body.color.slice(0, 16) : null;
  const sort = Number.isFinite(req.body?.sort_order) ? Number(req.body.sort_order) : listSubjects(code).length;
  const sid = id();
  db.prepare(
    'INSERT INTO subjects (room_code, id, name, color, sort_order, archived, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  ).run(code, sid, name, color, sort, now());
  broadcast(code, { type: 'subjects_changed' });
  res.json({ ok: true, id: sid });
});

app.put('/api/rooms/:code/subjects/:sid', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  const s = getSubject(code, req.params.sid);
  if (!s) return notFound(res, '分组不存在');
  const name = String(req.body?.name ?? s.name).trim();
  if (!name) return badRequest(res, '分组名称不能为空');
  if (name.length > SUBJECT_NAME_MAX) return badRequest(res, `分组名称不能超过 ${SUBJECT_NAME_MAX} 个字符`);
  const color = typeof req.body?.color === 'string' ? req.body.color.slice(0, 16) : s.color;
  db.prepare('UPDATE subjects SET name = ?, color = ? WHERE room_code = ? AND id = ?').run(
    name,
    color,
    code,
    req.params.sid
  );
  broadcast(code, { type: 'subjects_changed' });
  res.json({ ok: true });
});

// 归档(不物理删除,历史任务仍能显示原分组名)
app.delete('/api/rooms/:code/subjects/:sid', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  const s = getSubject(code, req.params.sid);
  if (!s) return notFound(res, '分组不存在');
  db.prepare('UPDATE subjects SET archived = 1 WHERE room_code = ? AND id = ?').run(code, req.params.sid);
  broadcast(code, { type: 'subjects_changed' });
  res.json({ ok: true });
});

// ---------- 任务 ----------
app.get('/api/rooms/:code/tasks/:date', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  if (!roomExists(code)) return notFound(res, '房间不存在');
  const date = String(req.params.date || '');
  if (!isValidDate(date)) return badRequest(res, '日期格式应为 YYYY-MM-DD');
  res.json(listTasks(code, date));
});

app.post('/api/rooms/:code/tasks', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  if (!roomExists(code)) return notFound(res, '房间不存在');

  const { date, subject_id, content } = req.body || {};
  if (!isValidDate(String(date || ''))) return badRequest(res, '日期格式应为 YYYY-MM-DD');
  const subject = getSubject(code, String(subject_id || ''));
  if (!subject) return badRequest(res, '分组不存在');
  const text = String(content || '').trim();
  if (!text) return badRequest(res, '任务内容不能为空');
  if (text.length > CONTENT_MAX) return badRequest(res, `任务内容不能超过 ${CONTENT_MAX} 字`);

  // 语音(可选):base64 编码的音频
  let audioPath = null;
  let audioMime = null;
  let audioSize = null;
  const b64 = req.body?.audio_base64;
  if (typeof b64 === 'string' && b64.length > 0) {
    audioMime = String(req.body?.audio_mime || '');
    const ext = AUDIO_MIME_EXT[audioMime];
    if (!ext) return badRequest(res, `不支持的音频格式: ${audioMime || '(空)'}`);
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return badRequest(res, '音频内容为空');
    if (buf.length > AUDIO_MAX_BYTES) return badRequest(res, '音频文件过大(上限 15MB)');
    const tid = id();
    audioPath = path.join('audio', `${tid}${ext}`);
    fs.writeFileSync(path.join(DATA_DIR, audioPath), buf);
    audioSize = buf.length;
    const ts = now();
    db.prepare(
      `INSERT INTO tasks (room_code, id, for_date, subject_id, content, audio_path, audio_mime, audio_size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(code, tid, date, subject.id, text, audioPath, audioMime, audioSize, ts, ts);
    broadcast(code, { type: 'tasks_changed', date });
    return res.json({ ok: true, id: tid });
  }

  const tid = id();
  const ts = now();
  db.prepare(
    `INSERT INTO tasks (room_code, id, for_date, subject_id, content, audio_path, audio_mime, audio_size, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
  ).run(code, tid, date, subject.id, text, ts, ts);
  broadcast(code, { type: 'tasks_changed', date });
  res.json({ ok: true, id: tid });
});

app.put('/api/rooms/:code/tasks/:tid', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  const task = getTask(code, req.params.tid);
  if (!task) return notFound(res, '任务不存在');
  const text = String(req.body?.content ?? task.content).trim();
  if (!text) return badRequest(res, '任务内容不能为空');
  if (text.length > CONTENT_MAX) return badRequest(res, `任务内容不能超过 ${CONTENT_MAX} 字`);
  let subjectId = task.subject_id;
  if (req.body?.subject_id && req.body.subject_id !== task.subject_id) {
    const subject = getSubject(code, String(req.body.subject_id));
    if (!subject) return badRequest(res, '分组不存在');
    subjectId = subject.id;
  }
  // 完成状态:家长/儿童两端都可以勾选,只传 done 时不动内容
  const done = typeof req.body?.done === 'boolean' ? (req.body.done ? 1 : 0) : task.done ? 1 : 0;
  db.prepare(
    'UPDATE tasks SET content = ?, subject_id = ?, done = ?, updated_at = ? WHERE room_code = ? AND id = ?'
  ).run(text, subjectId, done, now(), code, req.params.tid);
  broadcast(code, { type: 'tasks_changed', date: task.for_date });
  res.json({ ok: true });
});

app.delete('/api/rooms/:code/tasks/:tid', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  const ok = deleteTask(code, req.params.tid);
  if (!ok) return notFound(res, '任务不存在');
  broadcast(code, { type: 'tasks_changed' });
  res.json({ ok: true });
});

// ---------- 语音下载 ----------
app.get('/api/rooms/:code/audio/:tid', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  const task = getTask(code, req.params.tid);
  if (!task || !task.audio_path) return notFound(res, '音频不存在');
  const abs = path.join(DATA_DIR, task.audio_path);
  if (!fs.existsSync(abs)) return notFound(res, '音频文件缺失');
  res.setHeader('Content-Type', task.audio_mime || 'application/octet-stream');
  fs.createReadStream(abs).pipe(res);
});

// ---------- 启动 ----------
server.listen(PORT, () => {
  console.log(`[homework-server] listening on :${PORT}`);
  console.log(`[homework-server] data dir: ${DATA_DIR}`);
});

// 音频缓存目录大小统计(运维小工具):GET /api/stats
app.get('/api/stats', (_req, res) => {
  const rooms = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
  const tasks = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
  let audioBytes = 0;
  if (fs.existsSync(AUDIO_DIR)) {
    for (const f of fs.readdirSync(AUDIO_DIR)) {
      try {
        audioBytes += fs.statSync(path.join(AUDIO_DIR, f)).size;
      } catch {}
    }
  }
  res.json({ rooms, tasks, audio_bytes: audioBytes });
});
