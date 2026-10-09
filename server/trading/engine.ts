// 交易引擎：成交價只來自伺服器報價服務，前端無法指定價格。
import type {
  Instrument, OrderIntent, OrderPreview, Position, Side, Trade, AccountSummary, QuoteSnapshot,
} from '../../shared/types.ts';
import { getDb, tx, audit } from '../db.ts';
import { getSession } from '../clock.ts';
import { getSettings } from '../settings.ts';
import { getInstrument, ensureOptionInstrument, parseOptionSymbol } from '../instruments.ts';
import { getQuote, getUsdTwd, toSnapshot } from '../quotes/service.ts';
import { taipeiText } from '../time.ts';
import { calcFeeTax, round2 } from './fees.ts';
import { checkPriceLimit } from './priceLimit.ts';

export class TradeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface OrderInput {
  symbol: string;
  side: Side;
  intent: OrderIntent;
  qty: number;
  note?: string;
}

/** 是否以保證金方式計算 (期貨、原物料、所有空單) */
export function usesMargin(inst: Instrument, side: Side) {
  return inst.category === 'tw_future' || inst.category === 'commodity' || side === 'SHORT';
}

export function resolveInstrument(symbol: string): Instrument {
  const sym = symbol.trim().toUpperCase();
  const inst = parseOptionSymbol(sym) ? ensureOptionInstrument(sym) : getInstrument(sym);
  if (!inst) throw new TradeError(`查無商品「${sym}」`, 404);
  return inst;
}

// ───────────────────── 帳戶 / 部位存取 ─────────────────────
export function getAccountRow(userId: number) {
  const a = getDb().prepare('SELECT * FROM accounts WHERE user_id = ?').get(userId) as any;
  if (!a) throw new TradeError('帳戶不存在', 404);
  return a as { user_id: number; initial_capital: number; cash: number; realized_pnl: number };
}

export function rowToPosition(r: any): Position {
  return {
    id: r.id,
    userId: r.user_id,
    symbol: r.symbol,
    name: r.name,
    category: r.category,
    side: r.side,
    qty: r.qty,
    avgPrice: r.avg_price,
    multiplier: r.multiplier,
    currency: r.currency,
    fxAtEntry: r.fx_at_entry,
    marginLocked: r.margin_locked,
    costBasis: r.cost_basis,
    openedAt: r.opened_at,
    updatedAt: r.updated_at,
    markPrice: r.last_mark_price ?? undefined,
    markQuote: r.last_mark_quote ? JSON.parse(r.last_mark_quote) : null,
  };
}

export function listPositions(userId: number): Position[] {
  return (getDb().prepare('SELECT * FROM positions WHERE user_id = ? ORDER BY opened_at').all(userId) as any[]).map(
    rowToPosition
  );
}

function findPosition(userId: number, symbol: string, side: Side) {
  const r = getDb().prepare('SELECT * FROM positions WHERE user_id = ? AND symbol = ? AND side = ?').get(userId, symbol, side);
  return r ? rowToPosition(r) : null;
}

// ───────────────────── 下單試算 ─────────────────────
export async function previewOrder(userId: number, input: OrderInput, now = Date.now()): Promise<OrderPreview> {
  const settings = getSettings();
  const inst = resolveInstrument(input.symbol);
  const qty = Number(input.qty);
  const side = input.side;
  const intent = input.intent;
  const warnings: string[] = [];
  let blockReason: string | undefined;
  const block = (msg: string) => {
    if (!blockReason) blockReason = msg;
  };

  if (!Number.isFinite(qty) || qty <= 0) throw new TradeError('數量必須大於 0');
  if (inst.minQty >= 1 && !Number.isInteger(qty)) throw new TradeError(`${inst.name} 數量必須為整數${inst.unitLabel}`);
  if (qty < inst.minQty) throw new TradeError(`最小下單數量為 ${inst.minQty} ${inst.unitLabel}`);
  if (!inst.enabled) block('此商品已被管理員停用');
  if (settings.tradingFrozen) block('管理員已暫停全體交易');
  if (intent === 'OPEN' && side === 'SHORT' && !inst.shortable) block(`${inst.name} 不開放放空`);

  const qr = await getQuote(inst);
  if (!qr.quote) {
    throw new TradeError(`目前取不到「${inst.name}」的真實報價，暫時無法交易${qr.error ? `（${qr.error}）` : ''}`, 409);
  }
  const quote = qr.quote;
  const snap = toSnapshot(quote, now);
  const session = getSession(inst.category, now);

  if (qr.fallback === 'last_known') warnings.push(`報價供應商暫時無回應，使用最後一次取得的報價（${snap.quoteDate}）`);
  if (quote.basis === 'MANUAL') warnings.push(`此價格為管理員手動報價：${quote.note ?? ''}`);
  if (!session.isOpen) {
    if (settings.enforceTradingHours) block(`非交易時段（${session.sessionName}，${session.nextChange}）`);
    else warnings.push(`目前為非交易時段（${session.sessionName}），將以最近報價成交`);
  }
  if (snap.stale) {
    if (!settings.allowStaleQuotes) block(`報價日期為 ${snap.quoteDate}，不是今日報價，系統設定不允許以舊報價成交`);
    else warnings.push(`成交價為 ${snap.quoteDate} 的報價，非今日價格`);
  }
  if (session.isOpen && settings.maxQuoteAgeMinutesWhenOpen > 0 && snap.ageMinutes > settings.maxQuoteAgeMinutesWhenOpen) {
    block(`盤中報價已超過 ${settings.maxQuoteAgeMinutesWhenOpen} 分鐘未更新（距今 ${snap.ageMinutes} 分鐘）`);
  }

  // 漲跌停
  let priceLimit: OrderPreview['priceLimit'];
  if (settings.enforcePriceLimits) {
    const pl = checkPriceLimit(inst, quote, side, intent, qty);
    if (pl.limitUp !== undefined) {
      priceLimit = { state: pl.state, limitUp: pl.limitUp, limitDown: pl.limitDown, blocked: !!pl.block };
    }
    if (pl.block) block(pl.block);
    else if (pl.warning) warnings.push(pl.warning);
  }

  // 匯率
  let fx = 1;
  let fxSource = '新台幣計價';
  if (inst.currency === 'USD') {
    const f = await getUsdTwd();
    if (!f) throw new TradeError('取不到 USD/TWD 匯率，暫時無法交易美元計價商品（管理員可在設定中輸入匯率）', 409);
    fx = f.rate;
    fxSource = `${f.source} ${f.quoteDate}${f.basis === 'MANUAL' ? '（手動）' : ''}`;
  }

  const price = quote.price;
  const notional = round2(price * qty * inst.multiplier * fx);
  const { fee, tax } = calcFeeTax({ category: inst.category, symbol: inst.symbol, side, intent, qty, notionalTwd: notional, fx });
  const acct = getAccountRow(userId);

  let marginRequired = 0;
  let cashRequired = 0;
  let estimatedRealizedPnl: number | undefined;

  if (intent === 'OPEN') {
    if (usesMargin(inst, side)) {
      marginRequired = round2(notional * inst.marginRate);
      cashRequired = round2(marginRequired + fee + tax);
    } else {
      cashRequired = round2(notional + fee + tax);
    }
    if (cashRequired > acct.cash) block(`可用現金不足：需要 NT$ ${fmt(cashRequired)}，可用 NT$ ${fmt(acct.cash)}`);
  } else {
    const pos = findPosition(userId, inst.symbol, side);
    if (!pos) block(`沒有 ${inst.name} 的${side === 'LONG' ? '多' : '空'}單部位可平倉`);
    else if (qty > pos.qty + 1e-9) block(`平倉數量超過持有數量（持有 ${pos.qty} ${inst.unitLabel}）`);
    else {
      const r = closeMath(pos, inst, qty, price, fx, fee, tax);
      cashRequired = round2(-r.cashBack);
      estimatedRealizedPnl = r.realized;
    }
  }

  return {
    instrument: inst,
    quote,
    quoteSnapshot: snap,
    fx,
    fxSource,
    side,
    intent,
    qty,
    price,
    notional,
    fee,
    tax,
    marginRequired,
    cashRequired,
    estimatedRealizedPnl,
    session,
    allowed: !blockReason,
    blockReason,
    warnings,
    priceLimit,
  };
}

function closeMath(pos: Position, inst: Instrument, qty: number, price: number, fx: number, fee: number, tax: number) {
  const portion = qty / pos.qty;
  const costPortion = round2(pos.costBasis * portion);
  if (usesMargin(inst, pos.side)) {
    const dir = pos.side === 'LONG' ? 1 : -1;
    const gross = round2((price - pos.avgPrice) * qty * pos.multiplier * fx * dir);
    const marginRelease = round2(pos.marginLocked * portion);
    return {
      cashBack: round2(marginRelease + gross - fee - tax),
      realized: round2(gross - fee - tax - costPortion), // costBasis = 開倉費稅
      marginRelease,
      costPortion,
    };
  }
  const proceeds = round2(price * qty * pos.multiplier * fx);
  return {
    cashBack: round2(proceeds - fee - tax),
    realized: round2(proceeds - fee - tax - costPortion), // costBasis = 買進成本 + 買進費稅
    marginRelease: 0,
    costPortion,
  };
}

// ───────────────────── 成交 ─────────────────────
export async function executeOrder(userId: number, input: OrderInput, actor: string): Promise<Trade> {
  const now = Date.now();
  const pv = await previewOrder(userId, input, now);
  if (!pv.allowed) {
    // 漲跌停被拒的委託留下紀錄，老師可在「操作紀錄」查看
    if (pv.priceLimit?.blocked) {
      audit(actor, 'ORDER_REJECTED_PRICE_LIMIT',
        `${pv.instrument.symbol} ${pv.instrument.name} ${pv.intent === 'OPEN' ? '新倉' : '平倉'}${pv.side === 'LONG' ? '多' : '空'} ${pv.qty}${pv.instrument.unitLabel} @${pv.price}（${pv.quoteSnapshot.source} ${pv.quoteSnapshot.quoteDate} ${pv.quoteSnapshot.quoteTime ?? ''}）：${pv.blockReason}`);
    }
    throw new TradeError(pv.blockReason || '委託被拒絕', 409);
  }
  const inst = pv.instrument;

  const tradeId = tx(() => {
    const d = getDb();
    // 交易內重新讀取，避免併發造成超買
    const acct = getAccountRow(userId);
    let cashChange = 0;
    let marginChange = 0;
    let realized = 0;

    if (pv.intent === 'OPEN') {
      if (pv.cashRequired > acct.cash + 1e-6) throw new TradeError('可用現金不足', 409);
      cashChange = -pv.cashRequired;
      marginChange = pv.marginRequired;
      const openCost = usesMargin(inst, pv.side) ? round2(pv.fee + pv.tax) : round2(pv.notional + pv.fee + pv.tax);
      const pos = findPosition(userId, inst.symbol, pv.side);
      if (pos) {
        const newQty = pos.qty + pv.qty;
        const avg = (pos.avgPrice * pos.qty + pv.price * pv.qty) / newQty;
        const fxAvg = (pos.fxAtEntry * pos.qty + pv.fx * pv.qty) / newQty;
        d.prepare(
          `UPDATE positions SET qty=?, avg_price=?, fx_at_entry=?, margin_locked=?, cost_basis=?, updated_at=? WHERE id=?`
        ).run(newQty, avg, fxAvg, round2(pos.marginLocked + pv.marginRequired), round2(pos.costBasis + openCost), now, pos.id);
      } else {
        d.prepare(
          `INSERT INTO positions (user_id, symbol, name, category, side, qty, avg_price, multiplier, currency, fx_at_entry,
             margin_locked, cost_basis, opened_at, updated_at, last_mark_price, last_mark_quote)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          userId, inst.symbol, inst.name, inst.category, pv.side, pv.qty, pv.price, inst.multiplier, inst.currency, pv.fx,
          pv.marginRequired, openCost, now, now, pv.price, JSON.stringify(pv.quoteSnapshot)
        );
      }
    } else {
      const pos = findPosition(userId, inst.symbol, pv.side);
      if (!pos || pv.qty > pos.qty + 1e-9) throw new TradeError('部位數量已變動，請重新下單', 409);
      const r = closeMath(pos, inst, pv.qty, pv.price, pv.fx, pv.fee, pv.tax);
      cashChange = r.cashBack;
      marginChange = -r.marginRelease;
      realized = r.realized;
      const remain = round2(pos.qty - pv.qty);
      if (remain <= 1e-9) d.prepare('DELETE FROM positions WHERE id = ?').run(pos.id);
      else
        d.prepare('UPDATE positions SET qty=?, margin_locked=?, cost_basis=?, updated_at=? WHERE id=?').run(
          remain, round2(pos.marginLocked - r.marginRelease), round2(pos.costBasis - r.costPortion), now, pos.id
        );
    }

    d.prepare('UPDATE accounts SET cash = ?, realized_pnl = ?, updated_at = ? WHERE user_id = ?').run(
      round2(acct.cash + cashChange), round2(acct.realized_pnl + realized), now, userId
    );

    const res = d
      .prepare(
        `INSERT INTO trades (user_id, symbol, name, category, side, intent, qty, price, fx, notional, fee, tax,
           cash_change, margin_change, realized_pnl, executed_at, market_open, session_name, quote_json, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId, inst.symbol, inst.name, inst.category, pv.side, pv.intent, pv.qty, pv.price, pv.fx, pv.notional,
        pv.fee, pv.tax, round2(cashChange), round2(marginChange), realized, now, pv.session.isOpen ? 1 : 0,
        pv.session.sessionName, JSON.stringify({ ...pv.quoteSnapshot, fxSource: pv.fxSource }), input.note?.slice(0, 500) ?? null
      );
    return Number(res.lastInsertRowid);
  });

  audit(actor, 'TRADE', `${input.intent} ${input.side} ${inst.symbol} x${pv.qty} @ ${pv.price} (${pv.quoteSnapshot.basis} ${pv.quoteSnapshot.quoteDate})`);
  return getTrade(tradeId)!;
}

// ───────────────────── 查詢 ─────────────────────
export function rowToTrade(r: any): Trade {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name ?? undefined,
    symbol: r.symbol,
    name: r.name,
    category: r.category,
    side: r.side,
    intent: r.intent,
    qty: r.qty,
    price: r.price,
    fx: r.fx,
    notional: r.notional,
    fee: r.fee,
    tax: r.tax,
    cashChange: r.cash_change,
    marginChange: r.margin_change,
    realizedPnl: r.realized_pnl,
    executedAt: r.executed_at,
    executedAtText: taipeiText(r.executed_at),
    marketOpen: !!r.market_open,
    sessionName: r.session_name,
    quote: JSON.parse(r.quote_json) as QuoteSnapshot,
    note: r.note ?? undefined,
    flagged: !!r.flagged,
    flagReason: r.flag_reason ?? undefined,
  };
}

export function getTrade(id: number): Trade | null {
  const r = getDb()
    .prepare('SELECT t.*, u.name AS user_name FROM trades t JOIN users u ON u.id = t.user_id WHERE t.id = ?')
    .get(id);
  return r ? rowToTrade(r) : null;
}

export function listTrades(userId: number, limit = 200): Trade[] {
  return (
    getDb()
      .prepare('SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at DESC, id DESC LIMIT ?')
      .all(userId, limit) as any[]
  ).map(rowToTrade);
}

// ───────────────────── 估值 ─────────────────────
export async function valueAccount(userId: number): Promise<{ summary: AccountSummary; positions: Position[] }> {
  const d = getDb();
  const user = d.prepare('SELECT id, name, team FROM users WHERE id = ?').get(userId) as any;
  const acct = getAccountRow(userId);
  const positions = listPositions(userId);
  const needFx = positions.some(p => p.currency === 'USD');
  const fx = needFx ? await getUsdTwd() : null;
  let hasUnpriced = false;

  const valued = await Promise.all(
    positions.map(async p => {
      let markPrice = p.markPrice ?? p.avgPrice;
      let markQuote: QuoteSnapshot | null = p.markQuote ?? null;
      try {
        const inst = resolveInstrument(p.symbol);
        const qr = await getQuote(inst);
        if (qr.quote) {
          markPrice = qr.quote.price;
          markQuote = toSnapshot(qr.quote);
          d.prepare('UPDATE positions SET last_mark_price = ?, last_mark_quote = ? WHERE id = ?').run(
            markPrice, JSON.stringify(markQuote), p.id
          );
        } else hasUnpriced = true;
      } catch {
        hasUnpriced = true;
      }
      const rate = p.currency === 'USD' ? fx?.rate ?? p.fxAtEntry : 1;
      if (p.currency === 'USD' && !fx) hasUnpriced = true;
      const inst = { category: p.category } as Instrument;
      let marketValue: number;
      let unrealizedPnl: number;
      if (usesMargin(inst, p.side)) {
        const dir = p.side === 'LONG' ? 1 : -1;
        const gross = (markPrice - p.avgPrice) * p.qty * p.multiplier * rate * dir;
        unrealizedPnl = round2(gross - p.costBasis);
        marketValue = round2(p.marginLocked + gross);
      } else {
        marketValue = round2(markPrice * p.qty * p.multiplier * rate);
        unrealizedPnl = round2(marketValue - p.costBasis);
      }
      return { ...p, markPrice, markQuote, marketValue, unrealizedPnl };
    })
  );

  const positionsValue = round2(valued.reduce((s, p) => s + (p.marketValue ?? 0), 0));
  const marginLocked = round2(valued.reduce((s, p) => s + p.marginLocked, 0));
  const unrealized = round2(valued.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0));
  const nav = round2(acct.cash + positionsValue);
  return {
    summary: {
      userId,
      name: user?.name ?? '',
      team: user?.team ?? undefined,
      initialCapital: acct.initial_capital,
      cash: acct.cash,
      marginLocked,
      positionsValue,
      nav,
      returnPct: round2(((nav - acct.initial_capital) / acct.initial_capital) * 100),
      realizedPnl: acct.realized_pnl,
      unrealizedPnl: unrealized,
      hasUnpricedPositions: hasUnpriced,
      valuedAt: Date.now(),
    },
    positions: valued,
  };
}

export async function leaderboard(): Promise<AccountSummary[]> {
  const ids = (
    getDb().prepare("SELECT id FROM users WHERE role = 'student' AND status = 'active'").all() as any[]
  ).map(r => r.id as number);
  const rows = await Promise.all(ids.map(id => valueAccount(id).then(v => v.summary)));
  return rows.sort((a, b) => b.nav - a.nav);
}

// ───────────────────── 帳戶重置 ─────────────────────
export function resetAccount(userId: number, initialCapital: number, actor: string) {
  tx(() => {
    const d = getDb();
    d.prepare('DELETE FROM positions WHERE user_id = ?').run(userId);
    d.prepare('DELETE FROM trades WHERE user_id = ?').run(userId);
    d.prepare(
      `INSERT INTO accounts (user_id, initial_capital, cash, realized_pnl, updated_at) VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET initial_capital=excluded.initial_capital, cash=excluded.cash, realized_pnl=0, updated_at=excluded.updated_at`
    ).run(userId, initialCapital, initialCapital, Date.now());
  });
  audit(actor, 'ACCOUNT_RESET', `user #${userId} 重置為 NT$ ${fmt(initialCapital)}`);
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
