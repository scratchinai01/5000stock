// 台股漲跌停規則
// - 漲跌幅：前一日收盤價 ±10%，依升降單位取到合法價位 (漲停向下取、跌停向上取)
// - 判斷是否能成交：
//   規則 2 (即時 LIVE 且有委買賣資料)：漲停時看最佳一檔委賣量，跌停時看最佳一檔委買量；
//     有量 → 可成交，但張數不得超過該檔掛單量；量為 0 → 鎖死，拒絕
//   規則 1 (延遲 / 收盤 / 手動報價，或即時資料缺委買賣欄位)：漲停一律不能買進、跌停一律不能賣出
// - 不適用：債券 ETF、期貨、選擇權、美股、原物料、加密貨幣
//   (另：國外成分 ETF、新上市前五日無漲跌幅限制，本系統未區分，管理員可關閉此規則)
import type { Category, Instrument, OrderIntent, Quote, Side } from '../../shared/types.ts';

const APPLIES: Category[] = ['tw_stock', 'tw_etf'];
export const priceLimitApplies = (c: Category) => APPLIES.includes(c);

/** 證交所升降單位 */
export function tickSize(category: Category, price: number): number {
  if (category === 'tw_etf') return price < 50 ? 0.01 : 0.05;
  if (price < 10) return 0.01;
  if (price < 50) return 0.05;
  if (price < 100) return 0.1;
  if (price < 500) return 0.5;
  if (price < 1000) return 1;
  return 5;
}

const fix = (n: number) => Math.round(n * 100) / 100;

/** 依前一日收盤價計算漲停價、跌停價 */
export function limitPrices(category: Category, prevClose: number): { up: number; down: number } {
  const rawUp = prevClose * 1.1;
  const rawDown = prevClose * 0.9;
  const tu = tickSize(category, rawUp);
  const td = tickSize(category, rawDown);
  const up = fix(Math.floor(fix(rawUp / tu) + 1e-9) * tu);
  const down = fix(Math.ceil(fix(rawDown / td) - 1e-9) * td);
  return { up, down };
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

export interface PriceLimitResult {
  state: 'NONE' | 'LIMIT_UP' | 'LIMIT_DOWN';
  limitUp?: number;
  limitDown?: number;
  block?: string;
  warning?: string;
}

/** 檢查這筆委託在漲跌停時能否成交 */
export function checkPriceLimit(inst: Instrument, quote: Quote, side: Side, intent: OrderIntent, qty: number): PriceLimitResult {
  if (!priceLimitApplies(inst.category) || !quote.prevClose || quote.prevClose <= 0) return { state: 'NONE' };
  const { up, down } = limitPrices(inst.category, quote.prevClose);
  const base = { limitUp: up, limitDown: down };
  // 買方動作：新倉多、平倉空 (回補)；賣方動作：新倉空、平倉多
  const isBuy = (intent === 'OPEN' && side === 'LONG') || (intent === 'CLOSE' && side === 'SHORT');
  const atUp = quote.price >= up - 1e-6;
  const atDown = quote.price <= down + 1e-6;
  if (!atUp && !atDown) return { state: 'NONE', ...base };

  const state = atUp ? 'LIMIT_UP' : 'LIMIT_DOWN';
  const label = atUp ? `漲停 ${up}` : `跌停 ${down}`;
  // 漲停時賣出、跌停時買進：一定有對手，可以成交
  if ((atUp && !isBuy) || (atDown && isBuy)) {
    return { state, ...base, warning: `目前${label}，${isBuy ? '買進' : '賣出'}方向可正常成交` };
  }

  const action = atUp ? '買進' : '賣出';
  const bookSide = atUp ? '委賣' : '委買';
  const bookPrice = atUp ? quote.bestAsk : quote.bestBid;
  const bookVol = atUp ? quote.bestAskVolume : quote.bestBidVolume;
  const hasBook = quote.basis === 'LIVE' && bookVol !== undefined;

  if (!hasBook) {
    const why = quote.basis === 'LIVE' ? '即時報價缺少委買賣資料' : '此報價不是即時報價，沒有委買賣資料';
    return { state, ...base, block: `目前${label}，${why}，視為鎖死，無法${action}` };
  }
  const limitPx = atUp ? up : down;
  const vol = bookPrice !== undefined && same(bookPrice, limitPx) ? bookVol! : 0;
  if (vol <= 0) {
    return { state, ...base, block: `目前${label} 鎖死（最佳一檔${bookSide}量 0），無法${action}` };
  }
  if (qty > vol) {
    return {
      state, ...base,
      block: `目前${label}，${bookSide}只剩 ${vol} ${inst.unitLabel}，最多只能${action} ${vol} ${inst.unitLabel}`,
    };
  }
  return { state, ...base, warning: `目前${label}但未鎖死（${bookSide} ${vol} ${inst.unitLabel}），可${action}` };
}
