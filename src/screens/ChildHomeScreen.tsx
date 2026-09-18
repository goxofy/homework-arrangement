// 儿童端首页(iPad 为主):当日作业大字显示、语音播放、历史日期回查(只读)。

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioPlayer } from 'expo-audio';
import { Button, Card, Empty, Screen } from '../ui';
import { colors, spacing, radius } from '../theme';
import { useApp } from '../AppContext';
import { addDays, displayDate, isFuture, isToday, todayStr, weekdayLabel } from '../dates';
import type { Subject, Task } from '../storage';
import SettingsScreen from './SettingsScreen';

export default function ChildHomeScreen() {
  const {
    identity,
    subjects,
    tasksByDate,
    loadingDates,
    refreshTasks,
    updateIdentity,
    signOut,
  } = useApp();

  const [date, setDate] = useState(todayStr());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tasks = tasksByDate[date] ?? [];
  const loading = !!loadingDates[date];
  const future = isFuture(date);

  // 未来日期禁看
  React.useEffect(() => {
    if (future) refreshTasks(todayStr()).catch(() => {});
  }, [future, refreshTasks]);

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

  const viewDate = future ? todayStr() : date;
  const tasksForView = future ? tasksByDate[todayStr()] ?? [] : tasks;
  const total = tasksForView.length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      {/* 顶部:日期导航 */}
      <View style={s.topbar}>
        <Pressable
          style={s.navBtn}
          onPress={() => {
            const next = addDays(viewDate, -1);
            setDate(next);
            refreshTasks(next).catch(() => {});
          }}>
          <Text style={s.navBtnText}>‹ 前一天</Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={s.dateText}>{isToday(viewDate) ? '今天' : displayDate(viewDate)}</Text>
          <Text style={s.weekText}>
            {weekdayLabel(viewDate)} · 共 {total} 项作业
          </Text>
        </View>
        <Pressable
          style={[s.navBtn, isToday(viewDate) && { opacity: 0.35 }]}
          disabled={isToday(viewDate)}
          onPress={() => {
            const next = addDays(viewDate, 1);
            if (!isFuture(next)) {
              setDate(next);
              refreshTasks(next).catch(() => {});
            }
          }}>
          <Text style={s.navBtnText}>后一天 ›</Text>
        </Pressable>
      </View>

      {/* 快捷日期条:近 7 天 */}
      <View style={s.quickRow}>
        {[6, 5, 4, 3, 2, 1, 0].map((back) => {
          const d = addDays(todayStr(), -back);
          const active = d === viewDate;
          const has = (tasksByDate[d]?.length ?? 0) > 0;
          return (
            <Pressable
              key={d}
              style={[s.quickBtn, active && s.quickBtnActive]}
              onPress={() => {
                setDate(d);
                refreshTasks(d).catch(() => {});
              }}>
              <Text style={[s.quickBtnText, active && s.quickBtnTextActive]}>
                {back === 0 ? '今' : weekdayLabel(d).replace('周', '')}
              </Text>
              {has && !active && <View style={s.quickDot} />}
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        <Pressable style={s.navBtn} onPress={() => setSettingsOpen(true)}>
          <Text style={s.navBtnText}>⚙️</Text>
        </Pressable>
      </View>

      <Screen>
        {loading && total === 0 ? (
          <Empty text="加载中…" />
        ) : total === 0 ? (
          <Card>
            <Empty text={isToday(viewDate) ? '今天没有作业,尽情玩耍吧 🎉' : '这一天没有作业'} />
          </Card>
        ) : (
          grouped.map(({ subject, tasks: list }) => (
            <View key={subject.id} style={{ marginBottom: spacing(3) }}>
              <View style={[s.subjectHeader, { backgroundColor: (subject.color ?? colors.primary) + '1A' }]}>
                <View style={[s.subjectDot, { backgroundColor: subject.color ?? colors.primary }]} />
                <Text style={[s.subjectName, { color: subject.color ?? colors.primary }]}>{subject.name}</Text>
                <Text style={s.subjectCount}>{list.length} 项</Text>
              </View>
              {list.map((t) => (
                <ChildTaskCard key={t.id} task={t} server={identity?.server ?? ''} />
              ))}
            </View>
          ))
        )}
      </Screen>

      {settingsOpen && (
        <SettingsScreen
          onClose={() => setSettingsOpen(false)}
          onUpdateServer={updateIdentity}
          onSignOut={signOut}
        />
      )}
    </SafeAreaView>
  );
}

/** 儿童端任务卡:大字 + 语音播放 */
function ChildTaskCard({ task, server }: { task: Task; server: string }) {
  const [playing, setPlaying] = useState(false);
  const player = useAudioPlayer(task.has_audio && task.audio_url ? `${server}${task.audio_url}` : null);

  const toggleAudio = () => {
    if (!player) return;
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.play();
      setPlaying(true);
    }
  };

  return (
    <Card style={s.taskCard}>
      <Text style={s.taskText}>{task.content}</Text>
      {task.has_audio && task.audio_url && (
        <Pressable style={s.audioBtn} onPress={toggleAudio}>
          <Text style={s.audioBtnText}>{playing ? '⏸ 暂停语音' : '▶️ 播放语音'}</Text>
        </Pressable>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
  },
  navBtn: {
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  navBtnText: { fontSize: 15, color: colors.primary, fontWeight: '600' },
  dateText: { fontSize: 26, fontWeight: '800', color: colors.text },
  weekText: { fontSize: 13, color: colors.textSub, marginTop: 2 },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(0.8),
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(1.5),
  },
  quickBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  quickBtnText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  quickBtnTextActive: { color: '#fff' },
  quickDot: {
    position: 'absolute',
    bottom: 5,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.warn,
  },
  subjectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    borderRadius: radius,
    marginBottom: spacing(1),
  },
  subjectDot: { width: 14, height: 14, borderRadius: 7 },
  subjectName: { fontSize: 20, fontWeight: '800' },
  subjectCount: { fontSize: 14, color: colors.textSub, marginLeft: 'auto' },
  taskCard: { marginBottom: spacing(1.2), padding: spacing(2) },
  taskText: { fontSize: 19, lineHeight: 30, color: colors.text },
  audioBtn: {
    marginTop: spacing(1.2),
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.8),
  },
  audioBtnText: { color: colors.primaryDark, fontSize: 14, fontWeight: '700' },
});
