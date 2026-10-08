// 各市場交易時段 (以台北時間判斷；美股以紐約時間判斷，自動處理夏令時間)。
// 不含國定假日 (休市日請管理員以「凍結交易」處理，或於 HOLIDAYS 加入日期)。
import type { Category, SessionInfo } from '../shared/types.ts';
import { zonedParts } from './time.ts';

/** 台灣證交所 / 期交所休市日 (YYYY-MM-DD)，可自行補充 */
export const TW_HOLIDAYS = new Set<string>([
  // 例：'2026-10-10',
]);

const hm = (h: number, m: number) => h * 100 + m;

export function getSession(category: Category, now = Date.now()): SessionInfo {
  const tw = zonedParts(now, 'Asia/Taipei');
  const t = hm(tw.hour, tw.minute);
  const d = tw.weekday;
  const isWeekday = d >= 1 && d <= 5;
  const holiday = TW_HOLIDAYS.has(tw.dateStr);

  switch (category) {
    case 'tw_stock':
    case 'tw_etf':
    case 'tw_bond_etf': {
      if (!isWeekday || holiday) return s('TW_CASH', false, '休市', '下一個交易日 09:00');
      if (t >= 900 && t < 1330) return s('TW_CASH', true, '集中市場盤中 09:00–13:30', '13:30 收盤');
      if (t >= 1400 && t < 1430) return s('TW_CASH', true, '盤後定價 14:00–14:30', '14:30 結束');
      if (t < 900) return s('TW_CASH', false, '開盤前', '09:00 開盤');
      return s('TW_CASH', false, '已收盤', '下一個交易日 09:00');
    }
    case 'tw_future':
    case 'tw_option': {
      // 日盤 08:45–13:45；夜盤 15:00–次日 05:00 (週一夜盤起、週六 05:00 止)
      const dayOpen = isWeekday && !holiday && t >= 845 && t < 1345;
      const nightOpen = (isWeekday && t >= 1500) || (d >= 2 && d <= 6 && t < 500);
      if (dayOpen) return s('TAIFEX', true, '期貨日盤 08:45–13:45', '13:45 收盤');
      if (nightOpen) return s('TAIFEX', true, '期貨夜盤 15:00–05:00', '05:00 收盤');
      if (isWeekday && t >= 1345 && t < 1500) return s('TAIFEX', false, '日夜盤間休息', '15:00 夜盤');
      return s('TAIFEX', false, '休市', '下一個交易日 08:45');
    }
    case 'us_stock': {
      const ny = zonedParts(now, 'America/New_York');
      const nt = hm(ny.hour, ny.minute);
      const nyWeekday = ny.weekday >= 1 && ny.weekday <= 5;
      if (nyWeekday && nt >= 930 && nt < 1600) return s('US', true, '美股常規盤 (紐約 09:30–16:00)', '紐約 16:00 收盤');
      return s('US', false, '美股休市', '紐約 09:30 開盤');
    }
    case 'commodity': {
      // CME Globex：週日 18:00 – 週五 17:00 (芝加哥)，每日 17:00–18:00 休息
      const ch = zonedParts(now, 'America/Chicago');
      const ct = hm(ch.hour, ch.minute);
      const wd = ch.weekday;
      const dailyBreak = ct >= 1700 && ct < 1800;
      const weekendClosed = wd === 6 || (wd === 0 && ct < 1800) || (wd === 5 && ct >= 1700);
      if (!dailyBreak && !weekendClosed) return s('CME', true, 'CME Globex 電子盤', '芝加哥 17:00 休息');
      return s('CME', false, dailyBreak ? 'CME 每日休息' : 'CME 週末休市', '芝加哥 18:00 開盤');
    }
    case 'crypto':
      return s('CRYPTO', true, '24/7 全天候', '不收盤');
  }
}

function s(symbolClass: string, isOpen: boolean, sessionName: string, nextChange: string): SessionInfo {
  return { symbolClass, isOpen, sessionName, nextChange };
}
