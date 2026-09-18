// 家长端首页:按分组展示某一天的作业(可翻阅历史日期)+ 添加/编辑任务(文字为主,语音辅助)+ 分组配置入口。

import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  CONTENT_MAX_WIDTH,
  Empty,
  GroupHeader,
  Overlay,
  Screen,
  TopBar,
  TopBarAction,
  WeekNav,
} from '../ui';
import { colors, spacing } from '../theme';
import { useApp } from '../AppContext';
import { displayDate, todayStr } from '../dates';
import type { Subject, Task } from '../storage';
import { useSpeechRecognition } from '../speech';

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
    connected,
    addTask,
    editTask,
    removeTask,
    refreshTasks,
  } = useApp();
  const insets = useSafeAreaInsets();

  const [date, setDate] = useState(todayStr());
  const [addOpen, setAddOpen] = useState(false);
  const [presetSubjectId, setPresetSubjectId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);

  const tasks = tasksByDate[date] ?? [];
  const loading = !!loadingDates[date];

  // 用 ref 拿最新的 refreshTasks,避免把它的身份写进依赖(它会随数据变化而变,否则会无限刷新)
  const refreshRef = useRef(refreshTasks);
  refreshRef.current = refreshTasks;

  const changeDate = (next: string) => {
    setDate(next);
    refreshRef.current(next).catch(() => {});
  };

  const activeSubjects = useMemo(() => subjects.filter((s) => !s.archived), [subjects]);

  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const s of activeSubjects) map.set(s.id, []);
    for (const t of tasks) {
      const arr = map.get(t.subject_id);
      if (arr) arr.push(t);
      else map.set(t.subject_id, [t]);
    }
    return map;
  }, [activeSubjects, tasks]);

  // 分组内不再放小「+ 添加」按钮(底部的大按钮 + 弹层里选分组即可)
  const openAdd = () => {
    setPresetSubjectId(null);
    setAddOpen(true);
  };

  const isTodayDate = date === todayStr();

  return (
    // 根节点不加安全区 padding,弹层(Overlay)才能覆盖整个屏幕
    <View style={s.root}>
      <View style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
        {/* 大屏(横屏 iPad)下与列表保持同样的居中宽度 */}
        <View style={s.headerInner}>
        {/* 顶部栏:分组 / 设置 是唯一入口(底部不再重复一个「分组配置」) */}
        <View style={s.topbar}>
          <View style={{ flex: 1, paddingRight: spacing(1) }}>
            <Text style={s.topTitle} numberOfLines={1}>
              今日作业
            </Text>
            <Text style={s.topSub} numberOfLines={1}>
              家长端 · 房间 {identity?.roomCode ?? '-'}
            </Text>
          </View>
          <Pressable style={s.topBtn} onPress={onOpenSubjects}>
            <Text style={s.topBtnText}>分组</Text>
          </Pressable>
          <Pressable style={s.topBtn} onPress={onOpenSettings}>
            <Text style={s.topBtnText}>设置</Text>
          </Pressable>
        </View>
        {!connected && (
          <Text style={s.offline}>● 未连接同步服务,改动可能不同步到孩子设备</Text>
        )}

        {/* 周导航:家长端也能翻阅历史(和儿童端一致,不能翻到未来) */}
        <WeekNav
          date={date}
          onChange={changeDate}
          marks={(d) => (tasksByDate[d]?.length ?? 0) > 0}
        />
        </View>
      </View>

      {/* 顶部/底部栏已经各自让开了状态栏和手势条 */}
      <Screen edges={['left', 'right']}>
        {loading && tasks.length === 0 ? (
          <Empty text="加载中…" />
        ) : tasks.length === 0 ? (
          <Card>
            <Empty
              text={isTodayDate ? '今天还没有布置作业 🎈 点下方按钮添加' : `${displayDate(date)} 没有作业`}
            />
          </Card>
        ) : (
          activeSubjects.map((sub) => {
            const list = grouped.get(sub.id) ?? [];
            if (list.length === 0) return null;
            return (
              <View key={sub.id} style={{ marginBottom: spacing(1.5) }}>
                <GroupHeader name={sub.name} color={sub.color} count={list.length} />
                {list.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
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
          <Text style={s.totalHint}>
            共 {tasks.length} 条作业 · 孩子的 iPad 上会实时更新
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

      {/* 添加作业弹层:文字输入为主,可选语音转写辅助 */}
      <AddTaskModal
        visible={addOpen}
        subjects={activeSubjects}
        date={date}
        initial={presetSubjectId ? { subject_id: presetSubjectId, content: '' } : undefined}
        onClose={() => setAddOpen(false)}
        onSubmit={async (payload) => {
          await addTask(payload);
          setAddOpen(false);
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
    </View>
  );
}

/**
 * 家长端任务行:单行紧凑布局(内容 + 时间 + 编辑/删除 都在一行),
 * 不再重复显示分组名 —— 分组名已经在上面的分组标题里了。
 */
export function TaskRow({
  task,
  onEdit,
  onDelete,
  readOnly,
}: {
  task: Task;
  onEdit?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
}) {
  const d = new Date(task.created_at);
  const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

  return (
    <View style={s.taskRow}>
      <Text style={s.taskText} numberOfLines={1}>
        {task.content}
      </Text>
      {task.has_audio && <Text style={s.audioTag}>🎵</Text>}
      <Text style={s.timeText}>{time}</Text>
      {!readOnly && (
        <View style={s.taskActions}>
          <Pressable onPress={onEdit} hitSlop={10}>
            <Text style={s.editBtn}>编辑</Text>
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={10}>
            <Text style={s.delBtn}>删除</Text>
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
  onSubmit: (payload: { date: string; subject_id: string; content: string }) => Promise<void>;
}) {
  const [subjectId, setSubjectId] = useState<string>(initial?.subject_id || subjects[0]?.id || '');
  const [content, setContent] = useState(initial?.content ?? '');
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

  const canSubmit = !!subjectId && content.trim().length > 0 && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ date, subject_id: subjectId, content: content.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Overlay
      onRequestClose={onClose}
      bar={
        // 保存放在顶部栏:键盘弹起时也一定点得到(底部按钮可能被键盘盖住)
        <TopBar
          title={`${title} · ${displayDate(date)}`}
          left={<TopBarAction title="取消" tone="sub" onPress={onClose} />}
          right={<TopBarAction title="保存" onPress={submit} disabled={!canSubmit} />}
        />
      }>
      <Screen>
        <Card style={{ gap: spacing(2) }}>
          <Text style={s.label}>选择分组</Text>
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
                  <Text style={[s.chipText, active && { color: '#fff' }]}>{sub.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={s.label}>作业内容</Text>
          {/* 输入框放在页面靠上位置:键盘弹出也不会遮住 */}
          <TextInput
            style={[s.input, { minHeight: 100 }]}
            value={content}
            onChangeText={setContent}
            multiline
            placeholder="手动输入作业内容,例如:数学口算第 12 页 1~20 题"
            placeholderTextColor={colors.textSub}
          />

          {allowVoice && (
            <View style={s.voiceBox}>
              {speech.recognizing ? (
                <>
                  <Text style={s.voiceHint}>🎙️ 正在聆听…说完点「完成」,文字会追加到上面输入框</Text>
                  {!!speech.transcript && <Text style={s.voiceLive}>{speech.transcript}</Text>}
                  <Button title="完成" variant="soft" small onPress={speech.stop} style={{ alignSelf: 'center' }} />
                </>
              ) : (
                <Button title="🎤 说话转文字(可选)" variant="soft" onPress={startSpeech} />
              )}
              {speech.error && <Text style={s.error}>{speech.error}</Text>}
              <Text style={s.hint}>直接打字即可;语音只是辅助,识别结果保存前可任意修改。</Text>
            </View>
          )}

          {error && <Text style={s.error}>{error}</Text>}
          {busy && <Text style={s.hint}>保存中…</Text>}
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
  topBtns: { flexDirection: 'row', gap: spacing(1) },
  topBtn: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  topBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  offline: {
    color: colors.warn,
    fontSize: 12,
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(0.5),
  },
  // 单行任务行:高度压到最小,一屏能多看几条
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(0.8),
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    marginBottom: spacing(0.6),
  },
  taskText: { flex: 1, fontSize: 15, color: colors.text },
  audioTag: { fontSize: 12 },
  timeText: { fontSize: 11, color: colors.textSub },
  taskActions: { flexDirection: 'row', alignItems: 'center', gap: spacing(0.9) },
  editBtn: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  delBtn: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  totalHint: { textAlign: 'center', color: colors.textSub, fontSize: 12, marginTop: spacing(1) },
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
    padding: spacing(1.5),
    fontSize: 16,
    color: colors.text,
    backgroundColor: '#FBFCFE',
    textAlignVertical: 'top',
  },
  hint: { fontSize: 12, color: colors.textSub, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 13 },
});
