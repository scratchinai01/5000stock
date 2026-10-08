import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useApi, num } from '../../lib';
import { PageTitle, Stat, Alert } from '../../ui';

export default function AdminOverview() {
  const { data, error } = useApi<any>('/admin/overview');
  return (
    <div>
      <PageTitle
        title="後台總覽"
        desc={data ? `伺服器台北時間 ${data.serverTime}` : undefined}
        right={<a className="btn btn-ghost" href="/api/admin/backup"><Download size={15} /> 下載資料庫備份</a>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="學生 (啟用中)" value={`${data.activeStudents} / ${data.students}`} />
            <Stat label="總成交筆數" value={num(data.trades, 0)} sub={`近 24 小時 ${data.trades24h} 筆`} />
            <Stat label="以非今日報價成交" value={num(data.staleFills, 0)} sub={<Link className="underline" to="/admin/trades?stale=1">查看</Link>} />
            <Stat label="以手動報價成交" value={num(data.manualFills, 0)} sub={<Link className="underline" to="/admin/trades?basis=MANUAL">查看</Link>} />
            <Stat label="非交易時段成交" value={num(data.offHoursFills, 0)} sub={<Link className="underline" to="/admin/trades?offHours=1">查看</Link>} />
            <Stat label="已標記成交" value={num(data.flaggedTrades, 0)} sub={<Link className="underline" to="/admin/trades?flagged=1">查看</Link>} />
            <Stat label="手動報價" value={num(data.manualQuotes, 0)} sub={<Link className="underline" to="/admin/quotes">管理</Link>} />
            <Stat
              label="USD/TWD"
              value={data.fx ? num(data.fx.rate, 4) : '無'}
              sub={data.fx ? `${data.fx.source} ${data.fx.quoteDate}` : '美元商品暫停交易，請於系統設定輸入匯率'}
            />
          </div>
          <div className="card p-4 space-y-2">
            <h2 className="font-black">報價連線狀態</h2>
            {data.quotesOffline && <Alert tone="warn">QUOTES_OFFLINE=1：目前不連外取報價，只會使用手動報價與最後一次取得的報價。</Alert>}
            <Alert tone={data.finmindToken ? 'ok' : 'warn'}>
              FinMind Token：{data.finmindToken ? '已設定（台股盤中可取得即時快照）' : '未設定（台股使用日收盤/Yahoo 延遲報價；台指期與選擇權仍可取得日資料，但流量受限）'}
            </Alert>
            <div className="text-sm text-slate-600">
              交易規則：{data.settings.enforceTradingHours ? '僅限交易時段' : '全天可下單（非交易時段以最近報價成交並標示）'}；
              {data.settings.allowStaleQuotes ? '允許以非今日報價成交（會標示）' : '禁止以非今日報價成交'}；
              {data.settings.tradingFrozen ? '⚠ 目前已暫停交易' : '交易開放中'}。
              <Link to="/admin/settings" className="underline ml-1">修改</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
