import { useEffect } from 'react';
import type { SessionInfo } from '@shared/types';
import { useApi } from '../lib';
import { PageTitle } from '../ui';

const LABEL: Record<string, { name: string; hours: string }> = {
  tw_stock: { name: '台股 / ETF', hours: '09:00–13:30，盤後定價 14:00–14:30' },
  tw_future: { name: '台指期 / 選擇權', hours: '日盤 08:45–13:45，夜盤 15:00–次日 05:00' },
  us_stock: { name: '美股', hours: '紐約 09:30–16:00（台北 21:30/22:30 起，依夏令時間）' },
  commodity: { name: '國際原物料 (CME)', hours: '芝加哥 週日 18:00 – 週五 17:00，每日休息 1 小時' },
  crypto: { name: '加密貨幣', hours: '24 小時 × 7 天' },
};

export default function ClockPage() {
  const { data, reload } = useApi<{ taipei: string; sessions: Record<string, SessionInfo> }>('/market/clock');
  useEffect(() => {
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);
  return (
    <div>
      <PageTitle title="市場時鐘" desc={`伺服器台北時間 ${data?.taipei ?? '—'}（各市場依當地時區判斷，自動處理夏令時間；未內建國定假日）`} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data &&
          Object.entries(data.sessions).map(([k, s]) => (
            <div key={k} className={`card p-4 border-l-4 ${s.isOpen ? '!border-l-emerald-500' : '!border-l-slate-300'}`}>
              <div className="flex items-center justify-between">
                <div className="font-black">{LABEL[k]?.name ?? k}</div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.isOpen ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                  {s.isOpen ? '交易中' : '休市'}
                </span>
              </div>
              <div className="text-sm mt-2">{s.sessionName}</div>
              <div className="text-xs text-slate-500 mt-1">下一階段：{s.nextChange}</div>
              <div className="text-xs text-slate-400 mt-2">{LABEL[k]?.hours}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
