import { useState } from 'react';

const emptyProduct = {
  name: '',
  type: 'Software',
  price: '',
  cost: '',
  variants: [],
};

export default function App() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyProduct);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);

  function openNewForm() {
    setForm(emptyProduct);
    setEditingId(null);
    setShowForm(true);
  }

  function editProduct(product) {
    setForm(product);
    setEditingId(product.id);
    setShowForm(true);
  }

  function saveProduct(event) {
    event.preventDefault();

    if (editingId) {
      setProducts(products.map((product) =>
        product.id === editingId ? { ...form, id: editingId } : product
      ));
    } else {
      setProducts([...products, { ...form, id: Date.now() }]);
    }

    setShowForm(false);
  }

  function addVariant() {
    setForm({
      ...form,
      variants: [...form.variants, { name: '', priceAdjustment: '' }],
    });
  }

  function updateVariant(index, key, value) {
    setForm({
      ...form,
      variants: form.variants.map((variant, i) =>
        i === index ? { ...variant, [key]: value } : variant
      ),
    });
  }

  function deleteProduct(id) {
    setProducts(products.filter((product) => product.id !== id));
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="flex items-center justify-between border-b bg-white px-8 py-4">
        <h1 className="text-xl font-bold text-violet-700">Subflow</h1>
        <span className="text-sm text-slate-500">Product &amp; Plans</span>
      </header>

      <section className="mx-auto max-w-6xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">PRODUCT CATALOG</p>
            <h2 className="mt-1 text-3xl font-bold">Products</h2>
            <p className="mt-2 text-slate-500">
              Manage products, pricing, and product variants.
            </p>
          </div>

          <button
            onClick={openNewForm}
            className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-700"
          >
            + Add product
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-500">
              <tr>
                <th className="p-4">Product</th>
                <th className="p-4">Type</th>
                <th className="p-4">Sales price</th>
                <th className="p-4">Variants</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-t">
                  <td className="p-4 font-medium">{product.name}</td>
                  <td className="p-4">{product.type}</td>
                  <td className="p-4">${Number(product.price || 0).toFixed(2)}</td>
                  <td className="p-4">{product.variants.length}</td>
                  <td className="space-x-3 p-4">
                    <button
                      onClick={() => editProduct(product)}
                      className="text-violet-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteProduct(product.id)}
                      className="text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {products.length === 0 && (
            <p className="p-10 text-center text-slate-500">
              No products yet. Choose “Add product” to create one.
            </p>
          )}
        </div>
      </section>

      {showForm && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={saveProduct}
            className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl bg-white p-6"
          >
            <h3 className="text-xl font-bold">
              {editingId ? 'Edit product' : 'Add product'}
            </h3>

            <label className="block text-sm">
              Product name
              <input
                required
                className="mt-1 w-full rounded border p-2"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm">
                Type
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option>Software</option>
                  <option>Service</option>
                  <option>Other</option>
                </select>
              </label>

              <label className="block text-sm">
                Sales price
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  className="mt-1 w-full rounded border p-2"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </label>
            </div>

            <label className="block text-sm">
              Cost price
              <input
                min="0"
                step="0.01"
                type="number"
                className="mt-1 w-full rounded border p-2"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <b className="text-sm">Variants</b>
                <button
                  type="button"
                  onClick={addVariant}
                  className="text-sm text-violet-700"
                >
                  + Add variant
                </button>
              </div>

              {form.variants.map((variant, index) => (
                <div key={index} className="mb-2 grid grid-cols-2 gap-2">
                  <input
                    placeholder="Variant name"
                    className="rounded border p-2 text-sm"
                    value={variant.name}
                    onChange={(e) => updateVariant(index, 'name', e.target.value)}
                  />
                  <input
                    placeholder="Price adjustment"
                    type="number"
                    step="0.01"
                    className="rounded border p-2 text-sm"
                    value={variant.priceAdjustment}
                    onChange={(e) =>
                      updateVariant(index, 'priceAdjustment', e.target.value)
                    }
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 border-t pt-4">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded border px-4 py-2"
              >
                Cancel
              </button>
              <button className="rounded bg-violet-600 px-4 py-2 text-white">
                Save product
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}