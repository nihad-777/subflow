// Adds a showcase data set to the database in backend/.env. Deletes nothing, and
// stops if it has already run. Run with: npm run demo:data
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { pool, query, queryOne } from '../src/payments/lib/db.js';
import { addDays, todayStr } from '../src/payments/lib/dates.js';
import { runBilling } from '../src/billing/billing.service.js';

const MARKER = 'Brightloop Suite';
const CUSTOMERS = ['Asha Patel', 'Ravi Kumar', 'Meera Shah', 'John Mathew', 'Sara Thomas', 'Arjun Nair', 'Priya Iyer', 'Omar Khan'];
const today = todayStr();
const password = `Demo#${randomBytes(6).toString('hex')}A`;

async function createCustomer(name: string, i: number) {
  const email = `demo.customer${i + 1}@subflow-demo.test`;
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);
  return { id: data.user.id, name, email };
}

async function main() {
  if (await queryOne('SELECT 1 FROM products WHERE name = $1', [MARKER])) {
    console.log('Demo data is already there, so nothing was added.');
    return;
  }

  const insert = async (sql: string, values: unknown[]) => (await queryOne<{ id: string }>(`${sql} RETURNING id`, values))!.id;
  const product = (name: string, type: string, description: string, price: number, cost: number) =>
    insert('INSERT INTO products (name, type, description, price, cost) VALUES ($1,$2,$3,$4,$5)', [name, type, description, price, cost]);
  const suite = await product(MARKER, 'Software', 'The core subscription workspace', 1200, 300);
  const support = await product('Priority Support', 'Service', 'Four hour response time', 2500, 900);
  const storage = await product('Storage 100 GB', 'Other', 'Extra document storage', 500, 100);
  const odoo = await insert('INSERT INTO product_variants (product_id, name, price_adjustment) VALUES ($1,$2,$3)', [suite, 'Odoo brand', 560]);

  const plan = (name: string, price: number, frequency: string, autoClose: boolean) =>
    insert('INSERT INTO plans (name, price, frequency, auto_close) VALUES ($1,$2,$3,$4)', [name, price, frequency, autoClose]);
  const monthly = await plan('Monthly Standard', 1200, 'monthly', false);
  const yearly = await plan('Yearly Saver', 12000, 'yearly', false);
  const term = await plan('Six Month Term', 6000, 'monthly', true);
  for (const p of [monthly, yearly, term]) {
    for (const item of [suite, support, storage]) await pool.query('INSERT INTO plan_products (plan_id, product_id) VALUES ($1,$2)', [p, item]);
  }

  const gst = await insert('INSERT INTO tax_rules (name, tax_rate, description) VALUES ($1,$2,$3)', ['GST 18%', 18, 'Standard rate']);
  await pool.query(
    'INSERT INTO quotation_templates (name, validity_days, plan_id, line_items) VALUES ($1,$2,$3,$4)',
    ['Team Starter', 30, monthly, JSON.stringify([{ productId: suite, quantity: 5, taxRuleId: gst }, { productId: storage, quantity: 1, taxRuleId: gst }])],
  );
  await pool.query(
    `INSERT INTO discounts (name, code, type, value, scope, min_quantity, start_date, usage_limit)
     VALUES ('10% off for 5+ seats', 'SEATS10', 'PERCENT', 10, 'SUBSCRIPTION', 5, $1, 6)`,
    [addDays(today, -200)],
  );

  const customers = [];
  for (const [i, name] of CUSTOMERS.entries()) customers.push(await createCustomer(name, i));

  // status, months since it started, plan, seats, variant
  const subscriptions: [string, number, string, number, string | null][] = [
    ['active', 6, monthly, 6, odoo], ['active', 5, monthly, 3, null], ['active', 4, monthly, 8, null],
    ['active', 3, monthly, 2, odoo], ['active', 2, yearly, 10, null], ['active', 5, monthly, 1, null],
    ['paused', 3, monthly, 4, null], ['active', 7, term, 5, null], ['confirmed', 0, monthly, 3, null],
    ['quotation', 0, monthly, 5, odoo], ['draft', 0, yearly, 2, null],
  ];
  for (const [i, [status, months, planId, seats, variant]] of subscriptions.entries()) {
    const customer = customers[i % customers.length];
    const start = addDays(today, -30 * months);
    const number = `SUB/${start.slice(0, 4)}/${String(i + 1).padStart(4, '0')}`;
    const frequency = planId === yearly ? 'yearly' : 'monthly';
    const end = planId === term ? addDays(start, 150) : null;
    const sub = await insert(
      `INSERT INTO subscriptions (subscription_number, customer_id, plan_id, billing_frequency, start_date, end_date, next_billing_date, status, quote_expires_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [number, customer.id, planId, frequency, start, end, status === 'active' ? start : null, status, status === 'quotation' ? addDays(today, 30) : null],
    );
    await pool.query(
      `INSERT INTO subscription_items (subscription_id, product_id, product_variant_id, description, quantity, unit_price, tax_rule_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [sub, suite, variant, variant ? `${MARKER} (Odoo brand)` : MARKER, seats, variant ? 1760 : 1200, gst],
    );
    if (i % 2 === 0) {
      await pool.query(
        `INSERT INTO subscription_items (subscription_id, product_id, description, quantity, unit_price, tax_rule_id) VALUES ($1,$2,'Priority Support',1,2500,$3)`,
        [sub, support, gst],
      );
    }
    await pool.query('INSERT INTO subscription_events (subscription_id, to_status, note) VALUES ($1,$2,$3)', [sub, status, 'Demo data']);
  }
  await pool.query(
    `INSERT INTO number_series (series, year, last_value) VALUES ('SUB', $1, 100)
     ON CONFLICT (series, year) DO UPDATE SET last_value = GREATEST(number_series.last_value, 100)`,
    [Number(today.slice(0, 4))],
  );

  const summary = await runBilling(today);

  // Older invoices become paid, some partly paid or overdue, and the newest stay draft.
  const invoices = await query(`SELECT id, customer_id, invoice_date, due_date, total_amount FROM invoices WHERE status = 'draft' ORDER BY invoice_date`);
  for (const [i, inv] of invoices.entries()) {
    if (inv.invoice_date >= addDays(today, -3)) continue;
    await pool.query(`UPDATE invoices SET status = 'confirmed' WHERE id = $1`, [inv.id]);
    const total = Number(inv.total_amount);
    const paid = i % 5 === 3 ? 0 : i % 5 === 4 ? Math.round(total * 0.5 * 100) / 100 : total;
    if (paid > 0) {
      const when = inv.due_date < today ? inv.due_date : today;
      await pool.query(
        `INSERT INTO payments (invoice_id, customer_id, method, amount, payment_date, status) VALUES ($1,$2,$3,$4,$5,'POSTED')`,
        [inv.id, inv.customer_id, ['UPI', 'BANK_TRANSFER', 'CARD'][i % 3], paid, when],
      );
    }
    if (paid === total) await pool.query(`UPDATE invoices SET status = 'paid' WHERE id = $1`, [inv.id]);
  }

  console.log(`Added ${customers.length} customers, ${subscriptions.length} subscriptions and ${summary.invoicesCreated} invoices.`);
  console.log(`Sign in as a demo customer: ${customers[0].email}`);
  console.log(`Password for all demo customers: ${password}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
