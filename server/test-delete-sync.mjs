// 冒烟测试:任务删除的实时同步。
//
// 覆盖三件事:
//   1. 删除任务的广播必须带 date(否则子设备不知道刷新哪一天,会一直看到已删除的任务)
//   2. 添加/编辑/勾选的广播依然带 date
//   3. 对已被删除的任务勾选(两端并发操作)返回 404,客户端据此回滚并刷新
//
// 跑法:cd server && node test-delete-sync.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8899;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-delsync-'));
const BASE = `http://127.0.0.1:${PORT}`;
const ROOM = 'testroom99';
const DATE = '2026-09-18';

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

const server = spawn(process.execPath, [path.join(__dirname, 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

/** 等服务器起来 */
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

/** 连上房间的 WebSocket,收集收到的广播 */
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

try {
  if (!(await waitUp())) throw new Error('服务器未能启动');

  // 准备:房间 + 取一个默认分组
  await req('POST', '/api/rooms', { code: ROOM });
  const subjects = (await req('GET', `/api/rooms/${ROOM}/subjects`)).data;
  const subjectId = subjects[0].id;

  const { ws, messages } = await connect();
  await wait(200);

  // --- 添加:广播应带 date ---
  const created = await req('POST', `/api/rooms/${ROOM}/tasks`, {
    date: DATE,
    subject_id: subjectId,
    content: '数学口算第 12 页',
  });
  check('创建任务返回 200', created.status === 200);
  const taskId = created.data.id;
  await wait(250);
  const addMsg = messages.find((m) => m.type === 'tasks_changed');
  check('创建广播带 date', addMsg?.date === DATE, JSON.stringify(addMsg));

  // --- 勾选:广播应带 date ---
  messages.length = 0;
  await req('PUT', `/api/rooms/${ROOM}/tasks/${taskId}`, { done: true });
  await wait(250);
  const doneMsg = messages.find((m) => m.type === 'tasks_changed');
  check('勾选广播带 date', doneMsg?.date === DATE, JSON.stringify(doneMsg));
  const afterDone = (await req('GET', `/api/rooms/${ROOM}/tasks/${DATE}`)).data;
  check('勾选后 done = true', afterDone[0]?.done === true);

  // --- 删除:广播必须带 date(本次修复的核心)---
  messages.length = 0;
  const del = await req('DELETE', `/api/rooms/${ROOM}/tasks/${taskId}`);
  check('删除任务返回 200', del.status === 200);
  await wait(250);
  const delMsg = messages.find((m) => m.type === 'tasks_changed');
  check(
    '删除广播带 date(否则子设备看不到删除)',
    delMsg?.date === DATE,
    `收到: ${JSON.stringify(delMsg)}`
  );
  const afterDelete = (await req('GET', `/api/rooms/${ROOM}/tasks/${DATE}`)).data;
  check('删除后列表为空', Array.isArray(afterDelete) && afterDelete.length === 0);

  // --- 冲突:对已删除的任务勾选 ---
  const before = messages.length;
  const conflict = await req('PUT', `/api/rooms/${ROOM}/tasks/${taskId}`, { done: true });
  check('对已删除任务勾选返回 404', conflict.status === 404, `实际 ${conflict.status}`);
  check('404 带可读错误信息', conflict.data?.error === '任务不存在', JSON.stringify(conflict.data));
  await wait(250);
  check(
    '冲突时不再产生广播(避免两端来回打架)',
    messages.length === before,
    `新增 ${messages.length - before} 条: ${JSON.stringify(messages.slice(before))}`
  );

  // --- 冲突:对已删除的任务再次删除 ---
  check('重复删除返回 404', (await req('DELETE', `/api/rooms/${ROOM}/tasks/${taskId}`)).status === 404);

  // --- 回归:分组变更广播 ---
  messages.length = 0;
  await req('PUT', `/api/rooms/${ROOM}/subjects/${subjectId}`, { name: '语文' });
  await wait(250);
  check('分组变更广播', messages.some((m) => m.type === 'subjects_changed'));

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
