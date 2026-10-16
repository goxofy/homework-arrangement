// 客户端 API 封装:与自建服务端通信。

import { File, UploadType } from 'expo-file-system';
import type { Subject, Task, MediaKind } from './storage';
import { normalizeServer } from './storage';

/** 待上传的本地附件 */
export interface UploadFile {
  /** 本机文件 URI(file://...) */
  uri: string;
  mime: string;
  /** 原始文件名(服务端只用来展示与推断扩展名) */
  name: string;
}

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

  /**
   * 上传作业附件(图片 / 音视频 / 文件)。
   *
   * 请求体就是文件字节流(不走 base64,大视频才传得动),元数据放 query,
   * 这样服务端不用引入 multipart 解析依赖。iOS/Android 都用 expo-file-system 原生上传,
   * 内存里不会一次性装下整个文件。
   */
  async uploadTaskMedia(
    server: string,
    code: string,
    tid: string,
    file: UploadFile,
    onProgress?: (sent: number, total: number) => void
  ): Promise<{ id: string; kind: MediaKind; expires_at: number }> {
    const base = normalizeServer(server);
    const path =
      `/api/rooms/${encodeURIComponent(code)}/tasks/${encodeURIComponent(tid)}/media` +
      `?mime=${encodeURIComponent(file.mime)}&name=${encodeURIComponent(file.name)}`;
    let res;
    try {
      res = await new File(file.uri).upload(`${base}${path}`, {
        httpMethod: 'POST',
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: file.mime,
        headers: { 'Content-Type': file.mime },
        onProgress: onProgress
          ? ({ bytesSent, totalBytes }) => onProgress(bytesSent, totalBytes)
          : undefined,
      });
    } catch {
      throw new ApiError(0, `附件上传失败,请检查网络或服务器(${base})`);
    }
    let data: any = null;
    try {
      data = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* 非 JSON 响应 */
    }
    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(res.status, data?.error || `上传失败(${res.status})`);
    }
    return data as { id: string; kind: MediaKind; expires_at: number };
  },

  async deleteTaskMedia(server: string, code: string, mid: string): Promise<void> {
    await request(server, `/api/rooms/${encodeURIComponent(code)}/media/${encodeURIComponent(mid)}`, {
      method: 'DELETE',
    });
  },
};
