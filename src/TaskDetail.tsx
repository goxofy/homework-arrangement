// 作业详情弹层:家长端/儿童端共用。
// 列表里每条任务都是一行(超长会省略号截断),点一下进这里就能看到完整内容,
// 同时提供「标记完成」和对该条作业的操作(家长端有编辑/删除)。

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, DoneCircle, GroupHeader, Overlay, Screen, SectionTitle, TopBar, TopBarAction } from './ui';
import { colors, spacing } from './theme';
import { useDisplay } from './display';
import { useApp } from './AppContext';
import { displayDate, formatTime } from './dates';
import type { Task, TaskMedia } from './storage';
import {
  AttachmentStrip,
  AttachButtons,
  AudioRow,
  MAX_ATTACHMENTS_PER_TASK,
  type PendingAttachment,
} from './MediaAttachments';

export function TaskDetail({
  task,
  visible = true,
  subjectName,
  subjectColor,
  date,
  server,
  onClose,
  onEdit,
  onDelete,
  onAddMedia,
  onDeleteMedia,
  uploadingMedia,
}: {
  task: Task;
  /** 显隐开关(父级常驻渲染本组件,关闭时传 false,退场动画播完才卸载) */
  visible?: boolean;
  subjectName: string;
  subjectColor?: string | null;
  /** 这条作业归属的日期(YYYY-MM-DD) */
  date: string;
  /** 服务器地址(附件下载/播放要用) */
  server?: string;
  onClose: () => void;
  /** 家长端:进入编辑 */
  onEdit?: () => void;
  /** 家长端:删除该条 */
  onDelete?: () => void;
  /** 家长端:在详情里继续添加附件(图标/录音/文件),由父级负责上传 */
  onAddMedia?: (items: PendingAttachment[]) => void;
  /** 家长端:删除某个附件 */
  onDeleteMedia?: (media: TaskMedia) => void;
  /** 附件正在上传(家长端显示进度) */
  uploadingMedia?: boolean;
}) {
  const { fs, vs, lh } = useDisplay();
  const { setTaskDone } = useApp();
  const media = task.media ?? [];

  // 本地维护完成状态:弹层开着时点勾选立刻有反馈,
  // 另一台设备改了也会跟着刷新(父级传下来的 task 变了)
  const [done, setDone] = useState(task.done);
  useEffect(() => setDone(task.done), [task.id, task.done]);

  const toggle = () => {
    const next = !done;
    setDone(next);
    setTaskDone(task.id, next, date).catch(() => {
      setDone(!next);
      Alert.alert('操作失败', '网络或服务器不可用,请稍后重试');
    });
  };

  return (
    <Overlay
      zIndex={30}
      visible={visible}
      onRequestClose={onClose}
      bar={
        <TopBar
          flat
          title="作业详情"
          left={<TopBarAction title="关闭" tone="sub" onPress={onClose} />}
          right={onEdit ? <TopBarAction title="编辑" onPress={onEdit} /> : undefined}
        />
      }>
      <Screen>
        <Card style={{ gap: vs(12) }}>
          <GroupHeader name={subjectName} color={subjectColor} />
          {/* 完整内容:可选中复制,长文自动换行,不再截断 */}
          <Text
            selectable
            style={{ fontSize: fs(18), lineHeight: lh(18), color: done ? colors.textSub : colors.text }}>
            {task.content}
          </Text>
          <Text style={[s.meta, { fontSize: fs(12) }]}>
            {displayDate(date)} · 布置于 {formatTime(task.created_at)}
            {task.has_audio ? ' · 含语音' : ''}
          </Text>
        </Card>

        {/* 老版「一条作业一段短语音」(说话转文字录下来的)仍然可以播 */}
        {task.has_audio && task.audio_url && server ? (
          <Card style={{ marginTop: spacing(1.5) }}>
            <AudioRow uri={`${server}${task.audio_url}`} label="播放家长录的语音" />
          </Card>
        ) : null}

        {/* 附件:图片看大图、语音/视频播放、文件条目(家长端可加可删) */}
        {media.length > 0 && server ? (
          <Card style={{ gap: vs(10), marginTop: spacing(1.5) }}>
            <SectionTitle>作业资料 {media.length > 0 ? `(${media.length})` : ''}</SectionTitle>
            <AttachmentStrip server={server} media={media} onDelete={onDeleteMedia} />
          </Card>
        ) : null}

        {/* 家长端:详情里可以继续补图片/录音/文件 */}
        {onAddMedia && server ? (
          <Card style={{ gap: vs(10), marginTop: spacing(1.5) }}>
            <SectionTitle>添加资料</SectionTitle>
            <AttachButtons
              onItems={onAddMedia}
              disabled={uploadingMedia}
              remainingSlots={MAX_ATTACHMENTS_PER_TASK - media.length}
            />
            {uploadingMedia && (
              <View style={s.uploadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[s.uploadingText, { fontSize: fs(12) }]}>
                  正在上传…(图片、语音和文件最多在服务器保留 7 天,孩子在有效期内打开即可保存到本机)
                </Text>
              </View>
            )}
          </Card>
        ) : null}

        <Card style={{ marginTop: spacing(1.5) }}>
          <Pressable onPress={toggle} style={s.doneRow} accessibilityRole="button">
            {/* 外层已经是可点击区域,这里只做展示,避免嵌套点击 */}
            <DoneCircle done={done} size={26} />
            <Text style={[s.doneText, { fontSize: fs(16) }, done && { color: colors.ok, fontWeight: '700' }]}>
              {done ? '已完成(点一下取消)' : '标记为已完成'}
            </Text>
          </Pressable>
        </Card>

        {onDelete && (
          <View style={{ marginTop: spacing(2) }}>
            <Button
              title="删除这条作业"
              variant="ghost"
              onPress={() =>
                Alert.alert('删除作业', '确定删除这条作业吗?', [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '删除',
                    style: 'destructive',
                    onPress: () => {
                      onDelete();
                      onClose();
                    },
                  },
                ])
              }
            />
          </View>
        )}
      </Screen>
    </Overlay>
  );
}

const s = StyleSheet.create({
  meta: { color: colors.textSub },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  uploadingText: { color: colors.textSub, flex: 1, lineHeight: 17 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), paddingVertical: spacing(0.75) },
  doneText: { color: colors.text, fontWeight: '600' },
});
