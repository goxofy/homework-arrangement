// 通用小组件:屏幕容器、树内弹层、顶部栏、日期导航、卡片、按钮、任务行等。
//
// 关于「树内弹层」(Overlay)而不是 RN 的 Modal:
// Modal 会把内容渲染进一个独立的原生窗口(Android 是 Dialog、iOS 是新的 VC),
// 在那个窗口里 SafeAreaView 拿到的 insets 是错的(通常是 0),于是内容会顶到状态栏下面,
// 状态栏区域还会把点击吃掉 —— 这就是「二级页面顶到最上面、完成按钮点不了」的原因。
// Overlay 直接渲染在 App 自己的视图树里,安全区和键盘避让全部走主窗口的正确数值。

import React, { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  BackHandler,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius } from './theme';
import { useKeyboardInset } from './keyboard';
import {
  addDays,
  dayOfMonth,
  displayDate,
  isToday,
  startOfWeek,
  todayStr,
  weekRangeLabel,
  weekdayShort,
} from './dates';

/** 平板/大屏下限制内容宽度,避免卡片被拉得过宽 */
export const CONTENT_MAX_WIDTH = 720;

/** 统一的安全区边:上下(状态栏/手势条)+ 左右(横屏刘海/灵动岛) */
export const SAFE_EDGES = ['top', 'bottom', 'left', 'right'] as const;
export type ScreenEdge = (typeof SAFE_EDGES)[number];

/**
 * 页面容器。统一负责四件事:
 * 1. 安全区让位(把 insets 做成内容 padding,滚动时不会被裁切)
 * 2. 键盘避让 —— Android 15+ edge-to-edge 下系统不再缩小窗口,必须自己让位
 * 3. 内容超出屏幕时可滚动(小屏手机/横屏/大字体都不会截断)
 * 4. 大屏(平板)限宽居中
 *
 * 注意:安全区是加在「内容」上的,不是加在外层容器上,所以 Overlay 弹层
 * 作为兄弟节点渲染时能覆盖整个屏幕(不会被父级 padding 缩进)。
 */
export function Screen({
  children,
  style,
  scroll = true,
  center = false,
  edges = [],
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scroll?: boolean;
  center?: boolean;
  /** 本页需要避让的安全区边(顶部有固定栏的页面通常只填 bottom/left/right) */
  edges?: readonly ScreenEdge[];
}) {
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  const scrollRef = useRef<ScrollView | null>(null);
  const offsetRef = useRef(0);

  const safe = {
    top: edges.includes('top') ? insets.top : 0,
    bottom: edges.includes('bottom') ? insets.bottom : 0,
    left: edges.includes('left') ? insets.left : 0,
    right: edges.includes('right') ? insets.right : 0,
  };

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
      <View
        style={[
          styles.screen,
          shell,
          {
            paddingTop: safe.top,
            paddingBottom: safe.bottom,
            paddingLeft: safe.left,
            paddingRight: safe.right,
          },
          center && styles.screenCenter,
          style,
        ]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.screenScroll, shell]}
      contentContainerStyle={[
        styles.screenContent,
        styles.screenInner,
        {
          paddingTop: spacing(2) + safe.top,
          paddingBottom: spacing(6) + safe.bottom,
          paddingLeft: spacing(2) + safe.left,
          paddingRight: spacing(2) + safe.right,
        },
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

/**
 * 全屏弹层(替代 RN Modal)。直接渲染在 App 视图树里,好处:
 * - 安全区 insets 正确(状态栏/手势条/横屏左右都能让位)
 * - 键盘避让与主页面走同一套逻辑
 * - 可以嵌套(Modal 里再开 Modal 在 Android 上不可靠)
 * Android 返回键会自动关闭它。
 */
export function Overlay({
  children,
  onRequestClose,
  bar,
  zIndex = 20,
}: {
  children: React.ReactNode;
  onRequestClose: () => void;
  bar?: React.ReactNode;
  /** 弹层叠放顺序(同级弹层里更靠上的一层用更大的值) */
  zIndex?: number;
}) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [onRequestClose]);

  return (
    <View style={[styles.overlay, { zIndex, elevation: zIndex }]}>
      <SafeAreaView style={styles.overlaySafe} edges={[...SAFE_EDGES]}>
        {bar}
        {children}
      </SafeAreaView>
    </View>
  );
}

/** 弹层/页面顶部栏:标题居中,左右各放操作 */
export function TopBar({
  title,
  left,
  right,
}: {
  title?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.topBar}>
      <View style={styles.topBarSide}>{left}</View>
      <Text style={styles.topBarTitle} numberOfLines={1}>
        {title ?? ''}
      </Text>
      <View style={[styles.topBarSide, styles.topBarSideRight]}>{right}</View>
    </View>
  );
}

/** 顶部栏上的文字按钮(带足够大的点击热区,不会点不到) */
export function TopBarAction({
  title,
  onPress,
  tone = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  tone?: 'primary' | 'sub';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={14}
      style={({ pressed }) => [styles.topBarBtn, disabled && { opacity: 0.35 }, pressed && { opacity: 0.55 }]}>
      <Text style={[styles.topBarAction, tone === 'sub' && { color: colors.textSub }]}>{title}</Text>
    </Pressable>
  );
}

/**
 * 周导航(家长端和儿童端共用):
 * 上一周 / 下一周 + 本周七天的按钮(周一到周日)。
 * 过去的日期可任意查看,未来的日期(含未来周)一律不可选。
 */
export function WeekNav({
  date,
  onChange,
  marks,
}: {
  date: string;
  onChange: (date: string) => void;
  /** 该日期是否有作业(会在按钮上显示小圆点) */
  marks?: (date: string) => boolean;
}) {
  const today = todayStr();
  const weekStart = startOfWeek(date);
  const weekDays = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  // 下一周只要还有「未来」就不能翻(当前周永远不能往后翻)
  const canNextWeek = addDays(weekStart, 7) <= today;

  const goWeek = (delta: number) => {
    const target = addDays(date, delta * 7);
    onChange(target > today ? today : target);
  };

  return (
    <View style={styles.dateNav}>
      <View style={styles.dateNavTop}>
        <Pressable style={styles.navBtn} onPress={() => goWeek(-1)} hitSlop={8}>
          <Text style={styles.navBtnText}>‹ 上一周</Text>
        </Pressable>
        <View style={styles.dateCenter}>
          <Text style={styles.dateTitle} numberOfLines={1}>
            {weekRangeLabel(weekStart)}
          </Text>
          <Text style={styles.dateSub} numberOfLines={1}>
            {isToday(date) ? `今天 · ${displayDate(date)}` : displayDate(date)}
          </Text>
        </View>
        <Pressable
          style={[styles.navBtn, !canNextWeek && styles.navBtnDisabled]}
          disabled={!canNextWeek}
          hitSlop={8}
          onPress={() => goWeek(1)}>
          <Text style={[styles.navBtnText, !canNextWeek && { color: colors.textSub }]}>下一周 ›</Text>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {weekDays.map((d) => {
          const future = d > today;
          const active = d === date;
          const isTodayDate = d === today;
          const has = marks?.(d) ?? false;
          return (
            <Pressable
              key={d}
              disabled={future}
              onPress={() => onChange(d)}
              style={[
                styles.weekBtn,
                isTodayDate && !active && styles.weekBtnToday,
                active && styles.weekBtnActive,
                future && styles.weekBtnDisabled,
              ]}>
              <Text style={[styles.weekBtnDay, active && styles.weekBtnTextActive]}>
                {weekdayShort(d)}
              </Text>
              <Text style={[styles.weekBtnNum, active && styles.weekBtnTextActive]}>{dayOfMonth(d)}</Text>
              {has && !active && <View style={styles.quickDot} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * 分组标题(家长端/儿童端共用,保证两端外观一致):
 * 一个小圆点(分组颜色) + 分组名 + 数量,不再用整条底色块。
 */
export function GroupHeader({
  name,
  color,
  count,
  right,
}: {
  name: string;
  color?: string | null;
  count?: number;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.groupHeader}>
      <View style={[styles.groupDot, { backgroundColor: color ?? colors.primary }]} />
      <Text style={styles.groupName}>{name}</Text>
      {count != null && <Text style={styles.groupCount}>{count} 项</Text>}
      <View style={{ flex: 1 }} />
      {right}
    </View>
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
  // 内边距(含安全区)在 Screen 里按 edges 动态计算
  screenContent: { flexGrow: 1 },
  // 大屏(平板/横屏)下内容居中限宽,小屏不受影响
  screenInner: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  screenCenter: { justifyContent: 'center' },

  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
  },
  overlaySafe: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    paddingHorizontal: spacing(1),
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topBarSide: { minWidth: 72, justifyContent: 'center' },
  topBarSideRight: { alignItems: 'flex-end' },
  topBarTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.text },
  topBarBtn: { paddingHorizontal: spacing(1.2), paddingVertical: spacing(0.6) },
  topBarAction: { fontSize: 16, fontWeight: '600', color: colors.primary },

  dateNav: { paddingTop: spacing(1) },
  dateNavTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(2),
    gap: spacing(0.75),
  },
  navBtn: {
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.75),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  navBtnDisabled: { opacity: 0.5 },
  navBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  dateSub: { fontSize: 12, color: colors.textSub, marginTop: 2 },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing(0.5),
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.25),
  },
  weekBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing(0.75),
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  weekBtnToday: { borderColor: colors.primary, borderWidth: 1.5 },
  weekBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  weekBtnDisabled: { opacity: 0.42 },
  weekBtnDay: { fontSize: 11, color: colors.textSub },
  weekBtnNum: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 1 },
  weekBtnTextActive: { color: '#fff' },
  quickDot: {
    position: 'absolute',
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.warn,
  },

  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(0.85),
    marginTop: spacing(1.25),
    marginBottom: spacing(0.85),
  },
  groupDot: { width: 10, height: 10, borderRadius: 5 },
  groupName: { fontSize: 16, fontWeight: '700', color: colors.text },
  groupCount: { fontSize: 13, color: colors.textSub },

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
