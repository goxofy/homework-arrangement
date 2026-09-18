// 通用小组件:屏幕容器、卡片、按钮、任务行等。

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { colors, spacing, radius } from './theme';

export function Screen({
  children,
  style,
  scroll = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scroll?: boolean;
}) {
  const inner = [styles.screen, style];
  if (scroll) {
    return (
      <ScrollView
        style={styles.screenScroll}
        contentContainerStyle={[styles.screenContent, style]}
        keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    );
  }
  return <View style={inner}>{children}</View>;
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && { opacity: 0.85 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'soft';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  small,
}: {
  title: string;
  onPress: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const bg: Record<BtnVariant, TextStyle['backgroundColor']> = {
    primary: colors.primary,
    ghost: 'transparent',
    danger: colors.danger,
    soft: colors.primarySoft,
  };
  const fg: Record<BtnVariant, string> = {
    primary: '#fff',
    ghost: colors.primary,
    danger: '#fff',
    soft: colors.primaryDark,
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg[variant] },
        variant === 'ghost' && { borderWidth: 1.5, borderColor: colors.primary },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg[variant]} />
      ) : (
        <Text style={[styles.btnText, { color: fg[variant] }, small && styles.btnTextSmall]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function ErrorBar({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Pressable onPress={onRetry} style={styles.errorBar}>
      <Text style={styles.errorBarText}>
        {message}
        {onRetry ? '(点击重试)' : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenScroll: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: spacing(2), paddingBottom: spacing(8) },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  btn: {
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: spacing(2.5),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  btnSmall: { minHeight: 38, paddingVertical: 8, paddingHorizontal: spacing(1.5) },
  btnText: { fontSize: 16, fontWeight: '600' },
  btnTextSmall: { fontSize: 14 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing(1),
    marginBottom: spacing(1),
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  empty: { alignItems: 'center', paddingVertical: spacing(6) },
  emptyText: { color: colors.textSub, fontSize: 14 },
  errorBar: {
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    padding: spacing(1.5),
    marginBottom: spacing(1.5),
  },
  errorBarText: { color: colors.danger, fontSize: 13 },
});
