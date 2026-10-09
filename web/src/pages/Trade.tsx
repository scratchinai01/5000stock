import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, RefreshCw } from 'lucide-react';
import type { Category, Instrument, OrderPreview, Quote, QuoteSnapshot, SessionInfo, Side, OrderIntent, Trade } from '@shared/types';
import { CATEGORY_LABEL } from '@shared/types';
import { api, useApi, twd, num, pnlClass, signed } from '../lib';
import { PageTitle, QuoteTag, SessionTag, Alert, Empty } from '../ui';

const CATS: Category[] = ['tw_stock', 'tw_etf', 'tw_bond_etf', 'tw_future', 'tw_option', 'us_stock', 'commodity', 'crypto'];

interface QuoteResp {
  instrument: Instrument;
  quote: Quote | null;
  snapshot: QuoteSnapshot | null;
  fallback: string | null;
  error: string | null;
  session: SessionInfo;
}

function InstrumentPicker({ onPick, active }: { onPick: (s: string) => void; active: string | null }) {
  const [cat, setCat] = useState<Category>('tw_stock');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Instrument[] | null>(null);
  const list = useApi<Instrument[]>(cat === 'tw_option' ? null : `/market/instruments?category=${cat}`, [cat]);

  useEffect(() => {
    if (!q.trim()) return setResults(null);
    const t = setTimeout(() => api<Instrument[]>(`/market/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  const items = results ?? list.data ?? [];
  return (
    <div className="card p-3">
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-3 text-slate-400" />
        <input className="input !pl-9" placeholder="搜尋代號或名稱 (全台股 4,300+ 檔)" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {!results && (
        <div className="flex flex-wrap gap-1 mb-3">
          {CATS.map(c => (
            <button key={c} onClick={() => setCat(c)} className={`text-xs font-bold px-2.5 py-1 rounded-full border ${cat === c ? 'bg-[var(--color-ink)] text-white border-transparent' : 'border-[var(--color-line)] text-slate-600'}`}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      )}
      {cat === 'tw_option' && !results ? (
        <OptionChain onPick={onPick} />
      ) : (
        <div className="max-h-60 lg:max-h-[28rem] overflow-y-auto -mx-1">
          {items.length === 0 && <Empty>{list.loading ? '載入中…' : '沒有符合的商品'}</Empty>}
          {items.map(i => (
            <button key={i.symbol} onClick={() => onPick(i.symbol)} className={`w-full text-left px-2 py-2 rounded-lg flex items-center gap-2 ${active === i.symbol ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
              <span className="num font-bold text-sm w-16 shrink-0">{i.symbol}</span>
              <span className="text-sm truncate">{i.name}</span>
              <span className="ml-auto text-[10px] text-slate-400 shrink-0">{CATEGORY_LABEL[i.category]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionChain({ onPick }: { onPick: (s: string) => void }) {
  const [month, setMonth] = useState('');
  const { data, loading } = useApi<any>(`/market/options/chain${month ? `?month=${month}` : ''}`, [month]);
  if (loading && !data) return <Empty>載入選擇權資料…</Empty>;
  if (!data || data.error || !data.strikes.length) return <Alert tone="warn">{data?.error || '目前沒有選擇權資料（需要 FinMind 連線）。'}</Alert>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-xs">
        <select className="input !w-auto !py-1" value={data.month} onChange={e => setMonth(e.target.value)}>
          {data.months.map((m: string) => <option key={m}>{m}</option>)}
        </select>
        <span className="text-slate-500">資料日 {data.date}（日收盤/結算價）</span>
      </div>
      <div className="max-h-[24rem] overflow-y-auto">
        <table className="data-table">
          <thead><tr><th className="text-right">買權</th><th className="text-center">履約價</th><th>賣權</th></tr></thead>
          <tbody>
            {data.strikes.map((s: any) => (
              <tr key={s.strike}>
                <td className="text-right"><button disabled={!s.call} className="num font-bold text-[var(--color-up)] disabled:text-slate-300" onClick={() => onPick(`TXO-${data.month}-${s.strike}-C`)}>{s.call ?? '—'}</button></td>
                <td className="text-center num font-bold">{s.strike}</td>
                <td><button disabled={!s.put} className="num font-bold text-[var(--color-down)] disabled:text-slate-300" onClick={() => onPick(`TXO-${data.month}-${s.strike}-P`)}>{s.put ?? '—'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TradePage() {
  const [params, setParams] = useSearchParams();
  const symbol = params.get('symbol');
  const [side, setSide] = useState<Side>((params.get('side') as Side) || 'LONG');
  const [intent, setIntent] = useState<OrderIntent>((params.get('intent') as OrderIntent) || 'OPEN');
  const [qty, setQty] = useState<string>(params.get('qty') || '1');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [done, setDone] = useState<Trade | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const quote = useApi<QuoteResp>(symbol ? `/market/quote/${encodeURIComponent(symbol)}` : null, [symbol]);
  const inst = quote.data?.instrument;

  const pick = (s: string) => {
    setParams({ symbol: s });
    setIntent('OPEN');
    setSide('LONG');
    setQty('1');
    setNote('');
    setDone(null);
    setSubmitErr(null);
    setConfirming(false);
  };

  // 試算 (伺服器端計算，前端不決定價格)
  const qtyNum = Number(qty);
  const body = useMemo(() => (symbol && qtyNum > 0 ? { symbol, side, intent, qty: qtyNum } : null), [symbol, side, intent, qtyNum]);
  useEffect(() => {
    setPreview(null);
    setPreviewErr(null);
    setConfirming(false);
    if (!body) return;
    const t = setTimeout(() => {
      api<OrderPreview>('/orders/preview', { body }).then(setPreview).catch(e => setPreviewErr(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [body]);

  const submit = async () => {
    if (!body) return;
    setBusy(true);
    setSubmitErr(null);
    try {
      const t = await api<Trade>('/orders', { body: { ...body, note: note || undefined } });
      setDone(t);
      setNote('');
      setConfirming(false);
      quote.reload();
    } catch (e: any) {
      setSubmitErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const q = quote.data?.quote;
  const change = q?.prevClose ? q.price - q.prevClose : null;

  return (
    <div>
      <PageTitle title="下單" desc="成交價一律以伺服器取得的真實報價為準，下單時會同時記錄報價的來源與時間。" />
      <div className="grid lg:grid-cols-[22rem_1fr] gap-5">
        <InstrumentPicker onPick={pick} active={symbol} />

        <div className="space-y-4">
          {!symbol && <div className="card"><Empty>請從左側選擇商品。</Empty></div>}
          {symbol && quote.error && <Alert tone="error">{quote.error}</Alert>}
          {inst && (
            <div className="card p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div>
                  <div className="text-xs text-slate-500 num">{inst.symbol} · {CATEGORY_LABEL[inst.category]} · 1 {inst.unitLabel} = {num(inst.multiplier)} 倍{inst.currency === 'USD' ? ' · 美元計價' : ''}</div>
                  <div className="text-2xl font-black">{inst.name}</div>
                </div>
                <button className="btn btn-ghost ml-auto !py-1" onClick={() => quote.reload()}><RefreshCw size={14} /> 更新報價</button>
              </div>
              {q ? (
                <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <div className="num text-4xl font-bold">{num(q.price, 4)}</div>
                  {change !== null && (
                    <div className={`num font-bold ${pnlClass(change)}`}>
                      {change > 0 ? '+' : ''}{num(change, 4)} ({((change / q.prevClose!) * 100).toFixed(2)}%)
                    </div>
                  )}
                  <div className="text-xs text-slate-500">{q.currency}</div>
                </div>
              ) : (
                <Alert tone="error">目前取不到真實報價，無法交易。{quote.data?.error ? `（${quote.data.error}）` : ''}</Alert>
              )}
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <QuoteTag q={quote.data?.snapshot} />
                <SessionTag s={quote.data?.session} />
                {quote.data?.fallback === 'last_known' && <span className="text-[11px] text-amber-800 font-bold">供應商暫無回應，顯示最後一次取得的報價</span>}
              </div>
              {q?.note && <div className="text-xs text-amber-900 mt-2">手動報價說明：{q.note}</div>}
            </div>
          )}

          {inst && q && (
            <div className="card p-5 space-y-4">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <span className="label">動作</span>
                  <div className="flex rounded-lg bg-slate-100 p-1 text-sm font-bold">
                    {(['OPEN', 'CLOSE'] as const).map(v => (
                      <button key={v} className={`flex-1 py-1.5 rounded-md ${intent === v ? 'bg-white shadow-sm' : 'text-slate-500'}`} onClick={() => setIntent(v)}>{v === 'OPEN' ? '新倉' : '平倉'}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="label">方向</span>
                  <div className="flex rounded-lg bg-slate-100 p-1 text-sm font-bold">
                    <button className={`flex-1 py-1.5 rounded-md ${side === 'LONG' ? 'bg-white shadow-sm text-[var(--color-up)]' : 'text-slate-500'}`} onClick={() => setSide('LONG')}>多 (買)</button>
                    <button disabled={!inst.shortable && intent === 'OPEN'} className={`flex-1 py-1.5 rounded-md disabled:opacity-40 ${side === 'SHORT' ? 'bg-white shadow-sm text-[var(--color-down)]' : 'text-slate-500'}`} onClick={() => setSide('SHORT')}>空 (賣)</button>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="qty">數量 ({inst.unitLabel})</label>
                  <input id="qty" className="input num" type="number" min={inst.minQty} step={inst.minQty < 1 ? inst.minQty : 1} value={qty} onChange={e => setQty(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="note">下單理由 (選填，會出現在交易紀錄)</label>
                <input id="note" className="input" maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="例：看好 AI 伺服器需求，建立核心部位" />
              </div>

              {previewErr && <Alert tone="error">{previewErr}</Alert>}
              {preview && (
                <div className="rounded-xl border border-[var(--color-line)] bg-[#fbfaf6] p-4 text-sm">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4">
                    <Row k="成交價" v={<span className="num font-bold">{num(preview.price, 4)}</span>} />
                    {preview.instrument.currency === 'USD' && <Row k="匯率 USD/TWD" v={<span className="num" title={preview.fxSource}>{num(preview.fx, 4)}</span>} />}
                    <Row k="名目金額" v={twd(preview.notional)} />
                    <Row k="手續費" v={twd(preview.fee)} />
                    <Row k="交易稅" v={twd(preview.tax)} />
                    {preview.marginRequired > 0 && <Row k="原始保證金" v={twd(preview.marginRequired)} />}
                    {preview.intent === 'OPEN'
                      ? <Row k="需扣現金" v={<b>{twd(preview.cashRequired)}</b>} />
                      : <Row k="回收現金" v={<b>{twd(-preview.cashRequired)}</b>} />}
                    {preview.estimatedRealizedPnl !== undefined && (
                      <Row k="預估已實現損益" v={<b className={pnlClass(preview.estimatedRealizedPnl)}>{signed(preview.estimatedRealizedPnl)}</b>} />
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t border-[var(--color-line)] text-xs space-y-1">
                    <div className="flex flex-wrap items-center gap-1"><span className="font-bold">成交價依據：</span><QuoteTag q={preview.quoteSnapshot} /></div>
                    {preview.priceLimit && (
                      <div className="text-slate-600">
                        <span className="font-bold">今日漲跌停：</span>
                        <span className="num text-[var(--color-up)]">漲停 {preview.priceLimit.limitUp}</span>{' ／ '}
                        <span className="num text-[var(--color-down)]">跌停 {preview.priceLimit.limitDown}</span>
                        {preview.priceLimit.state !== 'NONE' && (
                          <b className={preview.priceLimit.state === 'LIMIT_UP' ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>
                            {' '}· 目前{preview.priceLimit.state === 'LIMIT_UP' ? '漲停' : '跌停'}
                          </b>
                        )}
                      </div>
                    )}
                    {preview.warnings.map(w => <div key={w} className="text-amber-800">⚠ {w}</div>)}
                  </div>
                  {!preview.allowed && <div className="mt-3"><Alert tone="error">{preview.blockReason}</Alert></div>}
                </div>
              )}

              {submitErr && <Alert tone="error">{submitErr}</Alert>}
              {!confirming ? (
                <button className="btn btn-primary w-full justify-center py-3" disabled={!preview?.allowed || busy} onClick={() => setConfirming(true)}>
                  {intent === 'OPEN' ? (side === 'LONG' ? '買進' : '放空') : side === 'LONG' ? '賣出平倉' : '回補平倉'} {qty} {inst.unitLabel}
                </button>
              ) : (
                <div className="rounded-xl border-2 border-[var(--color-ink)] p-3 space-y-2">
                  <div className="text-sm">
                    確認以 <b className="num">{num(preview?.price, 4)}</b>（{preview?.quoteSnapshot.quoteDate} {preview?.quoteSnapshot.quoteTime?.slice(0, 5)} 的報價）成交？
                    實際成交以送出當下伺服器取得的報價為準。
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost flex-1 justify-center" onClick={() => setConfirming(false)}>取消</button>
                    <button className="btn btn-primary flex-1 justify-center" disabled={busy} onClick={submit}>{busy ? '送出中…' : '確認送出'}</button>
                  </div>
                </div>
              )}

              {done && (
                <Alert tone="ok">
                  已成交：{done.name} {done.intent === 'OPEN' ? '新倉' : '平倉'}{done.side === 'LONG' ? '多' : '空'} {num(done.qty, 4)} {inst.unitLabel} @ <span className="num">{num(done.price, 4)}</span>
                  ，成交時間 {done.executedAtText}（報價 {done.quote.quoteDate} {done.quote.quoteTime?.slice(0, 5) ?? ''}）。
                  <Link className="underline ml-1" to="/history">查看交易紀錄</Link>
                </Alert>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500 font-bold">{k}</div>
      <div className="num">{v}</div>
    </div>
  );
}
