// Collections queue: confirmed invoices with a balance, plus today's payments.
import { useState } from 'react';
import { api, qs } from '../lib/api';
import { date, money, methodLabel, today } from '../lib/format';
import { useAsync, useDebounced } from '../lib/useAsync';
import type { PayableInvoice, Paged, Payment } from '../lib/types';
import { Badge, Empty, ErrorBanner, PageHeader, TableSkeleton, Toast } from '../components/ui';
import { RecordPaymentModal } from '../components/RecordPaymentModal';

export default function PaymentManagementPage({ onOpenHistory }: { onOpenHistory: () => void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [invoiceId, setInvoiceId] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const payable = useAsync(() => api.get<PayableInvoice[]>(`/invoices/payable${qs({ q })}`), [q]);
  const todays = useAsync(() => api.get<Paged<Payment> & { postedAmount: number }>(`/payments${qs({ from: today(), to: today(), status: 'POSTED', pageSize: 10 })}`), []);

  const record = (id?: string) => { setInvoiceId(id); setOpen(true); };

  return (
    <div>
      <PageHeader title="Payments" subtitle="Record payments against confirmed invoices. Partial payments are fine; overpayments are refused."
        actions={<button className="btn-primary" onClick={() => record()}>Record payment</button>} />

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Awaiting payment</h2>
            <input className="input max-w-xs" placeholder="Invoice or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ErrorBanner error={payable.error} onRetry={payable.reload} />
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className="th">Invoice</th><th className="th">Customer</th><th className="th">Due</th><th className="th text-right">Paid</th><th className="th text-right">Outstanding</th><th className="th" /></tr></thead>
            {payable.loading && !payable.data ? <TableSkeleton cols={6} /> : (
              <tbody>
                {payable.data?.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="td font-medium">{i.number}</td>
                    <td className="td">{i.customer.name}</td>
                    <td className="td whitespace-nowrap">{date(i.dueDate)} {i.isOverdue && <Badge tone="red">Overdue</Badge>}</td>
                    <td className="td text-right tabular-nums">{i.amountPaid > 0 ? money(i.amountPaid) : '—'}</td>
                    <td className="td text-right font-medium tabular-nums">{money(i.outstanding)}</td>
                    <td className="td text-right"><button className="btn-secondary px-2 py-1" onClick={() => record(i.id)}>Record</button></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
          {payable.data?.length === 0 && <Empty title="Nothing awaiting payment" />}
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">Showing the 20 oldest due first. Search to find others.</p>
        </section>

        <section className="card">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Received today</h2>
            <span className="text-sm font-semibold tabular-nums">{money(todays.data?.postedAmount)}</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {todays.data?.items.map((p) => (
              <li key={p.id} className="flex justify-between px-4 py-2.5 text-sm">
                <span><span className="font-medium">{p.invoiceNumber}</span><span className="ml-2 text-slate-500">{methodLabel(p.method)}</span></span>
                <span className="tabular-nums">{money(p.amount)}</span>
              </li>
            ))}
            {todays.data?.items.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-400">No payments yet today</li>}
          </ul>
          <button onClick={onOpenHistory} className="block w-full border-0 border-t border-solid border-slate-100 bg-transparent px-4 py-2.5 text-left text-sm text-indigo-700 hover:bg-slate-50">Full payment history →</button>
        </section>
      </div>

      <RecordPaymentModal open={open} invoiceId={invoiceId} onClose={() => setOpen(false)}
        onRecorded={(r) => {
          setToast(r.replayed ? 'Already recorded (duplicate submit ignored)' : `${money(r.payment.amount)} recorded on ${r.invoice.number}${r.invoice.status === 'paid' ? ' · invoice is now Paid' : ` · ${money(r.invoice.outstanding)} still outstanding`}`);
          payable.reload(); todays.reload();
        }} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
