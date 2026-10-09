// 各市場交易時段 (以台北時間判斷；美股以紐約時間判斷，自動處理夏令時間)。
// 台灣休市日列於 TW_HOLIDAYS (每年需更新)；美股與 CME 未含其國定假日。
import type { Category, SessionInfo } from '../shared/types.ts';
import { zonedParts } from './time.ts';

/** 台灣證交所 / 期交所休市日 (YYYY-MM-DD)，可自行補充 */
// 2026 (民國 115 年) 依證交所公告之平日休市日；週末不需列入。每年底請補上隔年日期。
export const TW_HOLIDAYS = new Set<string>([
  '2026-01-01',
  '2026-02-12', '2026-02-13', // 春節前 (僅辦理結算交割)
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', // 春節
  '2026-02-27', // 和平紀念日補假
  '2026-04-03', '2026-04-06', // 兒童節、清明節
  '2026-05-01', // 勞動節
  '2026-06-19', // 端午節
  '2026-09-25', '2026-09-28', // 中秋節、教師節
  '2026-10-09', // 國慶日補假
  '2026-10-26', // 光復節補假
  '2026-12-25', // 行憲紀念日
]);

const ymd = (ms: number) => zonedParts(ms, 'Asia/Taipei').dateStr;
/** 台灣的交易日：週一至週五且非休市日 */
function isTwTradingDay(ms: number): boolean {
  const p = zonedParts(ms, 'Asia/Taipei');
  return p.weekday >= 1 && p.weekday <= 5 && !TW_HOLIDAYS.has(ymd(ms));
}

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
      // 夜盤：當天是交易日才開 15:00 場；凌晨 05:00 前屬於「前一天」的夜盤
      const nightOpen = (isWeekday && !holiday && t >= 1500) || (t < 500 && isTwTradingDay(now - 86_400_000));
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
