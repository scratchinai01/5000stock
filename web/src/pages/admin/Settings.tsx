import { useEffect, useState } from 'react';
import type { Settings } from '@shared/types';
import { api, useApi, useAuth } from '../../lib';
import { PageTitle, Alert, Toggle } from '../../ui';

export default function AdminSettings() {
  const { data, error } = useApi<Settings>('/admin/settings');
  const { refresh } = useAuth();
  const [f, setF] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!f) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF({ ...f, [k]: v });

  return (
    <div className="max-w-3xl">
      <PageTitle title="系統設定" />
      <form className="space-y-5" onSubmit={async e => {
        e.preventDefault();
        try { await api('/admin/settings', { method: 'PATCH', body: f }); await refresh(); setMsg({ tone: 'ok', text: '設定已儲存' }); }
        catch (x: any) { setMsg({ tone: 'error', text: x.message }); }
      }}>
        <div className="card p-4 space-y-3">
          <h2 className="font-black">競賽</h2>
          <div><span className="label">競賽名稱</span><input className="input" value={f.competitionName} onChange={e => set('competitionName', e.target.value)} /></div>
          <div>
            <span className="label">新帳號起始資金 (NT$)</span>
            <input className="input num" type="number" value={f.initialCapital} onChange={e => set('initialCapital', Number(e.target.value))} />
            <p className="text-xs text-slate-500 mt-1">只影響之後建立或重置的帳戶。</p>
          </div>
          <Toggle checked={f.allowSelfRegister} onChange={v => set('allowSelfRegister', v)} label="開放學生自行註冊" desc="關閉後只能由管理員建立帳號。" />
          <Toggle checked={f.tradingFrozen} onChange={v => set('tradingFrozen', v)} label="暫停全體交易" desc="例如國定假日、競賽結算期間。" />
        </div>

        <div className="card p-4 space-y-1">
          <h2 className="font-black mb-1">成交規則（報價時間對齊）</h2>
          <Toggle checked={f.enforceTradingHours} onChange={v => set('enforceTradingHours', v)} label="僅允許在各市場交易時段內下單" desc="關閉時，非交易時段以最近報價成交，並在紀錄中標示「非交易時段」。" />
          <Toggle checked={f.allowStaleQuotes} onChange={v => set('allowStaleQuotes', v)} label="允許以非今日的報價成交" desc="例如週末以週五收盤價成交。關閉後，報價日期早於今日（台北）就拒絕成交。" />
          <div className="py-2">
            <span className="label">盤中報價最長可接受延遲（分鐘，0 = 不限制）</span>
            <input className="input num !w-32" type="number" min={0} value={f.maxQuoteAgeMinutesWhenOpen} onChange={e => set('maxQuoteAgeMinutesWhenOpen', Number(e.target.value))} />
          </div>
          <Toggle checked={f.allowManualQuotes} onChange={v => set('allowManualQuotes', v)} label="允許使用管理員手動報價" desc="關閉後，手動報價全部失效。" />
        </div>

        <div className="card p-4 space-y-2">
          <h2 className="font-black">匯率備援</h2>
          <p className="text-xs text-slate-500">系統會優先抓取 Yahoo USD/TWD；取不到時才使用這裡的匯率（成交紀錄會標示「手動」）。留空則取不到匯率時暫停美元商品交易。</p>
          <input className="input num !w-40" type="number" step="0.0001" min={20} max={50} value={f.manualUsdTwd ?? ''} onChange={e => set('manualUsdTwd', e.target.value ? Number(e.target.value) : null)} placeholder="例如 30.5" />
        </div>

        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <button className="btn btn-primary">儲存設定</button>
      </form>
    </div>
  );
}
