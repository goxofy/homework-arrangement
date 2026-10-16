// 全局上下文:身份(角色/房间/服务器)、分组列表、任务缓存与 WebSocket 实时同步。

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, type UploadFile } from './api';
import {
  loadIdentity,
  saveIdentity,
  clearIdentity,
  normalizeServer,
  type Identity,
  type Role,
  type Subject,
  type Task,
  type TaskMedia,
} from './storage';
import { importLocalFile, removeCachedMedia } from './media';
import { addDays, todayStr } from './dates';

/** 上传失败的一个附件 */
export interface UploadFailure {
  name: string;
  reason: string;
}

const WS_BACKOFF_MAX = 15000;

interface AppContextValue {
  ready: boolean;
  identity: Identity | null;
  subjects: Subject[];
  /** 按日期缓存的任务: date -> tasks */
  tasksByDate: Record<string, Task[]>;
  loadingDates: Record<string, boolean>;
  connected: boolean;
  saveIdentityAndJoin: (identity: Identity) => Promise<void>;
  updateIdentity: (patch: Partial<Identity>) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSubjects: () => Promise<void>;
  refreshTasks: (date: string) => Promise<void>;
  /**
   * 新建作业。files 是已经选好的本机文件(图片/语音/视频/文件),会依次上传;
   * 作业本身创建成功后即使某个附件上传失败也不会丢,失败项通过返回值告知。
   */
  addTask: (
    input: {
      date: string;
      subject_id: string;
      content: string;
      audio_base64?: string;
      audio_mime?: string;
      files?: UploadFile[];
    },
    /** index 是「正在上传第几个」(0 起),全部结束时用 (total, total, '') 再回调一次 */
    onUploadProgress?: (index: number, total: number, currentName: string) => void
  ) => Promise<{ id: string | null; failed: UploadFailure[] }>;
  /** 给已有作业补附件(家长端) */
  uploadTaskMedia: (
    tid: string,
    date: string,
    files: UploadFile[],
    onUploadProgress?: (index: number, total: number, currentName: string) => void
  ) => Promise<UploadFailure[]>;
  /** 删除某个附件(服务器文件 + 本机缓存) */
  removeTaskMedia: (media: TaskMedia, date: string) => Promise<void>;
  editTask: (tid: string, patch: { content?: string; subject_id?: string }, date: string) => Promise<void>;
  /** 勾选/取消勾选「已完成」(家长与儿童都可操作,乐观更新,失败回滚) */
  setTaskDone: (tid: string, done: boolean, date: string) => Promise<void>;
  removeTask: (tid: string, date: string) => Promise<void>;
  addSubject: (name: string, color: string | null) => Promise<void>;
  editSubject: (sid: string, patch: { name?: string; color?: string | null }) => Promise<void>;
  archiveSubject: (sid: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [tasksByDate, setTasksByDate] = useState<Record<string, Task[]>>({});
  const [loadingDates, setLoadingDates] = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);
  const closedRef = useRef(false);
  // 已请求过的日期集合,用 ref 保存以便 WebSocket 回调中拿到最新值
  const knownDatesRef = useRef<Set<string>>(new Set());

  const fetchSubjects = useCallback(async (id: Identity) => {
    const list = await api.listSubjects(id.server, id.roomCode);
    setSubjects(list);
  }, []);

  const fetchTasks = useCallback(async (id: Identity, date: string) => {
    knownDatesRef.current.add(date);
    setLoadingDates((m) => ({ ...m, [date]: true }));
    try {
      const list = await api.listTasks(id.server, id.roomCode, date);
      setTasksByDate((m) => ({ ...m, [date]: list }));
    } finally {
      setLoadingDates((m) => ({ ...m, [date]: false }));
    }
  }, []);

  // 预取最近几天(日期切换即时可见,日期条上的小圆点也才准)。
  // 服务器不可达时立即停止,不做无意义的连锁请求。
  const prefetchRecentDays = useCallback(
    async (id: Identity) => {
      const today = todayStr();
      for (let i = 1; i <= 6; i++) {
        try {
          await fetchTasks(id, addDays(today, -i));
        } catch {
          return;
        }
      }
    },
    [fetchTasks]
  );

  // 初始化:读本地身份
  useEffect(() => {
    (async () => {
      const id = await loadIdentity();
      if (id) {
        setIdentity(id);
        try {
          await fetchSubjects(id);
          await fetchTasks(id, todayStr());
          prefetchRecentDays(id); // 后台预取,不阻塞启动
        } catch {
          // 服务器暂时不可达也允许进入,界面会提示重试
        }
      }
      setReady(true);
    })();
  }, [fetchSubjects, fetchTasks, prefetchRecentDays]);

  // WebSocket 同步
  const connectWs = useCallback((id: Identity) => {
    closedRef.current = false;
    const base = normalizeServer(id.server).replace(/^http/, 'ws');
    const url = `${base}/ws?room=${encodeURIComponent(id.roomCode)}`;

    const open = () => {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        backoffRef.current = 1000;
        setConnected(true);
        // 重连后全量刷新,防漏消息
        fetchSubjects(id).catch(() => {});
        knownDatesRef.current.forEach((d) => fetchTasks(id, d).catch(() => {}));
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data));
          if (msg.type === 'subjects_changed') {
            fetchSubjects(id).catch(() => {});
          } else if (msg.type === 'tasks_changed') {
            if (msg.date) {
              fetchTasks(id, msg.date).catch(() => {});
            } else {
              // 兼容没带日期的广播(旧版服务端):刷新所有已加载的日期,
              // 宁可多刷一点,也不要漏掉删除这类会让本地数据变脏的事件。
              knownDatesRef.current.forEach((d) => fetchTasks(id, d).catch(() => {}));
            }
          }
        } catch {
          /* 忽略 */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!closedRef.current && AppState.currentState !== 'unknown') {
          const delay = backoffRef.current;
          backoffRef.current = Math.min(backoffRef.current * 2, WS_BACKOFF_MAX);
          setTimeout(() => {
            if (!closedRef.current) open();
          }, delay);
        }
      };
      ws.onerror = () => ws.close();
    };
    open();
  }, [fetchSubjects, fetchTasks]);

  // 身份变化时建立/断开 WebSocket
  useEffect(() => {
    if (!identity) {
      closedRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      return;
    }
    connectWs(identity);
    return () => {
      closedRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.server, identity?.roomCode]);

  // App 从后台回前台时刷新当前数据
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && identity) {
        fetchSubjects(identity).catch(() => {});
        knownDatesRef.current.forEach((d) => fetchTasks(identity, d).catch(() => {}));
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  /**
   * 依次上传若干附件(并发会让弱服务器 + 手机网络更容易失败,所以串行)。
   * 单个失败不影响其他附件,最后把失败清单返回给界面提示。
   */
  const uploadFiles = useCallback(
    async (
      id: Identity,
      taskId: string,
      files: UploadFile[],
      onProgress?: (index: number, total: number, currentName: string) => void
    ): Promise<UploadFailure[]> => {
      const failed: UploadFailure[] = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        onProgress?.(index, files.length, file.name);
        try {
          const res = await api.uploadTaskMedia(id.server, id.roomCode, taskId, file);
          // 刚上传的文件直接收进本机缓存,家长端不用再下载一遍自己的附件
          await importLocalFile(file.uri, {
            id: res.id,
            kind: res.kind,
            name: file.name,
            mime: file.mime,
            size: 0,
            created_at: Date.now(),
            expires_at: res.expires_at,
            expired: false,
            url: '',
          });
        } catch (e) {
          failed.push({ name: file.name, reason: e instanceof Error ? e.message : '上传失败' });
        }
      }
      if (files.length > 0) onProgress?.(files.length, files.length, '');
      return failed;
    },
    []
  );

  const saveIdentityAndJoin = useCallback(async (id: Identity) => {
    await saveIdentity(id);
    setIdentity(id);
    setTasksByDate({});
    knownDatesRef.current = new Set();
    await fetchSubjects(id);
    await fetchTasks(id, todayStr());
    prefetchRecentDays(id);
  }, [fetchSubjects, fetchTasks, prefetchRecentDays]);

  const updateIdentity = useCallback(
    async (patch: Partial<Identity>) => {
      if (!identity) return;
      const next = { ...identity, ...patch };
      if (patch.server) next.server = normalizeServer(patch.server);
      await saveIdentity(next);
      if (patch.server || patch.roomCode) {
        setTasksByDate({});
        knownDatesRef.current = new Set();
        await fetchSubjects(next).catch(() => {});
        await fetchTasks(next, todayStr()).catch(() => {});
        prefetchRecentDays(next);
      }
      setIdentity(next);
    },
    [identity, fetchSubjects, fetchTasks, prefetchRecentDays]
  );

  const signOut = useCallback(async () => {
    await clearIdentity();
    await AsyncStorage.removeItem('@homework/draft');
    setIdentity(null);
    setSubjects([]);
    setTasksByDate({});
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      identity,
      subjects,
      tasksByDate,
      loadingDates,
      connected,
      saveIdentityAndJoin,
      updateIdentity,
      signOut,
      refreshSubjects: () => (identity ? fetchSubjects(identity) : Promise.resolve()),
      refreshTasks: (date) => (identity ? fetchTasks(identity, date) : Promise.resolve()),
      addTask: async (input, onUploadProgress) => {
        if (!identity) return { id: null, failed: [] };
        const created = await api.createTask(identity.server, identity.roomCode, {
          date: input.date,
          subject_id: input.subject_id,
          content: input.content,
          audio_base64: input.audio_base64,
          audio_mime: input.audio_mime,
        });
        const failed = await uploadFiles(identity, created.id, input.files ?? [], onUploadProgress);
        // 重新拉一次:把附件(含失败前已上传的部分)一起带回来
        await fetchTasks(identity, input.date);
        return { id: created.id, failed };
      },
      uploadTaskMedia: async (tid, date, files, onUploadProgress) => {
        if (!identity) return [];
        const failed = await uploadFiles(identity, tid, files, onUploadProgress);
        await fetchTasks(identity, date);
        return failed;
      },
      removeTaskMedia: async (media, date) => {
        if (!identity) return;
        await api.deleteTaskMedia(identity.server, identity.roomCode, media.id);
        removeCachedMedia(media);
        await fetchTasks(identity, date);
      },
      editTask: async (tid, patch, date) => {
        if (!identity) return;
        await api.updateTask(identity.server, identity.roomCode, tid, patch);
        await fetchTasks(identity, date);
      },
      removeTask: async (tid, date) => {
        if (!identity) return;
        await api.deleteTask(identity.server, identity.roomCode, tid);
        await fetchTasks(identity, date);
      },
      setTaskDone: async (tid, done, date) => {
        if (!identity) return;
        // 先改本地(点一下立刻有反馈),失败再拉回真实数据
        setTasksByDate((m) => ({
          ...m,
          [date]: (m[date] ?? []).map((t) => (t.id === tid ? { ...t, done } : t)),
        }));
        try {
          await api.updateTask(identity.server, identity.roomCode, tid, { done });
        } catch (e) {
          await fetchTasks(identity, date).catch(() => {});
          throw e;
        }
      },
      addSubject: async (name, color) => {
        if (!identity) return;
        await api.createSubject(identity.server, identity.roomCode, name, color);
        await fetchSubjects(identity);
      },
      editSubject: async (sid, patch) => {
        if (!identity) return;
        await api.updateSubject(identity.server, identity.roomCode, sid, patch);
        await fetchSubjects(identity);
      },
      archiveSubject: async (sid) => {
        if (!identity) return;
        await api.archiveSubject(identity.server, identity.roomCode, sid);
        await fetchSubjects(identity);
      },
    }),
    [
      ready,
      identity,
      subjects,
      tasksByDate,
      loadingDates,
      connected,
      saveIdentityAndJoin,
      updateIdentity,
      signOut,
      fetchSubjects,
      fetchTasks,
      uploadFiles,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
