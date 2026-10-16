// 冒烟测试:作业附件(图片 / 音视频 / 文件)的上传、下载、过期清理。
//
// 覆盖:
//   1. 上传:原始字节流 + query 元数据,归类(image/video/file)、大小、URL 正确
//   2. 列表:GET tasks/:date 带上 media
//   3. 下载:字节与 Content-Type 一致,并且支持 Range(视频边下边播)
//   4. 广播:上传/删除附件都会让对应日期刷新(否则孩子端看不到新资料)
//   5. 校验:空内容 400、任务不存在 404
//   6. 过期:超过保留期后文件被删、下载返回 410、列表里标 expired
//   7. 级联:删除任务会把它的附件文件一起清掉
//
// 跑法:cd server && node test-media.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8898;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-media-'));
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const BASE = `http://127.0.0.1:${PORT}`;
const ROOM = 'mediaroom88';
const DATE = '2026-09-18';
// 保留期取 2 秒左右,这样一条测试跑下来就能覆盖「到期自动删除」
const TTL_DAYS = 2 / 86400;

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

async function req(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

/** 上传原始字节(和 App 里的行为一致:body 是文件字节,元数据走 query) */
async function upload(tid, buf, mime, name) {
  const url = `${BASE}/api/rooms/${ROOM}/tasks/${tid}/media?mime=${encodeURIComponent(mime)}&name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': mime },
    body: buf,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

function mediaFiles() {
  return fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];
}

const server = spawn(process.execPath, [path.join(__dirname, 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR, MEDIA_TTL_DAYS: String(TTL_DAYS) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${ROOM}`);
  const messages = [];
  ws.on('message', (raw) => {
    try {
      messages.push(JSON.parse(String(raw)));
    } catch {}
  });
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** 假装是一张图片的字节(内容不重要,服务端只按 mime 归类) */
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

try {
  if (!(await waitUp())) throw new Error('服务器未能启动');

  await req('POST', '/api/rooms', { code: ROOM });
  const subjects = (await req('GET', `/api/rooms/${ROOM}/subjects`)).data;
  const subjectId = subjects[0].id;

  const { ws, messages } = await connect();
  await wait(200);

  // ---------- 1. 上传 + 列表 ----------
  const task = await req('POST', `/api/rooms/${ROOM}/tasks`, {
    date: DATE,
    subject_id: subjectId,
    content: '看图写话:第 3 页',
  });
  const taskId = task.data.id;
  await wait(150);
  messages.length = 0;

  const upImg = await upload(taskId, pngBytes, 'image/png', 'IMG_0001.png');
  check('上传图片返回 200', upImg.status === 200, JSON.stringify(upImg.data));
  check('返回归类为 image', upImg.data?.kind === 'image');
  check('返回字节数正确', upImg.data?.size === pngBytes.length);
  check('返回过期时间(7 天默认,这里被测试缩短)', typeof upImg.data?.expires_at === 'number');

  const upPdf = await upload(taskId, Buffer.from('%PDF-1.4 hello'), 'application/pdf', '作业.pdf');
  check('上传 PDF 归类为 file', upPdf.data?.kind === 'file');

  // 以 application/json 上传的文件不能被全局 JSON 中间件当成请求体解析掉
  const upJson = await upload(taskId, Buffer.from('{"a":1}'), 'application/json', '配置.json');
  check('上传 .json 文件也能拿到原始字节', upJson.status === 200 && upJson.data?.size === 7, JSON.stringify(upJson.data));

  await wait(250);
  check(
    '上传附件后广播 tasks_changed 且带 date(孩子端才知道要刷新)',
    messages.some((m) => m.type === 'tasks_changed' && m.date === DATE),
    JSON.stringify(messages)
  );

  let list = (await req('GET', `/api/rooms/${ROOM}/tasks/${DATE}`)).data;
  const media = list[0]?.media ?? [];
  check('任务列表带上附件', media.length === 3, JSON.stringify(media));
  check('附件带 url', media.every((m) => m.url.startsWith(`/api/rooms/${ROOM}/media/`)));
  check('附件带原始文件名', media.some((m) => m.name === '作业.pdf'));
  check('附件未过期时 expired = false', media.every((m) => m.expired === false));

  // ---------- 2. 下载 ----------
  const imgUrl = media.find((m) => m.kind === 'image').url;
  const dl = await fetch(`${BASE}${imgUrl}`);
  const dlBytes = Buffer.from(await dl.arrayBuffer());
  check('下载返回 200', dl.status === 200);
  check('下载内容与上传一致', dlBytes.equals(pngBytes));
  check('下载 Content-Type 正确', dl.headers.get('content-type')?.includes('image/png'));

  const ranged = await fetch(`${BASE}${imgUrl}`, { headers: { Range: 'bytes=0-3' } });
  check('支持 Range 请求(视频边下边播)', ranged.status === 206, `实际 ${ranged.status}`);

  // ---------- 3. 校验 ----------
  check('空内容上传返回 400', (await upload(taskId, Buffer.alloc(0), 'image/png', 'x.png')).status === 400);
  const notFound = await upload('nonexistent', pngBytes, 'image/png', 'x.png');
  check('给不存在的任务上传返回 404', notFound.status === 404);
  check(
    '附件文件确实落在 data/media 目录',
    mediaFiles().length === 3,
    JSON.stringify(mediaFiles())
  );

  // ---------- 4. 删除单个附件 ----------
  const pdfMedia = media.find((m) => m.kind === 'file');
  messages.length = 0;
  const delMedia = await req('DELETE', `/api/rooms/${ROOM}/media/${pdfMedia.id}`);
  check('删除附件返回 200', delMedia.status === 200);
  check('删除后下载返回 404', (await fetch(`${BASE}${pdfMedia.url}`)).status === 404);
  check('删除后磁盘文件也少了一个', mediaFiles().length === 2);
  await wait(250);
  check(
    '删除附件也会广播',
    messages.some((m) => m.type === 'tasks_changed' && m.date === DATE),
    JSON.stringify(messages)
  );

  // ---------- 5. 删除任务级联清理附件 ----------
  const task2 = await req('POST', `/api/rooms/${ROOM}/tasks`, {
    date: DATE,
    subject_id: subjectId,
    content: '朗读课文',
  });
  const upVideo = await upload(task2.data.id, Buffer.from('fake-video-bytes'), 'video/mp4', '讲解.mp4');
  check('上传视频归类为 video', upVideo.data?.kind === 'video');
  check('上传后目录里有 3 个附件文件', mediaFiles().length === 3);
  await req('DELETE', `/api/rooms/${ROOM}/tasks/${task2.data.id}`);
  await wait(200);
  check('删除任务时附件文件一起清掉', mediaFiles().length === 2, JSON.stringify(mediaFiles()));

  // ---------- 6. 过期自动清理 ----------
  await wait(2200); // 等过保留期(测试里设成 2 秒)
  const afterExpiry = await fetch(`${BASE}${imgUrl}`);
  check('过期后下载返回 410', afterExpiry.status === 410, `实际 ${afterExpiry.status}`);
  const expiryBody = await afterExpiry.json().catch(() => null);
  check('410 带可读原因', typeof expiryBody?.error === 'string' && expiryBody.error.includes('过期'), JSON.stringify(expiryBody));
  check('过期后磁盘上的文件已删除', mediaFiles().length === 0, JSON.stringify(mediaFiles()));

  list = (await req('GET', `/api/rooms/${ROOM}/tasks/${DATE}`)).data;
  const expiredMedia = (list[0]?.media ?? [])[0];
  check('列表里标记 expired = true(前端好显示「已过期」)', expiredMedia?.expired === true, JSON.stringify(expiredMedia));

  const stats = (await req('GET', '/api/stats')).data;
  check('stats 显示过期附件数量', stats?.expired_media >= 1, JSON.stringify(stats));
  check('stats 暴露保留天数(运维可见)', typeof stats?.media_ttl_days === 'number');

  ws.close();
} catch (e) {
  console.error('测试异常:', e);
  failures++;
} finally {
  server.kill('SIGKILL');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
}
