// 通用小组件:屏幕容器、卡片、按钮、任务行等。

import React, { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius } from './theme';
import { useKeyboardInset } from './keyboard';

/** 平板/大屏下限制内容宽度,避免卡片被拉得过宽 */
const CONTENT_MAX_WIDTH = 720;

/**
 * 页面容器。统一负责三件事:
 * 1. 底部安全区(手势条/导航栏)避让
 * 2. 键盘避让 —— Android 15+ edge-to-edge 下系统不再缩小窗口,必须自己让位
 * 3. 内容超出屏幕时可滚动(小屏手机/横屏/大字体都不会截断)
 */
export function Screen({
  children,
  style,
  scroll = true,
  center = false,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scroll?: boolean;
  center?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  const scrollRef = useRef<ScrollView | null>(null);
  const offsetRef = useRef(0);

  // Android 上窗口不会随键盘缩小(edge-to-edge 下系统不再 resize),
  // Android 平台也不会自动把聚焦的输入框滚到键盘上方,所以这里量一下它的实际位置,
  // 只有真的被键盘遮住才滚动(输入框在页面上半部时不会被误滚动)
  const ensureFocusedVisible = useCallback(() => {
    const node = TextInput.State.currentlyFocusedInput?.();
    if (!node || typeof node.measureInWindow !== 'function') return;
    node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const visibleBottom = Dimensions.get('window').height - keyboardInset - 12;
      const overflow = y + h - visibleBottom;
      if (overflow > 0) {
        scrollRef.current?.scrollTo({ y: offsetRef.current + overflow, animated: true });
      }
    });
  }, [keyboardInset]);

  useEffect(() => {
    if (Platform.OS !== 'android' || keyboardInset <= 0 || !scroll) return;
    const timer = setTimeout(ensureFocusedVisible, 80);
    return () => clearTimeout(timer);
  }, [keyboardInset, scroll, ensureFocusedVisible]);

  // 收缩滚动区域(而不是给内容加 padding),这样可见区域真正让开了键盘
  const shell = { flex: 1, paddingBottom: keyboardInset };

  if (!scroll) {
    return (
      <View style={[styles.screen, shell, center && styles.screenCenter, style]}>{children}</View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.screenScroll, shell]}
      contentContainerStyle={[
        styles.screenContent,
        { paddingBottom: spacing(8) + insets.bottom },
        styles.screenInner,
        center && styles.screenCenter,
        style,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      onScroll={(e) => {
        offsetRef.current = e.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={32}
      // iOS:原生自动把聚焦的输入框滚到键盘上方
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
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
  screenContent: { padding: spacing(2), paddingBottom: spacing(8), flexGrow: 1 },
  // 大屏(平板/横屏)下内容居中限宽,小屏不受影响
  screenInner: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  screenCenter: { justifyContent: 'center' },
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
