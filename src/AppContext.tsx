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
import { api } from './api';
import {
  loadIdentity,
  saveIdentity,
  clearIdentity,
  normalizeServer,
  type Identity,
  type Role,
  type Subject,
  type Task,
} from './storage';
import { todayStr } from './dates';

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
  addTask: (input: { date: string; subject_id: string; content: string; audio_base64?: string; audio_mime?: string }) => Promise<void>;
  editTask: (tid: string, patch: { content?: string; subject_id?: string }, date: string) => Promise<void>;
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

  // 初始化:读本地身份
  useEffect(() => {
    (async () => {
      const id = await loadIdentity();
      if (id) {
        setIdentity(id);
        try {
          await fetchSubjects(id);
          await fetchTasks(id, todayStr());
        } catch {
          // 服务器暂时不可达也允许进入,界面会提示重试
        }
      }
      setReady(true);
    })();
  }, [fetchSubjects, fetchTasks]);

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
          } else if (msg.type === 'tasks_changed' && msg.date) {
            fetchTasks(id, msg.date).catch(() => {});
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

  const saveIdentityAndJoin = useCallback(async (id: Identity) => {
    await saveIdentity(id);
    setIdentity(id);
    setTasksByDate({});
    knownDatesRef.current = new Set();
    await fetchSubjects(id);
    await fetchTasks(id, todayStr());
  }, [fetchSubjects, fetchTasks]);

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
      }
      setIdentity(next);
    },
    [identity, fetchSubjects, fetchTasks]
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
      addTask: async (input) => {
        if (!identity) return;
        await api.createTask(identity.server, identity.roomCode, input);
        await fetchTasks(identity, input.date);
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
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
