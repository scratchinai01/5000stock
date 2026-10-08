import type { ReactNode } from 'react';
import type { PriceBasis, QuoteSnapshot, SessionInfo } from '@shared/types';
import { BASIS_LABEL } from '@shared/types';

const BASIS_STYLE: Record<PriceBasis, string> = {
  LIVE: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  DELAYED: 'bg-sky-50 text-sky-800 border-sky-300',
  CLOSE: 'bg-slate-100 text-slate-700 border-slate-300',
  MANUAL: 'bg-amber-50 text-amber-900 border-amber-300',
};

/** 報價來源與時間標籤：所有價格旁都要顯示 */
export function QuoteTag({ q, compact = false }: { q: QuoteSnapshot | null | undefined; compact?: boolean }) {
  if (!q) return <span className="text-xs text-rose-700 font-bold">無報價</span>;
  const tz = q.quoteTimeZone === 'Asia/Taipei' ? '台北' : q.quoteTimeZone.replace('America/', '').replace('_', ' ');
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px] leading-tight">
      <span className={`px-1.5 py-0.5 rounded border font-bold ${BASIS_STYLE[q.basis]}`}>{BASIS_LABEL[q.basis]}</span>
      <span className="num text-slate-600">
        {q.quoteDate}
        {q.quoteTime ? ` ${q.quoteTime.slice(0, 5)}` : ''}
        {!compact && ` ${tz}`}
      </span>
      {q.stale && <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold">非今日</span>}
      {!compact && <span className="text-slate-400">· {q.source}</span>}
    </span>
  );
}

export function SessionTag({ s }: { s: SessionInfo | null | undefined }) {
  if (!s) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded border ${
        s.isOpen ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-slate-100 border-slate-300 text-slate-600'
      }`}
      title={s.nextChange}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.isOpen ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {s.sessionName}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className={`num text-xl sm:text-2xl font-bold mt-1 ${tone ?? ''}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

export function PageTitle({ title, desc, right }: { title: string; desc?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight">{title}</h1>
        {desc && <p className="text-sm text-slate-500 mt-1">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const cls = {
    info: 'bg-slate-50 border-slate-300 text-slate-700',
    warn: 'bg-amber-50 border-amber-300 text-amber-900',
    error: 'bg-rose-50 border-rose-300 text-rose-800',
    ok: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  }[tone];
  return <div className={`border rounded-xl px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-center text-sm text-slate-500 py-10">{children}</div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-lg p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-lg">{title}</h2>
          <button className="btn btn-ghost !px-2 !py-1" onClick={onClose} aria-label="關閉">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <input type="checkbox" className="mt-1 w-4 h-4 accent-black" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>
        <span className="font-bold text-sm">{label}</span>
        {desc && <span className="block text-xs text-slate-500">{desc}</span>}
      </span>
    </label>
  );
}
