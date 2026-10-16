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
  MEDIA_DIR,
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
  createMedia,
  getMedia,
  listMediaByTask,
  deleteMedia,
  expireMedia,
} from './db.js';
import { attachWs, broadcast } from './ws.js';
import {
  ROOM_CODE_RE,
  isValidDate,
  CONTENT_MAX,
  SUBJECT_NAME_MAX,
  AUDIO_MAX_BYTES,
  AUDIO_MIME_EXT,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PER_TASK,
  MEDIA_TTL_DAYS,
  MEDIA_TTL_LABEL,
  MEDIA_UPLOAD_LIMIT,
  mediaKind,
  mediaExt,
  safeFileName,
  badRequest,
  notFound,
} from './util.js';

const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(cors());

/**
 * JSON 请求体解析(语音 base64 走这里)。
 *
 * 例外:附件上传是「原始字节流」,body 就是文件本身。这里必须跳过,
 * 否则上传一个 .json 文件时会被当成 JSON 解析掉(handler 就拿不到 Buffer 了)。
 */
const MEDIA_UPLOAD_PATH_RE = /^\/api\/rooms\/[^/]+\/tasks\/[^/]+\/media$/;
const jsonBody = express.json({ limit: '25mb' });
app.use((req, res, next) => {
  if (req.method === 'POST' && MEDIA_UPLOAD_PATH_RE.test(req.path)) return next();
  return jsonBody(req, res, next);
});

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
  // 先取出 for_date:广播必须带上日期,否则客户端不知道要刷新哪一天,
  // 子设备就会一直看到这条已被删除的任务,直到手动切日期/重进页面。
  const task = getTask(code, req.params.tid);
  if (!task) return notFound(res, '任务不存在');
  deleteTask(code, req.params.tid);
  broadcast(code, { type: 'tasks_changed', date: task.for_date });
  res.json({ ok: true });
});

// ---------- 附件(图片 / 音视频 / 文件) ----------
// 家长端上传,服务器暂存 MEDIA_TTL_DAYS 天(默认 7 天)后自动删除;
// 儿童端在这期间打开对应日期会把附件下载到本机长期保存。
//
// 上传的请求体就是文件字节流(Content-Type = 文件 mime),元数据走 query:
// 避免 base64 多出 33% 的体积,几十 MB 的视频也能正常上传。
app.post(
  '/api/rooms/:code/tasks/:tid/media',
  express.raw({ type: () => true, limit: MEDIA_UPLOAD_LIMIT }),
  (req, res) => {
    const code = withRoom(req, res);
    if (!code) return;
    if (!roomExists(code)) return notFound(res, '房间不存在');
    const task = getTask(code, req.params.tid);
    if (!task) return notFound(res, '任务不存在');

    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buf.length === 0) return badRequest(res, '附件内容为空');

    const mime = String(req.query.mime || '').trim().toLowerCase() || 'application/octet-stream';
    const kind = mediaKind(mime) || 'file';
    const max = MEDIA_MAX_BYTES[kind] ?? MEDIA_MAX_BYTES.file;
    if (buf.length > max) {
      return badRequest(res, `附件过大(上限 ${Math.round(max / 1024 / 1024)}MB)`);
    }
    if (listMediaByTask(code, task.id).length >= MEDIA_MAX_PER_TASK) {
      return badRequest(res, `每条作业最多 ${MEDIA_MAX_PER_TASK} 个附件`);
    }

    const name = safeFileName(req.query.name) || `${kind}${mediaExt(mime, '')}`;
    const created = createMedia(code, task.id, {
      kind,
      name,
      mime,
      size: buf.length,
      ext: mediaExt(mime, name),
    });
    fs.writeFileSync(path.join(DATA_DIR, created.media_path), buf);
    // 先入库再广播:儿童端收到通知时已经能拉到这份附件
    broadcast(code, { type: 'tasks_changed', date: task.for_date });
    res.json({
      ok: true,
      id: created.id,
      kind,
      name,
      mime,
      size: buf.length,
      expires_at: created.expires_at,
    });
  }
);

// 附件下载(儿童端/家长端都会下载到本机缓存)
app.get('/api/rooms/:code/media/:mid', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  // 顺手扫一下到期附件:不用等 10 分钟一次的定时任务,请求当下就能给「已过期」
  expireMedia(50);
  const media = getMedia(code, req.params.mid);
  if (!media) return notFound(res, '附件不存在');
  if (media.deleted_at) {
    return res.status(410).json({ error: `附件已过期(服务器只暂存 ${MEDIA_TTL_LABEL})` });
  }
  const abs = path.join(DATA_DIR, media.media_path);
  if (!fs.existsSync(abs)) return notFound(res, '附件文件缺失');
  res.type(media.mime || 'application/octet-stream');
  // sendFile 自带 Range 支持,大视频可以边下边播
  res.sendFile(abs, { maxAge: 24 * 60 * 60 * 1000, headers: { 'Content-Type': media.mime || 'application/octet-stream' } });
});

// 家长端删除某个附件(儿童端已下载到本机的副本不受影响)
app.delete('/api/rooms/:code/media/:mid', (req, res) => {
  const code = withRoom(req, res);
  if (!code) return;
  const media = getMedia(code, req.params.mid);
  if (!media) return notFound(res, '附件不存在');
  const task = getTask(code, media.task_id);
  deleteMedia(code, media.id);
  if (task) broadcast(code, { type: 'tasks_changed', date: task.for_date });
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

// ---------- 过期附件清理 ----------
// 启动时扫一遍,之后每 10 分钟扫一遍。
// 到期只删文件并打上 deleted_at 标记(行保留),这样客户端能显示「已过期」而不是干脆消失。
function sweepExpiredMedia() {
  try {
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const rows = expireMedia(500);
      total += rows.length;
      if (rows.length < 500) break;
    }
    if (total > 0) {
      console.log(`[homework-server] 已清理 ${total} 个过期附件(附件只保留 ${MEDIA_TTL_LABEL})`);
    }
  } catch (e) {
    console.error('[homework-server] 附件清理失败:', e?.message || e);
  }
}

sweepExpiredMedia();
const sweepTimer = setInterval(sweepExpiredMedia, 10 * 60 * 1000);
sweepTimer.unref?.();

// ---------- 启动 ----------
server.listen(PORT, () => {
  console.log(`[homework-server] listening on :${PORT}`);
  console.log(`[homework-server] data dir: ${DATA_DIR}`);
  console.log(`[homework-server] 附件暂存 ${MEDIA_TTL_LABEL},目录: ${MEDIA_DIR}`);
});

function dirBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const f of fs.readdirSync(dir)) {
    try {
      total += fs.statSync(path.join(dir, f)).size;
    } catch {}
  }
  return total;
}

// 缓存目录大小统计(运维小工具):GET /api/stats
app.get('/api/stats', (_req, res) => {
  const rooms = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
  const tasks = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
  const media = db
    .prepare('SELECT COUNT(*) AS n FROM task_media WHERE deleted_at IS NULL')
    .get().n;
  const expiredMedia = db
    .prepare('SELECT COUNT(*) AS n FROM task_media WHERE deleted_at IS NOT NULL')
    .get().n;
  res.json({
    rooms,
    tasks,
    audio_bytes: dirBytes(AUDIO_DIR),
    media,
    expired_media: expiredMedia,
    media_bytes: dirBytes(MEDIA_DIR),
    media_ttl_days: MEDIA_TTL_DAYS,
    media_ttl_label: MEDIA_TTL_LABEL,
  });
});

// ---------- 统一错误响应 ----------
// 上传超限等中间件错误默认返回 HTML,客户端解析不了;这里统一成 JSON。
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: '上传内容过大,请压缩或截短后重试' });
  }
  console.error('[homework-server] 未处理的错误:', err?.message || err);
  res.status(500).json({ error: '服务器内部错误' });
});
