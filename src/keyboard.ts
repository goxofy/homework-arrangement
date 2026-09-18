// 键盘避让高度(单位 dp)。
//
// 背景:Android 15+(targetSdk 35+)强制 edge-to-edge 后,系统的
// windowSoftInputMode="adjustResize" 已不再缩小窗口,键盘会直接盖住输入框;
// React Native 自带的 KeyboardAvoidingView 用 endCoordinates.screenY 计算避让量,
// 而这个值在这套环境下是不准的,所以这里改用「键盘高度」来算。
//
// 两种情况需要区分(否则 Android 14 及以下会被重复避让):
//   A. 系统确实缩小了窗口(Android 14 及以下):窗口高度会变小,
//      此时额外避让 = 键盘高度 - 窗口缩小的量 ≈ 0
//   B. 系统没缩小窗口(Android 15+/iOS):窗口高度不变,额外避让 = 键盘高度
//
// iOS 侧一般交给 ScrollView 的 automaticallyAdjustKeyboardInsets 处理,这里返回 0。

import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  const kbHeightRef = useRef(0); // 系统上报的键盘高度
  const winHeightRef = useRef(Dimensions.get('window').height); // 实时窗口高度
  const baselineRef = useRef(Dimensions.get('window').height); // 无键盘时的窗口高度

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const recompute = () => {
      const shrink = Math.max(0, baselineRef.current - winHeightRef.current);
      setInset(Math.max(0, Math.round(kbHeightRef.current - shrink)));
    };

    // 键盘弹出/收起时窗口尺寸可能变化,变化了才说明系统已经帮我们避让过
    // (RN 先发 keyboardDidShow 再发尺寸变化,所以这里要重算一次)
    const dimSub = Dimensions.addEventListener('change', ({ window }) => {
      winHeightRef.current = window.height;
      // 键盘不在时,当前高度就是基准高度(旋转屏幕后也能自动纠正)
      if (kbHeightRef.current === 0) baselineRef.current = window.height;
      recompute();
    });

    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      kbHeightRef.current = e.endCoordinates.height;
      recompute();
    });

    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      kbHeightRef.current = 0;
      baselineRef.current = winHeightRef.current;
      setInset(0);
    });

    return () => {
      dimSub.remove();
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return inset;
}
