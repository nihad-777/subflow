// Subscriptions, invoices, tax rules and the customer portal.
// Uses the finance pages' API client and UI kit, so everything looks and behaves the same.
import { createContext, useContext, useEffect, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, qs, setTokenSource } from '../finance/lib/api';
import { date, money, today } from '../finance/lib/format';
import { useAsync, useDebounced } from '../finance/lib/useAsync';
import type { Paged } from '../finance/lib/types';
import { Badge, Drawer, Empty, ErrorBanner, Field, Modal, PageHeader, Pagination, TableSkeleton, Toast, type Tone } from '../finance/components/ui';
import { RecordPaymentModal } from '../finance/components/RecordPaymentModal';
import MyPaymentsPage from '../finance/pages/MyPaymentsPage';
import '../finance/finance.css';

const AdminContext = createContext(false);
let currentToken: () => string | undefined = () => undefined;

/** Gives the pages inside it the signed-in user's token and the shared styles. */
export function ApiScope({ session, isAdmin = false, plain, children }: { session: Session | null; isAdmin?: boolean; plain?: boolean; children: ReactNode }) {
  currentToken = () => session?.access_token;
  setTokenSource(currentToken);
  if (!session) return null;
  return <AdminContext.Provider value={isAdmin}>{plain ? children : <div className="sf-finance">{children}</div>}</AdminContext.Provider>;
}

interface Subscription {
  id: string; number: string; status: string; customerId: string; customerName: string; customerEmail: string; planName: string; frequency: string;
  startDate: string; endDate: string | null; nextBillingDate: string | null; paymentTermsDays: number; quoteExpiresOn: string | null;
  allowPause: boolean; allowEarlyClose: boolean; allowRenew: boolean;
}
interface SubscriptionDetail extends Subscription {
  planId: string;
  lines: { id: string; productId: string; variantId: string | null; taxRuleId: string | null; description: string; quantity: number; unitPrice: number; taxName: string | null; taxRate: number }[];
  events: { from: string | null; to: string; note: string | null; at: string; actor: string | null }[];
  nextStatuses: string[];
}
interface Invoice {
  id: string; number: string; status: string; customerName: string; customerEmail: string; subscriptionNumber: string | null; invoiceDate: string; dueDate: string;
  periodStart: string; periodEnd: string; subtotal: number; taxAmount: number; discountAmount: number; total: number; amountPaid: number; sentAt: string | null;
}
interface InvoiceDetail extends Invoice {
  outstanding: number;
  lines: { description: string; quantity: number; unitPrice: number; taxRate: number; taxAmount: number; lineTotal: number }[];
  emailed?: boolean;
}

const SUB_TONE: Record<string, Tone> = { draft: 'gray', quotation: 'blue', confirmed: 'indigo', active: 'green', paused: 'amber', closed: 'gray' };
const INV_TONE: Record<string, Tone> = { draft: 'gray', confirmed: 'blue', paid: 'green', cancelled: 'red' };
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const StatusBadge = ({ status, tones }: { status: string; tones: Record<string, Tone> }) => <Badge tone={tones[status]}>{label(status)}</Badge>;
const STATUS_ACTION: Record<string, string> = { draft: 'Back to draft', quotation: 'Send as quotation', confirmed: 'Confirm', active: 'Activate', paused: 'Pause', closed: 'Close' };

async function downloadPdf(invoice: { id: string; number: string }, session: () => string | undefined) {
  const base = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000').replace(/\/$/, '');
  const res = await fetch(`${base}/api/finance/invoices/${invoice.id}/pdf`, { headers: { Authorization: `Bearer ${session()}` } });
  if (!res.ok) throw new Error('Could not download the PDF');
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `${invoice.number.replaceAll('/', '-')}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

function InvoiceLines({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <>
      <div className="card mb-4 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Price</th><th className="th text-right">Tax</th><th className="th text-right">Amount</th></tr></thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="td">{l.description}</td><td className="td text-right">{l.quantity}</td><td className="td text-right">{money(l.unitPrice)}</td>
                <td className="td text-right">{l.taxRate}%</td><td className="td text-right">{money(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mb-4 space-y-1 text-sm text-slate-600">
        {([['Subtotal', invoice.subtotal], ['Discount', -invoice.discountAmount], ['Tax', invoice.taxAmount], ['Total', invoice.total], ['Paid', invoice.amountPaid], ['Outstanding', invoice.outstanding]] as const).map(([name, value]) => (
          <div key={name} className={`flex justify-between ${name === 'Total' || name === 'Outstanding' ? 'font-semibold text-slate-900' : ''}`}><dt>{name}</dt><dd className="tabular-nums">{money(value)}</dd></div>
        ))}
      </dl>
    </>
  );
}

// --- subscriptions ------------------------------------------------------------

function NewSubscription({ open, editing, onClose, onCreated }: { open: boolean; editing?: SubscriptionDetail | null; onClose: () => void; onCreated: (id: string) => void }) {
  const lookups = useAsync(async () => {
    if (!open) return null;
    const [customers, plans, products, templates, taxes] = await Promise.all([
      api.get<{ id: string; name: string; email: string }[]>('/lookups/customers'),
      api.get<{ id: string; name: string }[]>('/catalog/plans'),
      api.get<{ id: string; name: string; price: number; variants: { id: string; name: string; priceAdjustment: number }[] }[]>('/catalog/products'),
      api.get<{ id: string; name: string; planId: string | null }[]>('/catalog/templates'),
      api.get<{ id: string; name: string; isActive: boolean }[]>('/catalog/taxes'),
    ]);
    return { customers, plans, products, templates, taxes };
  }, [open]);
  const blank = { customerId: '', templateId: '', planId: '', startDate: today(), endDate: '', paymentTermsDays: 15 };
  const [form, setForm] = useState(blank);
  const [lines, setLines] = useState([{ productId: '', variantId: '', quantity: 1, taxRuleId: '' }]);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!open || !editing) return;
    setForm({ customerId: editing.customerId, templateId: '', planId: editing.planId, startDate: editing.startDate, endDate: editing.endDate ?? '', paymentTermsDays: editing.paymentTermsDays });
    setLines(editing.lines.map((l) => ({ productId: l.productId, variantId: l.variantId ?? '', quantity: l.quantity, taxRuleId: l.taxRuleId ?? '' })));
  }, [open, editing]);
  const set = (key: keyof typeof blank, value: string | number) => setForm({ ...form, [key]: value });
  const setLine = (i: number, key: string, value: string | number) => setLines(lines.map((l, n) => (n === i ? { ...l, [key]: value, ...(key === 'productId' ? { variantId: '' } : {}) } : l)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const body = { ...form, lines: form.templateId ? [] : lines };
      const sub = editing ? await api.patch<{ id: string }>(`/subscriptions/${editing.id}`, body) : await api.post<{ id: string }>('/subscriptions', body);
      setForm(blank);
      onCreated(sub.id);
    } catch (err) {
      setError(err as Error);
    }
  };

  const data = lookups.data;
  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.number}` : 'New subscription'} wide>
      <ErrorBanner error={lookups.error ?? error} />
      {data && (
        <form className="space-y-3" onSubmit={submit}>
          {!editing && (
            <>
              <Field label="Customer">
                <select className="input" required value={form.customerId} onChange={(e) => set('customerId', e.target.value)}>
                  <option value="">Choose a customer</option>
                  {data.customers.map((c) => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}
                </select>
              </Field>
              <Field label="Quotation template" hint="Fills in the plan and products, and starts as a quotation.">
                <select className="input" value={form.templateId} onChange={(e) => set('templateId', e.target.value)}>
                  <option value="">No template, enter by hand</option>
                  {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            </>
          )}
          {!form.templateId && (
            <Field label="Recurring plan">
              <select className="input" required value={form.planId} onChange={(e) => set('planId', e.target.value)}>
                <option value="">Choose a plan</option>
                {data.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Start date"><input className="input" type="date" required value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
            <Field label="Expiry date"><input className="input" type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
            <Field label="Payment terms (days)"><input className="input" type="number" min="0" value={form.paymentTermsDays} onChange={(e) => set('paymentTermsDays', Number(e.target.value))} /></Field>
          </div>
          {!form.templateId && lines.map((line, i) => {
            const product = data.products.find((p) => p.id === line.productId);
            return (
              <div key={i} className="grid grid-cols-4 gap-2">
                <select className="input" aria-label="Product" required value={line.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}>
                  <option value="">Product</option>
                  {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="input" aria-label="Variant" value={line.variantId} onChange={(e) => setLine(i, 'variantId', e.target.value)}>
                  <option value="">Standard</option>
                  {product?.variants.map((v) => <option key={v.id} value={v.id}>{v.name} (+{v.priceAdjustment})</option>)}
                </select>
                <input className="input" aria-label="Quantity" type="number" min="1" value={line.quantity} onChange={(e) => setLine(i, 'quantity', Number(e.target.value))} />
                <select className="input" aria-label="Tax" value={line.taxRuleId} onChange={(e) => setLine(i, 'taxRuleId', e.target.value)}>
                  <option value="">No tax</option>
                  {data.taxes.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            );
          })}
          <div className="flex justify-between">
            {!form.templateId ? <button type="button" className="btn-ghost" onClick={() => setLines([...lines, { productId: '', variantId: '', quantity: 1, taxRuleId: '' }])}>+ Add line</button> : <span />}
            <button className="btn-primary">{editing ? 'Save changes' : 'Create'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function SubscriptionDrawer({ id, portal, onClose, onChanged }: { id: string | null; portal?: boolean; onClose: () => void; onChanged: () => void }) {
  const base = portal ? '/portal/subscriptions' : '/subscriptions';
  const detail = useAsync(() => (id ? api.get<SubscriptionDetail>(`${base}/${id}`) : Promise.resolve(null)), [id]);
  const [error, setError] = useState<Error | null>(null);
  const [editing, setEditing] = useState(false);
  const sub = detail.data;
  const act = async (path: string, body?: object) => {
    setError(null);
    try {
      await api.post(`${base}/${id}/${path}`, body);
      detail.reload();
      onChanged();
    } catch (err) {
      setError(err as Error);
    }
  };
  const portalActions = sub ? [
    sub.status === 'quotation' && ['accept', 'Accept quotation'],
    sub.status === 'active' && sub.allowPause && ['pause', 'Pause'],
    sub.status === 'paused' && sub.allowPause && ['resume', 'Resume'],
    (sub.status === 'active' || sub.status === 'paused') && sub.allowEarlyClose && ['close', 'Close'],
    (sub.status === 'closed' || sub.endDate) && sub.allowRenew && ['renew', 'Renew'],
  ].filter(Boolean) as [string, string][] : [];

  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={sub?.number ?? 'Subscription'}>
      <ErrorBanner error={detail.error ?? error} />
      {sub && (
        <>
          <div className="mb-4 flex items-center gap-2"><StatusBadge status={sub.status} tones={SUB_TONE} /><span className="text-sm text-slate-500">{sub.planName} · {sub.frequency}</span></div>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
            {!portal && <div><dt className="label">Customer</dt><dd>{sub.customerName || sub.customerEmail}</dd></div>}
            <div><dt className="label">Start</dt><dd>{date(sub.startDate)}</dd></div>
            <div><dt className="label">Expiry</dt><dd>{date(sub.endDate)}</dd></div>
            <div><dt className="label">Next billing</dt><dd>{date(sub.nextBillingDate)}</dd></div>
            <div><dt className="label">Payment terms</dt><dd>{sub.paymentTermsDays} days</dd></div>
            {sub.quoteExpiresOn && <div><dt className="label">Quote valid until</dt><dd>{date(sub.quoteExpiresOn)}</dd></div>}
          </dl>
          <div className="card mb-4 overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Price</th><th className="th">Tax</th></tr></thead>
              <tbody>{sub.lines.map((l) => <tr key={l.id} className="border-t border-slate-100"><td className="td">{l.description}</td><td className="td text-right">{l.quantity}</td><td className="td text-right">{money(l.unitPrice)}</td><td className="td">{l.taxName ?? 'None'}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="mb-5 flex flex-wrap gap-2">
            {portal
              ? portalActions.map(([path, name]) => <button key={path} className="btn-secondary" onClick={() => void act(path)}>{name}</button>)
              : <>
                  {(sub.status === 'draft' || sub.status === 'quotation') && <button className="btn-secondary" onClick={() => setEditing(true)}>Edit</button>}
                  {sub.nextStatuses.map((s) => <button key={s} className={s === 'closed' ? 'btn-secondary' : 'btn-primary'} onClick={() => void act('status', { status: s })}>{STATUS_ACTION[s]}</button>)}
                  {sub.allowRenew && (sub.status === 'closed' || sub.endDate) && <button className="btn-secondary" onClick={() => void act('renew')}>Renew</button>}
                </>}
          </div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">History</h3>
          <ul className="space-y-1 text-sm text-slate-600">
            {sub.events.map((e, i) => <li key={i}>{new Date(e.at).toLocaleString()}: {label(e.to)}{e.actor ? ` by ${e.actor}` : ''}{e.note ? ` (${e.note})` : ''}</li>)}
          </ul>
          {!portal && <NewSubscription open={editing} editing={sub} onClose={() => setEditing(false)} onCreated={() => { setEditing(false); detail.reload(); onChanged(); }} />}
        </>
      )}
    </Drawer>
  );
}

export function SubscriptionsPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setPage(1), [status, q]);
  const list = useAsync(() => api.get<Paged<Subscription>>(`/subscriptions${qs({ status, q, page })}`), [status, q, page]);

  return (
    <div>
      <PageHeader title="Subscriptions" subtitle="Every customer's recurring plan, from draft to closed." actions={<button className="btn-primary" onClick={() => setCreating(true)}>New subscription</button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search number or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(SUB_TONE).map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>
      <ErrorBanner error={list.error} onRetry={list.reload} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Number</th><th className="th">Customer</th><th className="th">Plan</th><th className="th">Next billing</th><th className="th">Status</th></tr></thead>
          {list.loading && !list.data ? <TableSkeleton cols={5} /> : (
            <tbody>
              {list.data?.items.map((s) => (
                <tr key={s.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpenId(s.id)}>
                  <td className="td font-medium">{s.number}</td><td className="td">{s.customerName || s.customerEmail}</td><td className="td">{s.planName}</td>
                  <td className="td">{date(s.nextBillingDate)}</td><td className="td"><StatusBadge status={s.status} tones={SUB_TONE} /></td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {list.data?.items.length === 0 && <Empty title="No subscriptions found" hint="Create one, or change the filters." />}
        {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </div>
      <NewSubscription open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); list.reload(); }} />
      <SubscriptionDrawer id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />
    </div>
  );
}

// --- invoices -----------------------------------------------------------------

function InvoiceDrawer({ id, portal, onClose, onChanged }: { id: string | null; portal?: boolean; onClose: () => void; onChanged: () => void }) {
  const base = portal ? '/portal/invoices' : '/invoices';
  const detail = useAsync(() => (id ? api.get<InvoiceDetail>(`${base}/${id}`) : Promise.resolve(null)), [id]);
  const [error, setError] = useState<Error | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const invoice = detail.data;
  const act = async (action: string) => {
    setError(null);
    try {
      const updated = await api.post<InvoiceDetail>(`/invoices/${id}/${action}`);
      if (action === 'send') setToast(updated.emailed ? 'Invoice emailed.' : 'Email is not set up, so nothing was sent. Add SMTP_URL to turn it on.');
      detail.reload();
      onChanged();
    } catch (err) {
      setError(err as Error);
    }
  };
  const pdf = () => downloadPdf(invoice!, currentToken).catch(setError);

  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={invoice?.number ?? 'Invoice'}>
      <ErrorBanner error={detail.error ?? error} />
      {invoice && (
        <>
          <div className="mb-4 flex items-center gap-2"><StatusBadge status={invoice.status} tones={INV_TONE} /><span className="text-sm text-slate-500">Due {date(invoice.dueDate)}</span></div>
          <p className="mb-4 text-sm text-slate-600">{invoice.customerName || invoice.customerEmail}. Period {date(invoice.periodStart)} to {date(invoice.periodEnd)}.</p>
          <InvoiceLines invoice={invoice} />
          <div className="flex flex-wrap gap-2">
            {!portal && invoice.status === 'draft' && <button className="btn-primary" onClick={() => void act('confirm')}>Confirm</button>}
            {!portal && invoice.status === 'confirmed' && <button className="btn-primary" onClick={() => setPaying(true)}>Record payment</button>}
            {!portal && (invoice.status === 'confirmed' || invoice.status === 'paid') && <button className="btn-secondary" onClick={() => void act('send')}>Send by email</button>}
            {!portal && (invoice.status === 'draft' || invoice.status === 'confirmed') && <button className="btn-danger" onClick={() => void act('cancel')}>Cancel invoice</button>}
            <button className="btn-secondary" onClick={() => void pdf()}>Download PDF</button>
          </div>
        </>
      )}
      {!portal && <RecordPaymentModal open={paying} invoiceId={id ?? undefined} onClose={() => setPaying(false)} onRecorded={() => { setPaying(false); detail.reload(); onChanged(); }} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </Drawer>
  );
}

function BillingRun({ onDone }: { onDone: () => void }) {
  const [day, setDay] = useState(today());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ invoicesCreated: number; duplicatesSkipped: number; closed: number; failed: number } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post('/billing/run', { date: day }));
      onDone();
    } catch (err) {
      setError(err as Error);
    }
    setBusy(false);
  };
  return (
    <div className="card mb-4 p-4">
      <ErrorBanner error={error} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Bill everything due up to"><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <button className="btn-primary" disabled={busy} onClick={() => void run()}>{busy ? 'Running…' : 'Run billing'}</button>
        {result && <p className="text-sm text-slate-600">{result.invoicesCreated} invoices created, {result.duplicatesSkipped} duplicates skipped, {result.closed} subscriptions closed{result.failed ? `, ${result.failed} failed` : ''}.</p>}
      </div>
    </div>
  );
}

export function InvoicesPage() {
  const isAdmin = useContext(AdminContext);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setPage(1), [status, q]);
  const list = useAsync(() => api.get<Paged<Invoice>>(`/invoices${qs({ status, q, page })}`), [status, q, page]);

  return (
    <div>
      <PageHeader title="Invoices" subtitle="Created automatically from due subscriptions. A date is never billed twice." />
      {isAdmin && <BillingRun onDone={list.reload} />}
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search number or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(INV_TONE).map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>
      <ErrorBanner error={list.error} onRetry={list.reload} />
      <InvoiceTable loading={list.loading} data={list.data} onOpen={setOpenId} onPage={setPage} showCustomer />
      <InvoiceDrawer id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />
    </div>
  );
}

function InvoiceTable({ loading, data, onOpen, onPage, showCustomer }: { loading: boolean; data: Paged<Invoice> | null; onOpen: (id: string) => void; onPage: (p: number) => void; showCustomer?: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50"><tr><th className="th">Number</th>{showCustomer && <th className="th">Customer</th>}<th className="th">Date</th><th className="th">Due</th><th className="th text-right">Total</th><th className="th text-right">Paid</th><th className="th">Status</th></tr></thead>
        {loading && !data ? <TableSkeleton cols={showCustomer ? 7 : 6} /> : (
          <tbody>
            {data?.items.map((i) => (
              <tr key={i.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => onOpen(i.id)}>
                <td className="td font-medium">{i.number}</td>{showCustomer && <td className="td">{i.customerName || i.customerEmail}</td>}
                <td className="td">{date(i.invoiceDate)}</td><td className="td">{date(i.dueDate)}</td>
                <td className="td text-right tabular-nums">{money(i.total)}</td><td className="td text-right tabular-nums">{money(i.amountPaid)}</td>
                <td className="td"><StatusBadge status={i.status} tones={INV_TONE} /></td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
      {data?.items.length === 0 && <Empty title="No invoices yet" />}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={onPage} />}
    </div>
  );
}

// --- tax rules ----------------------------------------------------------------

export function TaxRulesPage() {
  const list = useAsync(() => api.get<{ id: string; name: string; taxRate: number; description: string; isActive: boolean }[]>('/catalog/taxes'), []);
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const guard = (fn: () => Promise<unknown>) => { setError(null); fn().then(list.reload).catch(setError); };
  const add = (e: FormEvent) => {
    e.preventDefault();
    guard(async () => { await api.post('/catalog/taxes', { name, taxRate: rate }); setName(''); setRate(''); });
  };
  return (
    <div>
      <PageHeader title="Tax rules" subtitle="Choose one of these on each subscription line. Invoices work out the tax from it." />
      <ErrorBanner error={list.error ?? error} onRetry={list.reload} />
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-4" onSubmit={add}>
        <Field label="Name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="GST 18%" /></Field>
        <Field label="Rate (%)"><input className="input" type="number" required min="0" max="100" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <button className="btn-primary">Add tax rule</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Name</th><th className="th text-right">Rate</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody>
            {list.data?.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="td">{t.name}</td><td className="td text-right">{t.taxRate}%</td>
                <td className="td"><Badge tone={t.isActive ? 'green' : 'gray'}>{t.isActive ? 'Active' : 'Off'}</Badge></td>
                <td className="td text-right">
                  <button className="btn-ghost" onClick={() => guard(() => api.patch(`/catalog/taxes/${t.id}`, { ...t, isActive: !t.isActive }))}>{t.isActive ? 'Turn off' : 'Turn on'}</button>
                  <button className="btn-ghost" onClick={() => guard(() => api.delete(`/catalog/taxes/${t.id}`))}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && <Empty title="No tax rules yet" />}
      </div>
    </div>
  );
}

// --- dashboard cards ----------------------------------------------------------

interface Overview { activeSubscriptions: number; quotations: number; draftInvoices: number; openInvoices: number; overdueInvoices: number; outstanding: number }

/** Live numbers for the role dashboards. Card is the app's own stat card. */
export function OverviewCards({ role, Card }: { role: string; Card: ComponentType<{ label: string; value: string; detail: string; icon: string }> }) {
  const overview = useAsync(() => api.get<Overview>('/overview'), []);
  const o = overview.data;
  if (overview.error) return <p className="form-error">{overview.error.message}</p>;
  if (!o) return <div className="loading-screen"><span className="spinner" /> Loading your numbers</div>;
  return role === 'customer'
    ? <>
        <Card label="Active subscriptions" value={String(o.activeSubscriptions)} detail={`${o.quotations} quotations to review`} icon="check" />
        <Card label="Unpaid invoices" value={String(o.openInvoices)} detail={`${o.overdueInvoices} overdue`} icon="shield" />
        <Card label="Amount you owe" value={money(o.outstanding)} detail="Across confirmed invoices" icon="user" />
      </>
    : <>
        <Card label="Active subscriptions" value={String(o.activeSubscriptions)} detail={`${o.quotations} quotations open`} icon="check" />
        <Card label="Invoices to confirm" value={String(o.draftInvoices)} detail={`${o.overdueInvoices} overdue`} icon="shield" />
        <Card label="Still owed" value={money(o.outstanding)} detail={`${o.openInvoices} unpaid invoices`} icon="user" />
      </>;
}

// --- customer portal ----------------------------------------------------------

export function PortalPage() {
  const subs = useAsync(() => api.get<Paged<Subscription>>('/portal/subscriptions'), []);
  const [page, setPage] = useState(1);
  const invoices = useAsync(() => api.get<Paged<Invoice>>(`/portal/invoices${qs({ page })}`), [page]);
  const [subId, setSubId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title="My subscriptions" subtitle="See your plans and invoices, and make changes yourself." />
      <ErrorBanner error={subs.error ?? invoices.error} />
      <div className="card mb-8 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Number</th><th className="th">Plan</th><th className="th">Next billing</th><th className="th">Status</th></tr></thead>
          <tbody>
            {subs.data?.items.map((s) => (
              <tr key={s.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setSubId(s.id)}>
                <td className="td font-medium">{s.number}</td><td className="td">{s.planName}</td><td className="td">{date(s.nextBillingDate)}</td>
                <td className="td"><StatusBadge status={s.status} tones={SUB_TONE} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {subs.data?.items.length === 0 && <Empty title="You have no subscriptions yet" />}
      </div>
      <h2 className="mb-3 text-lg font-semibold text-slate-900">My invoices</h2>
      <div className="mb-8"><InvoiceTable loading={invoices.loading} data={invoices.data} onOpen={setInvoiceId} onPage={setPage} /></div>
      <MyPaymentsPage />
      <SubscriptionDrawer id={subId} portal onClose={() => setSubId(null)} onChanged={subs.reload} />
      <InvoiceDrawer id={invoiceId} portal onClose={() => setInvoiceId(null)} onChanged={invoices.reload} />
    </div>
  );
}
