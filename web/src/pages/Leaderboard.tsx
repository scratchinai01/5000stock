import type { AccountSummary } from '@shared/types';
import { useApi, twd, pct, pnlClass, useAuth, taipeiTime } from '../lib';
import { PageTitle, Alert, Empty } from '../ui';

export default function LeaderboardPage() {
  const { user } = useAuth();
  const { data, error, loading } = useApi<AccountSummary[]>('/leaderboard');
  return (
    <div>
      <PageTitle title="全班排行榜" desc="依總資產 (NAV) 排序，以伺服器即時估值計算。" />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="card p-3">
        {loading && !data && <Empty>估值中…</Empty>}
        {data && !data.length && <Empty>還沒有學生。</Empty>}
        {data && data.length > 0 && (
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>學生</th><th>組別</th><th className="text-right">總資產</th><th className="text-right">報酬率</th><th className="text-right">已實現</th><th className="text-right">未實現</th></tr>
            </thead>
            <tbody>
              {data.map((s, i) => (
                <tr key={s.userId} className={s.userId === user?.id ? 'bg-amber-50' : ''}>
                  <td className="num font-black">{i + 1}</td>
                  <td className="font-bold">
                    {s.name}
                    {s.hasUnpricedPositions && <span className="ml-1 text-[10px] text-amber-700" title="部分部位暫無報價">＊</span>}
                  </td>
                  <td className="text-slate-500">{s.team ?? ''}</td>
                  <td className="text-right num">{twd(s.nav)}</td>
                  <td className={`text-right num font-bold ${pnlClass(s.returnPct)}`}>{pct(s.returnPct)}</td>
                  <td className={`text-right num ${pnlClass(s.realizedPnl)}`}>{Math.round(s.realizedPnl).toLocaleString()}</td>
                  <td className={`text-right num ${pnlClass(s.unrealizedPnl)}`}>{Math.round(s.unrealizedPnl).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data?.[0] && <div className="text-xs text-slate-400 mt-2 px-2">估值時間 {taipeiTime(data[0].valuedAt)}；＊表示部分部位暫無報價，以最後估值計算。</div>}
      </div>
    </div>
  );
}
