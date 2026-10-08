import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, ScrollText, Trophy, Clock, LogOut, KeyRound,
  Users, Receipt, Gauge, Boxes, Settings as SettingsIcon, History, Database,
} from 'lucide-react';
import { useState } from 'react';
import './index.css';
import { AuthProvider, useAuth, api } from './lib';
import { Modal, Alert } from './ui';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import TradePage from './pages/Trade';
import HistoryPage from './pages/History';
import LeaderboardPage from './pages/Leaderboard';
import ClockPage from './pages/Clock';
import AdminOverview from './pages/admin/Overview';
import AdminUsers from './pages/admin/Users';
import AdminTrades from './pages/admin/Trades';
import AdminQuotes from './pages/admin/Quotes';
import AdminInstruments from './pages/admin/Instruments';
import AdminSettings from './pages/admin/Settings';
import AdminAudit from './pages/admin/Audit';

function NavItem({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap ${
          isActive ? 'bg-[var(--color-ink)] text-white' : 'text-slate-600 hover:bg-white'
        }`
      }
    >
      <Icon size={16} /> {label}
    </NavLink>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const nav = useNavigate();
  const { refresh } = useAuth();
  return (
    <Modal title="修改密碼" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async e => {
          e.preventDefault();
          try {
            await api('/auth/password', { body: { current, next } });
            setMsg({ tone: 'ok', text: '已修改，請重新登入' });
            setTimeout(async () => { await refresh(); nav('/login'); }, 800);
          } catch (err: any) {
            setMsg({ tone: 'error', text: err.message });
          }
        }}
      >
        <div><span className="label">目前密碼</span><input className="input" type="password" value={current} onChange={e => setCurrent(e.target.value)} required /></div>
        <div><span className="label">新密碼 (至少 4 碼)</span><input className="input" type="password" value={next} onChange={e => setNext(e.target.value)} minLength={4} required /></div>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <button className="btn btn-primary w-full justify-center">確認修改</button>
      </form>
    </Modal>
  );
}

function Shell() {
  const { user, settings, logout } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);
  const nav = useNavigate();
  if (!user) return <Navigate to="/login" replace />;
  const isAdmin = user.role === 'admin';
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-paper)]/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--color-ink)] text-[#e8c766] grid place-items-center font-black">富</div>
          <div className="min-w-0">
            <div className="font-black leading-tight truncate">{settings?.competitionName}</div>
            <div className="text-xs text-slate-500">
              {user.name}
              {user.team ? ` · ${user.team}` : ''} · {isAdmin ? '管理員' : '學生'}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button className="btn btn-ghost !px-2.5" onClick={() => setPwOpen(true)} title="修改密碼"><KeyRound size={16} /></button>
            <button className="btn btn-ghost !px-2.5" onClick={async () => { await logout(); nav('/login'); }} title="登出"><LogOut size={16} /></button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-4 pb-2 flex gap-1 overflow-x-auto">
          {!isAdmin && (
            <>
              <NavItem to="/" icon={LayoutDashboard} label="資產總覽" />
              <NavItem to="/trade" icon={ShoppingCart} label="下單" />
              <NavItem to="/history" icon={ScrollText} label="交易紀錄" />
            </>
          )}
          <NavItem to="/leaderboard" icon={Trophy} label="排行榜" />
          <NavItem to="/clock" icon={Clock} label="市場時鐘" />
          {isAdmin && (
            <>
              <span className="mx-1 border-l border-[var(--color-line)]" />
              <NavItem to="/admin" icon={Gauge} label="後台總覽" />
              <NavItem to="/admin/users" icon={Users} label="學生帳號" />
              <NavItem to="/admin/trades" icon={Receipt} label="成交稽核" />
              <NavItem to="/admin/quotes" icon={Database} label="報價管理" />
              <NavItem to="/admin/instruments" icon={Boxes} label="商品設定" />
              <NavItem to="/admin/settings" icon={SettingsIcon} label="系統設定" />
              <NavItem to="/admin/audit" icon={History} label="操作紀錄" />
            </>
          )}
        </nav>
      </header>
      {settings?.tradingFrozen && (
        <div className="bg-rose-700 text-white text-sm font-bold text-center py-1.5">管理員已暫停全體交易</div>
      )}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  );
}

function AdminOnly() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}

function Home() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <Navigate to="/admin" replace /> : <DashboardPage />;
}

function App() {
  const { ready } = useAuth();
  if (!ready) return <div className="p-10 text-center text-slate-500">載入中…</div>;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="trade" element={<TradePage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="clock" element={<ClockPage />} />
        <Route path="admin" element={<AdminOnly />}>
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="trades" element={<AdminTrades />} />
          <Route path="quotes" element={<AdminQuotes />} />
          <Route path="instruments" element={<AdminInstruments />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

