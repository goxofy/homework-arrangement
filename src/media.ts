// 作业附件的本机缓存。
//
// 背景:服务器上的附件只暂存 7 天(见 server/src/util.js 的 MEDIA_TTL_DAYS),
// 儿童端只要访问到作业对应的日期,就把附件下载到本机并长期保留 ——
// 7 天后服务器删掉了,孩子这边照样能看图、听语音、看视频。
//
// 约定:
// - 缓存放在 document 目录(iOS 的 cache 目录会被系统清掉,不能用来长期保存)
// - 同一个附件同时只会下载一次(去重 + 最多 2 个并发,避免一堆视频把家里的服务器打满)

import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useState } from 'react';
import type { TaskMedia } from './storage';
import { normalizeServer } from './storage';

const CACHE_DIR_NAME = 'homework-media';
/** 同时下载的最大数量(家里的服务器通常很弱,串行程度高一点更稳) */
const MAX_CONCURRENT = 2;

/** 下载进行中的 Promise,key = 附件 id */
const inflight = new Map<string, Promise<string>>();
/** 本机是否已有该附件(含「确认没有」),避免频繁访问文件系统 */
const known = new Map<string, string | null>();
let active = 0;
const queue: (() => void)[] = [];

function cacheDir(): Directory {
  return new Directory(Paths.document, CACHE_DIR_NAME);
}

function ensureCacheDir(): Directory {
  const dir = cacheDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** mime/文件名 → 扩展名。播放器(尤其安卓)很依赖扩展名,这里尽量给准。 */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/bmp': '.bmp',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.weba',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
};

/** 字节数 → 可读大小(0/未知都返回空串,便于拼提示文案) */
export function humanSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function mediaExt(mime: string, name?: string | null): string {
  const byMime = MIME_EXT[String(mime || '').toLowerCase()];
  if (byMime) return byMime;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? `.${m[1].toLowerCase()}` : '.bin';
}

function fileNameOf(media: TaskMedia): string {
  return `${media.id}${mediaExt(media.mime, media.name)}`;
}

/** 本机是否已有这份附件;没有则返回 null(同步,不发起下载) */
export function localMediaUri(media: TaskMedia): string | null {
  if (known.has(media.id)) return known.get(media.id) ?? null;
  let uri: string | null = null;
  try {
    const f = new File(cacheDir(), fileNameOf(media));
    uri = f.exists && f.size > 0 ? f.uri : null;
  } catch {
    uri = null;
  }
  known.set(media.id, uri);
  return uri;
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

/** 下载某个附件到本机(已缓存或正在下载则复用),返回本机文件 URI */
export function downloadMedia(server: string, media: TaskMedia): Promise<string> {
  const cached = localMediaUri(media);
  if (cached) return Promise.resolve(cached);

  const running = inflight.get(media.id);
  if (running) return running;

  const task = withSlot(async () => {
    const dir = ensureCacheDir();
    const dest = new File(dir, fileNameOf(media));
    const file = await File.downloadFileAsync(`${normalizeServer(server)}${media.url}`, dest, {
      idempotent: true,
    });
    known.set(media.id, file.uri);
    return file.uri;
  }).finally(() => {
    inflight.delete(media.id);
  });

  inflight.set(media.id, task);
  return task;
}

/**
 * 批量确保已下载(儿童端「访问到某天就全部下载下来」用这个)。
 * 已经在本机、已经过期且没缓存、正在下载中的都会自动跳过,重复调用没有额外开销。
 */
export function ensureMediaCached(server: string, list: TaskMedia[]): void {
  if (!server) return;
  for (const media of list) {
    if (localMediaUri(media)) continue;
    if (media.expired) continue;
    downloadMedia(server, media).catch(() => {
      /* 网络不好就下次进这一天再试 */
    });
  }
}

/** 上传成功后把刚选的文件收进缓存,家长端不用再下载一遍自己的附件 */
export async function importLocalFile(uri: string, media: TaskMedia): Promise<void> {
  const cached = localMediaUri(media);
  if (cached) return;
  try {
    const dir = ensureCacheDir();
    const dest = new File(dir, fileNameOf(media));
    await new File(uri).copy(dest);
    known.set(media.id, dest.uri);
  } catch {
    /* 拷贝失败不影响上传结果 */
  }
}

/** 删掉本机上某个附件的副本 */
export function removeCachedMedia(media: TaskMedia): void {
  known.set(media.id, null);
  try {
    const f = new File(cacheDir(), fileNameOf(media));
    if (f.exists) f.delete();
  } catch {
    /* 文件不存在就当作已删除 */
  }
}

/** 清空全部已下载附件(设置页的「清理本机资料」) */
export function clearMediaCache(): number {
  known.clear();
  try {
    const dir = cacheDir();
    if (!dir.exists) return 0;
    const count = dir.list().length;
    dir.delete();
    return count;
  } catch {
    return 0;
  }
}

/** 本机缓存占用的字节数(设置页展示用) */
export function mediaCacheSize(): number {
  try {
    const dir = cacheDir();
    return dir.exists ? (dir.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

export type MediaCacheState = 'idle' | 'downloading' | 'ready' | 'error' | 'expired';

/**
 * 附件在本机的可用状态:
 * uri 存在就直接用本机文件(iOS/安卓都能直接喂给 Image / 播放器),
 * 没有就自动去服务器下载 —— 只有在真的渲染到这份附件时才会触发。
 */
export function useCachedMedia(server: string, media: TaskMedia, enabled = true) {
  const [uri, setUri] = useState<string | null>(() => (enabled ? localMediaUri(media) : null));
  const [state, setState] = useState<MediaCacheState>(() => {
    if (!enabled) return 'idle';
    if (localMediaUri(media)) return 'ready';
    return media.expired ? 'expired' : 'idle';
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const cached = localMediaUri(media);
    if (cached) {
      setUri(cached);
      setState('ready');
      return;
    }
    if (!media.expired && !server) {
      setUri(null);
      setState('error');
      return;
    }
    if (media.expired) {
      setUri(null);
      setState('expired');
      return;
    }
    let alive = true;
    setState('downloading');
    downloadMedia(server, media)
      .then((local) => {
        if (!alive) return;
        setUri(local);
        setState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setUri(null);
        setState('error');
      });
    return () => {
      alive = false;
    };
    // media 是从任务列表里反序列化出来的新对象,按 id 判断身份
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, media.id, media.expired, enabled, attempt]);

  const retry = useCallback(() => {
    known.delete(media.id);
    setAttempt((n) => n + 1);
  }, [media.id]);

  return { uri, state, retry };
}
