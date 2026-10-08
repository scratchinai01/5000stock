// 報價服務：真實供應商 → (失敗) 管理員手動報價 → (失敗) 最後一次成功取得的真實報價 → null
// 「最後一次真實報價」保留原本的報價日期，所以一定看得出它是舊資料。
import type { Instrument, Quote, QuoteSnapshot } from '../../shared/types.ts';
import { getDb } from '../db.ts';
import { getSession } from '../clock.ts';
import { getSettings } from '../settings.ts';
import { taipei, taipeiEpoch, zonedParts } from '../time.ts';
import * as P from './providers.ts';

export interface QuoteResult {
  quote: Quote | null;
  error?: string;
  /** 供應商失敗時改用的備援來源 */
  fallback?: 'manual' | 'last_known';
}

const memCache = new Map<string, { quote: Quote; expires: number }>();
const inflight = new Map<string, Promise<QuoteResult>>();

export function clearQuoteCache(symbol?: string) {
  if (symbol) memCache.delete(symbol.toUpperCase());
  else memCache.clear();
}

function ttlFor(inst: Instrument): number {
  return getSession(inst.category).isOpen ? 20_000 : 10 * 60_000;
}

/** 供應商路由 */
async function fetchFromProvider(inst: Instrument): Promise<Quote | null> {
  switch (inst.provider) {
    case 'finmind':
      if (inst.category === 'tw_future') return P.finmindFuture(inst);
      try {
        const q = await P.finmindStock(inst);
        if (q) return q;
      } catch {
        /* 改用 Yahoo */
      }
      return P.yahoo(inst, inst.providerSymbol); // 例：2330.TW
    case 'finmind_option':
      return P.finmindOption(inst);
    case 'yahoo':
      return P.yahoo(inst);
    case 'binance':
      return P.binance(inst);
    case 'manual':
      return null;
  }
}

function manualQuote(inst: Instrument): (Quote & { mode: string }) | null {
  const r = getDb().prepare('SELECT * FROM manual_quotes WHERE symbol = ?').get(inst.symbol) as any;
  if (!r) return null;
  const tz = inst.currency === 'USD' ? 'America/New_York' : 'Asia/Taipei';
  return {
    symbol: inst.symbol,
    price: r.price,
    prevClose: r.prev_close ?? undefined,
    currency: inst.currency,
    basis: 'MANUAL',
    quoteDate: r.quote_date,
    quoteTime: r.quote_time ?? undefined,
    quoteTimeZone: tz,
    quoteEpoch: tz === 'Asia/Taipei' ? taipeiEpoch(r.quote_date, r.quote_time || '13:30:00') : r.set_at,
    source: `管理員手動報價 (${r.set_by})`,
    fetchedAt: r.set_at,
    note: r.note,
    mode: r.mode,
  };
}

function lastKnown(symbol: string): Quote | null {
  const r = getDb().prepare('SELECT json FROM quote_cache WHERE symbol = ?').get(symbol) as any;
  return r ? (JSON.parse(r.json) as Quote) : null;
}

function remember(q: Quote) {
  getDb()
    .prepare(
      'INSERT INTO quote_cache (symbol, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at'
    )
    .run(q.symbol, JSON.stringify(q), q.fetchedAt);
}

export async function getQuote(inst: Instrument, opts: { force?: boolean } = {}): Promise<QuoteResult> {
  const key = inst.symbol;
  const settings = getSettings();
  const manual = settings.allowManualQuotes ? manualQuote(inst) : null;
  if (manual && manual.mode === 'override') {
    const { mode, ...q } = manual;
    return { quote: q, fallback: 'manual' };
  }

  const cached = memCache.get(key);
  if (!opts.force && cached && cached.expires > Date.now()) return { quote: cached.quote };

  const running = inflight.get(key);
  if (running) return running;

  const p = (async (): Promise<QuoteResult> => {
    let error: string | undefined;
    try {
      const q = await fetchFromProvider(inst);
      if (q) {
        memCache.set(key, { quote: q, expires: Date.now() + ttlFor(inst) });
        remember(q);
        return { quote: q };
      }
      error = '供應商未回傳此商品報價';
    } catch (e: any) {
      error = e?.message || String(e);
    }
    if (manual) {
      const { mode, ...q } = manual;
      return { quote: q, fallback: 'manual', error };
    }
    const lk = lastKnown(key);
    if (lk) return { quote: lk, fallback: 'last_known', error };
    return { quote: null, error };
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

// ───────────── 匯率 USD/TWD ─────────────
export interface FxResult {
  rate: number;
  source: string;
  basis: Quote['basis'];
  quoteDate: string;
}
let fxCache: { fx: FxResult; expires: number } | null = null;

export async function getUsdTwd(): Promise<FxResult | null> {
  if (fxCache && fxCache.expires > Date.now()) return fxCache.fx;
  try {
    const q = await P.yahoo(
      { symbol: 'USDTWD', category: 'crypto' } as Instrument, // 外匯近 24 小時交易，借用 24/7 時段判斷
      'TWD=X'
    );
    if (q && q.price > 20 && q.price < 50) {
      const fx = { rate: q.price, source: 'Yahoo TWD=X', basis: q.basis, quoteDate: q.quoteDate };
      fxCache = { fx, expires: Date.now() + 10 * 60_000 };
      remember({ ...q, symbol: 'USDTWD' });
      return fx;
    }
  } catch {
    /* 改用備援 */
  }
  const m = getSettings().manualUsdTwd;
  if (m && m > 0) return { rate: m, source: '管理員設定匯率', basis: 'MANUAL', quoteDate: taipei().dateStr };
  const lk = lastKnown('USDTWD');
  if (lk) return { rate: lk.price, source: `${lk.source} (最後一次取得)`, basis: lk.basis, quoteDate: lk.quoteDate };
  return null;
}

// ───────────── 報價 → 成交紀錄用快照 ─────────────
export function toSnapshot(q: Quote, now = Date.now()): QuoteSnapshot {
  const todayTw = taipei(now).dateStr;
  // 用「報價時間點換算成台北日期」判斷是否為今日報價
  const quoteTwDate = zonedParts(q.quoteEpoch, 'Asia/Taipei').dateStr;
  return {
    basis: q.basis,
    quoteDate: q.quoteDate,
    quoteTime: q.quoteTime,
    quoteTimeZone: q.quoteTimeZone,
    source: q.source,
    note: q.note,
    ageMinutes: Math.max(0, Math.round((now - q.quoteEpoch) / 60_000)),
    stale: quoteTwDate < todayTw && q.basis !== 'LIVE',
  };
}

// ───────────── 管理員手動報價 ─────────────
export function setManualQuote(input: {
  symbol: string;
  price: number;
  prevClose?: number | null;
  quoteDate: string;
  quoteTime?: string | null;
  note: string;
  mode: 'fallback' | 'override';
  setBy: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO manual_quotes (symbol, price, prev_close, quote_date, quote_time, note, mode, set_by, set_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, prev_close=excluded.prev_close, quote_date=excluded.quote_date,
         quote_time=excluded.quote_time, note=excluded.note, mode=excluded.mode, set_by=excluded.set_by, set_at=excluded.set_at`
    )
    .run(
      input.symbol, input.price, input.prevClose ?? null, input.quoteDate, input.quoteTime ?? null,
      input.note, input.mode, input.setBy, Date.now()
    );
  clearQuoteCache(input.symbol);
}

export function deleteManualQuote(symbol: string) {
  getDb().prepare('DELETE FROM manual_quotes WHERE symbol = ?').run(symbol);
  clearQuoteCache(symbol);
}

export function listManualQuotes() {
  return getDb().prepare('SELECT * FROM manual_quotes ORDER BY set_at DESC').all();
}
