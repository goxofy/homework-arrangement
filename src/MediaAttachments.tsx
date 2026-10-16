// 作业附件(图片 / 音视频 / 文件)的通用 UI:
// - 家长端:选图片、录一段语音、选系统文件,以及待上传列表
// - 两端:展示附件(图片缩略图点开看大图、语音播放、历史视频播放、文件条目)
// - 新增上传暂不接受视频,但保留历史视频的展示兼容性
//
// 附件本体只存在服务器上 7 天(见 server/src/util.js),下载到本机后长期保留,
// 所以这里所有展示都优先用本机缓存(media.ts 的 useCachedMedia)。

import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { colors, spacing } from './theme';
import { useDisplay } from './display';
import { humanSize, localMediaUri, useCachedMedia } from './media';
import { useMediaViewer } from './media-viewer';
import { displayDate, localDateStr } from './dates';
import type { MediaKind, TaskMedia } from './storage';

/** 待上传的附件(还没进服务器) */
export interface PendingAttachment {
  /** 列表 key,同一批里唯一 */
  key: string;
  uri: string;
  mime: string;
  name: string;
  kind: MediaKind;
  /** 字节数(未知时省略) */
  size?: number;
}

export interface PickResult {
  items: PendingAttachment[];
  /** 被跳过的文件及原因(超大等),调用方提示用 */
  skipped: string[];
}

/** 与服务端 MEDIA_MAX_PER_TASK 保持一致 */
export const MAX_ATTACHMENTS_PER_TASK = 20;

function normalizeAttachmentLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_ATTACHMENTS_PER_TASK;
  return Math.max(0, Math.min(MAX_ATTACHMENTS_PER_TASK, Math.floor(limit)));
}

/** 与服务端 MEDIA_MAX_BYTES 保持一致,超了就不上传了,省得白等 */
const MAX_MB: Record<MediaKind, number> = { image: 12, audio: 25, video: 80, file: 25 };

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
};

function mimeFromName(name: string): string {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name || '')?.[1]?.toLowerCase();
  return (ext && EXT_MIME[ext]) || '';
}

/** 展示用文件名:没有原始文件名时按类型给个默认值 */
export function defaultName(kind: MediaKind, mime: string, fallbackName?: string | null): string {
  if (fallbackName) return fallbackName;
  const ext = mime.split('/')[1] || 'bin';
  const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'audio' ? '语音' : '文件';
  return `${label}.${ext === 'jpeg' ? 'jpg' : ext}`;
}

function kindOf(mime: string): MediaKind {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'file';
}

let seq = 0;
const nextKey = () => `att-${Date.now().toString(36)}-${seq++}`;

/** 待上传文件的暂存目录:安卓系统文件选择器给的是 content:// URI,先拷进来再上传 */
const STAGING_NAME = 'homework-upload';

function stagingDir(): Directory {
  const dir = new Directory(Paths.cache, STAGING_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** 统一的入口:file:// 直接用,content:// 先拷到本机暂存目录 */
async function stageIfNeeded(uri: string, name: string): Promise<string> {
  if (uri.startsWith('file://')) return uri;
  const safeName = name.replace(/[^\w.\-]/g, '_') || 'file';
  const dest = new File(stagingDir(), `${nextKey()}-${safeName}`);
  await new File(uri).copy(dest, { overwrite: true });
  return dest.uri;
}

/** 上传完成后清掉暂存文件(选完不传/放弃的情况靠系统清理缓存目录) */
export function resetUploadStaging(): void {
  try {
    const dir = new Directory(Paths.cache, STAGING_NAME);
    if (dir.exists) dir.delete();
  } catch {
    /* 清不掉也无所谓 */
  }
}

function oversizeMessage(kind: MediaKind, size?: number): string | null {
  if (!size) return null;
  const limit = MAX_MB[kind] * 1024 * 1024;
  return size > limit ? `超过 ${MAX_MB[kind]}MB` : null;
}

/** 尽量补齐系统选择器没返回的文件大小;读不到时仍由服务端做最终校验 */
function fileSizeOf(uri: string, reported?: number | null): number | undefined {
  if (reported && reported > 0) return reported;
  try {
    const size = new File(uri).size;
    return size > 0 ? size : undefined;
  } catch {
    return undefined;
  }
}

/** 从相册选图片(可多选,新增上传暂不接受视频) */
export async function pickLibraryMedia(
  limit = MAX_ATTACHMENTS_PER_TASK
): Promise<PickResult> {
  const selectionLimit = normalizeAttachmentLimit(limit);
  if (selectionLimit === 0) {
    return { items: [], skipped: [`每条作业最多 ${MAX_ATTACHMENTS_PER_TASK} 个附件`] };
  }

  // iOS 16+/新版 Android 使用系统照片选择器,无需申请整库访问权限。
  // Compatible 尽量把 HEIC 等格式转换为跨平台更容易显示的表示。
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit,
    orderedSelection: true,
    quality: 0.85,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    shouldDownloadFromNetwork: true,
  });
  if (res.canceled) return { items: [], skipped: [] };

  const items: PendingAttachment[] = [];
  const skipped: string[] = [];
  for (const asset of res.assets.slice(0, selectionLimit)) {
    const mime = asset.mimeType || mimeFromName(asset.fileName || asset.uri) || 'image/jpeg';
    const kind = kindOf(mime);
    const name = defaultName(kind, mime, asset.fileName);
    if (kind !== 'image') {
      skipped.push(`${name}(暂不支持上传视频)`);
      continue;
    }
    const size = fileSizeOf(asset.uri, asset.fileSize);
    const tooBig = oversizeMessage(kind, size);
    if (tooBig) {
      skipped.push(`${name}(${tooBig})`);
      continue;
    }
    items.push({ key: nextKey(), uri: asset.uri, mime, name, kind, size });
  }
  if (res.assets.length > selectionLimit) {
    skipped.push(`最多还能添加 ${selectionLimit} 个附件,其余图片未加入`);
  }
  return { items, skipped };
}

/** 从系统文件里选音频/PDF等文件;新增上传暂不接受视频 */
export async function pickSystemFiles(
  limit = MAX_ATTACHMENTS_PER_TASK
): Promise<PickResult> {
  const selectionLimit = normalizeAttachmentLimit(limit);
  if (selectionLimit === 0) {
    return { items: [], skipped: [`每条作业最多 ${MAX_ATTACHMENTS_PER_TASK} 个附件`] };
  }

  const res = await File.pickFileAsync({ multipleFiles: true });
  if (res.canceled) return { items: [], skipped: [] };

  const items: PendingAttachment[] = [];
  const skipped: string[] = [];
  for (const picked of res.result.slice(0, selectionLimit)) {
    const rawName = picked.name || 'file';
    const mime = picked.type || mimeFromName(rawName) || 'application/octet-stream';
    const kind = kindOf(mime);
    if (kind === 'video') {
      skipped.push(`${rawName}(暂不支持上传视频)`);
      continue;
    }

    // 安卓的文件选择器给的是 content:// URI,先拷进暂存目录;
    // 万一拷贝不支持(个别机型/网盘类文档),就直接拿原 URI 试上传。
    let uri = picked.uri;
    try {
      uri = await stageIfNeeded(picked.uri, rawName);
    } catch {
      /* 继续用原 URI */
    }
    const size = fileSizeOf(uri, picked.size);
    const tooBig = oversizeMessage(kind, size);
    if (tooBig) {
      skipped.push(`${rawName}(${tooBig})`);
      if (uri !== picked.uri) {
        try {
          new File(uri).delete();
        } catch {
          /* 暂存文件不存在就忽略 */
        }
      }
      continue;
    }
    items.push({ key: nextKey(), uri, mime, name: rawName, kind, size });
  }
  if (res.result.length > selectionLimit) {
    skipped.push(`最多还能添加 ${selectionLimit} 个附件,其余文件未加入`);
  }
  return { items, skipped };
}

/** 把 App 内录好的一段语音变成待上传附件 */
export function recordingToAttachment(uri: string, seconds: number, size?: number): PendingAttachment {
  const stamp = new Date();
  const hhmm = `${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}`;
  return {
    key: nextKey(),
    uri,
    mime: 'audio/m4a',
    name: `录音-${hhmm}-${Math.max(1, Math.round(seconds))}秒.m4a`,
    kind: 'audio',
    size: fileSizeOf(uri, size),
  };
}

// ---------- 录音 ----------

/** 「录一段语音」按钮:按下开始,再点结束,返回一个待上传附件 */
export function RecordAudioButton({ onPicked, disabled }: { onPicked: (a: PendingAttachment) => void; disabled?: boolean }) {
  const { fs } = useDisplay();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('需要麦克风权限', '请在系统设置里允许本应用使用麦克风,才能录语音讲解。');
        return;
      }
      // iOS 必须显式打开录音会话,否则录不到声音
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      Alert.alert('录音失败', '这台设备暂时无法录音,可以改用「选文件」上传音频文件。');
    }
  };

  const seconds = Math.floor((state.durationMillis ?? 0) / 1000);

  const stop = async () => {
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri ?? state.url;
      if (uri) onPicked(recordingToAttachment(uri, seconds));
    } catch {
      Alert.alert('录音失败', '没保存下这段录音,请重试。');
    } finally {
      // 录完把会话切回播放模式,否则喇叭音量可能很小
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      setBusy(false);
    }
  };

  return (
    <Pressable
      disabled={disabled || busy}
      onPress={state.isRecording ? stop : start}
      style={({ pressed }) => [
        s.pickBtn,
        state.isRecording && s.pickBtnRecording,
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}>
      <Text style={[s.pickBtnText, { fontSize: fs(13) }, state.isRecording && { color: '#fff' }]}>
        {state.isRecording ? `■ 结束录音 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '🎙 录一段'}
      </Text>
    </Pressable>
  );
}

// ---------- 添加附件的按钮组 ----------

/**
 * 三个入口:相册图片、App 内录音、系统文件。
 * 选好后统一回调 onItems,超限/失败的文件在这里提示,不打扰调用方。
 */
export function AttachButtons({
  onItems,
  disabled,
  remainingSlots = MAX_ATTACHMENTS_PER_TASK,
}: {
  onItems: (items: PendingAttachment[]) => void;
  disabled?: boolean;
  /** 这条作业还可以添加多少个附件 */
  remainingSlots?: number;
}) {
  const { fs } = useDisplay();
  const [busy, setBusy] = useState(false);
  const available = normalizeAttachmentLimit(remainingSlots);
  const unavailable = !!disabled || busy || available === 0;

  const report = (skipped: string[]) => {
    if (skipped.length > 0) {
      Alert.alert('有文件没能加入', skipped.join('\n'));
    }
  };

  const run = async (fn: () => Promise<PickResult>) => {
    if (unavailable) return;
    setBusy(true);
    try {
      const { items, skipped } = await fn();
      report(skipped);
      if (items.length > 0) onItems(items.slice(0, available));
    } catch {
      Alert.alert('打开失败', '系统选择器没能打开,请重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing(0.75) }}>
      <View style={s.pickRow}>
        <Pressable
          disabled={unavailable}
          onPress={() => run(() => pickLibraryMedia(available))}
          style={({ pressed }) => [s.pickBtn, unavailable && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
          <Text style={[s.pickBtnText, { fontSize: fs(13) }]}>🖼 选图片</Text>
        </Pressable>

        <RecordAudioButton disabled={unavailable} onPicked={(a) => onItems([a])} />

        <Pressable
          disabled={unavailable}
          onPress={() => run(() => pickSystemFiles(available))}
          style={({ pressed }) => [s.pickBtn, unavailable && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
          <Text style={[s.pickBtnText, { fontSize: fs(13) }]}>📄 选文件</Text>
        </Pressable>

        {busy && <ActivityIndicator size="small" color={colors.primary} />}
      </View>
      {available === 0 && (
        <Text style={[s.hint, { fontSize: fs(11) }]}>每条作业最多 {MAX_ATTACHMENTS_PER_TASK} 个附件</Text>
      )}
    </View>
  );
}

// ---------- 待上传列表(添加作业弹层里用) ----------

export function PendingAttachmentList({
  items,
  onRemove,
  uploadingIndex,
}: {
  items: PendingAttachment[];
  onRemove: (key: string) => void;
  /** 正在上传的下标(0 起),用来把那一行标成「上传中…」 */
  uploadingIndex?: number | null;
}) {
  const { fs } = useDisplay();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: spacing(0.75) }}>
      {items.map((a, index) => (
        <View key={a.key} style={s.pendingRow}>
          {a.kind === 'image' ? (
            <Image source={{ uri: a.uri }} style={s.pendingThumb} resizeMode="cover" />
          ) : (
            <View style={s.pendingIcon}>
              <Text style={{ fontSize: fs(16) }}>{kindIcon(a.kind)}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[s.pendingName, { fontSize: fs(13) }]} numberOfLines={1}>
              {a.name}
            </Text>
            <Text style={[s.pendingMeta, { fontSize: fs(11) }]}>
              {uploadingIndex === index
                ? '上传中…'
                : [kindLabel(a.kind), humanSize(a.size)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Pressable
            onPress={() => onRemove(a.key)}
            disabled={uploadingIndex != null}
            hitSlop={12}
            accessibilityLabel="移除附件">
            <Text style={[s.removeText, { fontSize: fs(16) }]}>✕</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

// ---------- 播放器 ----------

/** 语音播放(一行:播放/暂停 + 说明),儿童端详情弹层与家长端共用 */
export function AudioRow({ uri, label }: { uri: string; label?: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const { fs } = useDisplay();

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    const finished = status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.1);
    if (finished) player.seekTo(0).catch(() => {});
    player.play();
  };

  return (
    <Pressable style={s.audioRow} onPress={toggle} accessibilityRole="button">
      <View style={s.audioBtn}>
        <Text style={s.audioBtnIcon}>{status.playing ? '⏸' : '▶'}</Text>
      </View>
      <Text style={[s.audioRowText, { fontSize: fs(15) }]}>
        {status.playing ? '正在播放…' : (label ?? '播放语音讲解')}
      </Text>
    </Pressable>
  );
}

/** 语音播放小圆钮(列表行里用) */
export function AudioButton({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    const finished = status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.1);
    if (finished) player.seekTo(0).catch(() => {});
    player.play();
  };

  return (
    <Pressable
      style={s.audioBtn}
      onPress={toggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={status.playing ? '暂停语音' : '播放语音'}>
      <Text style={s.audioBtnIcon}>{status.playing ? '⏸' : '▶'}</Text>
    </Pressable>
  );
}

// ---------- 附件展示 ----------

function kindIcon(kind: MediaKind): string {
  return kind === 'image' ? '🖼' : kind === 'video' ? '🎬' : kind === 'audio' ? '🎵' : '📄';
}

function kindLabel(kind: MediaKind): string {
  return kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'audio' ? '语音' : '文件';
}

/**
 * 列表行里的附件角标:图片直接显示小缩略图,其余只显示图标。
 * 只要渲染出来就会触发下载(useCachedMedia),所以「孩子翻到这一天就已经存到本机了」。
 */
export function AttachmentBadges({ server, media }: { server: string; media: TaskMedia[] }) {
  const { fs } = useDisplay();
  if (media.length === 0) return null;

  const images = media.filter((m) => m.kind === 'image').slice(0, 2);
  const others = media.filter((m) => m.kind !== 'image');

  return (
    <View style={s.badgeRow}>
      {images.map((m) => (
        <BadgeThumb key={m.id} server={server} media={m} />
      ))}
      {others.map((m) => (
        <Text key={m.id} style={{ fontSize: fs(12) }}>
          {kindIcon(m.kind)}
        </Text>
      ))}
    </View>
  );
}

function BadgeThumb({ server, media }: { server: string; media: TaskMedia }) {
  const { uri } = useCachedMedia(server, media);
  return (
    <View style={s.badgeThumb}>
      {uri ? <Image source={{ uri }} style={s.badgeThumbImg} resizeMode="cover" /> : null}
    </View>
  );
}

/** 列表行里的「一键播放语音」:只有这一份语音附件已在本机时才出现(其余情况点进详情播) */
export function AudioQuickPlay({ server, media }: { server: string; media: TaskMedia }) {
  const { uri, state, retry } = useCachedMedia(server, media);
  if (state === 'ready' && uri) return <AudioButton uri={uri} />;
  // 还没下载到本机就先不占位(列表行里出现又消失比晚一点出现更傻)
  if (state === 'downloading' || state === 'idle') return null;
  return (
    <Pressable onPress={retry} hitSlop={8} accessibilityRole="button" accessibilityLabel="重新下载语音">
      <Text style={s.retryText}>🎵</Text>
    </Pressable>
  );
}

/**
 * 附件区(详情弹层里用):图片缩略图 + 语音/视频播放器 + 文件条目。
 * onDelete 传了就显示删除按钮(家长端)。
 */
export function AttachmentStrip({
  server,
  media,
  onDelete,
}: {
  server: string;
  media: TaskMedia[];
  onDelete?: (media: TaskMedia) => void;
}) {
  const { fs, vs } = useDisplay();
  if (media.length === 0) return null;

  const images = media.filter((m) => m.kind === 'image');
  const players = media.filter((m) => m.kind === 'audio' || m.kind === 'video');
  const files = media.filter((m) => m.kind === 'file');
  // 最近一份还在服务器上的附件什么时候被删(家长最关心这个)
  const nextExpiry = media.filter((m) => !m.expired).map((m) => m.expires_at).sort((a, b) => a - b)[0];

  return (
    <View style={{ gap: vs(10) }}>
      {images.length > 0 && (
        <View style={s.thumbWrap}>
          {images.map((m) => (
            <ImageThumb key={m.id} server={server} media={m} onDelete={onDelete} />
          ))}
        </View>
      )}
      {players.map((m) => (
        <MediaPlayerRow key={m.id} server={server} media={m} onDelete={onDelete} />
      ))}
      {files.map((m) => (
        <FileRow key={m.id} server={server} media={m} onDelete={onDelete} />
      ))}
      {/* 家长端看得到过期时间,孩子那边只看内容 */}
      {!!onDelete && (
        <Text style={[s.hint, { fontSize: fs(11) }]}>
          {nextExpiry
            ? `服务器上的附件保留至 ${displayDate(localDateStr(new Date(nextExpiry)))} 然后自动删除;`
            : '服务器上的附件都已到期删除;'}
          孩子在有效期内打开过这一天,就已经存到 iPad 上长期保存了。
        </Text>
      )}
    </View>
  );
}

/** 删除按钮(家长端) */
function RemoveBadge({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={s.removeBadge} accessibilityLabel="删除附件">
      <Text style={s.removeBadgeText}>✕</Text>
    </Pressable>
  );
}

function ImageThumb({
  server,
  media,
  onDelete,
}: {
  server: string;
  media: TaskMedia;
  onDelete?: (media: TaskMedia) => void;
}) {
  const { fs } = useDisplay();
  const { uri, state, retry } = useCachedMedia(server, media);
  const viewer = useMediaViewer();

  const box = (
    <View style={s.thumb}>
      {state === 'ready' && uri ? (
        <Image source={{ uri }} style={s.thumbImg} resizeMode="cover" />
      ) : state === 'downloading' ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Text style={[s.thumbPlaceholder, { fontSize: fs(10) }]}>
          {state === 'expired' ? '已过期' : state === 'error' ? '点此重试' : '…'}
        </Text>
      )}
    </View>
  );

  return (
    <View>
      <Pressable
        onPress={() => {
          if (state === 'ready' && uri) viewer.openImage(uri, media.name ?? undefined);
          else if (state === 'error') retry();
        }}
        accessibilityRole="button"
        accessibilityLabel={state === 'ready' ? '查看大图' : '重试下载'}>
        {box}
      </Pressable>
      {!!onDelete && <RemoveBadge onPress={() => onDelete(media)} />}
    </View>
  );
}

function MediaPlayerRow({
  server,
  media,
  onDelete,
}: {
  server: string;
  media: TaskMedia;
  onDelete?: (media: TaskMedia) => void;
}) {
  const { fs } = useDisplay();
  const { uri, state, retry } = useCachedMedia(server, media);
  const viewer = useMediaViewer();
  const label = media.name ?? kindLabel(media.kind);
  const isVideo = media.kind === 'video';

  return (
    <View style={s.playerRow}>
      {state === 'ready' && uri ? (
        isVideo ? (
          <Pressable
            style={{ flex: 1 }}
            onPress={() => viewer.openVideo(uri, media.name ?? undefined)}
            accessibilityRole="button">
            <View style={s.videoRow}>
              <View style={s.audioBtn}>
                <Text style={s.audioBtnIcon}>▶</Text>
              </View>
              <Text style={[s.audioRowText, { fontSize: fs(15) }]} numberOfLines={1}>
                {label}
              </Text>
              <Text style={[s.metaText, { fontSize: fs(11) }]}>点开看视频</Text>
            </View>
          </Pressable>
        ) : (
          <View style={{ flex: 1 }}>
            <AudioRow uri={uri} label={label} />
          </View>
        )
      ) : (
        <Pressable
          style={{ flex: 1 }}
          onPress={state === 'error' ? retry : undefined}
          disabled={state !== 'error'}
          accessibilityRole="button">
          <View style={s.videoRow}>
            <View style={[s.audioBtn, s.audioBtnMuted]}>
              {state === 'downloading' ? (
                <ActivityIndicator size="small" color={colors.primaryDark} />
              ) : (
                <Text style={s.audioBtnIcon}>{kindIcon(media.kind)}</Text>
              )}
            </View>
            <Text style={[s.audioRowText, { fontSize: fs(15), color: colors.textSub }]} numberOfLines={1}>
              {state === 'expired'
                ? `${label}(服务器已删除)`
                : state === 'error'
                  ? `${label} · 下载失败,点此重试`
                  : `${label} · 下载中…`}
            </Text>
          </View>
        </Pressable>
      )}
      {!!onDelete && <RemoveBadge onPress={() => onDelete(media)} />}
    </View>
  );
}

function FileRow({
  server,
  media,
  onDelete,
}: {
  server: string;
  media: TaskMedia;
  onDelete?: (media: TaskMedia) => void;
}) {
  const { fs } = useDisplay();
  const { state, retry } = useCachedMedia(server, media);
  const local = localMediaUri(media);

  const statusText =
    local != null
      ? '已保存到本机'
      : state === 'expired'
        ? '服务器已删除'
        : state === 'error'
          ? '下载失败,点此重试'
          : state === 'downloading'
            ? '下载中…'
            : '未下载';

  return (
    <View style={s.fileRow}>
      <Pressable
        style={{ flex: 1 }}
        onPress={state === 'error' ? retry : undefined}
        disabled={state !== 'error'}
        accessibilityRole="button">
        <View style={s.fileRowInner}>
          <Text style={{ fontSize: fs(18) }}>📄</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.pendingName, { fontSize: fs(14) }]} numberOfLines={1}>
              {media.name ?? '文件'}
            </Text>
            <Text style={[s.pendingMeta, { fontSize: fs(11) }]}>
              {[humanSize(media.size), statusText].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      </Pressable>
      {!!onDelete && <RemoveBadge onPress={() => onDelete(media)} />}
    </View>
  );
}

const s = StyleSheet.create({
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing(1) },
  pickBtn: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.9),
  },
  pickBtnRecording: { backgroundColor: colors.danger, borderColor: colors.danger },
  pickBtnText: { color: colors.primaryDark, fontWeight: '700' },

  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    backgroundColor: '#FBFCFE',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing(1),
  },
  pendingThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.border },
  pendingIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  pendingName: { color: colors.text, fontWeight: '600' },
  pendingMeta: { color: colors.textSub, marginTop: 2 },
  removeText: { color: colors.textSub, paddingHorizontal: spacing(0.5) },

  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  audioRowText: { color: colors.primaryDark, fontWeight: '600', flexShrink: 1 },
  audioBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  audioBtnMuted: { backgroundColor: colors.border },
  audioBtnIcon: { color: colors.primaryDark, fontSize: 14, fontWeight: '700' },

  playerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },

  thumbWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1) },
  thumb: {
    width: 96,
    height: 96,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF0F6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbPlaceholder: { color: colors.textSub, textAlign: 'center' },
  removeBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.card,
  },
  removeBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  fileRowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(0.6) },
  badgeThumb: {
    width: 26,
    height: 26,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#EEF0F6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  badgeThumbImg: { width: '100%', height: '100%' },
  metaText: { color: colors.textSub },
  retryText: { fontSize: 15 },
  hint: { color: colors.textSub, lineHeight: 16 },
});
