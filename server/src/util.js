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

export const AUDIO_MIME_EXT = {
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/x-m4a': '.m4a',
  'audio/m4a': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/ogg': '.ogg',
  'audio/webm': '.weba',
  'video/mp4': '.m4a', // 部分安卓录音以 video/mp4 上报
};

export function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

export function notFound(res, message = 'not found') {
  return res.status(404).json({ error: message });
}
