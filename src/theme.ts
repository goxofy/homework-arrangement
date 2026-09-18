// 主题色与全局样式常量。

export const colors = {
  primary: '#4F6EF7',
  primaryDark: '#3B5BDB',
  primarySoft: '#E8EDFF',
  bg: '#F5F6FA',
  card: '#FFFFFF',
  border: '#E6E8F0',
  text: '#1C2333',
  textSub: '#7A8299',
  danger: '#E5484D',
  ok: '#10B981',
  warn: '#F59E0B',
};

export const spacing = (n: number) => n * 8;

export const radius = 14;

export const roleLabel = {
  parent: '家长',
  child: '儿童',
} as const;

/** 分组默认配色(与默认四组一致,新增分组循环取色) */
export const subjectPalette = [
  '#E5484D',
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#6366F1',
];
