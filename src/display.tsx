// 显示偏好(字号 / 紧凑度)。家长端与儿童端共用一套,只存在本机,和房间/服务器无关。
//
// 用法:const { fs, vs } = useDisplay();
//   fs(15) → 按字号档位缩放后的字号
//   vs(8)  → 按紧凑度缩放后的「纵向」留白(水平留白不受影响,避免布局跑偏)

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  DEFAULT_DISPLAY,
  loadDisplayPrefs,
  saveDisplayPrefs,
  type Density,
  type DisplayPrefs,
  type FontStep,
} from './storage';

/** 字号档位(相对标准档的倍率) */
const FONT_SCALE: Record<FontStep, number> = {
  sm: 0.88,
  md: 1,
  lg: 1.18,
  xl: 1.38,
};

/** 紧凑度:纵向留白倍率 */
const DENSITY_SCALE: Record<Density, number> = {
  compact: 0.6,
  normal: 1,
  cozy: 1.5,
};

export const FONT_OPTIONS: { value: FontStep; label: string }[] = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '标准' },
  { value: 'lg', label: '大' },
  { value: 'xl', label: '特大' },
];

export const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'normal', label: '标准' },
  { value: 'cozy', label: '宽松' },
];

interface DisplayValue {
  ready: boolean;
  prefs: DisplayPrefs;
  fontScale: number;
  densityScale: number;
  setFontStep: (step: FontStep) => void;
  setDensity: (density: Density) => void;
  /** 字号缩放 */
  fs: (px: number) => number;
  /** 纵向留白缩放(行高/上下内边距/纵向间距) */
  vs: (px: number) => number;
  /** 多行文本的行高 */
  lh: (px: number) => number;
}

const DisplayContext = createContext<DisplayValue | null>(null);

export function useDisplay(): DisplayValue {
  const ctx = useContext(DisplayContext);
  if (!ctx) throw new Error('useDisplay must be used within DisplayProvider');
  return ctx;
}

export function DisplayProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<DisplayPrefs>(DEFAULT_DISPLAY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadDisplayPrefs().then((p) => {
      setPrefs(p);
      setReady(true);
    });
  }, []);

  const update = useCallback((patch: Partial<DisplayPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveDisplayPrefs(next).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<DisplayValue>(() => {
    const fontScale = FONT_SCALE[prefs.fontStep] ?? 1;
    const densityScale = DENSITY_SCALE[prefs.density] ?? 1;
    return {
      ready,
      prefs,
      fontScale,
      densityScale,
      setFontStep: (fontStep) => update({ fontStep }),
      setDensity: (density) => update({ density }),
      fs: (px) => Math.round(px * fontScale),
      vs: (px) => Math.round(px * densityScale),
      lh: (px) => Math.round(px * fontScale * 1.5),
    };
  }, [prefs, ready, update]);

  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}
