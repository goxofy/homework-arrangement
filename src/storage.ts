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

export interface Task {
  id: string;
  for_date: string; // YYYY-MM-DD
  subject_id: string;
  subject_name: string | null;
  subject_color: string | null;
  content: string;
  has_audio: boolean;
  audio_url: string | null;
  audio_mime: string | null;
  audio_size: number | null;
  created_at: number;
  updated_at: number;
}

export interface Identity {
  role: Role;
  roomCode: string;
  server: string;
}

const KEY_IDENTITY = '@homework/identity';
const KEY_ONBOARDED = '@homework/onboarded';
const KEY_SERVER_HINT = '@homework/server-hint'; // 欢迎页预填的服务器地址
export const KEY_DRAFT = '@homework/draft'; // 家长端语音/文本暂存

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
