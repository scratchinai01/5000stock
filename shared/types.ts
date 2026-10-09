// 前後端共用型別。所有金額單位為新台幣 (TWD)，除非欄位名稱標明 Usd / 原幣。

export type Category =
  | 'tw_stock'   // 台股現股 (上市/上櫃)
  | 'tw_etf'     // 台股 ETF
  | 'tw_bond_etf'// 債券 ETF
  | 'tw_future'  // 台指期 (TX/MTX/TMF)
  | 'tw_option'  // 台指選擇權 (TXO)
  | 'us_stock'   // 美股 / 美國 ETF
  | 'commodity'  // 國際原物料期貨
  | 'crypto';    // 加密貨幣

export const CATEGORY_LABEL: Record<Category, string> = {
  tw_stock: '台股',
  tw_etf: 'ETF',
  tw_bond_etf: '債券ETF',
  tw_future: '台指期',
  tw_option: '台指選擇權',
  us_stock: '美股',
  commodity: '原物料期貨',
  crypto: '加密貨幣',
};

/**
 * 報價來源等級 —— 系統不使用任何程式寫死的價格。
 * LIVE    : 交易所/券商即時資料 (FinMind 盤中快照、Binance)
 * DELAYED : 盤中延遲報價 (Yahoo，通常延遲 15~20 分鐘)
 * CLOSE   : 最近一個交易日的收盤 / 結算價
 * MANUAL  : 管理員手動輸入 (必須附註來源)，會在稽核頁標示
 */
export type PriceBasis = 'LIVE' | 'DELAYED' | 'CLOSE' | 'MANUAL';

export const BASIS_LABEL: Record<PriceBasis, string> = {
  LIVE: '即時',
  DELAYED: '盤中延遲',
  CLOSE: '收盤價',
  MANUAL: '管理員手動報價',
};

export interface Quote {
  symbol: string;
  price: number;           // 原幣報價
  prevClose?: number;
  currency: 'TWD' | 'USD';
  basis: PriceBasis;
  /** 報價所屬「交易所當地」日期 YYYY-MM-DD */
  quoteDate: string;
  /** 報價所屬時間 HH:MM:SS (交易所當地)；收盤價可能為空 */
  quoteTime?: string;
  /** 報價時間的時區，如 Asia/Taipei、America/New_York */
  quoteTimeZone: string;
  /** 報價事件的 epoch 毫秒 (可比較新舊) */
  quoteEpoch: number;
  source: string;          // 例："FinMind TaiwanStockPrice"、"Yahoo 2330.TW"
  fetchedAt: number;       // 伺服器取得此報價的 epoch 毫秒
  note?: string;           // 手動報價說明
  /** 最佳一檔委買／委賣 (僅即時快照提供；台股單位為張) */
  bestBid?: number;
  bestBidVolume?: number;
  bestAsk?: number;
  bestAskVolume?: number;
}

export interface Instrument {
  symbol: string;
  name: string;
  category: Category;
  currency: 'TWD' | 'USD';
  /** 每 1 單位 (張/口/股/枚) 的價格乘數；例：台股 1 張 = 1000，TX = 200 */
  multiplier: number;
  unitLabel: string;       // 張、口、股、枚
  /** 保證金類商品的原始保證金比例 (佔名目價值)；現貨為 0 */
  marginRate: number;
  /** 可否放空 */
  shortable: boolean;
  /** 最小下單數量 (crypto 可為小數) */
  minQty: number;
  provider: 'finmind' | 'yahoo' | 'binance' | 'finmind_option' | 'manual';
  providerSymbol: string;
  enabled: boolean;
  /** 選擇權欄位 */
  optionType?: 'C' | 'P';
  strike?: number;
  contractMonth?: string;
}

export type Side = 'LONG' | 'SHORT';
export type OrderIntent = 'OPEN' | 'CLOSE';

export interface QuoteSnapshot {
  basis: PriceBasis;
  quoteDate: string;
  quoteTime?: string;
  quoteTimeZone: string;
  source: string;
  note?: string;
  /** 下單當下距離報價時間的分鐘數 */
  ageMinutes: number;
  /** 報價日期 (台北) 早於下單日 */
  stale: boolean;
}

export interface Position {
  id: number;
  userId: number;
  symbol: string;
  name: string;
  category: Category;
  side: Side;
  qty: number;
  avgPrice: number;        // 原幣
  multiplier: number;
  currency: 'TWD' | 'USD';
  fxAtEntry: number;       // 建倉時 USD/TWD (TWD 商品為 1)
  marginLocked: number;    // TWD，現貨為 0
  costBasis: number;       // TWD，現貨多單的總成本 (含買進手續費)
  openedAt: number;
  updatedAt: number;
  // 以下為估值時填入
  markPrice?: number;
  markQuote?: QuoteSnapshot | null;
  marketValue?: number;    // TWD；現貨=市值，保證金類=保證金+未實現損益
  unrealizedPnl?: number;  // TWD
}

export interface Trade {
  id: number;
  userId: number;
  userName?: string;
  symbol: string;
  name: string;
  category: Category;
  side: Side;
  intent: OrderIntent;
  qty: number;
  price: number;           // 原幣成交價 (= 報價)
  fx: number;
  notional: number;        // TWD
  fee: number;
  tax: number;
  cashChange: number;      // 對現金的影響 (TWD，正=增加)
  marginChange: number;    // 保證金鎖定變化
  realizedPnl: number;     // 平倉才有
  executedAt: number;      // epoch ms
  executedAtText: string;  // 台北時間 YYYY-MM-DD HH:MM:SS
  marketOpen: boolean;     // 下單當下該商品是否在交易時段
  sessionName: string;
  quote: QuoteSnapshot;
  note?: string;
  flagged?: boolean;       // 管理員標記
  flagReason?: string;
}

export interface AccountSummary {
  userId: number;
  name: string;
  team?: string;
  initialCapital: number;
  cash: number;
  marginLocked: number;
  positionsValue: number;
  nav: number;
  returnPct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  /** 有部位缺乏報價、以最後成交價估值 */
  hasUnpricedPositions: boolean;
  valuedAt: number;
}

export interface SessionInfo {
  symbolClass: string;
  isOpen: boolean;
  sessionName: string;
  nextChange: string;
}

export interface User {
  id: number;
  name: string;
  role: 'student' | 'admin';
  team?: string;
  status: 'active' | 'disabled';
  createdAt: number;
}

export interface Settings {
  competitionName: string;
  initialCapital: number;
  allowSelfRegister: boolean;
  /** true: 非交易時段禁止下單 */
  enforceTradingHours: boolean;
  /** true: 允許以「非今日」的收盤價成交 (會標示 stale) */
  allowStaleQuotes: boolean;
  /** 交易時段中，報價超過幾分鐘就拒絕成交 (0 = 不限制) */
  maxQuoteAgeMinutesWhenOpen: number;
  /** 是否允許以管理員手動報價成交 */
  allowManualQuotes: boolean;
  /** 管理員手動設定的 USD/TWD (取不到即時匯率時使用，會標示) */
  manualUsdTwd: number | null;
  tradingFrozen: boolean;
  /** true: 台股／ETF 套用漲跌停成交規則 (鎖死無法成交，未鎖死時以委賣/委買量為上限) */
  enforcePriceLimits: boolean;
}

export interface OrderPreview {
  instrument: Instrument;
  quote: Quote;
  quoteSnapshot: QuoteSnapshot;
  fx: number;
  fxSource: string;
  side: Side;
  intent: OrderIntent;
  qty: number;
  price: number;
  notional: number;
  fee: number;
  tax: number;
  marginRequired: number;
  cashRequired: number;     // 開倉需扣的現金 (含費稅)；平倉為負值代表回收
  estimatedRealizedPnl?: number;
  session: SessionInfo;
  allowed: boolean;
  blockReason?: string;
  warnings: string[];
  /** 漲跌停資訊 (僅台股／ETF 且有前一日收盤價時提供) */
  priceLimit?: { state: 'NONE' | 'LIMIT_UP' | 'LIMIT_DOWN'; limitUp?: number; limitDown?: number; blocked: boolean };
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  detail: string;
  createdAt: number;
}
