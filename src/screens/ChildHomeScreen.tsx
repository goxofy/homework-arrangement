// 儿童端首页(iPad 为主):当日作业大字显示、语音播放、历史日期回查(只读布置,但可勾选完成)。

import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Card, CONTENT_MAX_WIDTH, DoneCircle, Empty, GroupHeader, Screen, WeekNav } from '../ui';
import { colors, spacing } from '../theme';
import { useDisplay } from '../display';
import { useApp } from '../AppContext';
import { displayDate, isToday, todayStr } from '../dates';
import { TaskDetail } from '../TaskDetail';
import type { Subject, Task } from '../storage';
import SettingsScreen from './SettingsScreen';

/** 内容超过这个长度就在任务行末尾显示一个「›」,提示可以点开看全文 */
const LONG_CONTENT_HINT = 18;

export default function ChildHomeScreen() {
  const {
    identity,
    subjects,
    tasksByDate,
    loadingDates,
    connected,
    setTaskDone,
    refreshTasks,
    updateIdentity,
    signOut,
  } = useApp();
  const insets = useSafeAreaInsets();
  const { fs, vs } = useDisplay();

  const [date, setDate] = useState(todayStr());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailOf, setDetailOf] = useState<Task | null>(null);

  const tasks = tasksByDate[date] ?? [];
  const loading = !!loadingDates[date];

  // 避免把 refreshTasks 的身份写进依赖(它会随数据变化而变)
  const refreshRef = useRef(refreshTasks);
  refreshRef.current = refreshTasks;

  const changeDate = (next: string) => {
    setDate(next);
    refreshRef.current(next).catch(() => {});
  };

  const grouped = useMemo(() => {
    const map: { subject: Subject; tasks: Task[] }[] = [];
    const active = subjects.filter((s) => !s.archived);
    for (const s of active) {
      const list = tasks.filter((t) => t.subject_id === s.id);
      if (list.length > 0) map.push({ subject: s, tasks: list });
    }
    // 有任务但分组被归档的,挂在「其他」区域
    const activeIds = new Set(active.map((s) => s.id));
    const orphans = tasks.filter((t) => !activeIds.has(t.subject_id));
    if (orphans.length > 0) {
      map.push({
        subject: { id: '__other', name: '其他', color: '#F59E0B', sort_order: 99, archived: 0 },
        tasks: orphans,
      });
    }
    return map;
  }, [subjects, tasks]);

  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.done).length;

  const subjectNameOf = (t: Task) =>
    subjects.find((s) => s.id === t.subject_id)?.name ?? t.subject_name ?? '其他';

  return (
    // 根节点不加安全区 padding,设置弹层才能覆盖整个屏幕
    <View style={s.root}>
      <View style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
        {/* 大屏(横屏 iPad)下与列表保持同样的居中宽度 */}
        <View style={s.headerInner}>
          <View style={s.topbar}>
            <View style={{ flex: 1, paddingRight: spacing(1) }}>
              <Text style={[s.topTitle, { fontSize: fs(24) }]} numberOfLines={1}>
                今日作业
              </Text>
              <Text style={[s.topSub, { fontSize: fs(13) }]} numberOfLines={1}>
                儿童端 · 房间 {identity?.roomCode ?? '-'}
              </Text>
            </View>
            {/* 设置:带文字的按钮,离屏幕边缘留出安全区,不再是贴边的小齿轮 */}
            <Pressable style={s.topBtn} onPress={() => setSettingsOpen(true)}>
              <Text style={[s.topBtnText, { fontSize: fs(15) }]}>设置</Text>
            </Pressable>
          </View>
          {!connected && (
            <Text style={[s.offline, { fontSize: fs(12) }]}>● 未连接同步服务,内容可能不是最新的</Text>
          )}

          <WeekNav date={date} onChange={changeDate} marks={(d) => (tasksByDate[d]?.length ?? 0) > 0} />
        </View>
      </View>

      {/* 顶部栏已经让开了状态栏,这里只需要底部(无底部栏)和横屏左右 */}
      <Screen edges={['bottom', 'left', 'right']}>
        {loading && total === 0 ? (
          <Empty text="加载中…" />
        ) : total === 0 ? (
          <Card>
            <Empty text={isToday(date) ? '今天没有作业,尽情玩耍吧 🎉' : '这一天没有作业'} />
          </Card>
        ) : (
          grouped.map(({ subject, tasks: list }) => (
            <View key={subject.id} style={{ marginBottom: vs(12) }}>
              <GroupHeader
                name={subject.name}
                color={subject.color}
                count={list.length}
                doneCount={list.filter((t) => t.done).length}
              />
              {list.map((t) => (
                <ChildTaskCard
                  key={t.id}
                  task={t}
                  server={identity?.server ?? ''}
                  onOpen={() => setDetailOf(t)}
                  onToggle={() => setTaskDone(t.id, !t.done, date).catch(() => {})}
                />
              ))}
            </View>
          ))
        )}
        {total > 0 && (
          <Text style={[s.footerHint, { fontSize: fs(12) }]}>
            {isToday(date) ? '今天的作业' : `${displayDate(date)} 的作业`}
            {doneCount > 0 ? ` · 已完成 ${doneCount}/${total}` : ''} · 做到哪条就打勾 ✅
          </Text>
        )}
      </Screen>

      {settingsOpen && (
        <SettingsScreen
          onClose={() => setSettingsOpen(false)}
          onUpdateServer={updateIdentity}
          onSignOut={signOut}
        />
      )}

      {/* 详情弹层:点任务文字看完整内容 / 勾选完成 / 播放语音 */}
      {detailOf && (
        <TaskDetail
          task={detailOf}
          subjectName={subjectNameOf(detailOf)}
          subjectColor={detailOf.subject_color}
          date={date}
          onClose={() => setDetailOf(null)}
          footer={
            detailOf.has_audio && detailOf.audio_url ? (
              <AudioRow uri={`${identity?.server ?? ''}${detailOf.audio_url}`} />
            ) : undefined
          }
        />
      )}
    </View>
  );
}

/** 儿童端任务卡:单行(勾选圈 + 内容 + 语音按钮),一屏能看更多条 */
function ChildTaskCard({
  task,
  server,
  onOpen,
  onToggle,
}: {
  task: Task;
  server: string;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { fs, vs } = useDisplay();
  const long = task.content.length > LONG_CONTENT_HINT;

  return (
    <View
      style={[
        s.taskCard,
        { paddingVertical: vs(8), marginBottom: vs(5) },
        task.done && { backgroundColor: '#FAFBFD' },
      ]}>
      <DoneCircle done={task.done} onPress={onToggle} />
      <Pressable style={{ flex: 1 }} onPress={onOpen} hitSlop={6} accessibilityRole="button">
        <Text
          style={[
            s.taskText,
            { fontSize: fs(17) },
            task.done && { color: colors.textSub, textDecorationLine: 'line-through' },
          ]}
          numberOfLines={1}>
          {task.content}
        </Text>
      </Pressable>
      {long && <Text style={[s.moreHint, { fontSize: fs(15) }]}>›</Text>}
      {task.has_audio && task.audio_url && <AudioButton uri={`${server}${task.audio_url}`} />}
    </View>
  );
}

/** 详情弹层里的语音播放:一行「播放/暂停 + 说明」 */
export function AudioRow({ uri }: { uri: string }) {
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
        {status.playing ? '正在播放家长录的语音…' : '播放家长录的语音'}
      </Text>
    </Pressable>
  );
}

/** 语音播放按钮:只在真的有语音的任务上挂载播放器,避免每个卡片都订阅播放状态 */
export function AudioButton({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    // 播完之后再点,从头开始(否则会停在结尾没反应)
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
  topBtnText: { fontSize: 15, color: colors.primary, fontWeight: '700' },
  offline: {
    color: colors.warn,
    fontSize: 12,
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(0.5),
  },
  // 单行任务卡:和分组标题配合,一屏能看到的作业条数更多
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing(1.5),
  },
  taskText: { fontSize: 17, color: colors.text },
  moreHint: { color: colors.textSub },
  audioBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  audioBtnIcon: { color: colors.primaryDark, fontSize: 14, fontWeight: '700' },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  audioRowText: { color: colors.primaryDark, fontWeight: '600' },
  footerHint: { textAlign: 'center', color: colors.textSub, marginTop: spacing(1) },
});
