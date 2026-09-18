// 客户端 API 封装:与自建服务端通信。

import type { Subject, Task } from './storage';
import { normalizeServer } from './storage';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(server: string, path: string, init?: RequestInit): Promise<T> {
  const base = normalizeServer(server);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch {
    // 带上解析后的实际地址,方便在真机上定位问题(网络不通 / 地址写错 / 服务未启动)
    throw new ApiError(0, `无法连接服务器(${base}),请检查网络、服务器地址或服务是否已启动`);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `请求失败(${res.status})`);
  }
  return data as T;
}

export const api = {
  async health(server: string): Promise<boolean> {
    try {
      await request<{ ok: boolean }>(server, '/api/health');
      return true;
    } catch {
      return false;
    }
  },

  async createRoom(server: string, code: string): Promise<void> {
    await request(server, '/api/rooms', { method: 'POST', body: JSON.stringify({ code }) });
  },

  async getRoom(server: string, code: string): Promise<{ ok: boolean; subjects: Subject[] }> {
    return request(server, `/api/rooms/${encodeURIComponent(code)}`);
  },

  async listSubjects(server: string, code: string): Promise<Subject[]> {
    return request(server, `/api/rooms/${encodeURIComponent(code)}/subjects`);
  },

  async createSubject(
    server: string,
    code: string,
    name: string,
    color: string | null
  ): Promise<{ id: string }> {
    return request(server, `/api/rooms/${encodeURIComponent(code)}/subjects`, {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    });
  },

  async updateSubject(
    server: string,
    code: string,
    sid: string,
    patch: { name?: string; color?: string | null }
  ): Promise<void> {
    await request(server, `/api/rooms/${encodeURIComponent(code)}/subjects/${sid}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },

  async archiveSubject(server: string, code: string, sid: string): Promise<void> {
    await request(server, `/api/rooms/${encodeURIComponent(code)}/subjects/${sid}`, {
      method: 'DELETE',
    });
  },

  async listTasks(server: string, code: string, date: string): Promise<Task[]> {
    return request(
      server,
      `/api/rooms/${encodeURIComponent(code)}/tasks/${encodeURIComponent(date)}`
    );
  },

  async createTask(
    server: string,
    code: string,
    input: {
      date: string;
      subject_id: string;
      content: string;
      audio_base64?: string;
      audio_mime?: string;
    }
  ): Promise<{ id: string }> {
    return request(server, `/api/rooms/${encodeURIComponent(code)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateTask(
    server: string,
    code: string,
    tid: string,
    patch: { content?: string; subject_id?: string; done?: boolean }
  ): Promise<void> {
    await request(server, `/api/rooms/${encodeURIComponent(code)}/tasks/${tid}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },

  async deleteTask(server: string, code: string, tid: string): Promise<void> {
    await request(server, `/api/rooms/${encodeURIComponent(code)}/tasks/${tid}`, {
      method: 'DELETE',
    });
  },
};
