// 设置页:身份与房间管理(改服务器/房间号、切换家长/儿童身份、退出)。

import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Overlay, Screen, SectionTitle, Segmented, TopBar, TopBarAction } from '../ui';
import { colors, spacing, roleLabel } from '../theme';
import { DENSITY_OPTIONS, FONT_OPTIONS, useDisplay } from '../display';
import { useApp } from '../AppContext';
import type { Identity } from '../storage';
import { ServerField, ServerPrompt } from '../ServerField';
import JoinRoomScreen from './JoinRoomScreen';

export default function SettingsScreen({
  visible = true,
  onClose,
  onUpdateServer,
  onSignOut,
}: {
  visible?: boolean;
  onClose: () => void;
  onUpdateServer: (patch: Partial<Identity>) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const { identity, connected } = useApp();
  const { prefs, setFontStep, setDensity, fs } = useDisplay();
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

  // 主设置页与「更换房间」页都常驻渲染 + visible:切换时一个退场、一个进场,不会硬切
  return (
    <>
      <Overlay
        visible={visible && mode === 'main'}
        onRequestClose={onClose}
        bar={<TopBar flat title="设置" left={<TopBarAction title="完成" onPress={onClose} />} />}>
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

              {/* 显示偏好:字号与紧凑度,只影响本机显示,家长端和儿童端各自设置 */}
              <SectionTitle>显示偏好</SectionTitle>
              <Card style={{ gap: spacing(1.2) }}>
                <Text style={[s.rowLabel, { fontSize: fs(14) }]}>字号</Text>
                <Segmented options={FONT_OPTIONS} value={prefs.fontStep} onChange={setFontStep} />
                <Text style={[s.rowLabel, { fontSize: fs(14), marginTop: spacing(0.5) }]}>行距(紧凑度)</Text>
                <Segmented options={DENSITY_OPTIONS} value={prefs.density} onChange={setDensity} />
                <Text style={[s.hint, { fontSize: fs(12) }]}>
                  影响作业列表的字号与行距(只影响本机显示)。作业内容过长时单行会省略,点任务文字即可查看全文。
                </Text>
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
      </Overlay>

      {/* 更换房间:整屏切到加入房间流程(已经在弹层里,所以 JoinRoomScreen 不再重复让位安全区) */}
      {identity && (
        <Overlay
          visible={visible && mode === 'join'}
          onRequestClose={() => setMode('main')}
          bar={
            <TopBar
              flat
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
      )}

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
  hint: { color: colors.textSub, lineHeight: 17 },
  about: {
    textAlign: 'center',
    color: colors.textSub,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing(4),
  },
});
