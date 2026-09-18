// 日期工具:全程使用"本地日期"YYYY-MM-DD,避免 UTC 时区错位。

export function todayStr(): string {
  const d = new Date();
  return localDateStr(d);
}

export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return localDateStr(dt);
}

export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(dateStr: string): string {
  return WEEKDAYS[parseDate(dateStr).getDay()];
}

/** 显示为「9月18日 周四」 */
export function displayDate(dateStr: string): string {
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdayLabel(dateStr)}`;
}

export function isToday(dateStr: string): boolean {
  return dateStr === todayStr();
}

/** 该日期所在周的周一(一周从周一开始) */
export function startOfWeek(dateStr: string): string {
  const dow = parseDate(dateStr).getDay(); // 0 = 周日
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(dateStr, -back);
}

/** 显示为「9月14日 - 9月20日」(跨月时两端都带月份) */
export function weekRangeLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const a = parseDate(weekStart);
  const b = parseDate(end);
  if (a.getMonth() === b.getMonth()) {
    return `${a.getMonth() + 1}月${a.getDate()}日 - ${b.getDate()}日`;
  }
  return `${a.getMonth() + 1}月${a.getDate()}日 - ${b.getMonth() + 1}月${b.getDate()}日`;
}

/** 周内按钮上的星期简称:一 / 二 / … / 日 */
export function weekdayShort(dateStr: string): string {
  return weekdayLabel(dateStr).replace('周', '');
}

/** 日号,如 18 */
export function dayOfMonth(dateStr: string): number {
  return parseDate(dateStr).getDate();
}

/** 时间戳 → 布置时间 HH:MM */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 儿童端只允许查看 今天(含)以前的日期 */
export function isFuture(dateStr: string): boolean {
  return dateStr > todayStr();
}
