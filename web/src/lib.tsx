import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@shared/types';

// ───────── API ─────────
export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: string[]) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error || `HTTP ${res.status}`, res.status, data?.details);
  return data as T;
}

/** 簡易資料讀取 hook */
export function useApi<T>(path: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

// ───────── 登入狀態 ─────────
export interface PublicSettings {
  competitionName: string;
  allowSelfRegister: boolean;
  initialCapital: number;
  tradingFrozen: boolean;
  enforceTradingHours: boolean;
}
interface AuthCtx {
  user: User | null;
  settings: PublicSettings | null;
  ready: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: User | null; settings: PublicSettings }>('/auth/me');
      setUser(r.user);
      setSettings(r.settings);
    } finally {
      setReady(true);
    }
  }, []);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return <Ctx.Provider value={{ user, settings, ready, refresh, logout }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);

// ───────── 格式化 ─────────
export const twd = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : `NT$ ${n.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const num = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('zh-TW', { maximumFractionDigits: digits });

export const pct = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

export const signed = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('zh-TW')}`;

/** 台灣慣例：紅漲綠跌 */
export const pnlClass = (n: number | null | undefined) =>
  !n ? 'text-slate-500' : n > 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]';

export const taipeiTime = (ms: number) =>
  new Date(ms).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
