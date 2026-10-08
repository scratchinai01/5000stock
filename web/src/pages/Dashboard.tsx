import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import type { AccountSummary, Position } from '@shared/types';
import { CATEGORY_LABEL } from '@shared/types';
import { useApi, twd, num, pct, pnlClass, signed, taipeiTime } from '../lib';
import { Stat, PageTitle, QuoteTag, Alert, Empty } from '../ui';

export function PositionsTable({ positions, actions = true }: { positions: Position[]; actions?: boolean }) {
  if (!positions.length) return <Empty>目前沒有持倉。</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>商品</th><th>方向</th><th className="text-right">數量</th><th className="text-right">均價</th>
            <th className="text-right">現價</th><th>現價依據</th><th className="text-right">市值/權益</th>
            <th className="text-right">未實現損益</th>{actions && <th />}
          </tr>
        </thead>
        <tbody>
          {positions.map(p => (
            <tr key={p.id}>
              <td>
                <div className="font-bold">{p.name}</div>
                <div className="text-xs text-slate-500 num">{p.symbol} · {CATEGORY_LABEL[p.category]}{p.currency === 'USD' ? ' · USD' : ''}</div>
                <div className="text-[11px] text-slate-400">建倉 {taipeiTime(p.openedAt)}</div>
              </td>
              <td><span className={`font-bold ${p.side === 'LONG' ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>{p.side === 'LONG' ? '多' : '空'}</span></td>
              <td className="text-right num">{num(p.qty, 4)}</td>
              <td className="text-right num">{num(p.avgPrice, 4)}</td>
              <td className="text-right num">{num(p.markPrice, 4)}</td>
              <td className="max-w-[16rem]"><QuoteTag q={p.markQuote} compact /></td>
              <td className="text-right num">{twd(p.marketValue)}</td>
              <td className={`text-right num font-bold ${pnlClass(p.unrealizedPnl)}`}>{signed(p.unrealizedPnl ?? 0)}</td>
              {actions && (
                <td>
                  <Link className="btn btn-ghost !py-1 !px-2 text-xs" to={`/trade?symbol=${encodeURIComponent(p.symbol)}&side=${p.side}&intent=CLOSE&qty=${p.qty}`}>
                    平倉
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SummaryStats({ s }: { s: AccountSummary }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat label="總資產 (NAV)" value={twd(s.nav)} sub={<span className={pnlClass(s.returnPct)}>{pct(s.returnPct)} · 起始 {twd(s.initialCapital)}</span>} />
      <Stat label="可用現金" value={twd(s.cash)} sub={`保證金占用 ${twd(s.marginLocked)}`} />
      <Stat label="已實現損益" value={signed(s.realizedPnl)} tone={pnlClass(s.realizedPnl)} sub="含手續費與交易稅" />
      <Stat label="未實現損益" value={signed(s.unrealizedPnl)} tone={pnlClass(s.unrealizedPnl)} sub={`估值時間 ${taipeiTime(s.valuedAt)}`} />
    </div>
  );
}

export default function DashboardPage() {
  const { data, error, loading, reload } = useApi<{ summary: AccountSummary; positions: Position[] }>('/me/account');
  return (
    <div>
      <PageTitle
        title="資產總覽"
        desc="所有現價都標示報價來源與時間；非今日的報價會特別註明。"
        right={<button className="btn btn-ghost" onClick={reload} disabled={loading}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> 重新估值</button>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {data && (
        <div className="space-y-5">
          <SummaryStats s={data.summary} />
          {data.summary.hasUnpricedPositions && (
            <Alert tone="warn">部分部位目前取不到報價，暫以最後一次成功估值的價格計算。</Alert>
          )}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-black">目前持倉</h2>
              <Link to="/trade" className="btn btn-primary !py-1.5">前往下單</Link>
            </div>
            <PositionsTable positions={data.positions} />
          </div>
        </div>
      )}
    </div>
  );
}
