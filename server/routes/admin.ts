// 後台管理 API (需管理員)
import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Category, Instrument } from '../../shared/types.ts';
import { requireAdmin, createUser, changePassword, rowToUser } from '../auth.ts';
import { getDb, audit } from '../db.ts';
import { getSettings, updateSettings } from '../settings.ts';
import { listInstruments, saveInstrument, getInstrument } from '../instruments.ts';
import {
  getQuote, toSnapshot, setManualQuote, deleteManualQuote, listManualQuotes, clearQuoteCache, getUsdTwd,
} from '../quotes/service.ts';
import { setFinmindToken, hasFinmindToken, OFFLINE } from '../quotes/providers.ts';
import * as E from '../trading/engine.ts';
import { taipeiText } from '../time.ts';
import { ah } from './util.ts';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const idParam = (v: any) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('id 錯誤'), { status: 400 });
  return n;
};

// ───────── 總覽 ─────────
adminRouter.get('/overview', ah(async (_req, res) => {
  const d = getDb();
  const one = (sql: string, ...p: any[]) => (d.prepare(sql).get(...p) as any).n as number;
  const since = Date.now() - 86_400_000;
  const trades = d.prepare('SELECT quote_json, market_open FROM trades').all() as any[];
  let stale = 0, manual = 0, offHours = 0;
  for (const t of trades) {
    const q = JSON.parse(t.quote_json);
    if (q.stale) stale++;
    if (q.basis === 'MANUAL') manual++;
    if (!t.market_open) offHours++;
  }
  res.json({
    students: one("SELECT COUNT(*) n FROM users WHERE role='student'"),
    activeStudents: one("SELECT COUNT(*) n FROM users WHERE role='student' AND status='active'"),
    trades: trades.length,
    trades24h: one('SELECT COUNT(*) n FROM trades WHERE executed_at > ?', since),
    flaggedTrades: one('SELECT COUNT(*) n FROM trades WHERE flagged = 1'),
    staleFills: stale,
    manualFills: manual,
    offHoursFills: offHours,
    manualQuotes: one('SELECT COUNT(*) n FROM manual_quotes'),
    finmindToken: hasFinmindToken(),
    quotesOffline: OFFLINE(),
    fx: await getUsdTwd(),
    settings: getSettings(),
    serverTime: taipeiText(),
  });
}));

// ───────── 使用者 ─────────
adminRouter.get('/users', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT u.*, a.cash, a.initial_capital, a.realized_pnl,
        (SELECT COUNT(*) FROM trades t WHERE t.user_id = u.id) AS trade_count,
        (SELECT MAX(executed_at) FROM trades t WHERE t.user_id = u.id) AS last_trade_at
       FROM users u LEFT JOIN accounts a ON a.user_id = u.id ORDER BY u.role DESC, u.created_at`
    )
    .all() as any[];
  res.json(
    rows.map(r => ({
      ...rowToUser(r),
      cash: r.cash,
      initialCapital: r.initial_capital,
      realizedPnl: r.realized_pnl,
      tradeCount: r.trade_count,
      lastTradeAt: r.last_trade_at,
    }))
  );
});

adminRouter.post('/users', ah(async (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(1).max(40),
      password: z.string().min(4).max(100),
      team: z.string().max(40).optional(),
      role: z.enum(['student', 'admin']).default('student'),
    })
    .parse(req.body);
  const u = createUser(b);
  audit(req.user!.name, 'USER_CREATE', `建立 ${b.role} ${u.name}`);
  res.json(u);
}));

/** 批次建立學生：每行「姓名,密碼,組別」 */
adminRouter.post('/users/bulk', ah(async (req, res) => {
  const { text } = z.object({ text: z.string().max(20000) }).parse(req.body);
  const results: { line: number; name: string; ok: boolean; error?: string }[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const [name, password, team] = line.split(/[,，\t]/).map(s => s?.trim());
    if (!name) return;
    try {
      createUser({ name, password: password || '', team });
      results.push({ line: i + 1, name, ok: true });
    } catch (e: any) {
      results.push({ line: i + 1, name, ok: false, error: e.message });
    }
  });
  audit(req.user!.name, 'USER_BULK_CREATE', `批次建立 ${results.filter(r => r.ok).length} 位`);
  res.json(results);
}));

adminRouter.patch('/users/:id', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const b = z
    .object({ team: z.string().max(40).nullable().optional(), status: z.enum(['active', 'disabled']).optional() })
    .parse(req.body);
  if (id === req.user!.id && b.status === 'disabled') return res.status(400).json({ error: '不能停用自己的帳號' });
  const d = getDb();
  if (b.team !== undefined) d.prepare('UPDATE users SET team = ? WHERE id = ?').run(b.team || null, id);
  if (b.status) {
    d.prepare('UPDATE users SET status = ? WHERE id = ?').run(b.status, id);
    if (b.status === 'disabled') d.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  audit(req.user!.name, 'USER_UPDATE', `#${id} ${JSON.stringify(b)}`);
  res.json(rowToUser(d.prepare('SELECT * FROM users WHERE id = ?').get(id)));
}));

adminRouter.post('/users/:id/password', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const { password } = z.object({ password: z.string().min(4).max(100) }).parse(req.body);
  changePassword(id, password);
  audit(req.user!.name, 'USER_PASSWORD_RESET', `#${id}`);
  res.json({ ok: true });
}));

adminRouter.post('/users/:id/reset', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const { initialCapital } = z.object({ initialCapital: z.number().positive().optional() }).parse(req.body ?? {});
  const u = getDb().prepare('SELECT role FROM users WHERE id = ?').get(id) as any;
  if (!u || u.role !== 'student') return res.status(400).json({ error: '只能重置學生帳戶' });
  E.resetAccount(id, initialCapital ?? getSettings().initialCapital, req.user!.name);
  res.json({ ok: true });
}));

adminRouter.delete('/users/:id', ah(async (req, res) => {
  const id = idParam(req.params.id);
  if (id === req.user!.id) return res.status(400).json({ error: '不能刪除自己的帳號' });
  const u = getDb().prepare('SELECT name FROM users WHERE id = ?').get(id) as any;
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req.user!.name, 'USER_DELETE', `刪除 #${id} ${u?.name ?? ''}`);
  res.json({ ok: true });
}));

adminRouter.get('/users/:id/account', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const v = await E.valueAccount(id);
  res.json({ ...v, trades: E.listTrades(id, 500) });
}));

// ───────── 成交稽核 ─────────
function queryTrades(q: any) {
  const where: string[] = [];
  const params: any[] = [];
  if (q.user) { where.push('t.user_id = ?'); params.push(Number(q.user)); }
  if (q.symbol) { where.push('t.symbol = ?'); params.push(String(q.symbol).toUpperCase()); }
  if (q.flagged === '1') where.push('t.flagged = 1');
  if (q.offHours === '1') where.push('t.market_open = 0');
  if (q.from) { where.push('t.executed_at >= ?'); params.push(Date.parse(`${q.from}T00:00:00+08:00`)); }
  if (q.to) { where.push('t.executed_at < ?'); params.push(Date.parse(`${q.to}T00:00:00+08:00`) + 86_400_000); }
  const limit = Math.min(5000, Number(q.limit) || 500);
  let rows = (
    getDb()
      .prepare(
        `SELECT t.*, u.name AS user_name FROM trades t JOIN users u ON u.id = t.user_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.executed_at DESC, t.id DESC LIMIT ?`
      )
      .all(...params, limit) as any[]
  ).map(E.rowToTrade);
  if (q.basis) rows = rows.filter(t => t.quote.basis === q.basis);
  if (q.stale === '1') rows = rows.filter(t => t.quote.stale);
  return rows;
}

adminRouter.get('/trades', (req, res) => res.json(queryTrades(req.query)));

adminRouter.get('/trades.csv', (req, res) => {
  const rows = queryTrades({ ...req.query, limit: 5000 });
  const head = ['成交時間(台北)', '學生', '代號', '名稱', '方向', '開/平', '數量', '成交價', '匯率', '名目金額', '手續費', '交易稅',
    '已實現損益', '報價來源等級', '報價日期', '報價時間', '報價時區', '報價來源', '非今日報價', '交易時段內', '時段', '標記', '備註'];
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map(t =>
    [t.executedAtText, t.userName, t.symbol, t.name, t.side, t.intent, t.qty, t.price, t.fx, t.notional, t.fee, t.tax,
      t.realizedPnl, t.quote.basis, t.quote.quoteDate, t.quote.quoteTime ?? '', t.quote.quoteTimeZone, t.quote.source,
      t.quote.stale ? '是' : '否', t.marketOpen ? '是' : '否', t.sessionName, t.flagged ? t.flagReason || '是' : '', t.note ?? '']
      .map(esc)
      .join(',')
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="trades-${Date.now()}.csv"`);
  res.send('﻿' + [head.map(esc).join(','), ...lines].join('\n'));
});

adminRouter.post('/trades/:id/flag', ah(async (req, res) => {
  const id = idParam(req.params.id);
  const b = z.object({ flagged: z.boolean(), reason: z.string().max(200).optional() }).parse(req.body);
  getDb().prepare('UPDATE trades SET flagged = ?, flag_reason = ? WHERE id = ?').run(b.flagged ? 1 : 0, b.flagged ? b.reason ?? null : null, id);
  audit(req.user!.name, b.flagged ? 'TRADE_FLAG' : 'TRADE_UNFLAG', `#${id} ${b.reason ?? ''}`);
  res.json(E.getTrade(id));
}));

// ───────── 報價管理 ─────────
adminRouter.get('/quotes/check', ah(async (req, res) => {
  const cat = req.query.category as Category | undefined;
  const insts = listInstruments(true).filter(i => !cat || i.category === cat).slice(0, 60);
  const out = await Promise.all(
    insts.map(async i => {
      const qr = await getQuote(i, { force: req.query.force === '1' });
      return {
        symbol: i.symbol,
        name: i.name,
        category: i.category,
        enabled: i.enabled,
        quote: qr.quote,
        snapshot: qr.quote ? toSnapshot(qr.quote) : null,
        fallback: qr.fallback ?? null,
        error: qr.error ?? null,
      };
    })
  );
  res.json(out);
}));

adminRouter.get('/manual-quotes', (_req, res) => res.json(listManualQuotes()));

adminRouter.post('/manual-quotes', ah(async (req, res) => {
  const b = z
    .object({
      symbol: z.string().trim().min(1).max(40),
      price: z.number().positive(),
      prevClose: z.number().positive().nullable().optional(),
      quoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      quoteTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
      note: z.string().trim().min(2, '請說明報價來源 (例：期交所 10/08 收盤)').max(200),
      mode: z.enum(['fallback', 'override']).default('fallback'),
    })
    .parse(req.body);
  const inst = E.resolveInstrument(b.symbol);
  setManualQuote({ ...b, symbol: inst.symbol, quoteTime: b.quoteTime?.length === 5 ? `${b.quoteTime}:00` : b.quoteTime, setBy: req.user!.name });
  audit(req.user!.name, 'MANUAL_QUOTE_SET', `${inst.symbol} ${b.price} @ ${b.quoteDate} [${b.mode}] ${b.note}`);
  res.json({ ok: true });
}));

adminRouter.delete('/manual-quotes/:symbol', ah(async (req, res) => {
  const sym = String(req.params.symbol).toUpperCase();
  deleteManualQuote(sym);
  audit(req.user!.name, 'MANUAL_QUOTE_DELETE', sym);
  res.json({ ok: true });
}));

adminRouter.post('/quotes/clear-cache', (req, res) => {
  clearQuoteCache();
  audit(req.user!.name, 'QUOTE_CACHE_CLEAR', '');
  res.json({ ok: true });
});

adminRouter.post('/finmind-token', ah(async (req, res) => {
  const { token } = z.object({ token: z.string().max(2000) }).parse(req.body);
  setFinmindToken(token);
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES ('__finmind_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(token.trim()));
  clearQuoteCache();
  audit(req.user!.name, 'FINMIND_TOKEN_SET', token ? `設定 token (…${token.slice(-4)})` : '清除 token');
  res.json({ ok: true, hasToken: hasFinmindToken() });
}));

// ───────── 商品管理 ─────────
adminRouter.get('/instruments', (_req, res) => res.json(listInstruments(true)));

const InstrumentBody = z.object({
  symbol: z.string().trim().min(1).max(40).transform(s => s.toUpperCase()),
  name: z.string().trim().min(1).max(60),
  category: z.enum(['tw_stock', 'tw_etf', 'tw_bond_etf', 'tw_future', 'tw_option', 'us_stock', 'commodity', 'crypto']),
  currency: z.enum(['TWD', 'USD']),
  multiplier: z.number().positive(),
  unitLabel: z.string().min(1).max(10),
  marginRate: z.number().min(0).max(1),
  shortable: z.boolean(),
  minQty: z.number().positive(),
  provider: z.enum(['finmind', 'yahoo', 'binance', 'manual']),
  providerSymbol: z.string().max(40),
  enabled: z.boolean(),
});

adminRouter.post('/instruments', ah(async (req, res) => {
  const b = InstrumentBody.parse(req.body) as Instrument;
  saveInstrument(b);
  clearQuoteCache(b.symbol);
  audit(req.user!.name, 'INSTRUMENT_SAVE', `${b.symbol} ${JSON.stringify(b)}`);
  res.json(getInstrument(b.symbol));
}));

adminRouter.patch('/instruments/:symbol', ah(async (req, res) => {
  const cur = getInstrument(String(req.params.symbol));
  if (!cur) return res.status(404).json({ error: '查無商品' });
  const patch = InstrumentBody.partial().omit({ symbol: true }).parse(req.body);
  const next = { ...cur, ...patch } as Instrument;
  saveInstrument(next);
  clearQuoteCache(cur.symbol);
  audit(req.user!.name, 'INSTRUMENT_UPDATE', `${cur.symbol} ${JSON.stringify(patch)}`);
  res.json(next);
}));

// ───────── 設定 ─────────
adminRouter.get('/settings', (_req, res) => res.json(getSettings()));

adminRouter.patch('/settings', ah(async (req, res) => {
  const b = z
    .object({
      competitionName: z.string().min(1).max(80),
      initialCapital: z.number().positive().max(1e12),
      allowSelfRegister: z.boolean(),
      enforceTradingHours: z.boolean(),
      allowStaleQuotes: z.boolean(),
      maxQuoteAgeMinutesWhenOpen: z.number().int().min(0).max(1440),
      allowManualQuotes: z.boolean(),
      manualUsdTwd: z.number().min(20).max(50).nullable(),
      tradingFrozen: z.boolean(),
    })
    .partial()
    .parse(req.body);
  const s = updateSettings(b);
  clearQuoteCache();
  audit(req.user!.name, 'SETTINGS_UPDATE', JSON.stringify(b));
  res.json(s);
}));

// ───────── 稽核紀錄 / 備份 ─────────
adminRouter.get('/audit', (req, res) => {
  const limit = Math.min(2000, Number(req.query.limit) || 300);
  const rows = getDb().prepare('SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as any[];
  res.json(rows.map(r => ({ id: r.id, actor: r.actor, action: r.action, detail: r.detail, createdAt: r.created_at, createdAtText: taipeiText(r.created_at) })));
});

adminRouter.get('/backup', ah(async (req, res) => {
  const file = path.join(os.tmpdir(), `tycoon-backup-${Date.now()}.db`);
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  audit(req.user!.name, 'BACKUP_DOWNLOAD', '');
  res.download(file, `tycoon-backup-${taipeiText().replace(/[: ]/g, '-')}.db`, () => fs.rm(file, () => {}));
}));
