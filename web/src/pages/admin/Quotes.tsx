import { useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import type { Category } from '@shared/types';
import { CATEGORY_LABEL } from '@shared/types';
import { api, useApi, num, taipeiTime } from '../../lib';
import { PageTitle, Alert, QuoteTag, Empty } from '../../ui';

const CATS = Object.keys(CATEGORY_LABEL) as Category[];
const todayTw = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

export default function AdminQuotes() {
  const [cat, setCat] = useState<Category>('tw_stock');
  const [force, setForce] = useState(0);
  const check = useApi<any[]>(cat === 'tw_option' ? null : `/admin/quotes/check?category=${cat}${force ? '&force=1' : ''}`, [cat, force]);
  const manual = useApi<any[]>('/admin/manual-quotes');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [f, setF] = useState({ symbol: '', price: '', prevClose: '', quoteDate: todayTw(), quoteTime: '13:30', note: '', mode: 'fallback' });
  const [token, setToken] = useState('');

  const saveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/admin/manual-quotes', {
        body: {
          symbol: f.symbol,
          price: Number(f.price),
          prevClose: f.prevClose ? Number(f.prevClose) : null,
          quoteDate: f.quoteDate,
          quoteTime: f.quoteTime || null,
          note: f.note,
          mode: f.mode,
        },
      });
      setMsg({ tone: 'ok', text: `已設定 ${f.symbol.toUpperCase()} 手動報價` });
      setF({ ...f, symbol: '', price: '', prevClose: '', note: '' });
      manual.reload();
      check.reload();
    } catch (x: any) {
      setMsg({ tone: 'error', text: x.message });
    }
  };

  return (
    <div className="space-y-5">
      <PageTitle title="報價管理" desc="檢查各商品是否取得真實報價、設定手動報價與 FinMind Token。系統不使用任何內建假價格。" />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-1 mb-3">
          {CATS.filter(c => c !== 'tw_option').map(c => (
            <button key={c} onClick={() => setCat(c)} className={`text-xs font-bold px-2.5 py-1 rounded-full border ${cat === c ? 'bg-[var(--color-ink)] text-white border-transparent' : 'border-[var(--color-line)]'}`}>{CATEGORY_LABEL[c]}</button>
          ))}
          <button className="btn btn-ghost ml-auto !py-1" onClick={() => setForce(x => x + 1)} disabled={check.loading}>
            <RefreshCw size={14} className={check.loading ? 'animate-spin' : ''} /> 重新抓取
          </button>
        </div>
        {check.loading && !check.data && <Empty>檢查中…</Empty>}
        {check.data && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>商品</th><th className="text-right">價格</th><th>報價依據</th><th>狀態</th></tr></thead>
              <tbody>
                {check.data.map(r => (
                  <tr key={r.symbol} className={r.enabled ? '' : 'opacity-50'}>
                    <td><b className="num">{r.symbol}</b> <span className="text-sm">{r.name}</span></td>
                    <td className="text-right num">{r.quote ? num(r.quote.price, 4) : '—'}</td>
                    <td><QuoteTag q={r.snapshot} /></td>
                    <td className="text-xs">
                      {!r.quote && <span className="text-rose-700 font-bold">無報價：{r.error}</span>}
                      {r.fallback === 'manual' && <span className="text-amber-800 font-bold">使用手動報價{r.error ? `（供應商：${r.error}）` : ''}</span>}
                      {r.fallback === 'last_known' && <span className="text-amber-800 font-bold">供應商失敗，使用最後一次報價（{r.error}）</span>}
                      {r.quote && !r.fallback && <span className="text-emerald-700 font-bold">正常</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <form className="card p-4 space-y-3" onSubmit={saveManual}>
          <h2 className="font-black">設定手動報價</h2>
          <Alert tone="info">
            供應商取不到報價時（或資料明顯錯誤時）使用。<b>必須註明來源</b>，成交紀錄會標示「管理員手動報價」。
            「備援」只在供應商失敗時使用；「覆蓋」會優先於供應商。
          </Alert>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="label">代號</span><input className="input num" required value={f.symbol} onChange={e => setF({ ...f, symbol: e.target.value })} placeholder="TX、2330、TXO-202610-48000-C" /></div>
            <div><span className="label">價格 (原幣)</span><input className="input num" required type="number" step="any" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></div>
            <div><span className="label">前一日收盤 (選填)</span><input className="input num" type="number" step="any" value={f.prevClose} onChange={e => setF({ ...f, prevClose: e.target.value })} /></div>
            <div><span className="label">模式</span>
              <select className="input" value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })}><option value="fallback">備援 (供應商失敗才用)</option><option value="override">覆蓋 (優先使用)</option></select>
            </div>
            <div><span className="label">報價日期</span><input className="input num" type="date" required value={f.quoteDate} onChange={e => setF({ ...f, quoteDate: e.target.value })} /></div>
            <div><span className="label">報價時間</span><input className="input num" type="time" value={f.quoteTime} onChange={e => setF({ ...f, quoteTime: e.target.value })} /></div>
          </div>
          <div><span className="label">來源說明 (必填)</span><input className="input" required minLength={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="例：期交所 10/08 一般交易時段收盤價" /></div>
          <button className="btn btn-primary">儲存</button>
        </form>

        <div className="space-y-5">
          <div className="card p-4">
            <h2 className="font-black mb-2">目前的手動報價</h2>
            {manual.data && !manual.data.length && <Empty>沒有手動報價</Empty>}
            {manual.data?.map((m: any) => (
              <div key={m.symbol} className="flex items-start gap-2 py-2 border-b border-[var(--color-line)] last:border-0 text-sm">
                <div className="flex-1">
                  <b className="num">{m.symbol}</b> <span className="num">{m.price}</span>
                  <span className="text-xs ml-2 px-1.5 rounded bg-amber-50 border border-amber-200">{m.mode === 'override' ? '覆蓋' : '備援'}</span>
                  <div className="text-xs text-slate-500">報價 {m.quote_date} {m.quote_time ?? ''} · {m.note} · {m.set_by} 設定於 {taipeiTime(m.set_at)}</div>
                </div>
                <button className="btn btn-ghost !p-1.5" title="刪除" onClick={async () => { await api(`/admin/manual-quotes/${m.symbol}`, { method: 'DELETE' }); manual.reload(); check.reload(); }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <form className="card p-4 space-y-2" onSubmit={async e => {
            e.preventDefault();
            try { const r = await api('/admin/finmind-token', { body: { token } }); setMsg({ tone: 'ok', text: r.hasToken ? 'FinMind Token 已更新' : '已清除 FinMind Token' }); setToken(''); } catch (x: any) { setMsg({ tone: 'error', text: x.message }); }
          }}>
            <h2 className="font-black">FinMind API Token</h2>
            <p className="text-xs text-slate-500">設定後台股與台指期在盤中可取得即時快照（需付費方案）。也可用環境變數 FINMIND_TOKEN 設定。留空送出 = 清除。</p>
            <input className="input num" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="貼上 token" />
            <div className="flex gap-2">
              <button className="btn btn-primary">儲存 Token</button>
              <button type="button" className="btn btn-ghost" onClick={async () => { await api('/admin/quotes/clear-cache', { method: 'POST' }); setMsg({ tone: 'ok', text: '已清除報價快取' }); check.reload(); }}>清除報價快取</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
