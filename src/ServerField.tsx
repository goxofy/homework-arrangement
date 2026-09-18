// 服务器地址:行 + 点击弹出的输入层。
//
// 为什么不是常驻输入框:欢迎页/设置页的输入框靠页面底部,键盘弹出后即使做了滚动避让,
// 在小屏 + 大字体的情况下仍然容易被遮住。改成弹层后,输入框固定在顶部栏正下方,
// 键盘无论多高都盖不到它(键盘永远从底部升起)。
//
// 用法:两个组件要作为兄弟节点渲染(Overlay 必须渲染在滚动容器外面,否则会被裁切):
//   <View style={{ flex: 1 }}>
//     <Screen>…<ServerField value={srv} onPress={() => setOpen(true)} />…</Screen>
//     <ServerPrompt visible={open} value={srv} onSave={…} onCancel={…} />
//   </View>

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Overlay, Screen, TopBar, TopBarAction } from './ui';
import { colors, spacing } from './theme';
import { isValidServer, normalizeServer } from './storage';

export function ServerField({
  value,
  onPress,
  title = '服务器地址',
}: {
  value: string;
  onPress: () => void;
  title?: string;
}) {
  return (
    <Card onPress={onPress} style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{title}</Text>
        <Text style={s.rowValue} numberOfLines={1}>
          {value || '未设置,点此填写'}
        </Text>
      </View>
      <Text style={s.rowAction}>{value ? '修改' : '填写'}</Text>
    </Card>
  );
}

export function ServerPrompt({
  visible,
  value,
  onSave,
  onCancel,
  title = '服务器地址',
  hint = '家里自建服务器的地址(局域网 IP + 端口,或域名)',
}: {
  visible: boolean;
  value: string;
  onSave: (server: string) => void;
  onCancel: () => void;
  title?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // 每次打开都用最新的值初始化草稿
  useEffect(() => {
    if (visible) {
      setDraft(value);
      setError(null);
    }
  }, [visible, value]);

  const save = () => {
    const raw = draft.trim();
    if (!raw) {
      setError('请输入服务器地址');
      return;
    }
    if (!isValidServer(raw)) {
      setError('地址格式不对,例如 192.168.1.10:8787 或 https://hw.example.com');
      return;
    }
    onSave(normalizeServer(raw));
  };

  return (
    <Overlay
      // 设置页里可能已经在另一个弹层上面,所以这层要更靠上
      zIndex={30}
      visible={visible}
      onRequestClose={onCancel}
      bar={
        <TopBar
          flat
          title={title}
          left={<TopBarAction title="取消" tone="sub" onPress={onCancel} />}
          right={<TopBarAction title="保存" onPress={save} />}
        />
      }>
      <Screen>
        {/* 输入框紧贴顶部栏下方:键盘从底部弹出,永远不会遮到它 */}
        <Card style={{ gap: spacing(1.5) }}>
          <Text style={s.label}>地址</Text>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              setError(null);
            }}
            placeholder="例如 192.168.1.10:8787"
            placeholderTextColor={colors.textSub}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={save}
            autoFocus
          />
          <Text style={s.hint}>{hint}</Text>
          {error && <Text style={s.error}>{error}</Text>}
          <Button title="保存" onPress={save} disabled={!draft.trim()} />
        </Card>

        <Text style={s.tip}>
          不用写 http:// 也可以,会自动补全。填过一次会记住,之后可在「设置」里随时修改。
        </Text>
      </Screen>
    </Overlay>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  rowLabel: { fontSize: 13, fontWeight: '600', color: colors.textSub },
  rowValue: { fontSize: 16, color: colors.text, fontWeight: '700', marginTop: 3 },
  rowAction: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: '#FBFCFE',
  },
  hint: { fontSize: 12, color: colors.textSub, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 13 },
  tip: { marginTop: spacing(1.5), fontSize: 12, color: colors.textSub, lineHeight: 18 },
});
