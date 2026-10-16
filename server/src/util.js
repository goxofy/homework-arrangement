// 通用校验工具与常量。

export const ROOM_CODE_RE = /^[A-Za-z0-9-]{8,32}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 任务的中文内容限制 */
export const CONTENT_MAX = 500;
/** 分组名限制 */
export const SUBJECT_NAME_MAX = 20;
/** 语音文件大小限制(base64 解码后) */
export const AUDIO_MAX_BYTES = 15 * 1024 * 1024;

// ---------- 附件(图片 / 音视频 / 文件) ----------

/** 附件类型:按 mime 归类,客户端的展示方式由它决定 */
export const MEDIA_KINDS = ['image', 'audio', 'video', 'file'];

/** 单条作业最多挂多少个附件 */
export const MEDIA_MAX_PER_TASK = 20;

/** 附件在服务器上的最长保留天数,任何部署配置都不能超过它 */
export const MEDIA_TTL_MAX_DAYS = 7;

/**
 * 解析附件保留期。允许用小数缩短保留期以便测试,无效值回落到 7 天,
 * 大于 7 的配置自动钳制,避免误配置成长期存储。
 * @param {unknown} value
 * @returns {number}
 */
export function resolveMediaTtlDays(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return MEDIA_TTL_MAX_DAYS;
  return Math.min(requested, MEDIA_TTL_MAX_DAYS);
}

export const MEDIA_TTL_DAYS = resolveMediaTtlDays(process.env.MEDIA_TTL_DAYS);
export const MEDIA_TTL_MS = MEDIA_TTL_DAYS * 24 * 60 * 60 * 1000;

/** 保留期的人类可读写法,用于日志与错误提示 */
export const MEDIA_TTL_LABEL =
  MEDIA_TTL_DAYS >= 1
    ? `${MEDIA_TTL_DAYS} 天`
    : `${Math.max(1, Math.round(MEDIA_TTL_DAYS * 24 * 60))} 分钟`;

/** 单文件大小上限(解码后字节) */
export const MEDIA_MAX_BYTES = {
  image: 12 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 80 * 1024 * 1024,
  file: 25 * 1024 * 1024,
};

/** 一次上传请求体的总上限(取最大类别,再留一点余量) */
export const MEDIA_UPLOAD_LIMIT = `${Math.ceil(MEDIA_MAX_BYTES.video / 1024 / 1024) + 10}mb`;

/** mime → 归类 */
export function mediaKind(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (!m) return null;
  return 'file';
}

/** mime → 落盘扩展名(未知类型时按文件名后缀兜底,再兜底 .bin) */
const MIME_EXT = {
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

const SAFE_NAME_RE = /[^\w.\-\u4e00-\u9fa5]+/g;

/** 只保留文件名里安全的字符,避免路径穿越与奇怪字符 */
export function safeFileName(name) {
  const base = String(name || '').split(/[/\\]/).pop() || '';
  return base.replace(SAFE_NAME_RE, '_').slice(0, 120);
}

/** 旧版「一条作业一段语音」用的 mime → 扩展名(部分安卓录音会以 video/mp4 上报) */
export const AUDIO_MIME_EXT = Object.fromEntries(
  Object.entries(MIME_EXT).filter(([mime]) => mime.startsWith('audio/')).concat([['video/mp4', '.m4a']])
);

export function mediaExt(mime, name) {
  const byMime = MIME_EXT[String(mime || '').toLowerCase()];
  if (byMime) return byMime;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? `.${m[1].toLowerCase()}` : '.bin';
}

export function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

export function notFound(res, message = 'not found') {
  return res.status(404).json({ error: message });
}
