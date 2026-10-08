// 學生端 API：認證、行情、下單、帳戶、排行榜
import { Router } from 'express';
import { z } from 'zod';
import type { Category } from '../../shared/types.ts';
import {
  createUser, login, logout, readToken, setSessionCookie, clearSessionCookie, requireUser, userFromRequest,
  verifyPassword, changePassword,
} from '../auth.ts';
import { getDb, audit } from '../db.ts';
import { getSettings } from '../settings.ts';
import { getSession } from '../clock.ts';
import { listInstruments, searchInstruments } from '../instruments.ts';
import { getQuote, toSnapshot } from '../quotes/service.ts';
import { finmindOptionChain } from '../quotes/providers.ts';
import * as E from '../trading/engine.ts';
import { taipeiText } from '../time.ts';
import { ah } from './util.ts';

export const publicRouter = Router();

// ───────── 認證 ─────────
const loginAttempts = new Map<string, { n: number; until: number }>();
function throttle(key: string) {
  const now = Date.now();
  const a = loginAttempts.get(key);
  if (a && a.until > now && a.n >= 8) throw Object.assign(new Error('嘗試次數過多，請 10 分鐘後再試'), { status: 429 });
  if (!a || a.until <= now) loginAttempts.set(key, { n: 1, until: now + 10 * 60_000 });
  else a.n++;
}

const Cred = z.object({ name: z.string().trim().min(1).max(40), password: z.string().min(1).max(100) });

publicRouter.get('/auth/me', (req, res) => {
  const user = userFromRequest(req);
  const s = getSettings();
  res.json({
    user,
    settings: {
      competitionName: s.competitionName,
      allowSelfRegister: s.allowSelfRegister,
      initialCapital: s.initialCapital,
      tradingFrozen: s.tradingFrozen,
      enforceTradingHours: s.enforceTradingHours,
    },
    serverTime: taipeiText(),
  });
});

publicRouter.post('/auth/login', ah(async (req, res) => {
  const { name, password } = Cred.parse(req.body);
  throttle(`${req.ip}|${name.toLowerCase()}`);
  const r = login(name, password);
  if (!r) return res.status(401).json({ error: '姓名或密碼錯誤，或帳號已停用' });
  loginAttempts.delete(`${req.ip}|${name.toLowerCase()}`);
  setSessionCookie(res, r.token);
  audit(r.user.name, 'LOGIN', `${r.user.role} 登入`);
  res.json({ user: r.user });
}));

publicRouter.post('/auth/register', ah(async (req, res) => {
  if (!getSettings().allowSelfRegister) return res.status(403).json({ error: '目前不開放自行註冊，請洽老師/管理員建立帳號' });
  const body = Cred.extend({ team: z.string().max(40).optional() }).parse(req.body);
  throttle(`${req.ip}|register`);
  const user = createUser({ name: body.name, password: body.password, team: body.team });
  audit(user.name, 'REGISTER', '學生自行註冊');
  const r = login(body.name, body.password)!;
  setSessionCookie(res, r.token);
  res.json({ user });
}));

publicRouter.post('/auth/logout', (req, res) => {
  const t = readToken(req);
  if (t) logout(t);
  clearSessionCookie(res);
  res.json({ ok: true });
});

publicRouter.post('/auth/password', requireUser, ah(async (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(4).max(100) }).parse(req.body);
  const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!verifyPassword(current, row.password_hash)) return res.status(400).json({ error: '目前密碼不正確' });
  changePassword(req.user!.id, next);
  clearSessionCookie(res);
  audit(req.user!.name, 'PASSWORD_CHANGE', '自行修改密碼');
  res.json({ ok: true });
}));

// ───────── 行情 ─────────
publicRouter.get('/market/instruments', requireUser, (req, res) => {
  const cat = req.query.category as Category | undefined;
  res.json(listInstruments().filter(i => !cat || i.category === cat));
});

publicRouter.get('/market/search', requireUser, (req, res) => {
  res.json(searchInstruments(String(req.query.q || ''), 30));
});

publicRouter.get('/market/quote/:symbol', requireUser, ah(async (req, res) => {
  const inst = E.resolveInstrument(String(req.params.symbol));
  const qr = await getQuote(inst, { force: req.query.force === '1' });
  res.json({
    instrument: inst,
    quote: qr.quote,
    snapshot: qr.quote ? toSnapshot(qr.quote) : null,
    fallback: qr.fallback ?? null,
    error: qr.quote ? null : qr.error ?? '無報價',
    session: getSession(inst.category),
  });
}));

publicRouter.get('/market/quotes', requireUser, ah(async (req, res) => {
  const symbols = String(req.query.symbols || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 40);
  const out = await Promise.all(
    symbols.map(async s => {
      try {
        const inst = E.resolveInstrument(s);
        const qr = await getQuote(inst);
        return { symbol: s, quote: qr.quote, snapshot: qr.quote ? toSnapshot(qr.quote) : null, error: qr.quote ? null : qr.error };
      } catch (e: any) {
        return { symbol: s, quote: null, snapshot: null, error: e.message };
      }
    })
  );
  res.json(out);
}));

publicRouter.get('/market/options/chain', requireUser, ah(async (req, res) => {
  try {
    const rows = await finmindOptionChain();
    const months = [...new Set(rows.map(r => String(r.contract_date)))].sort();
    const month = String(req.query.month || months[0] || '');
    const strikes = new Map<number, { strike: number; call?: number; put?: number }>();
    for (const r of rows.filter(r => String(r.contract_date) === month)) {
      const k = Number(r.strike_price);
      const p = Number(r.close) > 0 ? Number(r.close) : Number(r.settlement_price);
      const e = strikes.get(k) ?? { strike: k };
      if (String(r.call_put).toLowerCase() === 'call') e.call = p;
      else e.put = p;
      strikes.set(k, e);
    }
    res.json({
      date: rows[0]?.date ?? null,
      months,
      month,
      strikes: [...strikes.values()].sort((a, b) => a.strike - b.strike),
      source: 'FinMind TaiwanOptionDaily',
    });
  } catch (e: any) {
    res.json({ date: null, months: [], month: null, strikes: [], error: `目前無法取得選擇權資料：${e.message}` });
  }
}));

publicRouter.get('/market/clock', requireUser, (_req, res) => {
  const cats: Category[] = ['tw_stock', 'tw_future', 'us_stock', 'commodity', 'crypto'];
  res.json({ taipei: taipeiText(), sessions: Object.fromEntries(cats.map(c => [c, getSession(c)])) });
});

// ───────── 帳戶 / 下單 ─────────
const Order = z.object({
  symbol: z.string().trim().min(1).max(40),
  side: z.enum(['LONG', 'SHORT']),
  intent: z.enum(['OPEN', 'CLOSE']),
  qty: z.coerce.number().positive(),
  note: z.string().max(500).optional(),
});

function studentOnly(req: any, res: any, next: any) {
  if (req.user.role !== 'student') return res.status(403).json({ error: '管理員帳號沒有交易帳戶' });
  next();
}

publicRouter.get('/me/account', requireUser, studentOnly, ah(async (req, res) => {
  res.json(await E.valueAccount(req.user!.id));
}));

publicRouter.get('/me/trades', requireUser, studentOnly, (req, res) => {
  res.json(E.listTrades(req.user!.id, 500));
});

publicRouter.post('/orders/preview', requireUser, studentOnly, ah(async (req, res) => {
  res.json(await E.previewOrder(req.user!.id, Order.parse(req.body)));
}));

publicRouter.post('/orders', requireUser, studentOnly, ah(async (req, res) => {
  const trade = await E.executeOrder(req.user!.id, Order.parse(req.body), req.user!.name);
  res.json(trade);
}));

publicRouter.get('/leaderboard', requireUser, ah(async (_req, res) => {
  res.json(await E.leaderboard());
}));
