import { useEffect, useState } from 'react';
import { api } from './finance/lib/api';
import './catalog.css';

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
    planId: '',
    lineItems: [],
  },
};

const money = (value) => `₹${Number(value || 0).toFixed(2)}`;
const paths = { Products: 'products', Plans: 'plans', Quotations: 'templates' };

export default function App() {
  const [page, setPage] = useState('Products');
  const [products, setProducts] = useState([]);
  const [plans, setPlans] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState('');
  const [taxes, setTaxes] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all(['products', 'plans', 'templates', 'taxes'].map((path) => api.get(`/catalog/${path}`)))
      .then(([loadedProducts, loadedPlans, loadedTemplates, loadedTaxes]) => {
        setProducts(loadedProducts);
        setPlans(loadedPlans);
        setQuotes(loadedTemplates);
        setTaxes(loadedTaxes);
      })
      .catch((err) => setError(err.message));
  }, []);

  const rows =
    page === 'Products' ? products : page === 'Plans' ? plans : quotes;

  const setRows =
    page === 'Products'
      ? setProducts
      : page === 'Plans'
        ? setPlans
        : setQuotes;

  const visibleRows = rows.filter((item) =>
    String(item.name || '').toLowerCase().includes(query.trim().toLowerCase())
  );

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
    setError('');
    try {
      const path = `/catalog/${paths[page]}`;
      const saved = editingId
        ? await api.patch(`${path}/${editingId}`, form)
        : await api.post(path, form);
      setRows((current) =>
        editingId
          ? current.map((item) => (item.id === editingId ? saved : item))
          : [saved, ...current]
      );
      setForm(null);
    } catch (err) {
      setError(err.details?.formErrors?.[0] || err.message);
    }
  }

  async function deleteRow(id) {
    if (!confirm('Delete this item?')) return;
    setError('');
    try {
      await api.delete(`/catalog/${paths[page]}/${id}`);
      setRows((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

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
    <main className="catalog-root">
      <section className="catalog-content">
        {error && !form && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="catalog-heading-row">
          <div>
            <span className="eyebrow">CATALOG MANAGEMENT</span>
            <h1 className="catalog-title">Products, plans &amp; quotations</h1>
            <p className="catalog-subtitle">Build the offers your customers can choose from.</p>
          </div>
          <button onClick={() => openForm()} className="catalog-primary-button">
            + Add {page === 'Products' ? 'product' : page === 'Plans' ? 'plan' : 'template'}
          </button>
        </div>

        <div className="catalog-summary">
          <div><span>Products</span><strong>{products.length}</strong><small>In your catalog</small></div>
          <div><span>Plans</span><strong>{plans.length}</strong><small>Available offers</small></div>
          <div><span>Quotation templates</span><strong>{quotes.length}</strong><small>Ready to customize</small></div>
        </div>

        <nav className="catalog-tabs" aria-label="Catalog sections" role="tablist">
          {['Products', 'Plans', 'Quotations'].map((name) => (
            <button
              key={name}
              onClick={() => setPage(name)}
              type="button"
              role="tab"
              aria-selected={page === name}
              className={`catalog-tab ${page === name ? 'active' : ''}`}
            >
              {name}
            </button>
          ))}
        </nav>

        <div className="catalog-section-heading">
          <div>
            <h2>{page === 'Quotations' ? 'Quotation templates' : page}</h2>
            <p>{page === 'Products' ? 'Manage your products and their variants.' : page === 'Plans' ? 'Group products into clear, flexible plans.' : 'Set up reusable quotation starting points.'}</p>
          </div>
        </div>

        <div className="catalog-tools">
          <label className="catalog-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder={`Search ${page.toLowerCase()}…`}
              aria-label={`Search ${page.toLowerCase()}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="catalog-result-count">{visibleRows.length} {visibleRows.length === 1 ? 'result' : 'results'}</span>
        </div>

        <div className="catalog-table-shell">
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
              {visibleRows.map((item) => (
                <tr key={item.id}>
                  <td className="p-4 font-medium">
                    {item.name}

                    {page === 'Products' && (
                      <>
                        <div className="text-xs text-slate-500">
                          {item.description || 'No description'}
                        </div>
                        <div className="text-xs text-slate-500">
                          {item.variants.length} variants
                        </div>
                      </>
                    )}

                    {page === 'Plans' && (
                      <div className="text-xs text-slate-500">
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
                      className="catalog-text-button"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteRow(item.id)}
                      className="catalog-delete-button"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {visibleRows.length === 0 && (
            <p className="catalog-empty">
              {query ? `No ${page.toLowerCase()} match “${query}”.` : `No ${page.toLowerCase()} yet. Add one to get started.`}
            </p>
          )}
        </div>
      </section>

      {form && (
        <div className="catalog-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setForm(null); }}>
          <form
            onSubmit={save}
            className="catalog-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-modal-title"
          >
            <h3 id="catalog-modal-title" className="catalog-modal-title">
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
                    className="catalog-text-button"
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
                  <div key={i} className="grid grid-cols-2 gap-2">
                    <input
                      placeholder="Variant name"
                      className="rounded border p-2"
                      value={variant.name}
                      onChange={(e) =>
                        changeVariant(i, 'name', e.target.value)
                      }
                    />
                    <input
                      placeholder="Price adjustment"
                      type="number"
                      step=".01"
                      className="rounded border p-2"
                      value={variant.priceAdjustment}
                      onChange={(e) =>
                        changeVariant(i, 'priceAdjustment', e.target.value)
                      }
                    />
                    <span className="col-span-2 text-xs text-slate-500">
                      Variant price:{' '}
                      {money(
                        Number(form.price || 0) +
                          Number(variant.priceAdjustment || 0)
                      )}
                    </span>
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

                <label className="block text-sm">
                  Recurring plan
                  <select
                    className="mt-1 w-full rounded border p-2"
                    value={form.planId || ''}
                    onChange={(e) => setForm({ ...form, planId: e.target.value })}
                  >
                    <option value="">Choose when quoting</option>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>{plan.name}</option>
                    ))}
                  </select>
                </label>

                <div className="flex items-center justify-between text-sm font-medium">
                  <span>Quotation line items</span>
                  <button
                    type="button"
                    className="catalog-text-button"
                    onClick={() =>
                      setForm({
                        ...form,
                        lineItems: [
                          ...form.lineItems,
                          { productId: '', variantId: '', quantity: 1, taxRuleId: '' },
                        ],
                      })
                    }
                  >
                    + Add line
                  </button>
                </div>

                {form.lineItems.map((line, index) => (
                  <div key={index} className="grid grid-cols-3 gap-2">
                    <select
                      aria-label="Product"
                      required
                      className="rounded border p-2"
                      value={line.productId}
                      onChange={(e) =>
                        changeLineItem(index, 'productId', e.target.value)
                      }
                    >
                      <option value="">Product</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>{product.name}</option>
                      ))}
                    </select>
                    <input
                      aria-label="Quantity"
                      type="number"
                      min="1"
                      className="rounded border p-2"
                      value={line.quantity}
                      onChange={(e) =>
                        changeLineItem(index, 'quantity', e.target.value)
                      }
                    />
                    <select
                      aria-label="Tax"
                      className="rounded border p-2"
                      value={line.taxRuleId || ''}
                      onChange={(e) =>
                        changeLineItem(index, 'taxRuleId', e.target.value)
                      }
                    >
                      <option value="">No tax</option>
                      {taxes.map((tax) => (
                        <option key={tax.id} value={tax.id}>{tax.name}</option>
                      ))}
                    </select>
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
              </>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-3 border-t pt-4">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="catalog-cancel-button"
              >
                Cancel
              </button>
              <button className="catalog-primary-button">
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
