import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.QUOTES_OFFLINE = '1';

const { getDb } = await import('../server/db.ts');
const { seedInstruments } = await import('../server/instruments.ts');
const { createUser } = await import('../server/auth.ts');
const { setManualQuote, clearQuoteCache } = await import('../server/quotes/service.ts');
const { updateSettings } = await import('../server/settings.ts');
const E = await import('../server/trading/engine.ts');
const { taipei, taipeiDateDaysAgo } = await import('../server/time.ts');

let uid = 0;
const today = () => taipei().dateStr;
const quote = (symbol: string, price: number, date = today()) =>
  setManualQuote({ symbol, price, quoteDate: date, quoteTime: '13:30:00', note: 'test', mode: 'override', setBy: 'test' });

before(() => {
  getDb();
  seedInstruments();
  uid = createUser({ name: '測試生', password: '1234' }).id;
});

async function reconciles() {
  const { summary } = await E.valueAccount(uid);
  const diff = summary.nav - summary.initialCapital - (summary.realizedPnl + summary.unrealizedPnl);
  assert.ok(Math.abs(diff) < 0.05, `NAV 對帳差異 ${diff}`);
  return summary;
}

test('現股買進 → 部分賣出：現金、手續費、證交稅、已實現損益正確', async () => {
  quote('2330', 1000);
  const buy = await E.executeOrder(uid, { symbol: '2330', side: 'LONG', intent: 'OPEN', qty: 2 }, 't');
  assert.equal(buy.price, 1000);
  assert.equal(buy.notional, 2_000_000);
  assert.equal(buy.fee, 2850); // 0.1425%
  assert.equal(buy.tax, 0);
  assert.equal(buy.quote.basis, 'MANUAL');
  assert.equal(buy.quote.quoteDate, today());
  await reconciles();

  quote('2330', 1100);
  const sell = await E.executeOrder(uid, { symbol: '2330', side: 'LONG', intent: 'CLOSE', qty: 1 }, 't');
  assert.equal(sell.fee, 1567);
  assert.equal(sell.tax, 3300); // 0.3%
  // 成本 = (2,000,000 + 2,850)/2 = 1,001,425；賣出淨額 1,100,000 - 1,567 - 3,300
  assert.equal(sell.realizedPnl, 1_100_000 - 1567 - 3300 - 1_001_425);
  const s = await reconciles();
  assert.equal(s.unrealizedPnl, 1_100_000 - 1_001_425);
});

test('台指期多單：保證金鎖定、點數損益、平倉後釋放', async () => {
  quote('TX', 20000);
  const open = await E.executeOrder(uid, { symbol: 'TX', side: 'LONG', intent: 'OPEN', qty: 1 }, 't');
  assert.equal(open.notional, 4_000_000);
  assert.equal(open.marginChange, 400_000); // 10%
  quote('TX', 20100);
  let s = await reconciles();
  const pos = (await E.valueAccount(uid)).positions.find(p => p.symbol === 'TX')!;
  assert.equal(pos.unrealizedPnl, 100 * 200 - (open.fee + open.tax));
  const close = await E.executeOrder(uid, { symbol: 'TX', side: 'LONG', intent: 'CLOSE', qty: 1 }, 't');
  assert.equal(close.marginChange, -400_000);
  assert.equal(close.realizedPnl, 20_000 - close.fee - close.tax - (open.fee + open.tax));
  s = await reconciles();
  assert.ok(!(await E.valueAccount(uid)).positions.some(p => p.symbol === 'TX'));
});

test('融券放空：價格下跌獲利', async () => {
  quote('2603', 200);
  const open = await E.executeOrder(uid, { symbol: '2603', side: 'SHORT', intent: 'OPEN', qty: 1 }, 't');
  assert.equal(open.tax, 600); // 開空 = 賣出，課證交稅
  quote('2603', 180);
  const close = await E.executeOrder(uid, { symbol: '2603', side: 'SHORT', intent: 'CLOSE', qty: 1 }, 't');
  assert.equal(close.tax, 0);
  assert.equal(close.realizedPnl, 20_000 - close.fee - (open.fee + open.tax));
  await reconciles();
});

test('現金不足會被擋下', async () => {
  quote('3008', 3000);
  const pv = await E.previewOrder(uid, { symbol: '3008', side: 'LONG', intent: 'OPEN', qty: 100 });
  assert.equal(pv.allowed, false);
  assert.match(pv.blockReason!, /現金不足/);
  await assert.rejects(E.executeOrder(uid, { symbol: '3008', side: 'LONG', intent: 'OPEN', qty: 100 }, 't'));
});

test('取不到真實報價時拒絕交易，不使用任何預設價', async () => {
  clearQuoteCache();
  await assert.rejects(
    E.previewOrder(uid, { symbol: '2454', side: 'LONG', intent: 'OPEN', qty: 1 }),
    (e: any) => e.status === 409 && /取不到/.test(e.message)
  );
});

test('舊報價：預設允許但標示 stale；關閉設定後拒絕', async () => {
  quote('2882', 60, taipeiDateDaysAgo(3));
  const pv = await E.previewOrder(uid, { symbol: '2882', side: 'LONG', intent: 'OPEN', qty: 1 });
  assert.equal(pv.quoteSnapshot.stale, true);
  assert.ok(pv.warnings.some(w => w.includes('非今日價格')));
  updateSettings({ allowStaleQuotes: false });
  const pv2 = await E.previewOrder(uid, { symbol: '2882', side: 'LONG', intent: 'OPEN', qty: 1 });
  assert.equal(pv2.allowed, false);
  updateSettings({ allowStaleQuotes: true });
});

test('美股：沒有匯率時拒絕；設定匯率後以 TWD 結算', async () => {
  quote('NVDA', 200);
  updateSettings({ manualUsdTwd: null });
  await assert.rejects(E.previewOrder(uid, { symbol: 'NVDA', side: 'LONG', intent: 'OPEN', qty: 10 }), /匯率/);
  updateSettings({ manualUsdTwd: 30 });
  const t = await E.executeOrder(uid, { symbol: 'NVDA', side: 'LONG', intent: 'OPEN', qty: 10 }, 't');
  assert.equal(t.fx, 30);
  assert.equal(t.notional, 60_000);
  await reconciles();
});

test('不可平倉超過持有數量；不可放空不開放的商品', async () => {
  const pv = await E.previewOrder(uid, { symbol: '2330', side: 'LONG', intent: 'CLOSE', qty: 5 });
  assert.equal(pv.allowed, false);
  quote('NVDA', 200);
  const pv2 = await E.previewOrder(uid, { symbol: 'NVDA', side: 'SHORT', intent: 'OPEN', qty: 1 });
  assert.equal(pv2.allowed, false);
});
