// 家长端首页:按分组展示某一天的作业(可翻阅历史日期)+ 添加/编辑任务(文字为主,语音辅助)+ 分组配置入口。

import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AttachmentBadges,
  AttachButtons,
  MAX_ATTACHMENTS_PER_TASK,
  PendingAttachmentList,
  resetUploadStaging,
  type PendingAttachment,
} from '../MediaAttachments';
import {
  Button,
  Card,
  CONTENT_MAX_WIDTH,
  DoneCircle,
  Empty,
  ErrorBar,
  GroupHeader,
  Overlay,
  Screen,
  TopBar,
  SyncToast,
  TopBarAction,
  WeekNav,
} from '../ui';
import { colors, spacing } from '../theme';
import { useDisplay } from '../display';
import { useApp } from '../AppContext';
import { displayDate, formatTime, todayStr } from '../dates';
import { TaskDetail } from '../TaskDetail';
import { groupTasksBySubject } from '../task-groups';
import type { Subject, Task, TaskMedia } from '../storage';
import { useSpeechRecognition } from '../speech';

/** 内容超过这个长度就在任务行末尾显示一个「›」,提示可以点开看全文 */
const LONG_CONTENT_HINT = 18;

export default function ParentHomeScreen({
  onOpenSubjects,
  onOpenSettings,
}: {
  onOpenSubjects: () => void;
  onOpenSettings: () => void;
}) {
  const {
    identity,
    subjects,
    tasksByDate,
    loadingDates,
    taskErrorsByDate,
    connected,
    addTask,
    uploadTaskMedia,
    removeTaskMedia,
    editTask,
    removeTask,
    setTaskDone,
    refreshTasks,
  } = useApp();
  const insets = useSafeAreaInsets();
  const { fs, vs, lh } = useDisplay();

  const [date, setDate] = useState(todayStr());
  const [addOpen, setAddOpen] = useState(false);
  const [presetSubjectId, setPresetSubjectId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  // 详情弹层:task 留着不置空,这样关闭时退场动画期间内容还在,不会闪空
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // 详情里补传附件时的进行状态
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const openDetail = (t: Task) => {
    setDetailTask(t);
    setDetailOpen(true);
  };

  const tasks = tasksByDate[date] ?? [];
  // 详情弹层里的 task 要跟着列表一起更新(补了附件、别处改了内容)
  const liveDetailTask = detailTask ? (tasks.find((t) => t.id === detailTask.id) ?? detailTask) : null;
  const loading = !!loadingDates[date];
  const taskError = taskErrorsByDate[date];
  const doneCount = tasks.filter((t) => t.done).length;

  // 用 ref 拿最新的 refreshTasks,避免把它的身份写进依赖(它会随数据变化而变,否则会无限刷新)
  const refreshRef = useRef(refreshTasks);
  refreshRef.current = refreshTasks;

  const changeDate = (next: string) => {
    setDate(next);
    refreshRef.current(next).catch(() => {});
  };

  const activeSubjects = useMemo(() => subjects.filter((s) => !s.archived), [subjects]);

  const grouped = useMemo(() => groupTasksBySubject(subjects, tasks), [subjects, tasks]);

  const subjectNameOf = (task: Task) =>
    subjects.find((subject) => subject.id === task.subject_id)?.name ?? task.subject_name ?? '其他';

  const openAdd = () => {
    setPresetSubjectId(null);
    setAddOpen(true);
  };

  const isTodayDate = date === todayStr();

  // 详情里点「编辑」:关掉详情再开编辑弹层
  const openEditFromDetail = (task: Task) => {
    setDetailOpen(false);
    setEditing(task);
  };

  /** 详情里补附件:选完立刻上传(失败只提示,已上传的不受影响) */
  const addMediaToTask = (items: PendingAttachment[]) => {
    const target = liveDetailTask;
    if (!target) return;
    setUploadingMedia(true);
    uploadTaskMedia(target.id, date, items)
      .then((failed) => {
        resetUploadStaging();
        if (failed.length > 0) {
          Alert.alert(
            '部分附件没能上传',
            `${failed.map((f) => `${f.name}:${f.reason}`).join('\n')}\n\n可以稍后在详情里重新添加。`
          );
        }
      })
      .catch(() => Alert.alert('上传失败', '网络或服务器不可用,请稍后重试。'))
      .finally(() => setUploadingMedia(false));
  };

  const deleteMediaFromTask = (media: TaskMedia) => {
    Alert.alert('删除附件', `确定删除「${media.name ?? '该附件'}」吗?`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => removeTaskMedia(media, date).catch(() => {}) },
    ]);
  };

  return (
    // 根节点不加安全区 padding,弹层(Overlay)才能覆盖整个屏幕
    <View style={s.root}>
      <View style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
        {/* 大屏(横屏 iPad)下与列表保持同样的居中宽度 */}
        <View style={s.headerInner}>
          {/* 顶部栏:分组 / 设置 是唯一入口(底部不再重复一个「分组配置」) */}
          <View style={s.topbar}>
            <View style={{ flex: 1, paddingRight: spacing(1) }}>
              <Text style={[s.topTitle, { fontSize: fs(24) }]} numberOfLines={1}>
                今日作业
              </Text>
              <Text style={[s.topSub, { fontSize: fs(13) }]} numberOfLines={1}>
                家长端 · 房间 {identity?.roomCode ?? '-'}
              </Text>
            </View>
            <Pressable style={s.topBtn} onPress={onOpenSubjects}>
              <Text style={[s.topBtnText, { fontSize: fs(14) }]}>分组</Text>
            </Pressable>
            <Pressable style={s.topBtn} onPress={onOpenSettings}>
              <Text style={[s.topBtnText, { fontSize: fs(14) }]}>设置</Text>
            </Pressable>
          </View>
          {/* 周导航:家长和儿童都能查看历史与未来日期 */}
          <WeekNav date={date} onChange={changeDate} marks={(d) => (tasksByDate[d]?.length ?? 0) > 0} />
        </View>
      </View>

      {/* 顶部/底部栏已经各自让开了状态栏和手势条 */}
      <Screen edges={['left', 'right']}>
        {taskError && (
          <ErrorBar
            message={tasks.length > 0 ? `${taskError},当前显示上次内容` : taskError}
            onRetry={() => refreshRef.current(date).catch(() => {})}
          />
        )}
        {loading && tasks.length === 0 ? (
          <Empty text="加载中…" />
        ) : taskError && tasks.length === 0 ? null : tasks.length === 0 ? (
          <Card>
            <Empty
              text={isTodayDate ? '今天还没有布置作业 🎈 点下方按钮添加' : `${displayDate(date)} 没有作业`}
            />
          </Card>
        ) : (
          grouped.map((group) => {
            const list = group.tasks;
            return (
              <View key={group.id} style={{ marginBottom: vs(12) }}>
                <GroupHeader
                  name={group.name}
                  color={group.color}
                  count={list.length}
                  doneCount={list.filter((t) => t.done).length}
                  right={
                    group.archived ? <Text style={[s.archivedTag, { fontSize: fs(11) }]}>已归档</Text> : undefined
                  }
                />
                {list.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    server={identity?.server ?? ''}
                    onOpen={() => openDetail(t)}
                    onToggle={() => setTaskDone(t.id, !t.done, date).catch(() => {})}
                    onEdit={() => setEditing(t)}
                    onDelete={() =>
                      Alert.alert('删除任务', '确定删除这条作业吗?', [
                        { text: '取消', style: 'cancel' },
                        {
                          text: '删除',
                          style: 'destructive',
                          onPress: () => removeTask(t.id, date).catch(() => {}),
                        },
                      ])
                    }
                  />
                ))}
              </View>
            );
          })
        )}
        {tasks.length > 0 && (
          <Text style={[s.totalHint, { fontSize: fs(12) }]}>
            共 {tasks.length} 条作业
            {doneCount > 0 ? ` · 已完成 ${doneCount}` : ''} · 孩子的 iPad 上会实时更新
          </Text>
        )}
      </Screen>

      {/* 底部操作:文字添加为主 */}
      <View
        style={[
          s.bottomBar,
          {
            paddingBottom: spacing(2) + insets.bottom,
            paddingLeft: spacing(2) + insets.left,
            paddingRight: spacing(2) + insets.right,
          },
        ]}>
        <Button title="＋ 添加作业" onPress={() => openAdd()} style={{ flex: 1 }} />
      </View>

      {/* 添加作业弹层:文字输入为主,可选语音转写辅助 + 附图/录音/文件 */}
      <AddTaskModal
        visible={addOpen}
        subjects={activeSubjects}
        date={date}
        initial={presetSubjectId ? { subject_id: presetSubjectId, content: '' } : undefined}
        onClose={() => setAddOpen(false)}
        onSubmit={async (payload, onProgress) => {
          const { failed } = await addTask(payload, onProgress);
          resetUploadStaging();
          setAddOpen(false);
          if (failed.length > 0) {
            Alert.alert(
              '作业已保存,但有附件没传上去',
              `${failed.map((f) => `${f.name}:${f.reason}`).join('\n')}\n\n可以在作业详情里重新添加。`
            );
          }
        }}
      />

      {/* 编辑作业弹层(仅文字修改) */}
      <AddTaskModal
        visible={!!editing}
        subjects={activeSubjects}
        date={date}
        title="编辑作业"
        allowVoice={false}
        initial={editing ? { subject_id: editing.subject_id, content: editing.content } : undefined}
        onClose={() => setEditing(null)}
        onSubmit={async (payload) => {
          if (editing) {
            await editTask(editing.id, { content: payload.content, subject_id: payload.subject_id }, date);
          }
          setEditing(null);
        }}
      />

      {/* 断网提示:顶部居中悬浮,不占布局(原来那行会把页面整体顶下去一行) */}
      <SyncToast visible={!connected} text="未连接同步服务 · 改动可能不同步到孩子设备" />

      {/* 详情弹层:点任务文字进来,看完整内容 / 附件 / 勾选完成 / 编辑 / 删除 */}
      {liveDetailTask && (
        <TaskDetail
          task={liveDetailTask}
          visible={detailOpen}
          subjectName={subjectNameOf(liveDetailTask)}
          subjectColor={liveDetailTask.subject_color}
          date={date}
          server={identity?.server ?? ''}
          onClose={() => setDetailOpen(false)}
          onEdit={() => openEditFromDetail(liveDetailTask)}
          onDelete={() => removeTask(liveDetailTask.id, date).catch(() => {})}
          onAddMedia={addMediaToTask}
          onDeleteMedia={deleteMediaFromTask}
          uploadingMedia={uploadingMedia}
        />
      )}
    </View>
  );
}

/**
 * 家长端任务行:单行紧凑布局。
 * 左侧勾选圈(完成删除线)、中间内容(点开看全文)、右侧时间与编辑/删除。
 */
export function TaskRow({
  task,
  server = '',
  onOpen,
  onToggle,
  onEdit,
  onDelete,
  readOnly,
}: {
  task: Task;
  /** 服务器地址:列表里显示附件缩略图要用 */
  server?: string;
  onOpen?: () => void;
  onToggle?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
}) {
  const { fs, vs } = useDisplay();
  const long = task.content.length > LONG_CONTENT_HINT;
  const media = task.media ?? [];

  return (
    <View
      style={[
        s.taskRow,
        { paddingVertical: vs(8), marginBottom: vs(5) },
        task.done && { backgroundColor: '#FAFBFD' },
      ]}>
      <DoneCircle done={task.done} onPress={onToggle ?? (() => {})} />
      <Pressable style={s.taskTextWrap} onPress={onOpen} hitSlop={6}>
        <Text
          style={[
            s.taskText,
            { fontSize: fs(15) },
            task.done && { color: colors.textSub, textDecorationLine: 'line-through' },
          ]}
          numberOfLines={1}>
          {task.content}
        </Text>
      </Pressable>
      {long && <Text style={[s.moreHint, { fontSize: fs(13) }]}>›</Text>}
      {media.length > 0 && !!server && <AttachmentBadges server={server} media={media} />}
      {media.length === 0 && task.has_audio && <Text style={{ fontSize: fs(12) }}>🎵</Text>}
      <Text style={[s.timeText, { fontSize: fs(11) }]}>{formatTime(task.created_at)}</Text>
      {!readOnly && (
        <View style={s.taskActions}>
          <Pressable onPress={onEdit} hitSlop={10}>
            <Text style={[s.editBtn, { fontSize: fs(13) }]}>编辑</Text>
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={10}>
            <Text style={[s.delBtn, { fontSize: fs(13) }]}>删除</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * 添加/编辑作业弹层:
 * - 文字输入是主入口,始终可编辑
 * - 语音是辅助:点麦克风开始识别,识别出的文字会追加到输入框,可继续手动修改
 */
export function AddTaskModal({
  visible,
  subjects,
  date,
  initial,
  title = '添加作业',
  allowVoice = true,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  subjects: Subject[];
  date: string;
  initial?: { subject_id: string; content: string };
  title?: string;
  allowVoice?: boolean;
  onClose: () => void;
  onSubmit: (
    payload: { date: string; subject_id: string; content: string; files: PendingAttachment[] },
    onProgress: (index: number, total: number, name: string) => void
  ) => Promise<void>;
}) {
  const { fs, lh } = useDisplay();
  const [subjectId, setSubjectId] = useState<string>(initial?.subject_id || subjects[0]?.id || '');
  const [content, setContent] = useState(initial?.content ?? '');
  // 附图/录音/文件:选好先列在这里,保存时跟着作业一起上传
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState<{ index: number; total: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 本次识别开始前的已有文字,最终转写会追加在它后面
  const baseContentRef = useRef('');

  const speech = useSpeechRecognition({
    onFinal: (t) => {
      // 只用「已有文字 + 本次转写」覆盖,避免覆盖用户中途的手动编辑
      setContent(((baseContentRef.current + ' ' + t).trim()) || t);
    },
  });

  React.useEffect(() => {
    if (visible) {
      setSubjectId(initial?.subject_id || subjects[0]?.id || '');
      setContent(initial?.content ?? '');
      setAttachments([]);
      setUploading(null);
      setError(null);
      baseContentRef.current = initial?.content ?? '';
    } else if (speech.recognizing) {
      speech.cancel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, subjects.length, initial?.subject_id, initial?.content]);

  const startSpeech = () => {
    baseContentRef.current = content;
    speech.start().catch(() => {});
  };

  // 关闭时一定要停掉麦克风,否则会一直占用录音
  React.useEffect(() => () => speech.cancel(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (busy) return;
    resetUploadStaging();
    if (speech.recognizing) speech.cancel();
    onClose();
  };

  const canSubmit = !!subjectId && content.trim().length > 0 && !busy;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(
        { date, subject_id: subjectId, content: content.trim(), files: allowVoice ? attachments : [] },
        (index, total, name) => setUploading({ index, total, name })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败,请重试');
    } finally {
      setUploading(null);
      setBusy(false);
    }
  };

  return (
    // 常驻渲染 + visible:关闭时先播退场动画,所以这里不能提前 return null
    <Overlay
      visible={visible}
      onRequestClose={close}
      bar={
        // 保存放在顶部栏:键盘弹起时也一定点得到(底部按钮可能被键盘盖住)
        // flat:与首页同色,避免顶部白条和下面浅灰内容之间出现割裂的色带
        <TopBar
          flat
          title={`${title} · ${displayDate(date)}`}
          left={<TopBarAction title="取消" tone="sub" onPress={close} disabled={busy} />}
          right={<TopBarAction title="保存" onPress={submit} disabled={!canSubmit} />}
        />
      }>
      <Screen>
        <Card style={{ gap: spacing(2) }}>
          <Text style={[s.label, { fontSize: fs(14) }]}>选择分组</Text>
          <View style={s.chipWrap}>
            {subjects.map((sub) => {
              const active = sub.id === subjectId;
              return (
                <Pressable
                  key={sub.id}
                  onPress={() => setSubjectId(sub.id)}
                  style={[
                    s.chip,
                    active && {
                      backgroundColor: sub.color ?? colors.primary,
                      borderColor: sub.color ?? colors.primary,
                    },
                  ]}>
                  <Text style={[s.chipText, { fontSize: fs(14) }, active && { color: '#fff' }]}>
                    {sub.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[s.label, { fontSize: fs(14) }]}>作业内容</Text>
          {/* 输入框放在页面靠上位置:键盘弹出也不会遮住;高度给足,长作业不用边写边滚 */}
          <TextInput
            style={[s.input, { minHeight: 132, fontSize: fs(16) }]}
            value={content}
            onChangeText={setContent}
            multiline
            placeholder="手动输入作业内容,例如:数学口算第 12 页 1~20 题"
            placeholderTextColor={colors.textSub}
          />

          {allowVoice && (
            <>
              <Text style={[s.label, { fontSize: fs(14) }]}>图片 / 录音 / 文件(可选)</Text>
              <AttachButtons
                disabled={busy}
                remainingSlots={MAX_ATTACHMENTS_PER_TASK - attachments.length}
                onItems={(items) =>
                  setAttachments((prev) => [...prev, ...items].slice(0, MAX_ATTACHMENTS_PER_TASK))
                }
              />
              <PendingAttachmentList
                items={attachments}
                onRemove={(key) => setAttachments((prev) => prev.filter((a) => a.key !== key))}
                uploadingIndex={busy && uploading && uploading.index < attachments.length ? uploading.index : null}
              />
              {attachments.length > 0 && (
                <Text style={[s.hint, { fontSize: fs(11) }]}>
                  附件会上传到你的服务器暂存(最多 7 天);孩子在有效期内打开这一天,就会自动下载到 iPad
                  上长期保存。新增上传暂不支持视频。
                </Text>
              )}
            </>
          )}

          {allowVoice && (
            <View style={s.voiceBox}>
              {speech.recognizing ? (
                <>
                  <Text style={[s.voiceHint, { fontSize: fs(13) }]}>
                    🎙️ 正在聆听…说完点「完成」,文字会追加到上面输入框
                  </Text>
                  {!!speech.transcript && (
                    <Text style={[s.voiceLive, { fontSize: fs(14), lineHeight: lh(14) }]}>
                      {speech.transcript}
                    </Text>
                  )}
                  <Button title="完成" variant="soft" small onPress={speech.stop} style={{ alignSelf: 'center' }} />
                </>
              ) : (
                <Button title="🎤 说话转文字(可选)" variant="soft" onPress={startSpeech} />
              )}
              {speech.error && <Text style={s.error}>{speech.error}</Text>}
              <Text style={[s.hint, { fontSize: fs(12) }]}>
                直接打字即可;语音只是辅助,识别结果保存前可任意修改。
              </Text>
            </View>
          )}

          {error && <Text style={s.error}>{error}</Text>}
          {busy && (
            <Text style={s.hint}>
              {uploading && uploading.index < uploading.total
                ? `保存并上传附件 ${uploading.index + 1}/${uploading.total}${uploading.name ? `·${uploading.name}` : ''}…`
                : '保存中…'}
            </Text>
          )}
        </Card>
      </Screen>
    </Overlay>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerInner: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(2),
    paddingTop: spacing(1.5),
    paddingBottom: spacing(1),
    gap: spacing(1),
  },
  topTitle: { fontSize: 24, fontWeight: '800', color: colors.text },
  topSub: { fontSize: 13, color: colors.textSub, marginTop: 2 },
  topBtn: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  topBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  // 单行任务行:高度压到最小,一屏能多看几条
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(0.9),
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing(1.5),
  },
  taskTextWrap: { flex: 1 },
  taskText: { fontSize: 15, color: colors.text },
  moreHint: { color: colors.textSub },
  audioTag: { fontSize: 12 },
  timeText: { fontSize: 11, color: colors.textSub },
  taskActions: { flexDirection: 'row', alignItems: 'center', gap: spacing(0.9) },
  editBtn: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  delBtn: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  archivedTag: { color: colors.textSub, fontWeight: '600' },
  totalHint: { textAlign: 'center', color: colors.textSub, marginTop: spacing(1) },
  bottomBar: {
    paddingTop: spacing(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1) },
  chip: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.7),
    backgroundColor: colors.card,
  },
  chipText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  voiceBox: { gap: spacing(1.2), alignItems: 'stretch' },
  voiceHint: { textAlign: 'center', color: colors.textSub, fontSize: 13 },
  voiceLive: {
    textAlign: 'center',
    color: colors.primaryDark,
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    padding: spacing(1),
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing(1.75),
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
    backgroundColor: '#FBFCFE',
    textAlignVertical: 'top',
  },
  hint: { fontSize: 12, color: colors.textSub, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 13 },
});
