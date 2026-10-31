import { useState } from 'react';

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
  },
  Quotations: {
    name: '',
    validityDays: 30,
    lineItems: '[]',
  },
};

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function App() {
  const [page, setPage] = useState('Products');
  const [products, setProducts] = useState([]);
  const [plans, setPlans] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);

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

    // The quotation editor uses a text box, so convert saved items to JSON text.
    if (page === 'Quotations' && item) {
      nextForm.lineItems = JSON.stringify(item.lineItems || [], null, 2);
    }

    setForm(nextForm);
    setEditingId(item?.id ?? null);
  }

  function save(event) {
    event.preventDefault();

    const savedForm = { ...form, id: editingId ?? Date.now() };

    if (page === 'Quotations') {
      try {
        savedForm.lineItems = JSON.parse(form.lineItems || '[]');
      } catch {
        alert('Line items must be valid JSON.');
        return;
      }
    }

    setRows((current) =>
      editingId
        ? current.map((item) =>
            item.id === editingId ? savedForm : item
          )
        : [...current, savedForm]
    );

    setForm(null);
  }

  function deleteRow(id) {
    if (confirm('Delete this item?')) {
      setRows((current) => current.filter((item) => item.id !== id));
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

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="flex items-center justify-between border-b bg-white px-8 py-4">
        <h1 className="text-xl font-bold text-violet-700">Subflow</h1>
        <span className="text-sm text-slate-500">Product &amp; Plans</span>
      </header>

      <section className="mx-auto max-w-6xl p-8">
        <nav className="mb-8 flex gap-3">
          {['Products', 'Plans', 'Quotations'].map((name) => (
            <button
              key={name}
              onClick={() => setPage(name)}
              className={`rounded-lg px-4 py-2 ${
                page === name
                  ? 'bg-violet-600 text-white'
                  : 'bg-white text-slate-700'
              }`}
            >
              {name}
            </button>
          ))}
        </nav>

        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">PRODUCT CATALOG</p>
            <h2 className="mt-1 text-3xl font-bold">
              {page === 'Quotations' ? 'Quotation templates' : page}
            </h2>
          </div>

          <button
            onClick={() => openForm()}
            className="rounded-lg bg-violet-600 px-4 py-2 text-white"
          >
            + Add {page === 'Products' ? 'product' : page === 'Plans' ? 'plan' : 'template'}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-500">
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
                <tr key={item.id} className="border-t">
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
                      className="text-violet-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteRow(item.id)}
                      className="text-red-600"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && (
            <p className="p-10 text-center text-slate-500">
              No {page.toLowerCase()} yet.
            </p>
          )}
        </div>
      </section>

      {form && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={save}
            className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl bg-white p-6"
          >
            <h3 className="text-xl font-bold">
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
                    className="text-violet-700"
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
                      Variant price: {money(Number(form.price || 0) + Number(variant.priceAdjustment || 0))}
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
                  Default line items (JSON)
                  <textarea
                    rows="5"
                    className="mt-1 w-full rounded border p-2 font-mono text-xs"
                    value={form.lineItems}
                    onChange={(e) =>
                      setForm({ ...form, lineItems: e.target.value })
                    }
                  />
                </label>
              </>
            )}

            <div className="flex justify-end gap-3 border-t pt-4">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded border px-4 py-2"
              >
                Cancel
              </button>
              <button className="rounded bg-violet-600 px-4 py-2 text-white">
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}