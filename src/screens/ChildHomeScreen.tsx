// 儿童端首页(iPad 为主):作业大字显示、语音播放、历史与未来日期查看(只读布置,但可勾选完成)。

import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, CONTENT_MAX_WIDTH, DoneCircle, Empty, ErrorBar, GroupHeader, Screen, SyncToast, WeekNav } from '../ui';
import { colors, spacing } from '../theme';
import { useDisplay } from '../display';
import { useApp } from '../AppContext';
import { displayDate, isToday, todayStr } from '../dates';
import { TaskDetail } from '../TaskDetail';
import { ensureMediaCached } from '../media';
import { AttachmentBadges, AudioButton, AudioQuickPlay } from '../MediaAttachments';
import { groupTasksBySubject } from '../task-groups';
import type { Task } from '../storage';
import SettingsScreen from './SettingsScreen';

/** 内容超过这个长度就在任务行末尾显示一个「›」,提示可以点开看全文 */
const LONG_CONTENT_HINT = 18;

export default function ChildHomeScreen() {
  const {
    identity,
    subjects,
    tasksByDate,
    loadingDates,
    taskErrorsByDate,
    connected,
    setTaskDone,
    refreshSubjects,
    refreshTasks,
    updateIdentity,
    signOut,
  } = useApp();
  const insets = useSafeAreaInsets();
  const { fs, vs } = useDisplay();
  const server = identity?.server ?? '';

  const [date, setDate] = useState(todayStr());
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 详情弹层:task 留着不置空,这样关闭时退场动画期间内容还在,不会闪空
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const openDetail = (t: Task): void => {
    setDetailTask(t);
    setDetailOpen(true);
  };

  const tasks = tasksByDate[date] ?? [];
  const loading = !!loadingDates[date];
  const taskError = taskErrorsByDate[date];
  // 详情里的 task 跟着列表更新(附件下载完成后、另一台设备改了内容)
  const liveDetailTask = detailTask ? (tasks.find((t) => t.id === detailTask.id) ?? detailTask) : null;

  // 避免把 refreshTasks 的身份写进依赖(它会随数据变化而变)
  const refreshRef = useRef(refreshTasks);
  refreshRef.current = refreshTasks;

  const changeDate = (next: string): void => {
    setDate(next);
    refreshRef.current(next).catch(() => {});
  };

  const forceRefresh = async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.allSettled([refreshSubjects(), refreshRef.current(date)]);
    } finally {
      setRefreshing(false);
    }
  };

  // 只要孩子翻到这一天,就把这天的附件都下载到本机。
  // 服务器上的附件只保留 7 天,下载过之后即使超过 7 天也能正常看图/听语音/看视频。
  // 已缓存、下载中、已过期的都会被自动跳过,所以这里的依赖变化不会造成重复请求。
  React.useEffect(() => {
    if (!server) return;
    const all = tasks.flatMap((t) => t.media ?? []);
    if (all.length > 0) ensureMediaCached(server, all);
  }, [server, tasks]);

  const grouped = useMemo(() => groupTasksBySubject(subjects, tasks), [subjects, tasks]);

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
          <WeekNav date={date} onChange={changeDate} marks={(d) => (tasksByDate[d]?.length ?? 0) > 0} />
        </View>
      </View>

      {/* 顶部栏已经让开了状态栏,这里只需要底部(无底部栏)和横屏左右 */}
      <Screen
        edges={['bottom', 'left', 'right']}
        refreshing={refreshing}
        onRefresh={forceRefresh}>
        {taskError && (
          <ErrorBar
            message={total > 0 ? `${taskError},当前显示上次内容` : taskError}
            onRetry={() => refreshRef.current(date).catch(() => {})}
          />
        )}
        {loading && total === 0 ? (
          <Empty text="加载中…" />
        ) : taskError && total === 0 ? null : total === 0 ? (
          <Card>
            <Empty text={isToday(date) ? '今天没有作业,尽情玩耍吧 🎉' : '这一天没有作业'} />
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
                  <ChildTaskCard
                    key={t.id}
                    task={t}
                    server={server}
                    onOpen={() => openDetail(t)}
                    onToggle={() => setTaskDone(t.id, !t.done, date).catch(() => {})}
                  />
                ))}
              </View>
            );
          })
        )}
        {total > 0 && (
          <Text style={[s.footerHint, { fontSize: fs(12) }]}>
            {isToday(date) ? '今天的作业' : `${displayDate(date)} 的作业`}
            {doneCount > 0 ? ` · 已完成 ${doneCount}/${total}` : ''} · 做到哪条就打勾 ✅
          </Text>
        )}
      </Screen>

      {/* 断网提示:顶部居中悬浮,不占布局(原来那行会把页面整体顶下去一行) */}
      <SyncToast visible={!connected} text="未连接同步服务 · 内容可能不是最新的" />

      {/* 常驻渲染 + visible:只有这样才能播退场动画 */}
      <SettingsScreen
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onUpdateServer={updateIdentity}
        onSignOut={signOut}
      />

      {/* 详情弹层:点任务文字看完整内容 / 附件(图片大图、语音、视频)/ 勾选完成 */}
      {liveDetailTask && (
        <TaskDetail
          task={liveDetailTask}
          visible={detailOpen}
          subjectName={subjectNameOf(liveDetailTask)}
          subjectColor={liveDetailTask.subject_color}
          date={date}
          server={server}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </View>
  );
}

/** 儿童端任务卡:单行(勾选圈 + 内容 + 附件角标/语音按钮),一屏能看更多条 */
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
  const media = task.media ?? [];
  // 只有一份语音附件时,列表里直接给个播放钮(点进详情也能播)
  const quickAudio = media.length === 1 && media[0].kind === 'audio' ? media[0] : null;

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
      {media.length > 0 && <AttachmentBadges server={server} media={media} />}
      {quickAudio && <AudioQuickPlay server={server} media={quickAudio} />}
      {media.length === 0 && task.has_audio && task.audio_url && (
        <AudioButton uri={`${server}${task.audio_url}`} />
      )}
    </View>
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
  archivedTag: { color: colors.textSub, fontWeight: '600' },
  footerHint: { textAlign: 'center', color: colors.textSub, marginTop: spacing(1) },
});
