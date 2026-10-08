import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Flag } from 'lucide-react';
import type { Trade } from '@shared/types';
import { api, useApi } from '../../lib';
import { PageTitle, Alert } from '../../ui';
import { TradesTable } from '../History';

export default function AdminTrades() {
  const [params, setParams] = useSearchParams();
  const [symbol, setSymbol] = useState(params.get('symbol') ?? '');
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of ['basis', 'stale', 'flagged', 'offHours', 'symbol', 'user', 'from', 'to']) {
      const v = params.get(k);
      if (v) p.set(k, v);
    }
    return p.toString();
  }, [params]);
  const { data, error, reload } = useApi<Trade[]>(`/admin/trades?${qs}`, [qs]);

  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p);
  };

  const flag = async (t: Trade) => {
    if (t.flagged) {
      await api(`/admin/trades/${t.id}/flag`, { body: { flagged: false } });
    } else {
      const reason = prompt('標記原因（例：以前一日收盤價成交，請補說明）');
      if (reason === null) return;
      await api(`/admin/trades/${t.id}/flag`, { body: { flagged: true, reason } });
    }
    reload();
  };

  const chip = (label: string, k: string, v: string) => (
    <button
      onClick={() => set(k, params.get(k) === v ? null : v)}
      className={`text-xs font-bold px-2.5 py-1 rounded-full border ${params.get(k) === v ? 'bg-[var(--color-ink)] text-white border-transparent' : 'border-[var(--color-line)]'}`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <PageTitle
        title="成交稽核"
        desc="檢查每筆成交價的來源與時間。可篩出以非今日報價、手動報價或非交易時段成交的紀錄並加以標記。"
        right={<a className="btn btn-ghost" href={`/api/admin/trades.csv?${qs}`}><Download size={15} /> 匯出 CSV</a>}
      />
      <div className="card p-3 mb-3 flex flex-wrap items-end gap-2">
        {chip('非今日報價', 'stale', '1')}
        {chip('手動報價', 'basis', 'MANUAL')}
        {chip('收盤價', 'basis', 'CLOSE')}
        {chip('即時', 'basis', 'LIVE')}
        {chip('非交易時段', 'offHours', '1')}
        {chip('已標記', 'flagged', '1')}
        <form className="flex gap-1 ml-auto" onSubmit={e => { e.preventDefault(); set('symbol', symbol.trim().toUpperCase() || null); }}>
          <input className="input !py-1 !w-32 text-sm" placeholder="商品代號" value={symbol} onChange={e => setSymbol(e.target.value)} />
          <input className="input !py-1 !w-36 text-sm" type="date" value={params.get('from') ?? ''} onChange={e => set('from', e.target.value || null)} title="起日" />
          <input className="input !py-1 !w-36 text-sm" type="date" value={params.get('to') ?? ''} onChange={e => set('to', e.target.value || null)} title="迄日" />
          <button className="btn btn-ghost !py-1">篩選</button>
        </form>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="card p-3">
        {data && (
          <>
            <div className="text-xs text-slate-500 mb-2 px-2">共 {data.length} 筆（最多顯示 500 筆，CSV 最多 5,000 筆）</div>
            <TradesTable
              trades={data}
              showUser
              extra={t => (
                <button className={`btn btn-ghost !py-0.5 !px-2 text-xs ${t.flagged ? 'text-rose-700' : ''}`} onClick={() => flag(t)}>
                  <Flag size={12} /> {t.flagged ? '取消標記' : '標記'}
                </button>
              )}
            />
          </>
        )}
      </div>
    </div>
  );
}
