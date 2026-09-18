// 首次启动:选择身份(家长 / 儿童)+ 服务器地址(点击弹出填写,之后可在设置里改)。

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, SAFE_EDGES, Screen } from '../ui';
import { ServerField, ServerPrompt } from '../ServerField';
import { colors, spacing, radius } from '../theme';
import type { Role } from '../storage';

export default function WelcomeScreen({
  onPick,
  server,
  onChangeServer,
}: {
  onPick: (role: Role) => void;
  server: string;
  onChangeServer: (server: string) => void;
}) {
  const [serverOpen, setServerOpen] = useState(false);

  return (
    // 根节点不加安全区 padding,这样 ServerPrompt 弹层能覆盖整个屏幕
    <View style={styles.root}>
      <Screen edges={[...SAFE_EDGES]}>
        <View style={styles.header}>
          <Text style={styles.logo}>📚</Text>
          <Text style={styles.title}>今日作业</Text>
          <Text style={styles.subtitle}>家长布置作业,孩子随时查看</Text>
        </View>

        <View style={styles.choices}>
          <View style={styles.choiceCard}>
            <Text style={styles.choiceEmoji}>👨‍👩‍👧</Text>
            <Text style={styles.choiceTitle}>我是家长</Text>
            <Text style={styles.choiceDesc}>布置当日作业、语音录入、配置分组</Text>
            <Button title="进入家长端" onPress={() => onPick('parent')} />
          </View>

          <View style={styles.choiceCard}>
            <Text style={styles.choiceEmoji}>🧒</Text>
            <Text style={styles.choiceTitle}>我是儿童</Text>
            <Text style={styles.choiceDesc}>在 iPad 上查看每天的作业安排</Text>
            <Button title="进入儿童端" variant="soft" onPress={() => onPick('child')} />
          </View>
        </View>

        {/* 服务器地址:点击弹出填写,输入框在顶部,键盘不会遮到 */}
        <View style={styles.serverBox}>
          <ServerField value={server} onPress={() => setServerOpen(true)} />
        </View>

        <Text style={styles.footer}>无需注册账号,输入同一个房间号即可关联</Text>
      </Screen>

      <ServerPrompt
        visible={serverOpen}
        value={server}
        onSave={(v) => {
          onChangeServer(v);
          setServerOpen(false);
        }}
        onCancel={() => setServerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { alignItems: 'center', marginTop: spacing(2), marginBottom: spacing(3) },
  logo: { fontSize: 56, marginBottom: spacing(1) },
  title: { fontSize: 32, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 15, color: colors.textSub, marginTop: spacing(1) },
  choices: { gap: spacing(2) },
  choiceCard: {
    backgroundColor: colors.card,
    borderRadius: radius + 4,
    padding: spacing(2.5),
    alignItems: 'center',
    gap: spacing(1),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  choiceEmoji: { fontSize: 34 },
  choiceTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  choiceDesc: { fontSize: 13, color: colors.textSub, marginBottom: spacing(0.5), textAlign: 'center' },
  serverBox: { marginTop: spacing(3) },
  footer: { textAlign: 'center', color: colors.textSub, fontSize: 12, marginTop: spacing(3) },
});
