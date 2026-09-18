// 加入房间流程:服务器地址 + 房间号(家长创建/加入,儿童加入)。

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, SAFE_EDGES, Screen, SectionTitle } from '../ui';
import { colors, spacing, roleLabel } from '../theme';
import { api, ApiError } from '../api';
import { isValidServer, normalizeServer, type Role } from '../storage';

function genCode(): string {
  // 随机 10 位房间号(大写字母+数字,去掉易混淆字符)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function JoinRoomScreen({
  role,
  initialServer,
  onJoined,
  onBack,
  safe = true,
}: {
  role: Role;
  initialServer?: string;
  onJoined: (server: string, code: string) => void;
  onBack: () => void;
  /** 已经在弹层(Overlay)里时传 false,避免安全区让位两次 */
  safe?: boolean;
}) {
  const [server, setServer] = useState(initialServer ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'' | 'create' | 'join'>('');
  const [error, setError] = useState<string | null>(null);

  const serverOk = useMemo(() => isValidServer(server), [server]);
  const codeOk = /^[A-Za-z0-9-]{8,32}$/.test(code.trim());
  const canSubmit = serverOk && codeOk && busy === '';

  const normalizeCode = (t: string) => t.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);

  const doCreate = async () => {
    setError(null);
    setBusy('create');
    try {
      await api.createRoom(normalizeServer(server), code.trim());
      onJoined(normalizeServer(server), code.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建房间失败,请重试');
    } finally {
      setBusy('');
    }
  };

  const doJoin = async () => {
    setError(null);
    setBusy('join');
    try {
      await api.getRoom(normalizeServer(server), code.trim());
      onJoined(normalizeServer(server), code.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加入房间失败,请重试');
    } finally {
      setBusy('');
    }
  };

  return (
    <View style={s.root}>
      <Screen edges={safe ? [...SAFE_EDGES] : []}>
        <SectionTitle>{roleLabel[role]}端 · 关联房间</SectionTitle>

        {/* 服务器地址放最上面:键盘从底部弹出,这两张卡都在键盘上方 */}
        <Card style={{ gap: spacing(1.5) }}>
          <Text style={s.label}>服务器地址</Text>
          <TextInput
            style={s.input}
            value={server}
            onChangeText={setServer}
            placeholder="例如 192.168.1.10:8787 或 hw.example.com"
            placeholderTextColor={colors.textSub}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={s.hint}>填家里服务器的地址(局域网 IP + 端口,或域名);填过一次会记住</Text>
        </Card>

        <Card style={{ gap: spacing(1.5), marginTop: spacing(2) }}>
          <Text style={s.label}>房间号(至少 8 位,字母/数字/连字符)</Text>
          <TextInput
            style={[s.input, { fontSize: 22, letterSpacing: 2, fontWeight: '700' }]}
            value={code}
            onChangeText={(t) => setCode(normalizeCode(t))}
            placeholder="如 FAMILY2026"
            placeholderTextColor={colors.textSub}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {role === 'parent' && (
            <Pressable onPress={() => setCode(genCode())} style={s.genBtn}>
              <Text style={s.genBtnText}>🎲 随机生成房间号</Text>
            </Pressable>
          )}
        </Card>

        {error && (
          <Card style={{ marginTop: spacing(2), backgroundColor: '#FDECEC' }}>
            <Text style={s.error}>{error}</Text>
          </Card>
        )}

        <View style={{ marginTop: spacing(3), gap: spacing(1.5) }}>
          {role === 'parent' ? (
            <>
              <Button title="创建新房间" onPress={doCreate} disabled={!canSubmit} loading={busy === 'create'} />
              <Button title="加入已有房间" variant="ghost" onPress={doJoin} disabled={!canSubmit} loading={busy === 'join'} />
            </>
          ) : (
            <Button title="加入房间" onPress={doJoin} disabled={!canSubmit} loading={busy === 'join'} />
          )}
          <Button title="返回" variant="ghost" onPress={onBack} />
        </View>
      </Screen>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: '#FBFCFE',
  },
  hint: { fontSize: 12, color: colors.textSub, lineHeight: 17 },
  genBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  genBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13 },
});
