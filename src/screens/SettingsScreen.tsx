// 设置页:身份与房间管理(改服务器/房间号、切换家长/儿童身份、退出)。

import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Overlay, Screen, SectionTitle, TopBar, TopBarAction } from '../ui';
import { colors, spacing, roleLabel } from '../theme';
import { useApp } from '../AppContext';
import type { Identity } from '../storage';
import { ServerField, ServerPrompt } from '../ServerField';
import JoinRoomScreen from './JoinRoomScreen';

export default function SettingsScreen({
  onClose,
  onUpdateServer,
  onSignOut,
}: {
  onClose: () => void;
  onUpdateServer: (patch: Partial<Identity>) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const { identity, connected } = useApp();
  const [mode, setMode] = useState<'main' | 'join'>('main');
  const [serverOpen, setServerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const saveServer = async (server: string) => {
    setServerOpen(false);
    setBusy(true);
    setMsg(null);
    try {
      await onUpdateServer({ server });
      setMsg('服务器地址已保存');
    } catch {
      setMsg('保存失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  const doSwitchRole = () => {
    if (!identity) return;
    const nextRole = identity.role === 'parent' ? 'child' : 'parent';
    Alert.alert(
      '切换身份',
      `确定切换到${roleLabel[nextRole]}端吗?${nextRole === 'child' ? '切换后本设备将只能查看作业。' : '切换后本设备可以布置作业。'}`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定切换',
          onPress: () => onUpdateServer({ role: nextRole }).catch(() => {}),
        },
      ]
    );
  };

  const doSignOut = () =>
    Alert.alert('退出房间', '将清除本设备上的房间关联,房间数据仍保留在服务器上。', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: () => onSignOut().catch(() => {}) },
    ]);

  // 更换房间:整屏切到加入房间流程(已经在弹层里,所以 JoinRoomScreen 不再重复让位安全区)
  if (mode === 'join' && identity) {
    return (
      <Overlay
        onRequestClose={() => setMode('main')}
        bar={
          <TopBar
            title="更换房间"
            left={<TopBarAction title="返回" tone="sub" onPress={() => setMode('main')} />}
          />
        }>
        <JoinRoomScreen
          role={identity.role}
          initialServer={identity.server}
          safe={false}
          onJoined={async (srv, code) => {
            await onUpdateServer({ server: srv, roomCode: code });
            setMode('main');
          }}
          onBack={() => setMode('main')}
        />
      </Overlay>
    );
  }

  return (
    <>
      <Overlay
        onRequestClose={onClose}
        bar={<TopBar title="设置" left={<TopBarAction title="完成" onPress={onClose} />} />}>
        <Screen>
          {identity && (
            <>
              <SectionTitle>当前身份</SectionTitle>
              <Card style={s.rowCard}>
                <View style={s.row}>
                  <Text style={s.rowLabel}>身份</Text>
                  <Text style={s.rowValue}>
                    {roleLabel[identity.role]}端 {identity.role === 'child' && '(只能查看)'}
                  </Text>
                </View>
                <View style={s.divider} />
                <View style={s.row}>
                  <Text style={s.rowLabel}>房间号</Text>
                  <Text style={[s.rowValue, { fontWeight: '800', letterSpacing: 1 }]}>{identity.roomCode}</Text>
                </View>
                <View style={s.divider} />
                <View style={s.row}>
                  <Text style={s.rowLabel}>同步状态</Text>
                  <Text style={[s.rowValue, { color: connected ? colors.ok : colors.warn }]}>
                    {connected ? '● 已连接' : '● 未连接'}
                  </Text>
                </View>
              </Card>

              <SectionTitle>服务器</SectionTitle>
              {/* 点击弹出输入层:键盘不会遮住输入框 */}
              <ServerField value={identity.server} onPress={() => setServerOpen(true)} />
              <View style={{ marginTop: spacing(1) }}>
                <Button title="更换房间号" variant="ghost" onPress={() => setMode('join')} />
              </View>
              {busy && <Text style={s.msg}>保存中…</Text>}
              {!!msg && !busy && <Text style={s.msg}>{msg}</Text>}

              <SectionTitle>身份与房间</SectionTitle>
              <Card style={{ gap: spacing(1) }}>
                <Button
                  title={`切换到${roleLabel[identity.role === 'parent' ? 'child' : 'parent']}端`}
                  variant="soft"
                  onPress={doSwitchRole}
                />
                <Button title="退出当前房间" variant="ghost" onPress={doSignOut} />
              </Card>

              <Text style={s.about}>
                今日作业 v1.0 · 无账号设计,同一房间号即可关联{'\n'}
                儿童端建议在 iPad 上使用,只能查看作业,不能修改。
              </Text>
            </>
          )}
        </Screen>
      </Overlay>

      {/* 与上层弹层平级渲染(不要嵌套,否则安全区会让位两次) */}
      <ServerPrompt
        visible={serverOpen}
        value={identity?.server ?? ''}
        onSave={saveServer}
        onCancel={() => setServerOpen(false)}
      />
    </>
  );
}

const s = StyleSheet.create({
  rowCard: { gap: 0, paddingVertical: spacing(0.5) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing(1.2),
    gap: spacing(1),
  },
  rowLabel: { fontSize: 15, color: colors.textSub },
  rowValue: { fontSize: 15, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  msg: { fontSize: 13, color: colors.ok, marginTop: spacing(1) },
  about: {
    textAlign: 'center',
    color: colors.textSub,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing(4),
  },
});
