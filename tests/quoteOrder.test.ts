import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { preferNewer } = await import('../server/quotes/service.ts');
const { taipeiEpoch } = await import('../server/time.ts');
import type { Quote } from '../shared/types.ts';

const base = { symbol: 'TX', currency: 'TWD', quoteTimeZone: 'Asia/Taipei', fetchedAt: 1 } as const;
const night: Quote = { ...base, price: 48705, basis: 'LIVE', quoteDate: '2026-10-09', quoteTime: '04:59:00',
  quoteEpoch: taipeiEpoch('2026-10-09', '04:59:00'), source: 'FinMind taiwan_futures_snapshot' };
const dayClose: Quote = { ...base, price: 49349, basis: 'CLOSE', quoteDate: '2026-10-08', quoteTime: '13:45:00',
  quoteEpoch: taipeiEpoch('2026-10-08', '13:45:00'), source: 'FinMind TaiwanFuturesDaily' };

test('報價不可倒退：夜盤最後成交比前一日日盤收盤新，估值用夜盤價', () => {
  const q = preferNewer(dayClose, night);
  assert.equal(q.price, 48705);
  assert.equal(q.basis, 'CLOSE');
  assert.equal(q.quoteTime, '04:59:00');
});

test('新的日資料出來後，改用新的日資料', () => {
  const nextDay = { ...dayClose, price: 48800, quoteDate: '2026-10-12', quoteEpoch: taipeiEpoch('2026-10-12', '13:45:00') };
  assert.equal(preferNewer(nextDay, night).price, 48800);
});

test('最後已知報價是收盤或手動時，不覆蓋供應商資料', () => {
  assert.equal(preferNewer(dayClose, { ...night, basis: 'MANUAL' }).price, 49349);
});

test('成交紀錄中的夜盤即時成交價，比快取裡的前一日收盤新 → 視為最後已知報價', async () => {
  const { getDb } = await import('../server/db.ts');
  const { seedInstruments } = await import('../server/instruments.ts');
  const { newestKnown } = await import('../server/quotes/service.ts');
  const d = getDb();
  seedInstruments();
  d.prepare("INSERT INTO users (name, password_hash, created_at) VALUES ('t', 'x', 0)").run();
  d.prepare('INSERT INTO quote_cache (symbol, json, fetched_at) VALUES (?, ?, ?)').run('TX', JSON.stringify(dayClose), 1);
  d.prepare(`INSERT INTO trades (user_id, symbol, name, category, side, intent, qty, price, fx, notional, fee, tax,
      cash_change, margin_change, executed_at, market_open, session_name, quote_json)
    VALUES (1, 'TX', '台指期', 'tw_future', 'LONG', 'OPEN', 1, 48705, 1, 0, 0, 0, 0, 0, 1, 1, 's', ?)`)
    .run(JSON.stringify({ basis: 'LIVE', quoteDate: '2026-10-09', quoteTime: '04:59:00', quoteTimeZone: 'Asia/Taipei', source: 'snap', ageMinutes: 0, stale: false }));
  const lk = newestKnown('TX')!;
  assert.equal(lk.price, 48705);
  assert.equal(preferNewer(dayClose, lk).price, 48705);
});
