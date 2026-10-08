import type { ReactNode } from 'react';
import type { Trade } from '@shared/types';
import { useApi, twd, num, pnlClass, signed } from '../lib';
import { PageTitle, QuoteTag, Alert, Empty } from '../ui';

export function TradesTable({ trades, showUser = false, extra }: { trades: Trade[]; showUser?: boolean; extra?: (t: Trade) => ReactNode }) {
  if (!trades.length) return <Empty>沒有成交紀錄。</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>成交時間 (台北)</th>
            {showUser && <th>學生</th>}
            <th>商品</th><th>動作</th><th className="text-right">數量</th><th className="text-right">成交價</th>
            <th>成交價依據</th><th className="text-right">名目金額</th><th className="text-right">費+稅</th>
            <th className="text-right">已實現</th>{extra && <th />}
          </tr>
        </thead>
        <tbody>
          {trades.map(t => (
            <tr key={t.id} className={t.flagged ? 'bg-rose-50/60' : ''}>
              <td className="num text-xs whitespace-nowrap">
                {t.executedAtText}
                <div className={`text-[10px] ${t.marketOpen ? 'text-emerald-700' : 'text-slate-400'}`}>{t.sessionName}</div>
              </td>
              {showUser && <td className="font-bold whitespace-nowrap">{t.userName}</td>}
              <td>
                <div className="font-bold">{t.name}</div>
                <div className="text-xs text-slate-500 num">{t.symbol}</div>
                {t.note && <div className="text-[11px] text-slate-500 max-w-[14rem]">「{t.note}」</div>}
              </td>
              <td className="whitespace-nowrap">
                <span className={`font-bold ${t.side === 'LONG' ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                  {t.intent === 'OPEN' ? '新倉' : '平倉'}{t.side === 'LONG' ? '多' : '空'}
                </span>
              </td>
              <td className="text-right num">{num(t.qty, 4)}</td>
              <td className="text-right num">
                {num(t.price, 4)}
                {t.fx !== 1 && <div className="text-[10px] text-slate-400">匯率 {num(t.fx, 3)}</div>}
              </td>
              <td className="max-w-[16rem]">
                <QuoteTag q={t.quote} compact />
                {t.flagged && <div className="text-[11px] text-rose-700 font-bold mt-1">⚑ {t.flagReason || '已標記'}</div>}
              </td>
              <td className="text-right num">{twd(t.notional)}</td>
              <td className="text-right num text-slate-500">{num(t.fee + t.tax, 0)}</td>
              <td className={`text-right num font-bold ${pnlClass(t.realizedPnl)}`}>{t.intent === 'CLOSE' ? signed(t.realizedPnl) : ''}</td>
              {extra && <td>{extra(t)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HistoryPage() {
  const { data, error } = useApi<Trade[]>('/me/trades');
  return (
    <div>
      <PageTitle title="交易紀錄" desc="每筆成交同時記錄「下單時間」與「成交價所屬的報價時間」，兩者可能不同（例如收盤後以當日收盤價成交）。" />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="card p-3">{data && <TradesTable trades={data} />}</div>
    </div>
  );
}
