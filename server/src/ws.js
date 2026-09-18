// WebSocket 房间广播:同一房间的家长端/儿童端互推变更通知。
import { WebSocketServer } from 'ws';

/** roomCode -> Set<WebSocket> */
const rooms = new Map();

export function attachWs(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const code = url.searchParams.get('room') || '';
    if (!/^[A-Za-z0-9-]{8,32}$/.test(code)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, code);
    });
  });

  wss.on('connection', (ws, _req, roomCode) => {
    let set = rooms.get(roomCode);
    if (!set) rooms.set(roomCode, (set = new Set()));
    set.add(ws);
    ws.on('close', () => {
      set.delete(ws);
      if (set.size === 0) rooms.delete(roomCode);
    });
    // 客户端心跳
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      } catch {
        /* 忽略非 JSON 消息 */
      }
    });
  });
}

/**
 * 向指定房间的所有连接广播事件。
 * type: 'tasks_changed' { date } | 'subjects_changed'
 * sender 可传入发起变更的那条 ws 连接以跳过自己(当前客户端全量刷新,无需跳过)。
 */
export function broadcast(roomCode, payload) {
  const set = rooms.get(roomCode);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1 /* OPEN */) ws.send(data);
  }
}
