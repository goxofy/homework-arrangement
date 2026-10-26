// 本地持久化(AsyncStorage)与类型定义。

import AsyncStorage from '@react-native-async-storage/async-storage';

export type Role = 'parent' | 'child';

export interface Subject {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  archived: number; // sqlite 整数 0/1
}

/** 附件类型:决定在两端怎么展示 */
export type MediaKind = 'image' | 'audio' | 'video' | 'file';

/**
 * 作业附件(图片 / 音视频 / 文件)。
 * 服务器只暂存 7 天(见服务端 MEDIA_TTL_DAYS),儿童端在本机长期保留已下载的副本。
 */
export interface TaskMedia {
  id: string;
  kind: MediaKind;
  /** 原始文件名(展示用,可能是空) */
  name: string | null;
  mime: string;
  size: number;
  created_at: number;
  /** 服务器上的过期时间(毫秒时间戳) */
  expires_at: number;
  /** 服务器上的文件已被清理(7 天到了),本机若已下载仍可正常看/听 */
  expired: boolean;
  /** 相对路径,需要拼上服务器地址 */
  url: string;
}

export interface Task {
  id: string;
  for_date: string; // YYYY-MM-DD
  subject_id: string;
  subject_name: string | null;
  subject_color: string | null;
  content: string;
  done: boolean;
  has_audio: boolean;
  audio_url: string | null;
  audio_mime: string | null;
  audio_size: number | null;
  /** 该条作业的附件(老服务端可能没有这个字段,读取时用 ?? [] 兜底) */
  media?: TaskMedia[];
  created_at: number;
  updated_at: number;
}

export interface Identity {
  role: Role;
  roomCode: string;
  server: string;
}

const KEY_DISPLAY = '@homework/display';
const KEY_IDENTITY = '@homework/identity';
const KEY_ONBOARDED = '@homework/onboarded';
const KEY_SERVER_HINT = '@homework/server-hint'; // 欢迎页预填的服务器地址
const KEY_LAST_SUBJECTS = '@homework/last-subjects'; // server + room -> 上次成功新增作业的分组
export const KEY_DRAFT = '@homework/draft'; // 家长端文本暂存

export async function loadIdentity(): Promise<Identity | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_IDENTITY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export async function saveIdentity(identity: Identity): Promise<void> {
  await AsyncStorage.setItem(KEY_IDENTITY, JSON.stringify(identity));
  await AsyncStorage.setItem(KEY_ONBOARDED, '1');
}

/** 显示偏好:字号档位 + 行间距紧凑度(家长/儿童共用一套) */
export type FontStep = 'sm' | 'md' | 'lg' | 'xl';
export type Density = 'compact' | 'normal' | 'cozy';

export interface DisplayPrefs {
  fontStep: FontStep;
  density: Density;
}

export const DEFAULT_DISPLAY: DisplayPrefs = { fontStep: 'md', density: 'normal' };

export async function loadDisplayPrefs(): Promise<DisplayPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY_DISPLAY);
    if (!raw) return DEFAULT_DISPLAY;
    const parsed = JSON.parse(raw) as Partial<DisplayPrefs>;
    return {
      fontStep: parsed.fontStep ?? DEFAULT_DISPLAY.fontStep,
      density: parsed.density ?? DEFAULT_DISPLAY.density,
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

export async function saveDisplayPrefs(prefs: DisplayPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_DISPLAY, JSON.stringify(prefs));
  } catch {
    /* 存不上也不影响本次使用 */
  }
}

export async function clearIdentity(): Promise<void> {
  await AsyncStorage.removeItem(KEY_IDENTITY);
  await AsyncStorage.removeItem(KEY_ONBOARDED);
}

export async function hasOnboarded(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_ONBOARDED)) === '1';
}

/** 服务器地址预填值(欢迎页填写后记住,下次不再重输) */
export async function loadServerHint(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEY_SERVER_HINT)) ?? '';
  } catch {
    return '';
  }
}

export async function saveServerHint(server: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_SERVER_HINT, server);
  } catch {
    /* 存不上也不影响主流程 */
  }
}

function lastSubjectKey(identity: Pick<Identity, 'server' | 'roomCode'>): string {
  return `${normalizeServer(identity.server)}\u0000${identity.roomCode}`;
}

function parseLastSubjectMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/** 读取某台服务器、某个房间上次成功新增作业时使用的分组 */
export async function loadLastSubjectId(
  identity: Pick<Identity, 'server' | 'roomCode'>
): Promise<string | null> {
  try {
    const map = parseLastSubjectMap(await AsyncStorage.getItem(KEY_LAST_SUBJECTS));
    return map[lastSubjectKey(identity)] ?? null;
  } catch {
    return null;
  }
}

/** 记录某台服务器、某个房间上次成功新增作业时使用的分组 */
export async function saveLastSubjectId(
  identity: Pick<Identity, 'server' | 'roomCode'>,
  subjectId: string
): Promise<void> {
  if (!subjectId) return;
  try {
    const map = parseLastSubjectMap(await AsyncStorage.getItem(KEY_LAST_SUBJECTS));
    map[lastSubjectKey(identity)] = subjectId;
    await AsyncStorage.setItem(KEY_LAST_SUBJECTS, JSON.stringify(map));
  } catch {
    /* 存不上也不影响主流程 */
  }
}

/** 规范化服务器地址:补全协议、去掉末尾斜杠 */
export function normalizeServer(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//.test(s)) s = `http://${s}`;
  return s.replace(/\/+$/, '');
}

/** 简单校验服务器地址 */
export function isValidServer(input: string): boolean {
  const s = normalizeServer(input);
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}
