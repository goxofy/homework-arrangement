// 家长端首页:当日作业(按分组分区)+ 添加/编辑任务(文字为主,语音辅助转写)+ 分组配置入口。

import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Empty, Screen, SectionTitle } from '../ui';
import { colors, spacing, radius } from '../theme';
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

  const today = todayStr();
  const tasks = tasksByDate[today] ?? [];
  const loading = !!loadingDates[today];

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      {/* 顶部栏 */}
      <View style={s.topbar}>
        <View>
          <Text style={s.topTitle}>今日作业</Text>
          <Text style={s.topSub}>
            {displayDate(today)} · 房间 {identity?.roomCode ?? '-'}
          </Text>
        </View>
        <View style={s.topBtns}>
          <Pressable style={s.topBtn} onPress={onOpenSubjects}>
            <Text style={s.topBtnText}>分组</Text>
          </Pressable>
          <Pressable style={s.topBtn} onPress={onOpenSettings}>
            <Text style={s.topBtnText}>设置</Text>
          </Pressable>
        </View>
      </View>
      {!connected && (
        <Text style={s.offline}>● 未连接同步服务,改动可能不同步到孩子设备</Text>
      )}

      <Screen>
        {loading && tasks.length === 0 ? (
          <Empty text="加载中…" />
        ) : tasks.length === 0 ? (
          <Card>
            <Empty text="今天还没有布置作业 🎈 点下方按钮添加" />
          </Card>
        ) : (
          activeSubjects.map((sub) => {
            const list = grouped.get(sub.id) ?? [];
            if (list.length === 0) return null;
            return (
              <View key={sub.id} style={{ marginBottom: spacing(2) }}>
                <SectionTitle
                  right={
                    <Pressable onPress={() => setAddOpen(true)}>
                      <Text style={s.addInline}>+ 添加</Text>
                    </Pressable>
                  }>
                  <Text style={{ color: sub.color ?? colors.primary }}>● </Text>
                  {sub.name}
                  <Text style={s.countText}> ({list.length})</Text>
                </SectionTitle>
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
                          onPress: () => removeTask(t.id, today).catch(() => {}),
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
          <Text style={s.totalHint}>共 {tasks.length} 条作业 · 孩子的 iPad 上会实时更新</Text>
        )}
      </Screen>

      {/* 底部操作:文字添加为主 */}
      <View style={s.bottomBar}>
        <Button title="＋ 添加作业" onPress={() => setAddOpen(true)} style={{ flex: 1.4 }} />
        <Button title="分组配置" variant="ghost" onPress={onOpenSubjects} style={{ flex: 1 }} />
      </View>

      {/* 添加作业弹窗:文字输入为主,可选语音转写辅助 */}
      <AddTaskModal
        visible={addOpen}
        subjects={activeSubjects}
        date={today}
        onClose={() => setAddOpen(false)}
        onSubmit={async (payload) => {
          await addTask(payload);
          setAddOpen(false);
        }}
      />

      {/* 编辑作业弹窗(仅文字修改) */}
      <AddTaskModal
        visible={!!editing}
        subjects={activeSubjects}
        date={today}
        title="编辑作业"
        allowVoice={false}
        initial={editing ? { subject_id: editing.subject_id, content: editing.content } : undefined}
        onClose={() => setEditing(null)}
        onSubmit={async (payload) => {
          if (editing) {
            await editTask(editing.id, { content: payload.content, subject_id: payload.subject_id }, today);
          }
          setEditing(null);
        }}
      />
    </SafeAreaView>
  );
}

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
  return (
    <Card style={s.taskCard}>
      <View style={{ flex: 1 }}>
        <Text style={s.taskText}>{task.content}</Text>
        <View style={s.taskMetaRow}>
          {task.subject_name && (
            <View style={[s.tag, { backgroundColor: (task.subject_color ?? colors.primary) + '22' }]}>
              <Text style={[s.tagText, { color: task.subject_color ?? colors.primary }]}>
                {task.subject_name}
              </Text>
            </View>
          )}
          {task.has_audio && <Text style={s.audioTag}>🎵 语音</Text>}
          <Text style={s.timeText}>
            {new Date(task.created_at).getHours().toString().padStart(2, '0')}:
            {new Date(task.created_at).getMinutes().toString().padStart(2, '0')} 布置
          </Text>
        </View>
      </View>
      {!readOnly && (
        <View style={s.taskActions}>
          <Pressable onPress={onEdit} hitSlop={8}>
            <Text style={s.editBtn}>编辑</Text>
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={8}>
            <Text style={s.delBtn}>删除</Text>
          </Pressable>
        </View>
      )}
    </Card>
  );
}

/**
 * 添加/编辑作业弹窗:
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
  const [subjectId, setSubjectId] = useState<string>('');
  const [content, setContent] = useState('');
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={s.modalBar}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.modalClose}>取消</Text>
          </Pressable>
          <Text style={s.modalTitle}>
            {title} · {displayDate(date)}
          </Text>
          <View style={{ width: 40 }} />
        </View>

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
            <TextInput
              style={[s.input, { minHeight: 100 }]}
              value={content}
              onChangeText={setContent}
              multiline
              autoFocus={!allowVoice}
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
                <Text style={s.hint}>
                  直接打字即可;语音只是辅助,识别结果保存前可任意修改。
                </Text>
              </View>
            )}

            {error && <Text style={s.error}>{error}</Text>}

            <View style={{ flexDirection: 'row', gap: spacing(1.5) }}>
              <View style={{ flex: 1 }}>
                <Button title="保存作业" onPress={submit} disabled={!canSubmit} loading={busy} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="取消" variant="ghost" onPress={onClose} />
              </View>
            </View>
          </Card>
        </Screen>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    backgroundColor: colors.bg,
  },
  topTitle: { fontSize: 24, fontWeight: '800', color: colors.text },
  topSub: { fontSize: 13, color: colors.textSub, marginTop: 2 },
  topBtns: { flexDirection: 'row', gap: spacing(1) },
  topBtn: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.8),
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
    paddingBottom: spacing(1),
  },
  addInline: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  countText: { color: colors.textSub, fontSize: 13, fontWeight: '400' },
  taskCard: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginBottom: spacing(1) },
  taskText: { fontSize: 16, color: colors.text, lineHeight: 22 },
  taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1), marginTop: spacing(1) },
  tag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: 11, fontWeight: '700' },
  audioTag: { fontSize: 12, color: colors.primary },
  timeText: { fontSize: 11, color: colors.textSub },
  taskActions: { alignItems: 'flex-end', gap: spacing(1) },
  editBtn: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  delBtn: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  totalHint: { textAlign: 'center', color: colors.textSub, fontSize: 12, marginTop: spacing(1) },
  bottomBar: {
    flexDirection: 'row',
    gap: spacing(1.5),
    padding: spacing(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  modalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalClose: { color: colors.primary, fontSize: 16 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
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
