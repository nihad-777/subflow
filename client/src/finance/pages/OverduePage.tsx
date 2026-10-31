import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { date, money } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import type { Paged } from '../lib/types';
import { Badge, Empty, ErrorBanner, PageHeader, Pagination, TableSkeleton, Toast, type Tone } from '../components/ui';
import { RecordPaymentModal } from '../components/RecordPaymentModal';

interface OverdueRow {
  invoiceId: string; number: string; customer: { id: string; name: string; email: string };
  dueDate: string; daysOverdue: number; bucket: string; total: number; amountPaid: number; outstanding: number;
}
type OverdueResponse = Paged<OverdueRow> & { buckets: { bucket: string; count: number; amount: number }[] };

const BUCKET_TONE: Record<string, Tone> = { '1-30': 'amber', '31-60': 'orange', '61-90': 'red', '90+': 'red' };

export default function OverduePage() {
  const [bucket, setBucket] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [page, setPage] = useState(1);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => setPage(1), [bucket, minAmount]);
  const list = useAsync(() => api.get<OverdueResponse>(`/invoices/overdue${qs({ bucket, minAmount, page })}`), [bucket, minAmount, page]);
  const all = list.data?.buckets.reduce((a, b) => ({ count: a.count + b.count, amount: a.amount + b.amount }), { count: 0, amount: 0 });

  const tab = (key: string, title: string, count?: number, amount?: number) => (
    <button key={key} onClick={() => setBucket(key)}
      className={`rounded-lg border px-4 py-2.5 text-left transition ${bucket === key ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <p className="text-sm font-semibold tabular-nums text-slate-800">{count ?? '—'} · {money(amount)}</p>
    </button>
  );

  return (
    <div>
      <PageHeader title="Overdue invoices" subtitle="Confirmed invoices past their due date with money still owed. Worked out live, so it is never stale." />
      <div className="mb-4 flex flex-wrap gap-2">
        {tab('', 'All overdue', all?.count, all?.amount)}
        {list.data?.buckets.map((b) => tab(b.bucket, `${b.bucket} days`, b.count, b.amount))}
        <input className="input ml-auto w-44 self-center" inputMode="decimal" placeholder="Min outstanding ₹" value={minAmount} onChange={(e) => setMinAmount(e.target.value.replace(/[^\d.]/g, ''))} />
      </div>
      <ErrorBanner error={list.error} onRetry={list.reload} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr><th className="th">Invoice</th><th className="th">Customer</th><th className="th">Due</th><th className="th">Overdue</th>
              <th className="th text-right">Total</th><th className="th text-right">Paid</th><th className="th text-right">Outstanding</th><th className="th" /></tr>
          </thead>
          {list.loading && !list.data ? <TableSkeleton cols={8} /> : (
            <tbody>
              {list.data?.items.map((r) => (
                <tr key={r.invoiceId} className="border-t border-slate-100">
                  <td className="td font-medium">{r.number}</td>
                  <td className="td">{r.customer.name}<p className="text-xs text-slate-400">{r.customer.email}</p></td>
                  <td className="td whitespace-nowrap">{date(r.dueDate)}</td>
                  <td className="td"><Badge tone={BUCKET_TONE[r.bucket]}>{r.daysOverdue} days</Badge></td>
                  <td className="td text-right tabular-nums">{money(r.total)}</td>
                  <td className="td text-right tabular-nums">{r.amountPaid > 0 ? money(r.amountPaid) : '—'}</td>
                  <td className="td text-right font-semibold tabular-nums">{money(r.outstanding)}</td>
                  <td className="td whitespace-nowrap text-right">
                    <button className="btn-secondary px-2 py-1" onClick={() => setPayFor(r.invoiceId)}>Record payment</button>
                    <a className="btn-ghost px-2 py-1" href={`mailto:${r.customer.email}?subject=${encodeURIComponent(`Payment reminder: ${r.number}`)}&body=${encodeURIComponent(`Hi ${r.customer.name},\n\nInvoice ${r.number} was due on ${date(r.dueDate)} and ${money(r.outstanding)} is still outstanding. Please arrange payment at your earliest convenience.\n\nThank you`)}`}>Remind</a>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {list.data && list.data.items.length === 0 && <Empty title="No overdue invoices here" hint="Nice." />}
        {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </div>
      <RecordPaymentModal open={payFor !== null} invoiceId={payFor ?? undefined} onClose={() => setPayFor(null)}
        onRecorded={(r) => { setToast(`${money(r.payment.amount)} recorded on ${r.invoice.number}`); list.reload(); }} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
