// 認證：scrypt 密碼雜湊 + 伺服器端 session (httpOnly cookie)。
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { User } from '../shared/types.ts';
import { getDb, audit } from './db.ts';
import { getSettings } from './settings.ts';

const COOKIE = 'tycoon_session';
const SESSION_DAYS = 14;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function rowToUser(r: any): User {
  return { id: r.id, name: r.name, role: r.role, team: r.team ?? undefined, status: r.status, createdAt: r.created_at };
}

export function createUser(input: { name: string; password: string; role?: 'student' | 'admin'; team?: string }): User {
  const d = getDb();
  const name = input.name.trim();
  if (!name) throw new Error('姓名不可空白');
  if (input.password.length < 4) throw new Error('密碼至少 4 碼');
  const exists = d.prepare('SELECT id FROM users WHERE name = ?').get(name);
  if (exists) throw new Error('此姓名已被使用');
  const now = Date.now();
  const res = d
    .prepare('INSERT INTO users (name, role, team, password_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, input.role ?? 'student', input.team?.trim() || null, hashPassword(input.password), 'active', now);
  const id = Number(res.lastInsertRowid);
  if ((input.role ?? 'student') === 'student') {
    const cap = getSettings().initialCapital;
    d.prepare('INSERT INTO accounts (user_id, initial_capital, cash, realized_pnl, updated_at) VALUES (?, ?, ?, 0, ?)').run(
      id, cap, cap, now
    );
  }
  return rowToUser(d.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function login(name: string, password: string): { user: User; token: string } | null {
  const d = getDb();
  const r = d.prepare('SELECT * FROM users WHERE name = ?').get(name.trim()) as any;
  if (!r || r.status !== 'active' || !verifyPassword(password, r.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  d.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    sha256(token), r.id, now + SESSION_DAYS * 86_400_000, now
  );
  d.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  return { user: rowToUser(r), token };
}

export function logout(token: string) {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIE !== '1',
    maxAge: SESSION_DAYS * 86_400_000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function readToken(req: Request): string | null {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function userFromRequest(req: Request): User | null {
  const token = readToken(req);
  if (!token) return null;
  const r = getDb()
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`
    )
    .get(sha256(token), Date.now());
  return r ? rowToUser(r) : null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const u = userFromRequest(req);
  if (!u) return res.status(401).json({ error: '請先登入' });
  req.user = u;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const u = userFromRequest(req);
  if (!u) return res.status(401).json({ error: '請先登入' });
  if (u.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  req.user = u;
  next();
}

/** 首次啟動建立管理員帳號 (ADMIN_USERNAME / ADMIN_PASSWORD)，未設定則產生隨機密碼並印在主控台 */
export function bootstrapAdmin() {
  const d = getDb();
  const hasAdmin = d.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (hasAdmin) return;
  const name = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  createUser({ name, password, role: 'admin' });
  audit('system', 'ADMIN_BOOTSTRAP', `建立管理員 ${name}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('\n════════════════════════════════════════════');
    console.log(`  已建立管理員帳號：${name}`);
    console.log(`  初始密碼：${password}`);
    console.log('  請登入後台後立即修改密碼。');
    console.log('════════════════════════════════════════════\n');
  }
}

export function changePassword(userId: number, newPassword: string) {
  if (newPassword.length < 4) throw new Error('密碼至少 4 碼');
  const d = getDb();
  d.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
  d.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
