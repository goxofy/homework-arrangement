// 设置页:身份与房间管理(改服务器/房间号、切换家长/儿童身份、退出)。

import React, { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Screen, SectionTitle } from '../ui';
import { colors, spacing, roleLabel } from '../theme';
import { useApp } from '../AppContext';
import type { Identity } from '../storage';
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
  const [server, setServer] = useState(identity?.server ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (mode === 'join' && identity) {
    return (
      <Modal visible animationType="slide" onRequestClose={() => setMode('main')}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
          <JoinRoomScreen
            role={identity.role}
            initialServer={identity.server}
            onJoined={async (srv, code) => {
              await onUpdateServer({ server: srv, roomCode: code });
              setMode('main');
            }}
            onBack={() => setMode('main')}
          />
        </SafeAreaView>
      </Modal>
    );
  }

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

  const saveServer = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onUpdateServer({ server });
      setMsg('已保存');
    } catch {
      setMsg('保存失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={s.modalBar}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.modalClose}>完成</Text>
          </Pressable>
          <Text style={s.modalTitle}>设置</Text>
          <View style={{ width: 40 }} />
        </View>

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
              <Card style={{ gap: spacing(1.2) }}>
                <TextInput
                  style={s.input}
                  value={server}
                  onChangeText={setServer}
                  placeholder="例如 192.168.1.10:8787"
                  placeholderTextColor={colors.textSub}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <View style={{ flexDirection: 'row', gap: spacing(1) }}>
                  <View style={{ flex: 1 }}>
                    <Button title="保存服务器地址" small onPress={saveServer} loading={busy} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="更换房间" small variant="ghost" onPress={() => setMode('join')} />
                  </View>
                </View>
                {msg && <Text style={s.msg}>{msg}</Text>}
              </Card>

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
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
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
  modalClose: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  rowCard: { gap: 0, paddingVertical: spacing(0.5) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing(1.2),
  },
  rowLabel: { fontSize: 15, color: colors.textSub },
  rowValue: { fontSize: 15, color: colors.text, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: '#FBFCFE',
  },
  msg: { fontSize: 13, color: colors.ok },
  about: {
    textAlign: 'center',
    color: colors.textSub,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing(4),
  },
});
