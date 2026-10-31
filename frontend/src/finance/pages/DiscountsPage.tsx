import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError, qs } from '../lib/api';
import { date, money, today } from '../lib/format';
import { useAsync, useDebounced } from '../lib/useAsync';
import { useIsAdmin } from '../lib/session';
import type { Discount, DiscountDetail, DiscountStatus, Paged } from '../lib/types';
import { Badge, Drawer, Empty, ErrorBanner, Field, Modal, PageHeader, Pagination, Spinner, TableSkeleton, Toast, type Tone } from '../components/ui';

const STATUS_TONE: Record<DiscountStatus, Tone> = { ACTIVE: 'green', SCHEDULED: 'blue', EXPIRED: 'gray', EXHAUSTED: 'amber', INACTIVE: 'gray' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const valueText = (d: Pick<Discount, 'type' | 'value'>) => (d.type === 'PERCENT' ? `${d.value}%` : money(d.value));

export default function DiscountsPage() {
  const isAdmin = useIsAdmin();
  const [status, setStatus] = useState('');
  const [scope, setScope] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Discount | 'new' | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => setPage(1), [status, scope, q]);
  const list = useAsync(() => api.get<Paged<Discount>>(`/discounts${qs({ status, scope, q, page })}`), [status, scope, q, page]);

  const toggle = async (d: Discount) => {
    try {
      await api.post(`/discounts/${d.id}/${d.isActive ? 'deactivate' : 'activate'}`);
      setToast(`${d.name} ${d.isActive ? 'deactivated' : 'activated'}`);
      list.reload();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Discounts"
        subtitle={isAdmin ? 'Create and manage discount rules. Billing applies the best eligible one automatically.' : 'Read-only: only admins can change discounts.'}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setPreviewOpen(true)}>Preview on a subscription</button>
            {isAdmin && <button className="btn-primary" onClick={() => setEditing('new')}>New discount</button>}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <select className="input w-40" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope">
          <option value="">All scopes</option>
          <option value="PRODUCT">Product</option>
          <option value="SUBSCRIPTION">Subscription</option>
        </select>
      </div>

      <ErrorBanner error={list.error} onRetry={list.reload} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Name</th><th className="th">Value</th><th className="th">Scope</th><th className="th">Valid</th>
              <th className="th">Usage</th><th className="th">Status</th><th className="th" />
            </tr>
          </thead>
          {list.loading && !list.data ? <TableSkeleton cols={7} /> : (
            <tbody>
              {list.data?.items.map((d) => (
                <tr key={d.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setViewing(d.id)}>
                  <td className="td">
                    <p className="font-medium text-slate-800">{d.name}</p>
                    {d.code && <p className="font-mono text-xs text-slate-500">{d.code}</p>}
                  </td>
                  <td className="td tabular-nums">{valueText(d)}</td>
                  <td className="td">{d.scope === 'PRODUCT' ? (d.appliesToAll ? 'All products' : `${d.targetIds.length} product(s)`) : d.appliesToAll ? 'All subscriptions' : `${d.targetIds.length} subscription(s)`}</td>
                  <td className="td whitespace-nowrap">{date(d.startDate)} → {d.endDate ? date(d.endDate) : 'no end'}</td>
                  <td className="td tabular-nums">{d.usedCount} / {d.usageLimit ?? '∞'}</td>
                  <td className="td"><Badge tone={STATUS_TONE[d.status]}>{label(d.status)}</Badge></td>
                  <td className="td text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {isAdmin && (
                      <>
                        <button className="btn-ghost px-2 py-1" onClick={() => setEditing(d)}>Edit</button>
                        <button className="btn-ghost px-2 py-1" onClick={() => toggle(d)}>{d.isActive ? 'Deactivate' : 'Activate'}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {list.data && list.data.items.length === 0 && <Empty title="No discounts match" hint={isAdmin ? 'Create one with “New discount”.' : undefined} />}
        {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </div>

      <DiscountForm
        open={editing !== null}
        discount={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(d) => { setEditing(null); setToast(`Saved ${d.name}`); list.reload(); }}
      />
      <DiscountDetailDrawer id={viewing} onClose={() => setViewing(null)} />
      <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit form (validation mirrors the server)
// ---------------------------------------------------------------------------

interface FormState {
  name: string; code: string; type: 'PERCENT' | 'FIXED'; value: string; scope: 'PRODUCT' | 'SUBSCRIPTION';
  minPurchase: string; minQuantity: string; startDate: string; endDate: string; usageLimit: string;
  appliesToAll: boolean; targetIds: string[];
}

const empty = (): FormState => ({
  name: '', code: '', type: 'PERCENT', value: '', scope: 'PRODUCT', minPurchase: '0', minQuantity: '0',
  startDate: today(), endDate: '', usageLimit: '', appliesToAll: false, targetIds: [],
});

function validate(f: FormState, usedCount: number) {
  const e: Record<string, string> = {};
  const v = Number(f.value);
  if (!f.name.trim()) e.name = 'Name is required';
  if (!f.value || !Number.isFinite(v)) e.value = 'Enter a value';
  else if (!/^\d+(\.\d{1,2})?$/.test(f.value)) e.value = 'Use at most 2 decimal places';
  else if (f.type === 'PERCENT' && (v <= 0 || v > 100)) e.value = 'Percentage must be between 0 and 100';
  else if (f.type === 'FIXED' && v <= 0) e.value = 'Amount must be greater than 0';
  if (f.minPurchase && !(Number(f.minPurchase) >= 0)) e.minPurchase = 'Cannot be negative';
  if (!/^\d+$/.test(f.minQuantity || '0')) e.minQuantity = 'Whole number, 0 or more';
  if (!f.startDate) e.startDate = 'Start date is required';
  if (f.endDate && f.endDate < f.startDate) e.endDate = 'End date must be on or after start date';
  if (f.usageLimit) {
    const n = Number(f.usageLimit);
    if (!Number.isInteger(n) || n < 1) e.usageLimit = 'At least 1, or leave empty for unlimited';
    else if (n < usedCount) e.usageLimit = `Already used ${usedCount} times`;
  }
  if (f.scope === 'PRODUCT' && !f.appliesToAll && f.targetIds.length === 0) e.targetIds = 'Pick at least one product, or choose “All products”';
  return e;
}

function DiscountForm({ open, discount, onClose, onSaved }: { open: boolean; discount: Discount | null; onClose: () => void; onSaved: (d: Discount) => void }) {
  const [f, setF] = useState<FormState>(empty);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<{ id: string; label: string }[]>([]);
  const [targetSearch, setTargetSearch] = useState('');
  const tq = useDebounced(targetSearch);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setServerErrors({});
    setError(null);
    setF(discount ? {
      name: discount.name, code: discount.code ?? '', type: discount.type, value: String(discount.value), scope: discount.scope,
      minPurchase: String(discount.minPurchase), minQuantity: String(discount.minQuantity), startDate: discount.startDate,
      endDate: discount.endDate ?? '', usageLimit: discount.usageLimit ? String(discount.usageLimit) : '',
      appliesToAll: discount.appliesToAll, targetIds: discount.targetIds,
    } : empty());
  }, [open, discount]);

  useEffect(() => {
    if (!open) return;
    const path = f.scope === 'PRODUCT' ? '/lookups/products' : '/lookups/subscriptions';
    api.get<any[]>(`${path}?q=${encodeURIComponent(tq)}`).then((rows) =>
      setTargets(rows.map((r) => ({ id: r.id, label: f.scope === 'PRODUCT' ? r.name : `${r.number} · ${r.customerName}` }))),
    ).catch(() => setTargets([]));
  }, [open, f.scope, tq]);

  const errors = useMemo(() => validate(f, discount?.usedCount ?? 0), [f, discount]);
  const err = (k: string) => serverErrors[k] ?? (touched ? errors[k] : undefined);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    setError(null);
    setServerErrors({});
    const body = {
      name: f.name, code: f.code || null, type: f.type, value: f.value, scope: f.scope,
      minPurchase: f.minPurchase || 0, minQuantity: Number(f.minQuantity || 0), startDate: f.startDate,
      endDate: f.endDate || null, usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
      appliesToAll: f.appliesToAll, targetIds: f.appliesToAll ? [] : f.targetIds,
    };
    try {
      const saved = discount ? await api.patch<Discount>(`/discounts/${discount.id}`, body) : await api.post<Discount>('/discounts', body);
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.details?.fieldErrors) {
        setServerErrors(Object.fromEntries(Object.entries(e.details.fieldErrors).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)])));
      }
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const allLabel = f.scope === 'PRODUCT' ? 'All products' : 'All subscriptions';
  return (
    <Drawer open={open} onClose={onClose} title={discount ? `Edit ${discount.name}` : 'New discount'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" error={err('name')}><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Code (optional)" error={err('code')}><input className="input font-mono uppercase" value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <div className="inline-flex w-full rounded-lg border border-slate-300 p-0.5">
              {(['PERCENT', 'FIXED'] as const).map((t) => (
                <button type="button" key={t} onClick={() => set('type', t)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm ${f.type === t ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>
                  {t === 'PERCENT' ? 'Percentage' : 'Fixed amount'}
                </button>
              ))}
            </div>
          </Field>
          <Field label={f.type === 'PERCENT' ? 'Percent off' : 'Amount off (₹)'} error={err('value')}
            hint={f.type === 'FIXED' ? (f.scope === 'PRODUCT' ? 'Flat amount off each matching line' : 'Flat amount off the invoice') : undefined}>
            <input className="input" inputMode="decimal" value={f.value} onChange={(e) => set('value', e.target.value.trim())} />
          </Field>
        </div>

        <Field label="Applies to">
          <div className="inline-flex w-full rounded-lg border border-slate-300 p-0.5">
            {(['PRODUCT', 'SUBSCRIPTION'] as const).map((s) => (
              <button type="button" key={s} onClick={() => setF((x) => ({ ...x, scope: s, targetIds: [], appliesToAll: false }))}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm ${f.scope === s ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>
                {s === 'PRODUCT' ? 'Products (per line)' : 'Whole subscription'}
              </button>
            ))}
          </div>
        </Field>

        <div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={f.appliesToAll} onChange={(e) => set('appliesToAll', e.target.checked)} /> {allLabel}
          </label>
          {!f.appliesToAll && (
            <div className="mt-2">
              <input className="input" placeholder={`Search ${f.scope === 'PRODUCT' ? 'products' : 'subscriptions'}`} value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} />
              <ul className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200">
                {targets.map((t) => (
                  <li key={t.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={f.targetIds.includes(t.id)}
                        onChange={(e) => set('targetIds', e.target.checked ? [...f.targetIds, t.id] : f.targetIds.filter((x) => x !== t.id))} />
                      {t.label}
                    </label>
                  </li>
                ))}
                {targets.length === 0 && <li className="px-3 py-3 text-sm text-slate-400">Nothing found</li>}
              </ul>
              <p className="mt-1 text-xs text-slate-500">{f.targetIds.length} selected</p>
            </div>
          )}
          {err('targetIds') && <p className="field-error">{err('targetIds')}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Min purchase (₹)" error={err('minPurchase')} hint="Invoice subtotal before discounts">
            <input className="input" inputMode="decimal" value={f.minPurchase} onChange={(e) => set('minPurchase', e.target.value.trim())} />
          </Field>
          <Field label="Min quantity" error={err('minQuantity')} hint={f.scope === 'PRODUCT' ? 'On the line' : 'Total across lines'}>
            <input className="input" inputMode="numeric" value={f.minQuantity} onChange={(e) => set('minQuantity', e.target.value.trim())} />
          </Field>
          <Field label="Start date" error={err('startDate')}><input className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label="End date (optional)" error={err('endDate')}><input className="input" type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
          <Field label="Usage limit (optional)" error={err('usageLimit')} hint={discount ? `Used ${discount.usedCount} times so far` : 'Number of invoices; empty = unlimited'}>
            <input className="input" inputMode="numeric" value={f.usageLimit} onChange={(e) => set('usageLimit', e.target.value.trim())} />
          </Field>
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving && <Spinner />} {discount ? 'Save changes' : 'Create discount'}</button>
        </div>
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Detail + usage history
// ---------------------------------------------------------------------------

function DiscountDetailDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => (id ? api.get<DiscountDetail>(`/discounts/${id}`) : Promise.resolve(null)), [id]);
  return (
    <Drawer open={id !== null} onClose={onClose} title={data?.name ?? 'Discount'}>
      <ErrorBanner error={error} />
      {loading && <Spinner />}
      {data && (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[data.status]}>{label(data.status)}</Badge>
            {data.code && <span className="font-mono text-sm text-slate-500">{data.code}</span>}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-slate-500">Value</dt><dd>{valueText(data)} {data.type === 'FIXED' && (data.scope === 'PRODUCT' ? 'per line' : 'per invoice')}</dd></div>
            <div><dt className="text-xs text-slate-500">Scope</dt><dd>{data.appliesToAll ? (data.scope === 'PRODUCT' ? 'All products' : 'All subscriptions') : `${data.targetIds.length} ${data.scope.toLowerCase()}(s)`}</dd></div>
            <div><dt className="text-xs text-slate-500">Valid</dt><dd>{date(data.startDate)} → {data.endDate ? date(data.endDate) : 'no end'}</dd></div>
            <div><dt className="text-xs text-slate-500">Usage</dt><dd>{data.usedCount} / {data.usageLimit ?? '∞'}</dd></div>
            <div><dt className="text-xs text-slate-500">Min purchase</dt><dd>{money(data.minPurchase)}</dd></div>
            <div><dt className="text-xs text-slate-500">Min quantity</dt><dd>{data.minQuantity}</dd></div>
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Used on invoices</h3>
            {data.usages.length === 0 ? <p className="text-sm text-slate-400">Not used yet</p> : (
              <table className="w-full rounded-lg border border-slate-200">
                <thead className="bg-slate-50"><tr><th className="th">Invoice</th><th className="th">Customer</th><th className="th text-right">Amount</th></tr></thead>
                <tbody>
                  {data.usages.map((u) => (
                    <tr key={u.invoiceId} className="border-t border-slate-100">
                      <td className="td">{u.invoiceNumber}<p className="text-xs text-slate-400">{date(u.invoiceDate)}</p></td>
                      <td className="td">{u.customer.name}</td>
                      <td className="td text-right tabular-nums">{money(u.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Preview: what would the next invoice for a subscription get?
// ---------------------------------------------------------------------------

interface Preview {
  subscription: { number: string; plan: string; customer: { name: string } };
  invoiceDate: string;
  subtotal: number; discountTotal: number; netTotal: number;
  lines: { lineId: string; productName: string; quantity: number; unitPrice: number; subtotal: number; discountName: string | null; productDiscountAmount: number; invoiceDiscountShare: number; netAmount: number }[];
  invoiceDiscount: { discountName: string | null; amount: number } | null;
}

function PreviewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [subs, setSubs] = useState<{ id: string; number: string; customerName: string; planName: string }[]>([]);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [subId, setSubId] = useState<string | null>(null);
  const [on, setOn] = useState(today());
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) api.get<typeof subs>(`/lookups/subscriptions?q=${encodeURIComponent(q)}`).then(setSubs).catch(() => setSubs([]));
  }, [open, q]);
  useEffect(() => {
    if (!subId) return;
    setError(null);
    api.post<Preview>('/discounts/preview', { subscriptionId: subId, date: on }).then(setResult).catch((e) => setError(e.message));
  }, [subId, on]);

  return (
    <Modal open={open} onClose={onClose} title="Preview discounts" wide>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Subscription">
            <input className="input" placeholder="Search number or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <select className="input mt-2" size={4} value={subId ?? ''} onChange={(e) => setSubId(e.target.value)}>
            {subs.map((s) => <option key={s.id} value={s.id}>{s.number} · {s.customerName} · {s.planName}</option>)}
          </select>
        </div>
        <Field label="Invoice date"><input className="input" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
      </div>
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      {result && (
        <div className="mt-4">
          <table className="w-full rounded-lg border border-slate-200 text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Line</th><th className="th text-right">Subtotal</th><th className="th">Discount</th><th className="th text-right">Net</th></tr></thead>
            <tbody>
              {result.lines.map((l) => (
                <tr key={l.lineId} className="border-t border-slate-100">
                  <td className="td">{l.productName} <span className="text-slate-400">× {l.quantity}</span></td>
                  <td className="td text-right tabular-nums">{money(l.subtotal)}</td>
                  <td className="td">
                    {l.discountName ? <span className="text-emerald-700">{l.discountName}: −{money(l.productDiscountAmount)}</span> : <span className="text-slate-400">—</span>}
                    {l.invoiceDiscountShare > 0 && <p className="text-xs text-slate-500">share of invoice discount −{money(l.invoiceDiscountShare)}</p>}
                  </td>
                  <td className="td text-right tabular-nums">{money(l.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{money(result.subtotal)}</dd></div>
            {result.invoiceDiscount && <div className="flex justify-between"><dt className="text-slate-500">Invoice discount ({result.invoiceDiscount.discountName})</dt><dd className="tabular-nums text-emerald-700">−{money(result.invoiceDiscount.amount)}</dd></div>}
            <div className="flex justify-between"><dt className="text-slate-500">Total discounts</dt><dd className="tabular-nums text-emerald-700">−{money(result.discountTotal)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Net before tax</dt><dd className="tabular-nums">{money(result.netTotal)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-slate-400">Tax is computed by billing on the net amount. Nothing is saved by previewing.</p>
        </div>
      )}
    </Modal>
  );
}
