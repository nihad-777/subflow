import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/payments/app.js';
import { pool, queryOne } from '../src/payments/lib/db.js';
import { addDays, todayStr } from '../src/payments/lib/dates.js';

export const app = createApp();
export const API = '/api/finance';

export async function resetDb() {
  await pool.query(`TRUNCATE payments, discount_usages, discount_targets, discounts, invoice_items, invoices,
                    subscription_items, subscriptions, plans, products RESTART IDENTITY CASCADE`);
  await pool.query(`DELETE FROM auth.users`);
}

/** Creates an auth user (schema.sql's trigger makes the profile), then sets its role as service_role. */
export async function makeUser(role: 'admin' | 'staff' | 'customer', name: string = role) {
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [id, `${id}@t.test`, { full_name: name }]);
    await client.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`);
    await client.query(`UPDATE profiles SET role = $2 WHERE id = $1`, [id, role]);
    await client.query(`SELECT set_config('request.jwt.claim.role', '', false)`);
  } finally {
    client.release();
  }
  return id;
}

export async function makeWorld() {
  const admin = await makeUser('admin');
  const staff = await makeUser('staff');
  const customer = await makeUser('customer', 'Cust One');
  const otherCustomer = await makeUser('customer', 'Cust Two');
  const product = (await queryOne(`INSERT INTO products (name, price) VALUES ('Seat', 100) RETURNING id`))!.id as string;
  const product2 = (await queryOne(`INSERT INTO products (name, price) VALUES ('Storage', 50) RETURNING id`))!.id as string;
  const plan = (await queryOne(`INSERT INTO plans (name, price, billing_period) VALUES ('Monthly', 100, 'Monthly') RETURNING id`))!.id as string;
  const sub = (await queryOne(
    `INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date) VALUES ('SUB-1', $1, $2, 'Active', $3) RETURNING id`,
    [customer, plan, addDays(todayStr(), -100)],
  ))!.id as string;
  await pool.query(`INSERT INTO subscription_items (subscription_id, product_id, quantity, unit_price) VALUES ($1,$2,6,100)`, [sub, product]);
  await pool.query(`INSERT INTO subscription_items (subscription_id, product_id, quantity, unit_price) VALUES ($1,$2,2,50)`, [sub, product2]);
  return { admin, staff, customer, otherCustomer, product, product2, plan, sub };
}

let invoiceSeq = 0;
export async function makeInvoice(opts: { customer: string; sub?: string; total: number; status?: string; invoiceDaysAgo?: number; dueDaysAgo?: number }) {
  invoiceSeq++;
  const invoiceDate = addDays(todayStr(), -(opts.invoiceDaysAgo ?? 10));
  const dueDate = addDays(todayStr(), -(opts.dueDaysAgo ?? -5));
  const row = await queryOne(
    `INSERT INTO invoices (invoice_number, customer_id, subscription_id, status, invoice_date, due_date, subtotal, total_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
    [`INV-T${invoiceSeq}-${Date.now()}`, opts.customer, opts.sub ?? null, opts.status ?? 'Confirmed', invoiceDate, dueDate, opts.total],
  );
  return row!.id as string;
}

export const as = (userId: string) => ({
  get: (url: string) => request(app).get(API + url).set('x-user-id', userId),
  post: (url: string, body?: object) => request(app).post(API + url).set('x-user-id', userId).send(body ?? {}),
  patch: (url: string, body?: object) => request(app).patch(API + url).set('x-user-id', userId).send(body ?? {}),
  delete: (url: string) => request(app).delete(API + url).set('x-user-id', userId),
});

export const invoiceStatus = async (id: string) => (await queryOne('SELECT status FROM invoices WHERE id = $1', [id]))!.status;
