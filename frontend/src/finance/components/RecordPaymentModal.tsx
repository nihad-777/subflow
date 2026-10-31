// Reusable "Record payment" modal. The invoice teammate can open it from the
// invoice detail page:  <RecordPaymentModal open invoiceId={invoice.id} ... />
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { money, date, today, methodLabel } from '../lib/format';
import { useDebounced } from '../lib/useAsync';
import type { Balance, PayableInvoice, Payment } from '../lib/types';
import { Badge, Field, Modal, Spinner } from './ui';

const METHODS = ['BANK_TRANSFER', 'CASH', 'CARD', 'UPI', 'CHEQUE', 'OTHER'];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Preselect an invoice (e.g. from the invoice page or overdue list). */
  invoiceId?: string;
  onRecorded?: (result: { payment: Payment; invoice: Balance; replayed: boolean }) => void;
}

export function RecordPaymentModal({ open, onClose, invoiceId, onRecorded }: Props) {
  const [selected, setSelected] = useState<Balance | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [options, setOptions] = useState<PayableInvoice[]>([]);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [paymentDate, setPaymentDate] = useState(today());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // One key per form opening: retries and double clicks reuse it, so the server records the payment once.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const pickInvoice = async (id: string) => {
    setError(null);
    try {
      const b = await api.get<Balance>(`/invoices/${id}/balance`);
      setSelected(b);
      setAmount(b.outstanding.toFixed(2));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (!open) return;
    setIdempotencyKey(crypto.randomUUID());
    setSelected(null);
    setSearch('');
    setAmount('');
    setMethod('BANK_TRANSFER');
    setPaymentDate(today());
    setReference('');
    setNote('');
    setError(null);
    setFieldErrors({});
    if (invoiceId) pickInvoice(invoiceId);
  }, [open, invoiceId]);

  useEffect(() => {
    if (!open || selected) return;
    api.get<PayableInvoice[]>(`/invoices/payable?q=${encodeURIComponent(debounced)}`).then(setOptions).catch(() => setOptions([]));
  }, [open, debounced, selected]);

  const clientErrors = useMemo(() => {
    const e: Record<string, string> = {};
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0) e.amount = 'Enter an amount greater than 0';
    else if (!/^\d+(\.\d{1,2})?$/.test(amount)) e.amount = 'Use at most 2 decimal places';
    else if (selected && n > selected.outstanding + 1e-9) e.amount = `Cannot exceed the outstanding ${money(selected.outstanding)}`;
    if (paymentDate > today()) e.paymentDate = 'Payment date cannot be in the future';
    return e;
  }, [amount, paymentDate, selected]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!selected || Object.keys(clientErrors).length || posting) return;
    setPosting(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await api.post<{ payment: Payment; invoice: Balance; replayed: boolean }>('/payments', {
        invoiceId: selected.invoiceId, amount, method, paymentDate, reference: reference || null, note: note || null, idempotencyKey,
      });
      onRecorded?.(result);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        const fe = e.details?.fieldErrors;
        if (fe) setFieldErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)])));
        if (e.code === 'OVERPAYMENT' || e.code === 'INVOICE_NOT_PAYABLE') pickInvoice(selected.invoiceId); // refresh the numbers
      } else setError('Network error. Your payment was not lost: press Record again to retry safely.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record payment">
      <form onSubmit={submit} className="space-y-4">
        {!selected ? (
          <div>
            <Field label="Invoice">
              <input className="input" autoFocus placeholder="Search by invoice number or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {options.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No confirmed invoices with a balance match.</li>}
              {options.map((o) => (
                <li key={o.id}>
                  <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50" onClick={() => pickInvoice(o.id)}>
                    <span>
                      <span className="font-medium text-slate-800">{o.number}</span>
                      <span className="ml-2 text-sm text-slate-500">{o.customer.name}</span>
                      {o.isOverdue && <span className="ml-2"><Badge tone="red">Overdue</Badge></span>}
                    </span>
                    <span className="text-sm font-medium text-slate-700">{money(o.outstanding)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-lg bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-800">{selected.number}</p>
                <p className="text-xs text-slate-500">Due {date(selected.dueDate)}</p>
              </div>
              <div className="flex items-center gap-2">
                {selected.isOverdue && <Badge tone="red">{selected.daysOverdue} days overdue</Badge>}
                {selected.isPartiallyPaid && <Badge tone="amber">Partially paid</Badge>}
                {!invoiceId && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(null)}>Change</button>}
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-xs text-slate-500">Total</dt><dd className="font-medium">{money(selected.total)}</dd></div>
              <div><dt className="text-xs text-slate-500">Paid</dt><dd className="font-medium">{money(selected.amountPaid)}</dd></div>
              <div><dt className="text-xs text-slate-500">Outstanding</dt><dd className="font-semibold text-indigo-700">{money(selected.outstanding)}</dd></div>
            </dl>
          </div>
        )}

        {selected && selected.status !== 'CONFIRMED' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">This invoice is {selected.status.toLowerCase()} and cannot take payments.</p>
        )}

        {selected && selected.status === 'CONFIRMED' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount" error={fieldErrors.amount ?? (amount ? clientErrors.amount : undefined)}>
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
              </Field>
              <Field label="Method">
                <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
                </select>
              </Field>
              <Field label="Payment date" error={fieldErrors.paymentDate ?? clientErrors.paymentDate}>
                <input className="input" type="date" max={today()} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </Field>
              <Field label="Reference" hint="Bank ref, UPI txn id, cheque no.">
                <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
            <Field label="Note">
              <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {selected && Number(amount) > 0 && Number(amount) < selected.outstanding && !clientErrors.amount && (
              <p className="text-xs text-slate-500">Partial payment: {money(selected.outstanding - Number(amount))} will remain outstanding.</p>
            )}
          </>
        )}

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!selected || selected.status !== 'CONFIRMED' || posting || Object.keys(clientErrors).length > 0}>
            {posting && <Spinner />} Record payment
          </button>
        </div>
      </form>
    </Modal>
  );
}
