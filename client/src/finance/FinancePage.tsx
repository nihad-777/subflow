// Payments & Analytics (Member 4). Rendered by App.tsx at /app/finance for admin and staff.
import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useSearchParams } from 'react-router-dom';
import { setTokenSource } from './lib/api';
import { FinanceRoleContext } from './lib/session';
import DashboardPage from './pages/DashboardPage';
import PaymentManagementPage from './pages/PaymentManagementPage';
import PaymentHistoryPage from './pages/PaymentHistoryPage';
import OverduePage from './pages/OverduePage';
import DiscountsPage from './pages/DiscountsPage';
import './finance.css';

const TABS = [
  { id: 'dashboard', label: 'Revenue dashboard' },
  { id: 'payments', label: 'Payments' },
  { id: 'history', label: 'Payment history' },
  { id: 'overdue', label: 'Overdue invoices' },
  { id: 'discounts', label: 'Discounts' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default function FinancePage({ session, isAdmin }: { session: Session | null; isAdmin: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'dashboard');
  const go = (id: Tab) => setParams(id === 'dashboard' ? {} : { tab: id });

  // Set synchronously so the first requests already carry the token.
  setTokenSource(() => session?.access_token);
  useEffect(() => setTokenSource(() => session?.access_token), [session?.access_token]);

  return (
    <FinanceRoleContext.Provider value={{ isAdmin }}>
      <div className="sf-finance">
        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-solid border-slate-200 bg-white p-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => go(t.id)}
              className={`whitespace-nowrap rounded-md border-0 px-3 py-2 text-sm ${tab === t.id ? 'bg-indigo-50 font-semibold text-indigo-700' : 'bg-transparent text-slate-500 hover:bg-slate-50'}`}>
              {t.label}
            </button>
          ))}
        </nav>
        {tab === 'dashboard' && <DashboardPage />}
        {tab === 'payments' && <PaymentManagementPage onOpenHistory={() => go('history')} />}
        {tab === 'history' && <PaymentHistoryPage />}
        {tab === 'overdue' && <OverduePage />}
        {tab === 'discounts' && <DiscountsPage />}
      </div>
    </FinanceRoleContext.Provider>
  );
}
