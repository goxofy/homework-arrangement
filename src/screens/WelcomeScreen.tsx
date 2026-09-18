// 首次启动:选择身份(家长 / 儿童)+ 服务器地址(记住,之后可在设置里改)。

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Screen } from '../ui';
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
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* 用 Screen 承载:小屏/横屏可滚动,键盘弹出时输入框不会被遮住 */}
      <Screen center>
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

        {/* 服务器地址:一次性填写,之后记住 */}
        <View style={styles.serverBox}>
          <Text style={styles.serverLabel}>服务器地址(家庭自建,填写一次即可)</Text>
          <TextInput
            style={styles.serverInput}
            value={server}
            onChangeText={onChangeServer}
            placeholder="例如 192.168.1.10:8787 或 hw.example.com"
            placeholderTextColor={colors.textSub}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
          />
          <Text style={styles.serverHint}>
            会自动记住;之后可在「设置」中修改。不知道填什么?问一下部署这个服务的人 😊
          </Text>
        </View>

        <Text style={styles.footer}>无需注册账号,输入同一个房间号即可关联</Text>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
  choiceDesc: { fontSize: 13, color: colors.textSub, marginBottom: spacing(0.5) },
  serverBox: {
    marginTop: spacing(3),
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing(1),
  },
  serverLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  serverInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: '#FBFCFE',
  },
  serverHint: { fontSize: 11, color: colors.textSub, lineHeight: 16 },
  footer: {
    textAlign: 'center',
    color: colors.textSub,
    fontSize: 12,
    marginTop: spacing(3),
  },
});
