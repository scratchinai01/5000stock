import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Category, Instrument } from '@shared/types';
import { CATEGORY_LABEL } from '@shared/types';
import { api, useApi, num } from '../../lib';
import { PageTitle, Alert, Modal } from '../../ui';

const CATS = Object.keys(CATEGORY_LABEL) as Category[];

export default function AdminInstruments() {
  const { data, error, reload } = useApi<Instrument[]>('/admin/instruments');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [edit, setEdit] = useState<Partial<Instrument> | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const patch = async (sym: string, body: Partial<Instrument>) => {
    try {
      await api(`/admin/instruments/${sym}`, { method: 'PATCH', body });
      reload();
    } catch (e: any) {
      setMsg({ tone: 'error', text: e.message });
    }
  };

  const rows = (data ?? []).filter(i => cat === 'all' || i.category === cat);
  return (
    <div>
      <PageTitle
        title="商品設定"
        desc="啟用/停用商品、調整保證金比例。合約乘數為交易所規格，修改前請確認。"
        right={<button className="btn btn-primary" onClick={() => setEdit({ category: 'us_stock', currency: 'USD', multiplier: 1, unitLabel: '股', marginRate: 0, shortable: false, minQty: 1, provider: 'yahoo', enabled: true })}><Plus size={15} /> 新增商品</button>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="flex flex-wrap gap-1 mb-3">
        {(['all', ...CATS] as const).map(c => (
          <button key={c} onClick={() => setCat(c)} className={`text-xs font-bold px-2.5 py-1 rounded-full border ${cat === c ? 'bg-[var(--color-ink)] text-white border-transparent' : 'border-[var(--color-line)]'}`}>{c === 'all' ? '全部' : CATEGORY_LABEL[c]}</button>
        ))}
      </div>
      <div className="card p-3 overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>啟用</th><th>代號</th><th>名稱</th><th>類別</th><th className="text-right">乘數</th><th>單位</th><th className="text-right">保證金比例</th><th>可放空</th><th>報價來源</th><th /></tr></thead>
          <tbody>
            {rows.map(i => (
              <tr key={i.symbol} className={i.enabled ? '' : 'opacity-50'}>
                <td><input type="checkbox" className="accent-black w-4 h-4" checked={i.enabled} onChange={e => patch(i.symbol, { enabled: e.target.checked })} /></td>
                <td className="num font-bold">{i.symbol}</td>
                <td>{i.name}</td>
                <td className="text-xs">{CATEGORY_LABEL[i.category]}</td>
                <td className="text-right num">{num(i.multiplier, 4)}</td>
                <td>{i.unitLabel}</td>
                <td className="text-right">
                  <input
                    className="input !py-0.5 !w-20 num text-right text-xs"
                    type="number" step="0.01" min="0" max="1"
                    defaultValue={i.marginRate}
                    onBlur={e => Number(e.target.value) !== i.marginRate && patch(i.symbol, { marginRate: Number(e.target.value) })}
                  />
                </td>
                <td>{i.shortable ? '是' : '否'}</td>
                <td className="text-xs num">{i.provider} · {i.providerSymbol}</td>
                <td><button className="btn btn-ghost !py-0.5 !px-2 text-xs" onClick={() => setEdit(i)}>編輯</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <EditModal
          init={edit}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); setMsg({ tone: 'ok', text: '已儲存' }); reload(); }}
        />
      )}
    </div>
  );
}

function EditModal({ init, onClose, onSaved }: { init: Partial<Instrument>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ providerSymbol: '', ...init });
  const [err, setErr] = useState<string | null>(null);
  const isNew = !init.symbol;
  const field = (k: string, label: string, type = 'text', extra: any = {}) => (
    <div>
      <span className="label">{label}</span>
      <input className="input" type={type} value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} {...extra} />
    </div>
  );
  return (
    <Modal title={isNew ? '新增商品' : `編輯 ${init.symbol}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault();
        try {
          await api('/admin/instruments', { body: { ...f, symbol: f.symbol } });
          onSaved();
        } catch (x: any) { setErr(x.message); }
      }}>
        <div className="grid grid-cols-2 gap-2">
          {field('symbol', '代號', 'text', { required: true, disabled: !isNew })}
          {field('name', '名稱', 'text', { required: true })}
          <div><span className="label">類別</span>
            <select className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>
              {CATS.filter(c => c !== 'tw_option').map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
          <div><span className="label">計價幣別</span>
            <select className="input" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}><option>TWD</option><option>USD</option></select>
          </div>
          {field('multiplier', '合約乘數', 'number', { step: 'any', required: true })}
          {field('unitLabel', '單位', 'text', { required: true })}
          {field('marginRate', '保證金比例 (0–1)', 'number', { step: '0.01', min: 0, max: 1 })}
          {field('minQty', '最小數量', 'number', { step: 'any', min: 0.0001 })}
          <div><span className="label">報價來源</span>
            <select className="input" value={f.provider} onChange={e => setF({ ...f, provider: e.target.value })}>
              <option value="yahoo">Yahoo Finance</option><option value="finmind">FinMind (台股)</option><option value="binance">Binance</option><option value="manual">僅手動報價</option>
            </select>
          </div>
          {field('providerSymbol', '來源代號 (如 NVDA、2330.TW、CL=F、BTCUSDT)')}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.shortable} onChange={e => setF({ ...f, shortable: e.target.checked })} /> 可放空</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.enabled} onChange={e => setF({ ...f, enabled: e.target.checked })} /> 啟用</label>
        {err && <Alert tone="error">{err}</Alert>}
        <button className="btn btn-primary w-full justify-center">儲存</button>
      </form>
    </Modal>
  );
}
