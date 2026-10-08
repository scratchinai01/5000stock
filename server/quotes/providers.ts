// 報價供應商。原則：拿不到就回傳 null，絕不以預設值或推算值補位。
import type { Instrument, Quote } from '../../shared/types.ts';
import { getSession } from '../clock.ts';
import { taipeiDateDaysAgo, taipeiEpoch, zonedParts } from '../time.ts';

export const OFFLINE = () => process.env.QUOTES_OFFLINE === '1';

async function getJson(url: string, timeoutMs = 6000): Promise<any> {
  if (OFFLINE()) throw new Error('QUOTES_OFFLINE=1');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'finmind-tycoon/2.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const num = (v: any) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const valid = (v: number) => Number.isFinite(v) && v > 0;

// ───────────────────────── FinMind ─────────────────────────
let finmindToken = (process.env.FINMIND_TOKEN || process.env.FINMIND_API_TOKEN || '').trim();
export const setFinmindToken = (t: string) => (finmindToken = t.trim());
export const hasFinmindToken = () => finmindToken.length > 0;
const tokenParam = () => (finmindToken ? `&token=${encodeURIComponent(finmindToken)}` : '');

/** 台股 / ETF：盤中且有 token → 即時快照；否則 → 最近交易日收盤 */
export async function finmindStock(inst: Instrument): Promise<Quote | null> {
  const now = Date.now();
  if (hasFinmindToken() && getSession(inst.category, now).isOpen) {
    try {
      const j = await getJson(
        `https://api.finmindtrade.com/api/v4/taiwan_stock_tick_snapshot?data_id=${inst.symbol}${tokenParam()}`
      );
      const row = Array.isArray(j?.data) ? j.data.find((r: any) => r.stock_id === inst.symbol) : null;
      if (row && valid(num(row.close)) && typeof row.date === 'string') {
        const [d, t] = row.date.slice(0, 19).split(' ');
        return {
          symbol: inst.symbol,
          price: num(row.close),
          prevClose: valid(num(row.close) - num(row.change_price)) ? num(row.close) - num(row.change_price) : undefined,
          currency: 'TWD',
          basis: 'LIVE',
          quoteDate: d,
          quoteTime: t,
          quoteTimeZone: 'Asia/Taipei',
          quoteEpoch: taipeiEpoch(d, t),
          source: 'FinMind taiwan_stock_tick_snapshot',
          fetchedAt: now,
        };
      }
    } catch {
      /* 改用日資料 */
    }
  }
  const j = await getJson(
    `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${inst.symbol}&start_date=${taipeiDateDaysAgo(14)}${tokenParam()}`
  );
  const rows = (Array.isArray(j?.data) ? j.data : []).filter((r: any) => valid(num(r.close)));
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  return {
    symbol: inst.symbol,
    price: num(last.close),
    prevClose: prev ? num(prev.close) : undefined,
    currency: 'TWD',
    basis: 'CLOSE',
    quoteDate: last.date,
    quoteTime: '13:30:00',
    quoteTimeZone: 'Asia/Taipei',
    quoteEpoch: taipeiEpoch(last.date, '13:30:00'),
    source: 'FinMind TaiwanStockPrice (日收盤)',
    fetchedAt: now,
  };
}

/** 台指期 (TX/MTX/TMF)：近月一般盤 */
export async function finmindFuture(inst: Instrument): Promise<Quote | null> {
  const now = Date.now();
  if (hasFinmindToken() && getSession(inst.category, now).isOpen) {
    try {
      const j = await getJson(
        `https://api.finmindtrade.com/api/v4/taiwan_futures_snapshot?data_id=${inst.symbol}${tokenParam()}`
      );
      const rows = (Array.isArray(j?.data) ? j.data : []).filter((r: any) => valid(num(r.close)));
      // 取成交量最大的合約 (通常為近月)
      const row = rows.sort((a: any, b: any) => num(b.total_volume) - num(a.total_volume))[0];
      if (row && typeof row.date === 'string') {
        const [d, t] = row.date.slice(0, 19).split(' ');
        return {
          symbol: inst.symbol,
          price: num(row.close),
          prevClose: valid(num(row.close) - num(row.change_price)) ? num(row.close) - num(row.change_price) : undefined,
          currency: 'TWD',
          basis: 'LIVE',
          quoteDate: d,
          quoteTime: t,
          quoteTimeZone: 'Asia/Taipei',
          quoteEpoch: taipeiEpoch(d, t),
          source: `FinMind taiwan_futures_snapshot ${row.futures_id ?? ''}`.trim(),
          fetchedAt: now,
        };
      }
    } catch {
      /* 改用日資料 */
    }
  }
  const j = await getJson(
    `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesDaily&data_id=${inst.symbol}&start_date=${taipeiDateDaysAgo(14)}${tokenParam()}`
  );
  const rows = (Array.isArray(j?.data) ? j.data : []).filter(
    (r: any) => r.trading_session === 'position' && /^\d{6}$/.test(String(r.contract_date)) && valid(num(r.close))
  );
  if (!rows.length) return null;
  const lastDate = rows[rows.length - 1].date;
  const near = rows
    .filter((r: any) => r.date === lastDate)
    .sort((a: any, b: any) => String(a.contract_date).localeCompare(String(b.contract_date)))[0];
  const prevDates = [...new Set<string>(rows.map((r: any) => String(r.date)))].filter(d => d < lastDate).sort();
  const prevRow = prevDates.length
    ? rows.find((r: any) => r.date === prevDates[prevDates.length - 1] && r.contract_date === near.contract_date)
    : null;
  return {
    symbol: inst.symbol,
    price: num(near.close),
    prevClose: prevRow ? num(prevRow.close) : undefined,
    currency: 'TWD',
    basis: 'CLOSE',
    quoteDate: near.date,
    quoteTime: '13:45:00',
    quoteTimeZone: 'Asia/Taipei',
    quoteEpoch: taipeiEpoch(near.date, '13:45:00'),
    source: `FinMind TaiwanFuturesDaily 近月 ${near.contract_date}`,
    fetchedAt: now,
  };
}

/** 台指選擇權日資料 (整個 TXO 鏈快取 10 分鐘) */
let optionChainCache: { at: number; rows: any[] } | null = null;
export async function finmindOptionChain(): Promise<any[]> {
  if (optionChainCache && Date.now() - optionChainCache.at < 10 * 60_000) return optionChainCache.rows;
  const j = await getJson(
    `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanOptionDaily&data_id=TXO&start_date=${taipeiDateDaysAgo(7)}${tokenParam()}`,
    15000
  );
  const rows = (Array.isArray(j?.data) ? j.data : []).filter((r: any) => r.trading_session === 'position');
  if (!rows.length) return [];
  const lastDate = rows.reduce((m: string, r: any) => (r.date > m ? r.date : m), '');
  const latest = rows.filter((r: any) => r.date === lastDate && /^\d{6}$/.test(String(r.contract_date)));
  optionChainCache = { at: Date.now(), rows: latest };
  return latest;
}

export async function finmindOption(inst: Instrument): Promise<Quote | null> {
  const rows = await finmindOptionChain();
  const want = inst.optionType === 'C' ? 'call' : 'put';
  const row = rows.find(
    (r: any) =>
      String(r.contract_date) === inst.contractMonth &&
      num(r.strike_price) === inst.strike &&
      String(r.call_put).toLowerCase() === want
  );
  if (!row) return null;
  // 當日無成交 (close=0) 時使用期交所結算價
  const price = valid(num(row.close)) ? num(row.close) : num(row.settlement_price);
  if (!valid(price)) return null;
  return {
    symbol: inst.symbol,
    price,
    currency: 'TWD',
    basis: 'CLOSE',
    quoteDate: row.date,
    quoteTime: '13:45:00',
    quoteTimeZone: 'Asia/Taipei',
    quoteEpoch: taipeiEpoch(row.date, '13:45:00'),
    source: valid(num(row.close)) ? 'FinMind TaiwanOptionDaily (收盤)' : 'FinMind TaiwanOptionDaily (結算價，當日無成交)',
    fetchedAt: Date.now(),
  };
}

// ───────────────────────── Yahoo Finance ─────────────────────────
export async function yahoo(inst: Instrument, yahooSymbol = inst.providerSymbol): Promise<Quote | null> {
  const now = Date.now();
  const j = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`
  );
  const r = j?.chart?.result?.[0];
  const meta = r?.meta;
  const price = num(meta?.regularMarketPrice);
  const ts = num(meta?.regularMarketTime);
  if (!valid(price) || !valid(ts)) return null; // 沒有報價時間就不採用，避免日期錯置
  const tz: string = meta.exchangeTimezoneName || 'UTC';
  const epoch = ts * 1000;
  const local = zonedParts(epoch, tz);

  // 前一交易日收盤：取日K中「報價日之前」最後一根
  let prevClose: number | undefined;
  const stamps: number[] = r?.timestamp || [];
  const closes: number[] = r?.indicators?.quote?.[0]?.close || [];
  for (let i = stamps.length - 1; i >= 0; i--) {
    const d = zonedParts(stamps[i] * 1000, tz).dateStr;
    if (d < local.dateStr && valid(num(closes[i]))) {
      prevClose = num(closes[i]);
      break;
    }
  }

  // 交易時段中、且報價在 60 分鐘內 → 延遲盤中價；否則視為收盤價
  const open = getSession(inst.category, now).isOpen;
  const basis = open && now - epoch < 60 * 60_000 ? 'DELAYED' : 'CLOSE';
  return {
    symbol: inst.symbol,
    price,
    prevClose,
    currency: (meta.currency === 'USD' ? 'USD' : 'TWD'),
    basis,
    quoteDate: local.dateStr,
    quoteTime: local.timeStr,
    quoteTimeZone: tz,
    quoteEpoch: epoch,
    source: `Yahoo Finance ${yahooSymbol}`,
    fetchedAt: now,
  };
}

// ───────────────────────── Binance ─────────────────────────
export async function binance(inst: Instrument): Promise<Quote | null> {
  const j = await getJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${inst.providerSymbol}`);
  const price = num(j?.lastPrice);
  const closeTime = num(j?.closeTime);
  if (!valid(price) || !valid(closeTime)) return null;
  const p = zonedParts(closeTime, 'UTC');
  return {
    symbol: inst.symbol,
    price,
    prevClose: valid(num(j.prevClosePrice)) ? num(j.prevClosePrice) : undefined,
    currency: 'USD',
    basis: 'LIVE',
    quoteDate: p.dateStr,
    quoteTime: p.timeStr,
    quoteTimeZone: 'UTC',
    quoteEpoch: closeTime,
    source: `Binance ${inst.providerSymbol} (USDT 計價，視同 USD)`,
    fetchedAt: Date.now(),
  };
}
