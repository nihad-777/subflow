import { useEffect, useState, type FormEvent } from 'react';
import { api, qs } from '../lib/api';
import { date, money, methodLabel } from '../lib/format';
import { useAsync, useDebounced } from '../lib/useAsync';
import { useIsAdmin } from '../lib/session';
import type { Paged, Payment } from '../lib/types';
import { Badge, Empty, ErrorBanner, Field, Modal, PageHeader, Pagination, Spinner, TableSkeleton, Toast } from '../components/ui';
import { RecordPaymentModal } from '../components/RecordPaymentModal';

const METHODS = ['BANK_TRANSFER', 'CASH', 'CARD', 'UPI', 'CHEQUE', 'OTHER'];

export default function PaymentHistoryPage() {
  const isAdmin = useIsAdmin();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => setPage(1), [from, to, method, status, q]);
  const filters = { from, to, method, status, q };
  const list = useAsync(
    () => api.get<Paged<Payment> & { postedAmount: number }>(`/payments${qs({ ...filters, page })}`),
    [from, to, method, status, q, page],
  );

  const exportCsv = async () => {
    // Pulls up to 2,000 rows matching the current filters.
    const rows: Payment[] = [];
    for (let p = 1; p <= 20; p++) {
      const r = await api.get<Paged<Payment>>(`/payments${qs({ ...filters, page: p, pageSize: 100 })}`);
      rows.push(...r.items);
      if (r.items.length < 100) break;
    }
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['Date', 'Invoice', 'Customer', 'Method', 'Amount', 'Reference', 'Recorded by', 'Status'].join(','),
      ...rows.map((p) => [p.paymentDate, p.invoiceNumber, p.customer.name, methodLabel(p.method), p.amount.toFixed(2), p.reference, p.recordedBy?.name, p.status].map(esc).join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div>
      <PageHeader
        title="Payment history"
        subtitle="Every payment recorded against an invoice. Voided payments stay visible for the audit trail."
        actions={
          <>
            <button className="btn-secondary" onClick={exportCsv}>Export CSV</button>
            <button className="btn-primary" onClick={() => setRecording(true)}>Record payment</button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <input className="input max-w-xs" placeholder="Invoice, customer or reference" value={search} onChange={(e) => setSearch(e.target.value)} />
        <input className="input w-40" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input className="input w-40" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className="input w-40" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
          <option value="">All methods</option>
          {METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
        </select>
        <select className="input w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="POSTED">Posted</option>
          <option value="VOIDED">Voided</option>
        </select>
      </div>

      <ErrorBanner error={list.error} onRetry={list.reload} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Date</th><th className="th">Invoice</th><th className="th">Customer</th><th className="th">Method</th>
              <th className="th text-right">Amount</th><th className="th">Recorded by</th><th className="th">Status</th><th className="th" />
            </tr>
          </thead>
          {list.loading && !list.data ? <TableSkeleton cols={8} /> : (
            <tbody>
              {list.data?.items.map((p) => (
                <tr key={p.id} className={`border-t border-slate-100 ${p.status === 'VOIDED' ? 'text-slate-400' : ''}`}>
                  <td className="td whitespace-nowrap">{date(p.paymentDate)}</td>
                  <td className="td font-medium">{p.invoiceNumber}</td>
                  <td className="td">{p.customer.name}</td>
                  <td className="td">{methodLabel(p.method)}{p.reference && <p className="text-xs text-slate-400">{p.reference}</p>}</td>
                  <td className={`td text-right tabular-nums ${p.status === 'VOIDED' ? 'line-through' : ''}`}>{money(p.amount)}</td>
                  <td className="td">{p.recordedBy?.name ?? '—'}</td>
                  <td className="td">
                    {p.status === 'POSTED' ? <Badge tone="green">Posted</Badge> : <span title={p.voidReason ?? ''}><Badge tone="gray">Voided</Badge></span>}
                  </td>
                  <td className="td text-right">
                    {isAdmin && p.status === 'POSTED' && <button className="btn-ghost px-2 py-1 text-rose-700" onClick={() => setVoiding(p)}>Void</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
          {list.data && list.data.items.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="td font-semibold" colSpan={4}>Total posted ({list.data.total.toLocaleString()} payments match)</td>
                <td className="td text-right font-semibold tabular-nums">{money(list.data.postedAmount)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
        {list.data && list.data.items.length === 0 && <Empty title="No payments match these filters" />}
        {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </div>

      <RecordPaymentModal open={recording} onClose={() => setRecording(false)}
        onRecorded={(r) => { setToast(`${money(r.payment.amount)} recorded on ${r.invoice.number}${r.invoice.status === 'paid' ? ' · invoice is now Paid' : ''}`); list.reload(); }} />
      <VoidModal payment={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); setToast('Payment voided'); list.reload(); }} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function VoidModal({ payment, onClose, onDone }: { payment: Payment | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setReason(''); setError(null); }, [payment]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!payment) return;
    setBusy(true);
    try {
      await api.post(`/payments/${payment.id}/void`, { reason });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!payment} onClose={onClose} title="Void payment">
      {payment && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-slate-600">
            Void {money(payment.amount)} on {payment.invoiceNumber}? The payment stays in history as voided, and if the invoice was Paid it goes back to Confirmed.
          </p>
          <Field label="Reason"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cheque bounced" /></Field>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-danger" disabled={busy || reason.trim().length < 3}>{busy && <Spinner />} Void payment</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
