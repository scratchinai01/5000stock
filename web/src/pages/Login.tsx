import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, useAuth, twd } from '../lib';
import { Alert } from '../ui';

export default function LoginPage() {
  const { user, settings, refresh } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [team, setTeam] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'register' && password !== password2) return setError('兩次輸入的密碼不一致');
    setBusy(true);
    try {
      await api(mode === 'login' ? '/auth/login' : '/auth/register', {
        body: mode === 'login' ? { name, password } : { name, password, team: team || undefined },
      });
      await refresh();
      nav('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <section className="hidden lg:flex flex-col justify-between bg-[var(--color-ink)] text-white p-12">
        <div className="text-[#e8c766] font-black tracking-widest text-sm">FINMIND TYCOON</div>
        <div>
          <h1 className="text-5xl font-black leading-tight">{settings?.competitionName}</h1>
          <p className="mt-5 text-slate-300 max-w-md leading-relaxed">
            起始資金 {twd(settings?.initialCapital)}，以真實市場報價模擬台股、ETF、台指期、選擇權、美股、原物料與加密貨幣交易。
            每一筆成交都會記錄價格的來源與時間，可供老師稽核。
          </p>
        </div>
        <div className="text-xs text-slate-500">教學模擬用途，不構成投資建議。</div>
      </section>

      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-4">
          <div className="lg:hidden font-black text-xl">{settings?.competitionName}</div>
          <div className="flex rounded-lg bg-slate-100 p-1 text-sm font-bold">
            <button type="button" className={`flex-1 py-1.5 rounded-md ${mode === 'login' ? 'bg-white shadow-sm' : 'text-slate-500'}`} onClick={() => setMode('login')}>登入</button>
            <button
              type="button"
              disabled={!settings?.allowSelfRegister}
              className={`flex-1 py-1.5 rounded-md ${mode === 'register' ? 'bg-white shadow-sm' : 'text-slate-500'} disabled:opacity-40`}
              onClick={() => setMode('register')}
              title={settings?.allowSelfRegister ? '' : '目前不開放自行註冊'}
            >
              新同學註冊
            </button>
          </div>
          <div>
            <label className="label" htmlFor="name">姓名</label>
            <input id="name" className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="username" required />
          </div>
          <div>
            <label className="label" htmlFor="pw">密碼</label>
            <input id="pw" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </div>
          {mode === 'register' && (
            <>
              <div>
                <label className="label" htmlFor="pw2">再次輸入密碼</label>
                <input id="pw2" className="input" type="password" value={password2} onChange={e => setPassword2(e.target.value)} autoComplete="new-password" required />
              </div>
              <div>
                <label className="label" htmlFor="team">組別 (選填)</label>
                <input id="team" className="input" value={team} onChange={e => setTeam(e.target.value)} />
              </div>
            </>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <button className="btn btn-primary w-full justify-center" disabled={busy}>
            {busy ? '處理中…' : mode === 'login' ? '登入' : '建立帳號並登入'}
          </button>
          {!settings?.allowSelfRegister && <p className="text-xs text-slate-500">帳號由老師建立，忘記密碼請洽老師重設。</p>}
        </form>
      </section>
    </div>
  );
}
