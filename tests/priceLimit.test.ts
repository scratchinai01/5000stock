import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitPrices, checkPriceLimit } from '../server/trading/priceLimit.ts';
import type { Instrument, Quote } from '../shared/types.ts';

const stock: Instrument = {
  symbol: '2317', name: '鴻海', category: 'tw_stock', currency: 'TWD', multiplier: 1000, unitLabel: '張',
  marginRate: 0, shortable: true, minQty: 1, provider: 'finmind', providerSymbol: '2317', enabled: true,
};
const q = (p: Partial<Quote>): Quote => ({
  symbol: '2317', price: 110, prevClose: 100, currency: 'TWD', basis: 'LIVE', quoteDate: '2026-10-12',
  quoteTime: '10:00:00', quoteTimeZone: 'Asia/Taipei', quoteEpoch: 0, source: 'test', fetchedAt: 0, ...p,
});

test('漲跌停價：依升降單位取整（漲停向下、跌停向上）', () => {
  assert.deepEqual(limitPrices('tw_stock', 100), { up: 110, down: 90 });
  assert.deepEqual(limitPrices('tw_stock', 47.3), { up: 52, down: 42.6 }); // 52.03→52 (0.1 檔)、42.57→42.6 (0.05 檔)
  assert.deepEqual(limitPrices('tw_stock', 1005), { up: 1105, down: 905 }); // 1105.5→1105 (5 元檔)、904.5→905 (1 元檔)
  assert.deepEqual(limitPrices('tw_stock', 9.5), { up: 10.45, down: 8.55 }); // 10.45 屬 0.05 檔
  assert.deepEqual(limitPrices('tw_etf', 150), { up: 165, down: 135 });
});

test('規則 2：即時報價漲停，委賣量 0 = 鎖死，拒絕買進', () => {
  const r = checkPriceLimit(stock, q({ bestAsk: undefined, bestAskVolume: 0 }), 'LONG', 'OPEN', 1);
  assert.equal(r.state, 'LIMIT_UP');
  assert.match(r.block!, /鎖死/);
});

test('規則 2：漲停未鎖死，可買但不得超過委賣量', () => {
  const book = { bestAsk: 110, bestAskVolume: 35 };
  assert.equal(checkPriceLimit(stock, q(book), 'LONG', 'OPEN', 35).block, undefined);
  assert.match(checkPriceLimit(stock, q(book), 'LONG', 'OPEN', 36).block!, /最多只能買進 35 張/);
  // 融券回補也是買進方向
  assert.match(checkPriceLimit(stock, q(book), 'SHORT', 'CLOSE', 50).block!, /最多只能買進 35 張/);
});

test('漲停時賣出一定可以成交', () => {
  const r = checkPriceLimit(stock, q({ bestAskVolume: 0 }), 'LONG', 'CLOSE', 999);
  assert.equal(r.block, undefined);
});

test('規則 2：跌停看委買量；跌停時買進可成交', () => {
  const down = { price: 90, bestBid: 90, bestBidVolume: 0 };
  assert.match(checkPriceLimit(stock, q(down), 'LONG', 'CLOSE', 1).block!, /跌停 90 鎖死/);
  assert.match(checkPriceLimit(stock, q(down), 'SHORT', 'OPEN', 1).block!, /鎖死/);
  assert.equal(checkPriceLimit(stock, q(down), 'LONG', 'OPEN', 10).block, undefined);
  assert.equal(checkPriceLimit(stock, q({ ...down, bestBidVolume: 5 }), 'LONG', 'CLOSE', 5).block, undefined);
});

test('規則 1：非即時報價或缺委買賣資料，漲停一律不能買', () => {
  assert.match(checkPriceLimit(stock, q({ basis: 'CLOSE' }), 'LONG', 'OPEN', 1).block!, /不是即時報價/);
  assert.match(checkPriceLimit(stock, q({ basis: 'LIVE' }), 'LONG', 'OPEN', 1).block!, /缺少委買賣資料/);
});

test('未達漲跌停、無前一日收盤價、不適用的商品：不限制', () => {
  assert.equal(checkPriceLimit(stock, q({ price: 105 }), 'LONG', 'OPEN', 1).state, 'NONE');
  assert.equal(checkPriceLimit(stock, q({ prevClose: undefined }), 'LONG', 'OPEN', 1).state, 'NONE');
  assert.equal(checkPriceLimit({ ...stock, category: 'tw_bond_etf' }, q({}), 'LONG', 'OPEN', 1).state, 'NONE');
  assert.equal(checkPriceLimit({ ...stock, category: 'us_stock' }, q({}), 'LONG', 'OPEN', 1).state, 'NONE');
});
