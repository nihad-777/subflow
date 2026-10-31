import { useEffect, useState } from 'react';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const sessionKey = 'subflow-product-session';
const demoKey = 'subflow-product-demo';
const demoProducts = [
  { id: 'demo-product-1', name: 'Subflow Starter', type: 'Software', description: 'Core tools for growing teams.', price: '29.00', cost: '8.00', variants: [{ name: 'Monthly', priceAdjustment: '0' }, { name: 'Annual', priceAdjustment: '-5' }] },
  { id: 'demo-product-2', name: 'Onboarding', type: 'Service', description: 'Guided workspace setup.', price: '199.00', cost: '80.00', variants: [] },
];
const demoPlans = [{ id: 'demo-plan-1', name: 'Team monthly', price: '49.00', frequency: 'monthly', minQuantity: 1, productIds: ['demo-product-1'], startsAt: '', endsAt: '', autoClose: false, allowPause: true, allowEarlyClose: true, allowRenew: true }];
const demoQuotes = [{ id: 'demo-quote-1', name: 'Standard proposal', validityDays: 30, lineItems: [{ description: 'Workspace setup', quantity: 1, unitPrice: '199.00' }] }];

async function signIn(email, password) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: supabaseKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.msg || data.message || 'Sign in failed.');
  return data;
}

async function refreshSession(session) {
  if (!session?.refresh_token) return session;
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: supabaseKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!response.ok) return null;
  return response.json();
}

async function apiRequest(path, session, options = {}) {
  let response = await fetch(`${apiUrl}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers } });
  if (response.status === 401) {
    const updated = await refreshSession(session);
    if (!updated) throw new Error('Your session expired. Please sign in again.');
    session.save(updated);
    response = await fetch(`${apiUrl}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${updated.access_token}`, ...options.headers } });
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

const empty = {
  Products: {
    name: '',
    type: 'Software',
    description: '',
    price: '',
    cost: '',
    variants: [],
  },
  Plans: {
    name: '',
    price: '',
    frequency: 'monthly',
    minQuantity: 1,
    productIds: [],
    startsAt: '',
    endsAt: '',
    autoClose: false,
    allowPause: true,
    allowEarlyClose: true,
    allowRenew: true,
  },
  Quotations: {
    name: '',
    validityDays: 30,
    lineItems: [],
  },
};

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function App() {
  const [page, setPage] = useState('Products');
  const [products, setProducts] = useState(() => JSON.parse(localStorage.getItem(demoKey) === 'true' ? localStorage.getItem('subflow-products') || '[]' : '[]'));
  const [plans, setPlans] = useState(() => JSON.parse(localStorage.getItem(demoKey) === 'true' ? localStorage.getItem('subflow-plans') || '[]' : '[]'));
  const [quotes, setQuotes] = useState(() => JSON.parse(localStorage.getItem(demoKey) === 'true' ? localStorage.getItem('subflow-quotes') || '[]' : '[]'));
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem(sessionKey) || 'null'));
  const [demoMode, setDemoMode] = useState(() => localStorage.getItem(demoKey) === 'true');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function updateSession(next) {
    if (next) localStorage.setItem(sessionKey, JSON.stringify(next));
    else localStorage.removeItem(sessionKey);
    setSession(next);
  }

  function startPreview() {
    localStorage.setItem(demoKey, 'true');
    if (!localStorage.getItem('subflow-products')) localStorage.setItem('subflow-products', JSON.stringify(demoProducts));
    if (!localStorage.getItem('subflow-plans')) localStorage.setItem('subflow-plans', JSON.stringify(demoPlans));
    if (!localStorage.getItem('subflow-quotes')) localStorage.setItem('subflow-quotes', JSON.stringify(demoQuotes));
    setProducts(JSON.parse(localStorage.getItem('subflow-products')));
    setPlans(JSON.parse(localStorage.getItem('subflow-plans')));
    setQuotes(JSON.parse(localStorage.getItem('subflow-quotes')));
    setDemoMode(true);
  }

  function exitPreview() {
    localStorage.removeItem(demoKey);
    localStorage.removeItem('subflow-products');
    localStorage.removeItem('subflow-plans');
    localStorage.removeItem('subflow-quotes');
    setDemoMode(false);
    setProducts([]); setPlans([]); setQuotes([]);
  }

  useEffect(() => {
    if (demoMode) return;
    if (!session?.access_token) return;
    let active = true;
    const authenticatedSession = { ...session, save: updateSession };
    Promise.all([
      apiRequest('/api/catalog/products', authenticatedSession),
      apiRequest('/api/catalog/plans', authenticatedSession),
      apiRequest('/api/catalog/quotations', authenticatedSession),
    ]).then(([productData, planData, quoteData]) => {
      if (!active) return;
      setProducts((productData.products || []).map((p) => ({ ...p, variants: (p.product_variants || []).map((v) => ({ ...v, priceAdjustment: String(v.price_adjustment) })) })));
      setPlans((planData.plans || []).map((p) => ({ ...p, productIds: p.product_ids || [], minQuantity: p.min_quantity, startsAt: p.starts_at || '', endsAt: p.ends_at || '' })));
      setQuotes((quoteData.quotations || []).map((q) => ({ ...q, validityDays: q.validity_days, lineItems: (q.line_items || []).map((line) => ({ ...line, unitPrice: String(line.unit_price) })) })));
      setError('');
    }).catch((loadError) => {
      if (!active) return;
      setError(loadError.message);
      if (loadError.message.includes('sign in again')) updateSession(null);
    });
    return () => { active = false; };
  }, [session?.access_token, demoMode]);

  const rows =
    page === 'Products' ? products : page === 'Plans' ? plans : quotes;

  const setRows =
    page === 'Products'
      ? setProducts
      : page === 'Plans'
        ? setPlans
        : setQuotes;

  function openForm(item) {
    const nextForm = item ? { ...item } : structuredClone(empty[page]);

    if (page === 'Quotations' && item) {
      nextForm.lineItems = (item.lineItems || []).map((line) => ({ ...line }));
    }

    setForm(nextForm);
    setEditingId(item?.id ?? null);
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (demoMode) {
        const savedForm = { ...form, id: editingId ?? `demo-${Date.now()}` };
        setRows((current) => {
          const next = editingId ? current.map((item) => item.id === editingId ? savedForm : item) : [...current, savedForm];
          const key = page === 'Products' ? 'subflow-products' : page === 'Plans' ? 'subflow-plans' : 'subflow-quotes';
          localStorage.setItem(key, JSON.stringify(next));
          return next;
        });
        setForm(null);
        return;
      }
      const path = `/api/catalog/${page === 'Products' ? 'products' : page === 'Plans' ? 'plans' : 'quotations'}${editingId ? `/${editingId}` : ''}`;
      const body = page === 'Products'
        ? { name: form.name, type: form.type, description: form.description, price: form.price, cost: form.cost, variants: form.variants.map((v) => ({ name: v.name, price_adjustment: Number(v.priceAdjustment || 0) })) }
        : page === 'Plans'
          ? { name: form.name, price: form.price, frequency: form.frequency, min_quantity: Number(form.minQuantity), product_ids: form.productIds, starts_at: form.startsAt || null, ends_at: form.endsAt || null, auto_close: form.autoClose, allow_pause: form.allowPause, allow_early_close: form.allowEarlyClose, allow_renew: form.allowRenew }
          : { name: form.name, validity_days: Number(form.validityDays), line_items: form.lineItems.map((line) => ({ description: line.description, quantity: Number(line.quantity), unit_price: Number(line.unitPrice) })) };
      await apiRequest(path, { ...session, save: updateSession }, { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setForm(null); setSession((current) => ({ ...current }));
      // Reload lists after a mutation so linked plan/product data stays in sync.
      const auth = { ...session, save: updateSession };
      const [p, pl, q] = await Promise.all([apiRequest('/api/catalog/products', auth), apiRequest('/api/catalog/plans', auth), apiRequest('/api/catalog/quotations', auth)]);
      setProducts((p.products || []).map((x) => ({ ...x, variants: (x.product_variants || []).map((v) => ({ ...v, priceAdjustment: String(v.price_adjustment) })) })));
      setPlans((pl.plans || []).map((x) => ({ ...x, productIds: x.product_ids || [], minQuantity: x.min_quantity, startsAt: x.starts_at || '', endsAt: x.ends_at || '' })));
      setQuotes((q.quotations || []).map((x) => ({ ...x, validityDays: x.validity_days, lineItems: (x.line_items || []).map((line) => ({ ...line, unitPrice: String(line.unit_price) })) })));
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  }

  async function deleteRow(id) {
    if (!confirm('Delete this item?')) return;
    setError('');
    try {
      if (demoMode) {
        setRows((current) => {
          const next = current.filter((item) => item.id !== id);
          const key = page === 'Products' ? 'subflow-products' : page === 'Plans' ? 'subflow-plans' : 'subflow-quotes';
          localStorage.setItem(key, JSON.stringify(next));
          return next;
        });
        return;
      }
      await apiRequest(`/api/catalog/${page === 'Products' ? 'products' : page === 'Plans' ? 'plans' : 'quotations'}/${id}`, { ...session, save: updateSession }, { method: 'DELETE' });
      setRows((current) => current.filter((item) => item.id !== id));
    } catch (deleteError) { setError(deleteError.message); }
  }

  async function submitLogin(event) {
    event.preventDefault(); setLoginError(''); setBusy(true);
    try { updateSession(await signIn(email, password)); }
    catch (authError) { setLoginError(authError.message); }
    finally { setBusy(false); }
  }

  if (!demoMode && (!supabaseUrl || !supabaseKey)) return <main className="catalog-gate"><section className="catalog-gate-card"><div className="catalog-brand gate-brand"><span className="catalog-brand-mark">S</span><span>subflow<span className="catalog-brand-dot">.</span></span></div><p className="catalog-eyebrow">PRODUCT WORKSPACE</p><h1>Build your catalog</h1><p>Preview the product, plans, and quotation screens before connecting Supabase.</p><button onClick={startPreview} className="catalog-primary-button gate-button">Preview catalog</button></section></main>;
  if (!demoMode && !session?.access_token) return <main className="catalog-gate"><form onSubmit={submitLogin} className="catalog-gate-card"><div className="catalog-brand gate-brand"><span className="catalog-brand-mark">S</span><span>subflow<span className="catalog-brand-dot">.</span></span></div><p className="catalog-eyebrow">WELCOME BACK</p><h1>Sign in to your workspace</h1><p>Use your workspace administrator account to manage the catalog.</p><label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{loginError && <p className="text-sm text-red-600">{loginError}</p>}<button disabled={busy} className="catalog-primary-button gate-button">{busy ? 'Signing in…' : 'Sign in'}</button><button type="button" onClick={startPreview} className="catalog-secondary-button gate-button">Preview catalog</button></form></main>;

  function changeVariant(index, key, value) {
    setForm({
      ...form,
      variants: form.variants.map((variant, i) =>
        i === index ? { ...variant, [key]: value } : variant
      ),
    });
  }

  function changeLineItem(index, key, value) {
    setForm({
      ...form,
      lineItems: form.lineItems.map((line, i) =>
        i === index ? { ...line, [key]: value } : line
      ),
    });
  }

  return (
    <main className="catalog-app">
      <aside className="catalog-sidebar">
        <div className="catalog-brand"><span className="catalog-brand-mark">S</span><span>subflow<span className="catalog-brand-dot">.</span></span></div>
        <div className="catalog-workspace"><span className="catalog-workspace-avatar">S</span><span><b>Subflow workspace</b><small>Product management</small></span><span className="catalog-chevron">⌄</span></div>
        <span className="catalog-side-label">WORKSPACE</span>
        <nav className="catalog-nav" aria-label="Product management sections">
          {['Products', 'Plans', 'Quotations'].map((name) => (
            <button key={name} onClick={() => setPage(name)} className={page === name ? 'catalog-nav-link active' : 'catalog-nav-link'}>
              <span className="catalog-nav-icon">{name === 'Products' ? 'P' : name === 'Plans' ? '↗' : '≡'}</span><span>{name === 'Quotations' ? 'Quotation templates' : name}</span>
            </button>
          ))}
        </nav>
        <div className="catalog-sidebar-bottom"><span className="catalog-help-mark">?</span><b>Product &amp; Plans</b><small>Catalog workspace</small></div>
      </aside>

      <div className="catalog-main-column">
      <header className="catalog-topbar">
        <div className="catalog-breadcrumb">Workspace <span>/</span> <b>{page === 'Quotations' ? 'Quotation templates' : page}</b></div>
        <div className="catalog-header-actions">{demoMode && <span className="catalog-preview-pill">Preview mode</span>}<span className="catalog-header-label">Product &amp; Plans</span><button onClick={() => demoMode ? exitPreview() : updateSession(null)} className="catalog-signout">{demoMode ? 'Exit preview' : 'Sign out'}</button></div>
      </header>

      <section className="catalog-content">
        {error && <p role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {demoMode && <p className="catalog-demo-note">Preview data is saved in this browser only. Connect Supabase later to use shared workspace data.</p>}
        {busy && <p className="mb-3 text-xs text-slate-500">Saving changes…</p>}
        <div className="catalog-page-heading">
          <div>
            <p className="catalog-eyebrow">PRODUCT CATALOG</p>
            <h2 className="catalog-title">
              {page === 'Quotations' ? 'Quotation templates' : page}
            </h2>
            <p className="catalog-subtitle">{page === 'Products' ? 'Manage your products, pricing, and available variants.' : page === 'Plans' ? 'Build subscription plans and choose what each plan includes.' : 'Create reusable quotation templates for your customers.'}</p>
          </div>

          <button
            onClick={() => openForm()}
            className="catalog-primary-button"
          >
            <span className="catalog-plus">+</span> Add {page === 'Products' ? 'product' : page === 'Plans' ? 'plan' : 'template'}
          </button>
        </div>

        <div className="catalog-metrics">
          <div className="catalog-metric-card"><span className="catalog-metric-icon mint">P</span><div><small>Total products</small><strong>{products.length}</strong></div></div>
          <div className="catalog-metric-card"><span className="catalog-metric-icon sage">↗</span><div><small>Subscription plans</small><strong>{plans.length}</strong></div></div>
          <div className="catalog-metric-card"><span className="catalog-metric-icon sand">≡</span><div><small>Quotation templates</small><strong>{quotes.length}</strong></div></div>
        </div>

        <div className="catalog-table-wrap">
          <div className="catalog-table-heading"><div><h3>{page === 'Quotations' ? 'Saved templates' : page === 'Plans' ? 'Your plans' : 'Product list'}</h3><p>Review and manage items in your workspace.</p></div><span className="catalog-count-badge">{rows.length} {rows.length === 1 ? 'item' : 'items'}</span></div>
          <table className="catalog-table">
            <thead>
              <tr>
                <th className="p-4">Name</th>
                <th className="p-4">
                  {page === 'Products'
                    ? 'Type'
                    : page === 'Plans'
                      ? 'Billing'
                      : 'Valid for'}
                </th>
                <th className="p-4">
                  {page === 'Quotations' ? 'Line items' : 'Price'}
                </th>
                {page === 'Plans' && <th className="p-4">Available dates</th>}
                <th className="p-4">Actions</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td className="p-4 font-medium">
                    {item.name}

                    {page === 'Products' && (
                      <>
                        <div className="catalog-row-detail">
                          {item.description || 'No description'}
                        </div>
                        <div className="catalog-row-detail">
                          {item.variants.length} variants
                        </div>
                      </>
                    )}

                    {page === 'Plans' && (
                      <div className="catalog-row-detail">
                        {item.productIds
                          .map((id) => products.find((product) => product.id === id)?.name)
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    )}
                  </td>

                  <td className="p-4">
                    {page === 'Products'
                      ? item.type
                      : page === 'Plans'
                        ? item.frequency
                        : `${item.validityDays} days`}
                  </td>

                  <td className="p-4">
                    {page === 'Quotations'
                      ? `${item.lineItems.length} items`
                      : money(item.price)}
                  </td>

                  {page === 'Plans' && (
                    <td className="p-4 text-xs text-slate-600">
                      {item.startsAt || 'Any date'} – {item.endsAt || 'No end date'}
                    </td>
                  )}

                  <td className="space-x-3 p-4">
                    <button
                      onClick={() => openForm(item)}
                      className="catalog-edit-action"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteRow(item.id)}
                      className="catalog-delete-action"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && (
            <div className="catalog-empty"><span className="catalog-empty-icon">＋</span><b>No {page.toLowerCase()} yet</b><p>Add your first {page === 'Products' ? 'product' : page === 'Plans' ? 'plan' : 'quotation template'} to get started.</p></div>
          )}
        </div>
      </section>
      </div>

      {form && (
        <div className="catalog-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setForm(null); }}>
          <form
            onSubmit={save}
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-form-title"
            className="catalog-dialog space-y-4"
          >
            <p className="catalog-dialog-eyebrow">{editingId ? 'EDIT DETAILS' : 'NEW ENTRY'}</p>
            <h3 id="catalog-form-title" className="text-xl font-bold">
              {editingId ? 'Edit' : 'Add'}{' '}
              {page === 'Products'
                ? 'product'
                : page === 'Plans'
                  ? 'plan'
                  : 'quotation template'}
            </h3>

            <label className="block text-sm">
              Name
              <input
                required
                className="mt-1 w-full rounded border p-2"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>

            {page === 'Products' && (
              <>
                <label className="block text-sm">
                  Description
                  <textarea
                    className="mt-1 w-full rounded border p-2"
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    Type
                    <select
                      className="mt-1 w-full rounded border p-2"
                      value={form.type}
                      onChange={(e) =>
                        setForm({ ...form, type: e.target.value })
                      }
                    >
                      <option>Software</option>
                      <option>Service</option>
                      <option>Other</option>
                    </select>
                  </label>

                  <label className="text-sm">
                    Sales price
                    <input
                      required
                      type="number"
                      min="0"
                      step=".01"
                      className="mt-1 w-full rounded border p-2"
                      value={form.price}
                      onChange={(e) =>
                        setForm({ ...form, price: e.target.value })
                      }
                    />
                  </label>
                </div>

                <label className="block text-sm">
                  Cost price
                  <input
                    type="number"
                    min="0"
                    step=".01"
                    className="mt-1 w-full rounded border p-2"
                    value={form.cost}
                    onChange={(e) =>
                      setForm({ ...form, cost: e.target.value })
                    }
                  />
                </label>

                <div className="flex justify-between text-sm font-medium">
                  <span>Variants</span>
                  <button
                    type="button"
                    className="catalog-text-action"
                    onClick={() =>
                      setForm({
                        ...form,
                        variants: [
                          ...form.variants,
                          { name: '', priceAdjustment: '' },
                        ],
                      })
                    }
                  >
                    + Add variant
                  </button>
                </div>

                {form.variants.map((variant, i) => (
                  <div key={i} className="catalog-variant-row grid grid-cols-2 gap-2 rounded-lg border border-slate-100 p-3">
                    <input
                      required
                      placeholder="Variant name"
                      className="rounded border p-2"
                      value={variant.name}
                      onChange={(e) =>
                        changeVariant(i, 'name', e.target.value)
                      }
                    />
                    <input
                      required
                      placeholder="Price adjustment"
                      type="number"
                      step=".01"
                      min={-Number(form.price || 0)}
                      className="rounded border p-2"
                      value={variant.priceAdjustment}
                      onChange={(e) =>
                        changeVariant(i, 'priceAdjustment', e.target.value)
                      }
                    />
                    <span className="catalog-variant-price col-span-2 text-xs text-slate-500">
                      Variant price:{' '}
                      {money(
                        Number(form.price || 0) +
                          Number(variant.priceAdjustment || 0)
                      )}
                    </span>
                    <button type="button" className="catalog-remove-action col-span-2 justify-self-start text-xs text-red-600" onClick={() => setForm({ ...form, variants: form.variants.filter((_, index) => index !== i) })}>Remove variant</button>
                  </div>
                ))}
              </>
            )}

            {page === 'Plans' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    Price
                    <input
                      required
                      type="number"
                      min="0"
                      step=".01"
                      className="mt-1 w-full rounded border p-2"
                      value={form.price}
                      onChange={(e) =>
                        setForm({ ...form, price: e.target.value })
                      }
                    />
                  </label>

                  <label className="text-sm">
                    Billing frequency
                    <select
                      className="mt-1 w-full rounded border p-2"
                      value={form.frequency}
                      onChange={(e) =>
                        setForm({ ...form, frequency: e.target.value })
                      }
                    >
                      <option>daily</option>
                      <option>weekly</option>
                      <option>monthly</option>
                      <option>yearly</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    Available from
                    <input
                      type="date"
                      max={form.endsAt || undefined}
                      className="mt-1 w-full rounded border p-2"
                      value={form.startsAt}
                      onChange={(e) =>
                        setForm({ ...form, startsAt: e.target.value })
                      }
                    />
                  </label>

                  <label className="text-sm">
                    Available until
                    <input
                      type="date"
                      min={form.startsAt || undefined}
                      className="mt-1 w-full rounded border p-2"
                      value={form.endsAt}
                      onChange={(e) =>
                        setForm({ ...form, endsAt: e.target.value })
                      }
                    />
                  </label>
                </div>

                <label className="block text-sm">
                  Minimum quantity
                  <input
                    type="number"
                    min="1"
                    className="mt-1 w-full rounded border p-2"
                    value={form.minQuantity}
                    onChange={(e) =>
                      setForm({ ...form, minQuantity: e.target.value })
                    }
                  />
                </label>

                <div className="text-sm font-medium">Products included</div>

                {products.map((product) => (
                  <label
                    key={product.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={form.productIds.includes(product.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          productIds: e.target.checked
                            ? [...form.productIds, product.id]
                            : form.productIds.filter((id) => id !== product.id),
                        })
                      }
                    />
                    {product.name}
                  </label>
                ))}

                {products.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Add a product before creating a plan.
                  </p>
                )}

                <div className="space-y-2 border-t pt-3">
                  {[
                    ['autoClose', 'Close automatically when the plan ends'],
                    ['allowPause', 'Allow pausing'],
                    ['allowEarlyClose', 'Allow early closure'],
                    ['allowRenew', 'Allow renewal'],
                  ].map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center justify-between text-sm"
                    >
                      {label}
                      <input
                        type="checkbox"
                        checked={Boolean(form[key])}
                        onChange={(e) =>
                          setForm({ ...form, [key]: e.target.checked })
                        }
                      />
                    </label>
                  ))}
                </div>
              </>
            )}

            {page === 'Quotations' && (
              <>
                <label className="block text-sm">
                  Valid for (days)
                  <input
                    type="number"
                    min="1"
                    className="mt-1 w-full rounded border p-2"
                    value={form.validityDays}
                    onChange={(e) =>
                      setForm({ ...form, validityDays: e.target.value })
                    }
                  />
                </label>

                <div className="flex items-center justify-between text-sm font-medium">
                  <span>Quotation line items</span>
                  <button
                    type="button"
                    className="catalog-text-action"
                    onClick={() =>
                      setForm({
                        ...form,
                        lineItems: [
                          ...form.lineItems,
                          { description: '', quantity: 1, unitPrice: '' },
                        ],
                      })
                    }
                  >
                    + Add line
                  </button>
                </div>

                {form.lineItems.map((line, index) => (
                  <div key={index} className="catalog-line-row grid grid-cols-3 gap-2">
                    <input
                      required
                      placeholder="Description"
                      className="rounded border p-2"
                      value={line.description}
                      onChange={(e) =>
                        changeLineItem(index, 'description', e.target.value)
                      }
                    />
                    <input
                      aria-label="Quantity"
                      type="number"
                      min="1"
                      required
                      className="rounded border p-2"
                      value={line.quantity}
                      onChange={(e) =>
                        changeLineItem(index, 'quantity', e.target.value)
                      }
                    />
                    <input
                      aria-label="Unit price"
                      type="number"
                      min="0"
                      step=".01"
                      required
                      placeholder="Unit price"
                      className="rounded border p-2"
                      value={line.unitPrice}
                      onChange={(e) =>
                        changeLineItem(index, 'unitPrice', e.target.value)
                      }
                    />
                    <button
                      type="button"
                      className="text-left text-xs text-red-600"
                      onClick={() =>
                        setForm({
                          ...form,
                          lineItems: form.lineItems.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Remove line
                    </button>
                  </div>
                ))}
                <p className="catalog-estimate text-right text-sm font-semibold text-slate-700">
                  Estimated total: {money(form.lineItems.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0))}
                </p>
              </>
            )}

            <div className="flex justify-end gap-3 border-t pt-4">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="catalog-secondary-button"
              >
                Cancel
              </button>
              <button disabled={busy} className="catalog-primary-button">
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
