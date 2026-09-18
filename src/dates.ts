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

/** 儿童端只允许查看 今天(含)以前的日期 */
export function isFuture(dateStr: string): boolean {
  return dateStr > todayStr();
}
