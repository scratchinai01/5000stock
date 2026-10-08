import { useApi } from '../../lib';
import { PageTitle, Alert, Empty } from '../../ui';

export default function AdminAudit() {
  const { data, error } = useApi<any[]>('/admin/audit?limit=500');
  return (
    <div>
      <PageTitle title="操作紀錄" desc="登入、下單、帳號、報價與設定變更都會留下紀錄（最近 500 筆）。" />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="card p-3 overflow-x-auto">
        {data && !data.length && <Empty>沒有紀錄</Empty>}
        {data && data.length > 0 && (
          <table className="data-table">
            <thead><tr><th>時間 (台北)</th><th>操作者</th><th>動作</th><th>內容</th></tr></thead>
            <tbody>
              {data.map(r => (
                <tr key={r.id}>
                  <td className="num text-xs whitespace-nowrap">{r.createdAtText}</td>
                  <td className="font-bold whitespace-nowrap">{r.actor}</td>
                  <td className="num text-xs">{r.action}</td>
                  <td className="text-sm break-all">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
