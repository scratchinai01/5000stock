import { useState } from 'react';
import { UserPlus, Users as UsersIcon } from 'lucide-react';
import type { AccountSummary, Position, Trade } from '@shared/types';
import { api, useApi, twd, taipeiTime } from '../../lib';
import { PageTitle, Alert, Modal, Empty } from '../../ui';
import { SummaryStats, PositionsTable } from '../Dashboard';
import { TradesTable } from '../History';

interface AdminUser {
  id: number; name: string; role: 'student' | 'admin'; team?: string; status: 'active' | 'disabled'; createdAt: number;
  cash: number | null; initialCapital: number | null; realizedPnl: number | null; tradeCount: number; lastTradeAt: number | null;
}

export default function AdminUsers() {
  const { data, error, reload } = useApi<AdminUser[]>('/admin/users');
  const [modal, setModal] = useState<null | 'create' | 'bulk' | { kind: 'password' | 'reset' | 'view'; user: AdminUser }>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const act = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: 'ok', text: ok });
      reload();
    } catch (e: any) {
      setMsg({ tone: 'error', text: e.message });
    }
  };

  return (
    <div>
      <PageTitle
        title="學生帳號"
        desc="建立/停用帳號、重設密碼、重置資金、檢視個人帳戶。"
        right={
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setModal('bulk')}><UsersIcon size={15} /> 批次建立</button>
            <button className="btn btn-primary" onClick={() => setModal('create')}><UserPlus size={15} /> 新增帳號</button>
          </div>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="card p-3 overflow-x-auto">
        {data && !data.length && <Empty>尚無帳號</Empty>}
        {data && data.length > 0 && (
          <table className="data-table">
            <thead><tr><th>姓名</th><th>身分</th><th>組別</th><th>狀態</th><th className="text-right">現金</th><th className="text-right">成交筆數</th><th>最後交易</th><th>操作</th></tr></thead>
            <tbody>
              {data.map(u => (
                <tr key={u.id} className={u.status === 'disabled' ? 'opacity-50' : ''}>
                  <td className="font-bold">{u.name}</td>
                  <td>{u.role === 'admin' ? '管理員' : '學生'}</td>
                  <td>
                    <input
                      className="input !py-1 !text-xs !w-28"
                      defaultValue={u.team ?? ''}
                      onBlur={e => e.target.value !== (u.team ?? '') && act(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { team: e.target.value || null } }), `已更新 ${u.name} 的組別`)}
                    />
                  </td>
                  <td>{u.status === 'active' ? '啟用' : '停用'}</td>
                  <td className="text-right num">{u.cash !== null ? twd(u.cash) : '—'}</td>
                  <td className="text-right num">{u.tradeCount}</td>
                  <td className="text-xs num">{u.lastTradeAt ? taipeiTime(u.lastTradeAt) : '—'}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {u.role === 'student' && <button className="btn btn-ghost !py-0.5 !px-2 text-xs" onClick={() => setModal({ kind: 'view', user: u })}>帳戶</button>}
                      <button className="btn btn-ghost !py-0.5 !px-2 text-xs" onClick={() => setModal({ kind: 'password', user: u })}>重設密碼</button>
                      {u.role === 'student' && <button className="btn btn-ghost !py-0.5 !px-2 text-xs" onClick={() => setModal({ kind: 'reset', user: u })}>重置資金</button>}
                      <button
                        className="btn btn-ghost !py-0.5 !px-2 text-xs"
                        onClick={() => act(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'disabled' : 'active' } }), `${u.name} 已${u.status === 'active' ? '停用' : '啟用'}`)}
                      >
                        {u.status === 'active' ? '停用' : '啟用'}
                      </button>
                      <button
                        className="btn btn-ghost !py-0.5 !px-2 text-xs text-rose-700"
                        onClick={() => confirm(`確定永久刪除「${u.name}」及其所有交易紀錄？此動作無法復原。`) && act(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }), `已刪除 ${u.name}`)}
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal === 'create' && <CreateModal onClose={() => setModal(null)} onDone={t => { setModal(null); setMsg({ tone: 'ok', text: t }); reload(); }} />}
      {modal === 'bulk' && <BulkModal onClose={() => { setModal(null); reload(); }} />}
      {modal && typeof modal === 'object' && modal.kind === 'password' && (
        <PasswordModal user={modal.user} onClose={() => setModal(null)} onDone={t => { setModal(null); setMsg({ tone: 'ok', text: t }); }} />
      )}
      {modal && typeof modal === 'object' && modal.kind === 'reset' && (
        <ResetModal user={modal.user} onClose={() => setModal(null)} onDone={t => { setModal(null); setMsg({ tone: 'ok', text: t }); reload(); }} />
      )}
      {modal && typeof modal === 'object' && modal.kind === 'view' && <AccountModal user={modal.user} onClose={() => setModal(null)} />}
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const [f, setF] = useState({ name: '', password: '', team: '', role: 'student' });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="新增帳號" onClose={onClose}>
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault();
        try { await api('/admin/users', { body: { ...f, team: f.team || undefined } }); onDone(`已建立 ${f.name}`); } catch (x: any) { setErr(x.message); }
      }}>
        <div><span className="label">姓名</span><input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div><span className="label">初始密碼 (至少 4 碼)</span><input className="input" required minLength={4} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></div>
        <div><span className="label">組別</span><input className="input" value={f.team} onChange={e => setF({ ...f, team: e.target.value })} /></div>
        <div><span className="label">身分</span>
          <select className="input" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}><option value="student">學生</option><option value="admin">管理員 (老師/助教)</option></select>
        </div>
        {err && <Alert tone="error">{err}</Alert>}
        <button className="btn btn-primary w-full justify-center">建立</button>
      </form>
    </Modal>
  );
}

function BulkModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<any[] | null>(null);
  return (
    <Modal title="批次建立學生" onClose={onClose}>
      <p className="text-sm text-slate-600 mb-2">每行一位：<code>姓名,密碼,組別</code>（可直接從 Excel 複製貼上，以 Tab 分隔亦可）。</p>
      <textarea className="input h-48 num text-xs" value={text} onChange={e => setText(e.target.value)} placeholder={'王小明,1234,A組\n李小華,5678,B組'} />
      <button className="btn btn-primary w-full justify-center mt-3" onClick={async () => setRes(await api('/admin/users/bulk', { body: { text } }))}>建立</button>
      {res && (
        <div className="mt-3 max-h-48 overflow-y-auto text-sm space-y-1">
          {res.map(r => <div key={r.line} className={r.ok ? 'text-emerald-700' : 'text-rose-700'}>第 {r.line} 行 {r.name}：{r.ok ? '成功' : r.error}</div>)}
        </div>
      )}
    </Modal>
  );
}

function PasswordModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (t: string) => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`重設 ${user.name} 的密碼`} onClose={onClose}>
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault();
        try { await api(`/admin/users/${user.id}/password`, { body: { password: pw } }); onDone(`已重設 ${user.name} 的密碼，該帳號已被登出`); } catch (x: any) { setErr(x.message); }
      }}>
        <input className="input" minLength={4} required value={pw} onChange={e => setPw(e.target.value)} placeholder="新密碼" />
        {err && <Alert tone="error">{err}</Alert>}
        <button className="btn btn-primary w-full justify-center">確認</button>
      </form>
    </Modal>
  );
}

function ResetModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (t: string) => void }) {
  const [cap, setCap] = useState(String(user.initialCapital ?? 50000000));
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`重置 ${user.name} 的帳戶`} onClose={onClose}>
      <Alert tone="warn">會刪除此學生所有持倉與交易紀錄，並將現金設為下方金額。此動作無法復原（會寫入操作紀錄）。</Alert>
      <div className="mt-3"><span className="label">起始資金 (NT$)</span><input className="input num" type="number" value={cap} onChange={e => setCap(e.target.value)} /></div>
      {err && <div className="mt-2"><Alert tone="error">{err}</Alert></div>}
      <button className="btn btn-danger w-full justify-center mt-3" onClick={async () => {
        try { await api(`/admin/users/${user.id}/reset`, { body: { initialCapital: Number(cap) } }); onDone(`已重置 ${user.name}`); } catch (x: any) { setErr(x.message); }
      }}>確認重置</button>
    </Modal>
  );
}

function AccountModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { data, error } = useApi<{ summary: AccountSummary; positions: Position[]; trades: Trade[] }>(`/admin/users/${user.id}/account`);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto p-3" onClick={onClose}>
      <div className="card max-w-6xl mx-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-lg">{user.name} 的帳戶</h2>
          <button className="btn btn-ghost !px-2 !py-1" onClick={onClose}>✕</button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {data && (
          <div className="space-y-4">
            <SummaryStats s={data.summary} />
            <div><h3 className="font-black mb-1">持倉</h3><PositionsTable positions={data.positions} actions={false} /></div>
            <div><h3 className="font-black mb-1">成交紀錄</h3><TradesTable trades={data.trades} /></div>
          </div>
        )}
      </div>
    </div>
  );
}
