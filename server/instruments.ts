// 商品目錄。這裡只放「合約規格」(乘數、單位、保證金比例)，不放任何價格。
import fs from 'node:fs';
import path from 'node:path';
import type { Category, Instrument } from '../shared/types.ts';
import { getDb } from './db.ts';

type Seed = Omit<Instrument, 'enabled'> & { enabled?: boolean };

const twStock = (symbol: string, name: string, market: 'TW' | 'TWO' = 'TW'): Seed => ({
  symbol, name, category: 'tw_stock', currency: 'TWD', multiplier: 1000, unitLabel: '張',
  marginRate: 0.9, shortable: true, minQty: 1, provider: 'finmind', providerSymbol: `${symbol}.${market}`,
});
const twEtf = (symbol: string, name: string, market: 'TW' | 'TWO' = 'TW', category: Category = 'tw_etf'): Seed => ({
  symbol, name, category, currency: 'TWD', multiplier: 1000, unitLabel: '張',
  marginRate: 0.9, shortable: category === 'tw_etf', minQty: 1, provider: 'finmind', providerSymbol: `${symbol}.${market}`,
});
const twFuture = (symbol: string, name: string, multiplier: number): Seed => ({
  symbol, name, category: 'tw_future', currency: 'TWD', multiplier, unitLabel: '口',
  marginRate: 0.1, shortable: true, minQty: 1, provider: 'finmind', providerSymbol: 'TX',
});
const us = (symbol: string, name: string): Seed => ({
  symbol, name, category: 'us_stock', currency: 'USD', multiplier: 1, unitLabel: '股',
  marginRate: 0, shortable: false, minQty: 1, provider: 'yahoo', providerSymbol: symbol,
});
/** 原物料：multiplier = 合約規模 × 報價單位 (例：玉米報價為美分/英斗 → 5000 × 0.01) */
const cmd = (symbol: string, name: string, multiplier: number, unit = '口'): Seed => ({
  symbol, name, category: 'commodity', currency: 'USD', multiplier, unitLabel: unit,
  marginRate: 0.1, shortable: true, minQty: 1, provider: 'yahoo', providerSymbol: `${symbol}=F`,
});
const crypto = (symbol: string, name: string): Seed => ({
  symbol, name, category: 'crypto', currency: 'USD', multiplier: 1, unitLabel: '枚',
  marginRate: 0, shortable: false, minQty: 0.0001, provider: 'binance', providerSymbol: `${symbol}USDT`,
});

export const SEED_INSTRUMENTS: Seed[] = [
  twStock('2330', '台積電'), twStock('2317', '鴻海'), twStock('2454', '聯發科'), twStock('2382', '廣達'),
  twStock('2308', '台達電'), twStock('2303', '聯電'), twStock('2603', '長榮'), twStock('2609', '陽明'),
  twStock('2881', '富邦金'), twStock('2882', '國泰金'), twStock('3231', '緯創'), twStock('3008', '大立光'),
  twStock('2376', '技嘉'), twStock('3017', '奇鋐'), twStock('2002', '中鋼'), twStock('2634', '漢翔'),
  twEtf('0050', '元大台灣50'), twEtf('006208', '富邦台50'), twEtf('0056', '元大高股息'), twEtf('00878', '國泰永續高股息'),
  twEtf('00919', '群益台灣精選高息'), twEtf('00929', '復華台灣科技優息'), twEtf('00940', '元大台灣價值高息'),
  twEtf('00713', '元大台灣高息低波'), twEtf('0052', '富邦科技'), twEtf('00631L', '元大台灣50正2'),
  twEtf('00632R', '元大台灣50反1'),
  twEtf('00679B', '元大美債20年', 'TWO', 'tw_bond_etf'), twEtf('00687B', '國泰20年美債', 'TWO', 'tw_bond_etf'),
  twEtf('00720B', '元大投資級公司債', 'TWO', 'tw_bond_etf'), twEtf('00772B', '中信高評級公司債', 'TWO', 'tw_bond_etf'),
  twEtf('00937B', '群益ESG投等債20+', 'TWO', 'tw_bond_etf'), twEtf('00751B', '元大AAA至A公司債', 'TWO', 'tw_bond_etf'),
  twFuture('TX', '臺股期貨 (大台)', 200), twFuture('MTX', '小型臺指期貨 (小台)', 50), twFuture('TMF', '微型臺指期貨 (微台)', 10),
  us('NVDA', '輝達'), us('AAPL', '蘋果'), us('MSFT', '微軟'), us('GOOGL', 'Alphabet'), us('AMZN', '亞馬遜'),
  us('META', 'Meta'), us('TSLA', '特斯拉'), us('TSM', '台積電 ADR'), us('AVGO', '博通'), us('AMD', '超微'),
  us('INTC', '英特爾'), us('NFLX', '網飛'), us('PLTR', 'Palantir'), us('QQQ', '那斯達克100 ETF'),
  us('SPY', '標普500 ETF'), us('VOO', 'Vanguard 標普500'), us('SOXX', '費城半導體 ETF'),
  cmd('CL', 'WTI 原油', 1000), cmd('BZ', '布蘭特原油', 1000), cmd('NG', '天然氣', 10000), cmd('RB', 'RBOB 汽油', 42000),
  cmd('HO', '燃油', 42000), cmd('GC', '黃金', 100), cmd('SI', '白銀', 5000), cmd('HG', '銅', 25000),
  cmd('PL', '白金', 50), cmd('PA', '鈀金', 100), cmd('ZC', '玉米 (美分報價)', 50), cmd('ZS', '黃豆 (美分報價)', 50),
  cmd('ZW', '小麥 (美分報價)', 50), cmd('KC', '咖啡 (美分報價)', 375), cmd('SB', '11號糖 (美分報價)', 1120),
  cmd('CC', '可可', 10), cmd('CT', '棉花 (美分報價)', 500), cmd('LE', '活牛 (美分報價)', 400), cmd('HE', '瘦肉豬 (美分報價)', 400),
  crypto('BTC', '比特幣'), crypto('ETH', '以太坊'), crypto('SOL', 'Solana'), crypto('BNB', 'BNB'),
];

export function seedInstruments() {
  const d = getDb();
  const stmt = d.prepare(`INSERT OR IGNORE INTO instruments
    (symbol, name, category, currency, multiplier, unit_label, margin_rate, shortable, min_qty, provider, provider_symbol, enabled, option_type, strike, contract_month)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const i of SEED_INSTRUMENTS) upsertParams(stmt, i);
}

function upsertParams(stmt: any, i: Seed) {
  stmt.run(
    i.symbol, i.name, i.category, i.currency, i.multiplier, i.unitLabel, i.marginRate, i.shortable ? 1 : 0,
    i.minQty, i.provider, i.providerSymbol, i.enabled === false ? 0 : 1, i.optionType ?? null, i.strike ?? null,
    i.contractMonth ?? null
  );
}

function rowToInstrument(r: any): Instrument {
  return {
    symbol: r.symbol,
    name: r.name,
    category: r.category,
    currency: r.currency,
    multiplier: r.multiplier,
    unitLabel: r.unit_label,
    marginRate: r.margin_rate,
    shortable: !!r.shortable,
    minQty: r.min_qty,
    provider: r.provider,
    providerSymbol: r.provider_symbol,
    enabled: !!r.enabled,
    optionType: r.option_type ?? undefined,
    strike: r.strike ?? undefined,
    contractMonth: r.contract_month ?? undefined,
  };
}

export function listInstruments(includeDisabled = false): Instrument[] {
  const rows = getDb()
    .prepare(`SELECT * FROM instruments ${includeDisabled ? '' : 'WHERE enabled = 1'} ORDER BY category, symbol`)
    .all();
  return rows.map(rowToInstrument);
}

// ── 全台股目錄 (4,329 檔)：讓學生能交易未預先列入的上市櫃股票 ──
interface CatalogItem { symbol: string; name: string; industry: string; type: string }
let twCatalog: CatalogItem[] | null = null;
function loadTwCatalog(): CatalogItem[] {
  if (twCatalog) return twCatalog;
  try {
    twCatalog = JSON.parse(fs.readFileSync(path.resolve('data', 'taiwanStockList.json'), 'utf8'));
  } catch {
    twCatalog = [];
  }
  return twCatalog!;
}

/** 取得商品；若為台股目錄內但尚未建立的代號，自動建立 (仍需有真實報價才能交易) */
export function getInstrument(symbol: string): Instrument | null {
  const sym = symbol.trim().toUpperCase();
  const r = getDb().prepare('SELECT * FROM instruments WHERE symbol = ?').get(sym);
  if (r) return rowToInstrument(r);

  const item = loadTwCatalog().find(c => c.symbol.toUpperCase() === sym);
  if (item) {
    const isEtf = /^00/.test(sym);
    const isBond = isEtf && sym.endsWith('B');
    const market = item.type === 'tpex' ? 'TWO' : 'TW';
    const seed = isEtf ? twEtf(sym, item.name, market, isBond ? 'tw_bond_etf' : 'tw_etf') : twStock(sym, item.name, market);
    saveInstrument({ ...seed, enabled: true } as Instrument);
    return getInstrument(sym);
  }
  return null;
}

export function saveInstrument(i: Instrument) {
  const stmt = getDb().prepare(`INSERT INTO instruments
    (symbol, name, category, currency, multiplier, unit_label, margin_rate, shortable, min_qty, provider, provider_symbol, enabled, option_type, strike, contract_month)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, category=excluded.category, currency=excluded.currency,
      multiplier=excluded.multiplier, unit_label=excluded.unit_label, margin_rate=excluded.margin_rate,
      shortable=excluded.shortable, min_qty=excluded.min_qty, provider=excluded.provider,
      provider_symbol=excluded.provider_symbol, enabled=excluded.enabled, option_type=excluded.option_type,
      strike=excluded.strike, contract_month=excluded.contract_month`);
  upsertParams(stmt, i);
}

export function searchInstruments(q: string, limit = 30): Instrument[] {
  const query = q.trim().toUpperCase();
  if (!query) return listInstruments().slice(0, limit);
  const own = listInstruments().filter(
    i => i.symbol.includes(query) || i.name.toUpperCase().includes(query)
  );
  const seen = new Set(own.map(i => i.symbol));
  const extra: Instrument[] = [];
  for (const c of loadTwCatalog()) {
    if (own.length + extra.length >= limit) break;
    if (seen.has(c.symbol)) continue;
    if (c.symbol.toUpperCase().includes(query) || c.name.includes(q.trim())) {
      const isEtf = /^00/.test(c.symbol);
      const isBond = isEtf && c.symbol.endsWith('B');
      const market = c.type === 'tpex' ? 'TWO' : 'TW';
      const seed = isEtf ? twEtf(c.symbol, c.name, market, isBond ? 'tw_bond_etf' : 'tw_etf') : twStock(c.symbol, c.name, market);
      extra.push({ ...seed, enabled: true } as Instrument);
    }
  }
  return [...own, ...extra].slice(0, limit);
}

/** 台指選擇權代號：TXO-202610-48000-C */
export function parseOptionSymbol(sym: string) {
  const m = sym.toUpperCase().match(/^TXO-(\d{6})-(\d+)-(C|P)$/);
  if (!m) return null;
  return { contractMonth: m[1], strike: Number(m[2]), optionType: m[3] as 'C' | 'P' };
}

export function ensureOptionInstrument(sym: string): Instrument | null {
  const p = parseOptionSymbol(sym);
  if (!p) return null;
  const existing = getDb().prepare('SELECT * FROM instruments WHERE symbol = ?').get(sym.toUpperCase());
  if (existing) return rowToInstrument(existing);
  const inst: Instrument = {
    symbol: sym.toUpperCase(),
    name: `臺指選擇權 ${p.contractMonth} ${p.strike} ${p.optionType === 'C' ? '買權' : '賣權'}`,
    category: 'tw_option',
    currency: 'TWD',
    multiplier: 50,
    unitLabel: '口',
    marginRate: 0,
    shortable: false, // 本系統僅開放買方 (風險有限)，不開放賣方
    minQty: 1,
    provider: 'finmind_option',
    providerSymbol: 'TXO',
    enabled: true,
    optionType: p.optionType,
    strike: p.strike,
    contractMonth: p.contractMonth,
  };
  saveInstrument(inst);
  return inst;
}
