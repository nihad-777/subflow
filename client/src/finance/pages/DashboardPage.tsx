import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiRaw, qs } from '../lib/api';
import { daysAgo, money, moneyCompact, startOfMonth, startOfYear, today, methodLabel, date } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { ErrorBanner, PageHeader } from '../components/ui';

// Reference data-viz palette (validated): slot 1 blue, slot 2 orange; ordinal blue ramp for aging.
const C = { invoiced: '#2a78d6', collected: '#eb6834', single: '#2a78d6', grid: '#e7e5e0', axis: '#52514e' };
const AGING_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];

const PRESETS = [
  { key: 'month', label: 'This month', from: startOfMonth, gran: 'day' },
  { key: '3m', label: 'Last 3 months', from: () => daysAgo(89), gran: 'week' },
  { key: '6m', label: 'Last 6 months', from: () => daysAgo(182), gran: 'month' },
  { key: 'ytd', label: 'Year to date', from: startOfYear, gran: 'month' },
] as const;

interface Dashboard {
  summary: {
    activeSubscriptions: number; mrr: number; invoicedAmount: number; invoiceCount: number; collectedAmount: number;
    paymentCount: number; outstandingAmount: number; overdueCount: number; overdueAmount: number; discountsGiven: number;
  };
  trend: { granularity: string; points: { bucket: string; invoiced: number; collected: number }[] };
  byPlan: { planId: string; planName: string; invoiced: number; collected: number }[];
  byMethod: { method: string; amount: number; count: number }[];
  aging: { bucket: string; count: number; amount: number }[];
  topOutstanding: { customer: { id: string; name: string }; outstanding: number; overdue: number; maxDaysOverdue: number }[];
}

const tick = { fill: C.axis, fontSize: 12 };
const tooltipStyle = { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 };

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${warn ? 'font-medium text-rose-700' : 'text-slate-500'}`}>{sub}</p>}
    </div>
  );
}

function ChartCard({ title, children, empty }: { title: string; children: ReactNode; empty?: boolean }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      {empty ? <p className="py-16 text-center text-sm text-slate-400">No data in this range</p> : children}
    </section>
  );
}

const bucketLabel = (b: string, g: string) =>
  g === 'month' ? new Date(`${b}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : date(b).slice(0, 6);

export default function DashboardPage() {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>(PRESETS[2]);
  const [planId, setPlanId] = useState('');
  const plans = useAsync(() => apiRaw<{ id: string; name: string }[]>('/lookups/plans').then((r) => r.data), []);
  const { data: res, error, loading, reload } = useAsync(
    () => apiRaw<Dashboard>(`/reports/dashboard${qs({ from: preset.from(), to: today(), granularity: preset.gran, planId })}`),
    [preset.key, planId],
  );
  const d = res?.data;
  const s = d?.summary;
  const collectionRate = s && s.invoicedAmount > 0 ? Math.round((s.collectedAmount / s.invoicedAmount) * 100) : null;

  return (
    <div>
      <PageHeader
        title="Revenue analytics"
        subtitle={res?.ms != null ? <span title="Server time for the whole dashboard">Loaded in {res.ms} ms</span> : loading ? 'Loading…' : undefined}
        actions={
          <>
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
              {PRESETS.map((p) => (
                <button key={p.key} onClick={() => setPreset(p)}
                  className={`rounded-md px-3 py-1.5 text-sm ${p.key === preset.key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <select className="input w-44" value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Plan">
              <option value="">All plans</option>
              {plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        }
      />
      <ErrorBanner error={error} onRetry={reload} />

      <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 ${loading && !d ? 'animate-pulse' : ''}`}>
        <Kpi label="Active subscriptions" value={s ? s.activeSubscriptions.toLocaleString() : '—'} />
        <Kpi label="MRR" value={s ? moneyCompact(s.mrr) : '—'} sub="Normalised to one month" />
        <Kpi label="Invoiced" value={s ? moneyCompact(s.invoicedAmount) : '—'} sub={s ? `${s.invoiceCount.toLocaleString()} invoices` : undefined} />
        <Kpi label="Collected" value={s ? moneyCompact(s.collectedAmount) : '—'} sub={collectionRate !== null ? `${collectionRate}% of invoiced` : undefined} />
        <Kpi label="Outstanding" value={s ? moneyCompact(s.outstandingAmount) : '—'} sub="As of today" />
        <Kpi label="Overdue" value={s ? moneyCompact(s.overdueAmount) : '—'} sub={s ? `${s.overdueCount.toLocaleString()} invoices` : undefined} warn={!!s?.overdueCount} />
      </div>

      {d && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <ChartCard title="Invoiced vs collected" empty={!d.trend.points.some((p) => p.invoiced || p.collected)}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={d.trend.points} barGap={2} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="bucket" tick={tick} tickLine={false} axisLine={{ stroke: C.grid }} tickFormatter={(b) => bucketLabel(b, d.trend.granularity)} />
                  <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => moneyCompact(v)} width={70} />
                  <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} labelFormatter={(b) => `Period from ${date(String(b))}`} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: C.axis }} />
                  <Bar dataKey="invoiced" name="Invoiced" fill={C.invoiced} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="collected" name="Collected" fill={C.collected} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <ChartCard title="Revenue by plan" empty={!d.byPlan.length}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.byPlan} layout="vertical" barGap={2} margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke={C.grid} />
                <XAxis type="number" tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => moneyCompact(v)} />
                <YAxis type="category" dataKey="planName" tick={tick} tickLine={false} axisLine={false} width={110} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: C.axis }} />
                <Bar dataKey="invoiced" name="Invoiced" fill={C.invoiced} radius={[0, 4, 4, 0]} maxBarSize={16} />
                <Bar dataKey="collected" name="Collected" fill={C.collected} radius={[0, 4, 4, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Payments by method" empty={!d.byMethod.length}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.byMethod.map((m) => ({ ...m, label: methodLabel(m.method) }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke={C.grid} />
                <XAxis type="number" tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => moneyCompact(v)} />
                <YAxis type="category" dataKey="label" tick={tick} tickLine={false} axisLine={false} width={110} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={tooltipStyle}
                  formatter={(v, _n, item) => [`${money(Number(v))} · ${(item.payload as { count: number }).count} payments`, 'Collected']} />
                <Bar dataKey="amount" name="Collected" fill={C.single} radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Outstanding by age (today)" empty={!d.aging.some((a) => a.amount)}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.aging.map((a) => ({ ...a, label: a.bucket === 'CURRENT' ? 'Not due' : `${a.bucket} days` }))} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: C.grid }} />
                <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => moneyCompact(v)} width={70} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={tooltipStyle}
                  formatter={(v, _n, item) => [`${money(Number(v))} · ${(item.payload as { count: number }).count} invoices`, 'Outstanding']} />
                <Bar dataKey="amount" name="Outstanding" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {d.aging.map((_, i) => <Cell key={i} fill={AGING_RAMP[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Customers owing most</h2>
            {d.topOutstanding.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400">Nobody owes anything</p>
            ) : (
              <table className="w-full">
                <thead><tr><th className="th px-2">Customer</th><th className="th px-2 text-right">Outstanding</th><th className="th px-2 text-right">Overdue</th></tr></thead>
                <tbody>
                  {d.topOutstanding.map((t) => (
                    <tr key={t.customer.id} className="border-t border-slate-100">
                      <td className="td px-2">{t.customer.name}</td>
                      <td className="td px-2 text-right tabular-nums">{money(t.outstanding)}</td>
                      <td className="td px-2 text-right tabular-nums">
                        {t.overdue > 0 ? <span className="text-rose-700">{money(t.overdue)}</span> : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
