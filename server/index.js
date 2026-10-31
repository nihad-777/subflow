const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 4000);
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '64kb' }));

async function rest(path, { method = 'GET', body, token = serviceKey, prefer } = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      'Content-Type': 'application/json',
      ...(token && token !== serviceKey ? { Authorization: `Bearer ${token}` } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, data };
}

async function requireAdmin(req, res, next) {
  if (!supabaseUrl || !anonKey || !serviceKey) return res.status(503).json({ error: 'Supabase server configuration is missing.' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const auth = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (!auth.ok) return res.status(401).json({ error: 'Your session is invalid or expired.' });
    const user = await auth.json();
    const { response, data } = await rest(`profiles?select=role&id=eq.${encodeURIComponent(user.id)}`);
    if (!response.ok || data?.[0]?.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' });
    req.authToken = token;
    next();
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: 'Could not verify your session.' });
  }
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/catalog/products', requireAdmin, async (_req, res) => {
  const { response, data } = await rest('products?select=*,product_variants(*)&order=created_at.desc');
  res.status(response.ok ? 200 : 500).json(response.ok ? { products: data } : { error: 'Could not load products.' });
});
app.post('/api/catalog/products', requireAdmin, async (req, res) => saveProduct(req, res));
app.put('/api/catalog/products/:id', requireAdmin, async (req, res) => saveProduct(req, res, req.params.id));
app.delete('/api/catalog/products/:id', requireAdmin, async (req, res) => {
  const { response } = await rest(`products?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
  if (!response.ok) return res.status(400).json({ error: 'Could not delete product. Remove it from plans first.' });
  res.status(204).end();
});

async function saveProduct(req, res, id) {
  const b = req.body || {};
  const variants = Array.isArray(b.variants) ? b.variants : [];
  const type = b.type || 'Software';
  const variantNames = variants.map((v) => typeof v?.name === 'string' ? v.name.trim().toLowerCase() : '');
  const invalidVariant = variants.some((v) => !validName(v?.name) || !Number.isFinite(Number(v.price_adjustment)) || Number(b.price) + Number(v.price_adjustment) < 0);
  if (!validName(b.name) || !validMoney(b.price) || !validMoney(b.cost ?? 0) || !['Software', 'Service', 'Other'].includes(type) || typeof (b.description ?? '') !== 'string' || invalidVariant || new Set(variantNames).size !== variantNames.length) return res.status(400).json({ error: 'Enter a product name, valid prices, and unique variants whose final prices are not negative.' });
  const record = { name: b.name.trim(), type, description: b.description || '', price: Number(b.price), cost: Number(b.cost || 0) };
  const { response, data } = await rest(id ? `products?id=eq.${encodeURIComponent(id)}&select=*` : 'products?select=*', { method: id ? 'PATCH' : 'POST', body: record, prefer: 'return=representation' });
  if (!response.ok || !data?.[0]) return res.status(500).json({ error: 'Could not save product.' });
  const product = data[0];
  const { response: removeResponse } = await rest(`product_variants?product_id=eq.${product.id}`, { method: 'DELETE' });
  if (!removeResponse.ok) return res.status(500).json({ error: 'Product saved, but variants could not be replaced.' });
  if (variants.length) {
    const { response: addResponse } = await rest('product_variants', { method: 'POST', body: variants.map((v) => ({ product_id: product.id, name: v.name.trim(), price_adjustment: Number(v.price_adjustment) })) });
    if (!addResponse.ok) return res.status(500).json({ error: 'Product saved, but variants could not be saved.' });
  }
  const { response: readResponse, data: saved } = await rest(`products?select=*,product_variants(*)&id=eq.${product.id}`);
  res.status(id ? 200 : 201).json({ product: readResponse.ok ? saved[0] : product });
}

app.get('/api/catalog/plans', requireAdmin, async (_req, res) => {
  const { response, data } = await rest('plans?select=*,plan_products(product_id)&order=created_at.desc');
  res.status(response.ok ? 200 : 500).json(response.ok ? { plans: data.map((p) => ({ ...p, product_ids: p.plan_products.map((x) => x.product_id) })) } : { error: 'Could not load plans.' });
});
app.post('/api/catalog/plans', requireAdmin, async (req, res) => savePlan(req, res));
app.put('/api/catalog/plans/:id', requireAdmin, async (req, res) => savePlan(req, res, req.params.id));
app.delete('/api/catalog/plans/:id', requireAdmin, async (req, res) => {
  const { response } = await rest(`plans?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
  if (!response.ok) return res.status(500).json({ error: 'Could not delete plan.' });
  res.status(204).end();
});

async function savePlan(req, res, id) {
  const b = req.body || {};
  const productIds = Array.isArray(b.product_ids) ? b.product_ids : null;
  const validDate = (value) => value == null || value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!validName(b.name) || !validMoney(b.price) || !['daily', 'weekly', 'monthly', 'yearly'].includes(b.frequency) || !productIds || productIds.some((value) => !isUuid(value)) || new Set(productIds).size !== productIds.length || !Number.isInteger(Number(b.min_quantity)) || Number(b.min_quantity) < 1 || !validDate(b.starts_at) || !validDate(b.ends_at) || (b.starts_at && b.ends_at && b.ends_at < b.starts_at)) return res.status(400).json({ error: 'Enter a plan name, valid price, billing frequency, quantity, dates, and product selections.' });
  if (productIds.length) {
    const { response: productsResponse, data: linkedProducts } = await rest(`products?select=id&id=in.(${productIds.join(',')})`);
    if (!productsResponse.ok || linkedProducts.length !== productIds.length) return res.status(400).json({ error: 'One or more selected products could not be found.' });
  }
  const record = { name: b.name.trim(), price: Number(b.price), frequency: b.frequency, min_quantity: Number(b.min_quantity), starts_at: b.starts_at || null, ends_at: b.ends_at || null, auto_close: Boolean(b.auto_close), allow_pause: Boolean(b.allow_pause), allow_early_close: Boolean(b.allow_early_close), allow_renew: Boolean(b.allow_renew) };
  const { response, data } = await rest(id ? `plans?id=eq.${encodeURIComponent(id)}&select=*` : 'plans?select=*', { method: id ? 'PATCH' : 'POST', body: record, prefer: 'return=representation' });
  if (!response.ok || !data?.[0]) return res.status(500).json({ error: 'Could not save plan.' });
  const plan = data[0];
  const { response: unlinkResponse } = await rest(`plan_products?plan_id=eq.${plan.id}`, { method: 'DELETE' });
  if (!unlinkResponse.ok) return res.status(500).json({ error: 'Plan saved, but its previous product links could not be updated.' });
  if (productIds.length) {
    const { response: productResponse } = await rest('plan_products', { method: 'POST', body: productIds.map((product_id) => ({ plan_id: plan.id, product_id })) });
    if (!productResponse.ok) return res.status(500).json({ error: 'Plan saved, but included products could not be updated.' });
  }
  res.status(id ? 200 : 201).json({ plan: { ...plan, product_ids: productIds } });
}

app.get('/api/catalog/quotations', requireAdmin, async (_req, res) => {
  const { response, data } = await rest('quotation_templates?select=*&order=created_at.desc');
  res.status(response.ok ? 200 : 500).json(response.ok ? { quotations: data } : { error: 'Could not load quotation templates.' });
});
app.post('/api/catalog/quotations', requireAdmin, async (req, res) => saveQuotation(req, res));
app.put('/api/catalog/quotations/:id', requireAdmin, async (req, res) => saveQuotation(req, res, req.params.id));
app.delete('/api/catalog/quotations/:id', requireAdmin, async (req, res) => {
  const { response } = await rest(`quotation_templates?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
  if (!response.ok) return res.status(500).json({ error: 'Could not delete quotation template.' });
  res.status(204).end();
});

async function saveQuotation(req, res, id) {
  const b = req.body || {};
  if (!validName(b.name) || !Number.isInteger(Number(b.validity_days)) || Number(b.validity_days) < 1 || !Array.isArray(b.line_items) || b.line_items.some((item) => !item || typeof item !== 'object')) return res.status(400).json({ error: 'Enter a name, validity period, and valid line items.' });
  const line_items = b.line_items.map((item) => ({ description: String(item.description || '').trim(), quantity: Number(item.quantity), unit_price: Number(item.unit_price) }));
  if (line_items.some((item) => !item.description || !Number.isInteger(item.quantity) || item.quantity < 1 || !validMoney(item.unit_price))) return res.status(400).json({ error: 'Each line needs a description, positive quantity, and valid price.' });
  const record = { name: b.name.trim(), validity_days: Number(b.validity_days), line_items };
  const { response, data } = await rest(id ? `quotation_templates?id=eq.${encodeURIComponent(id)}&select=*` : 'quotation_templates?select=*', { method: id ? 'PATCH' : 'POST', body: record, prefer: 'return=representation' });
  if (!response.ok || !data?.[0]) return res.status(500).json({ error: 'Could not save quotation template.' });
  res.status(id ? 200 : 201).json({ quotation: data[0] });
}

function validName(value) { return typeof value === 'string' && value.trim().length > 0; }
function validMoney(value) { return value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0; }
function isUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Unexpected server error.' }); });
app.listen(port, () => console.log(`API running on port ${port}`));
