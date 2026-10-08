// 時間工具：所有判斷一律指定時區，不依賴伺服器本機時區。

export interface ZonedParts {
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:MM:SS
  hour: number;
  minute: number;
  weekday: number; // 0=週日
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string) {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function zonedParts(epochMs: number, tz = 'Asia/Taipei'): ZonedParts {
  const m: Record<string, string> = {};
  formatter(tz).formatToParts(new Date(epochMs)).forEach(p => (m[p.type] = p.value));
  const hour = m.hour === '24' ? 0 : Number(m.hour);
  return {
    dateStr: `${m.year}-${m.month}-${m.day}`,
    timeStr: `${String(hour).padStart(2, '0')}:${m.minute}:${m.second}`,
    hour,
    minute: Number(m.minute),
    weekday: WEEKDAY[m.weekday] ?? 0,
  };
}

export const taipei = (epochMs = Date.now()) => zonedParts(epochMs, 'Asia/Taipei');

export function taipeiText(epochMs = Date.now()): string {
  const p = taipei(epochMs);
  return `${p.dateStr} ${p.timeStr}`;
}

export function taipeiDateDaysAgo(days: number, from = Date.now()): string {
  return taipei(from - days * 86_400_000).dateStr;
}

/** 由「台北日期 + 時間」得到 epoch 毫秒 */
export function taipeiEpoch(dateStr: string, timeStr = '00:00:00'): number {
  return Date.parse(`${dateStr}T${timeStr}+08:00`);
}
