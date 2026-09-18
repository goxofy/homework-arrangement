// 儿童端首页(iPad 为主):当日作业大字显示、语音播放、历史日期回查(只读)。

import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Card, CONTENT_MAX_WIDTH, Empty, GroupHeader, Screen, WeekNav } from '../ui';
import { colors, spacing } from '../theme';
import { useApp } from '../AppContext';
import { displayDate, isToday, todayStr } from '../dates';
import type { Subject, Task } from '../storage';
import SettingsScreen from './SettingsScreen';

export default function ChildHomeScreen() {
  const {
    identity,
    subjects,
    tasksByDate,
    loadingDates,
    connected,
    refreshTasks,
    updateIdentity,
    signOut,
  } = useApp();
  const insets = useSafeAreaInsets();

  const [date, setDate] = useState(todayStr());
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  return (
    // 根节点不加安全区 padding,设置弹层才能覆盖整个屏幕
    <View style={s.root}>
      <View style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
        {/* 大屏(横屏 iPad)下与列表保持同样的居中宽度 */}
        <View style={s.headerInner}>
        <View style={s.topbar}>
          <View style={{ flex: 1, paddingRight: spacing(1) }}>
            <Text style={s.topTitle} numberOfLines={1}>
              今日作业
            </Text>
            <Text style={s.topSub} numberOfLines={1}>
              儿童端 · 房间 {identity?.roomCode ?? '-'}
            </Text>
          </View>
          {/* 设置:带文字的按钮,离屏幕边缘留出安全区,不再是贴边的小齿轮 */}
          <Pressable style={s.topBtn} onPress={() => setSettingsOpen(true)}>
            <Text style={s.topBtnText}>设置</Text>
          </Pressable>
        </View>
        {!connected && <Text style={s.offline}>● 未连接同步服务,内容可能不是最新的</Text>}

        <WeekNav
          date={date}
          onChange={changeDate}
          marks={(d) => (tasksByDate[d]?.length ?? 0) > 0}
        />
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
            <View key={subject.id} style={{ marginBottom: spacing(1.5) }}>
              <GroupHeader name={subject.name} color={subject.color} count={list.length} />
              {list.map((t) => (
                <ChildTaskCard key={t.id} task={t} server={identity?.server ?? ''} />
              ))}
            </View>
          ))
        )}
        {total > 0 && (
          <Text style={s.footerHint}>{isToday(date) ? '今天的作业' : `${displayDate(date)} 的作业`}</Text>
        )}
      </Screen>

      {settingsOpen && (
        <SettingsScreen
          onClose={() => setSettingsOpen(false)}
          onUpdateServer={updateIdentity}
          onSignOut={signOut}
        />
      )}
    </View>
  );
}

/** 儿童端任务卡:单行(内容 + 语音按钮),一屏能看更多条 */
function ChildTaskCard({ task, server }: { task: Task; server: string }) {
  return (
    <View style={s.taskCard}>
      <Text style={s.taskText} numberOfLines={1}>
        {task.content}
      </Text>
      {task.has_audio && task.audio_url && <AudioButton uri={`${server}${task.audio_url}`} />}
    </View>
  );
}

/** 语音播放按钮:只在真的有语音的任务上挂载播放器,避免每个卡片都订阅播放状态 */
function AudioButton({ uri }: { uri: string }) {
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
    paddingVertical: spacing(1),
    marginBottom: spacing(0.6),
  },
  taskText: { flex: 1, fontSize: 17, color: colors.text },
  audioBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  audioBtnIcon: { color: colors.primaryDark, fontSize: 14, fontWeight: '700' },
  footerHint: { textAlign: 'center', color: colors.textSub, fontSize: 12, marginTop: spacing(1) },
});
