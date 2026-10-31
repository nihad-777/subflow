// LOCAL demo data for payments & analytics. Deterministic (same data every run).
//   npm run payments:seed          small, hand-readable demo set
//   npm run payments:seed:large    ~5,000 subscriptions / ~28,000 invoices / ~26,000 payments
// Wipes this module's tables, the dev stub tables and the demo auth users first.
// Local only: refuses to run against a supabase.co URL.
import 'dotenv/config';
import pg from 'pg';
import { addDays, todayStr } from './lib/dates.js';
import { centsToSql } from './lib/money.js';

const LARGE = process.env.SEED_SCALE === 'large';
const url = process.env.DATABASE_URL ?? '';
if (/supabase\.(co|com)/.test(url) && process.env.SEED_ALLOW_REMOTE !== 'true') {
  console.error('Refusing to wipe a Supabase database. Set SEED_ALLOW_REMOTE=true if you really mean it.');
  process.exit(1);
}

// Mulberry32: tiny deterministic PRNG.
let seed = 42;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
// Deterministic uuids per table: prefix keeps ids readable (e.g. invoice 42 = 00000005-...-000000000042).
const uuidOf = (prefix: number, n: number) => `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uuid = (n: number) => uuidOf(0, n);
const PRODUCT = (n: number) => uuidOf(2, n), PLAN = (n: number) => uuidOf(3, n), SUB = (n: number) => uuidOf(4, n), INV = (n: number) => uuidOf(5, n);

export const DEMO_USERS = {
  admin: uuid(1),
  staff: uuid(2),
  customer: uuid(101), // Asha Patel: has paid, partial and overdue invoices
};

const FIRST = ['Asha', 'Ravi', 'Meera', 'John', 'Sara', 'Ken', 'Lina', 'Omar', 'Priya', 'Tom', 'Nina', 'Arjun', 'Zoe', 'Ivan', 'Maya', 'Leo'];
const LAST = ['Patel', 'Kumar', 'Shah', 'Smith', 'Lee', 'Garcia', 'Khan', 'Brown', 'Iyer', 'Rossi', 'Nair', 'Chen'];
const COMPANY = ['Labs', 'Studio', 'Foods', 'Tech', 'Retail', 'Clinic', 'Logistics', 'Media'];
const METHODS = ['BANK_TRANSFER', 'BANK_TRANSFER', 'CARD', 'CARD', 'UPI', 'UPI', 'CASH', 'CHEQUE'] as const;

const PRODUCTS = [
  { id: 1, name: 'Team seat', price: 1200_00 },
  { id: 2, name: 'Storage 100 GB', price: 500_00 },
  { id: 3, name: 'Priority support', price: 2500_00 },
  { id: 4, name: 'Analytics add-on', price: 1800_00 },
  { id: 5, name: 'API access', price: 3000_00 },
];
const PLANS = [
  { id: 1, name: 'Starter Monthly', price: 999_00, period: 'Monthly' },
  { id: 2, name: 'Pro Monthly', price: 2999_00, period: 'Monthly' },
  { id: 3, name: 'Pro Yearly', price: 29999_00, period: 'Yearly' },
  { id: 4, name: 'Flex Weekly', price: 299_00, period: 'Weekly' },
];
const TAX_RATE = 0.18;

async function insertMany(client: pg.Client, table: string, cols: string[], types: string[], rows: unknown[][]) {
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const arrays = cols.map((_, c) => chunk.map((r) => r[c]));
    const sel = types.map((t, c) => `$${c + 1}::${t}[]`).join(', ');
    await client.query(`INSERT INTO ${table} (${cols.join(', ')}) SELECT * FROM unnest(${sel})`, arrays);
  }
}

async function main() {
  const client = new pg.Client({ connectionString: url, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  const t0 = Date.now();
  const today = todayStr();

  await client.query(`TRUNCATE payments, discount_usages, discount_targets, discounts, invoice_items, invoices,
                      subscription_items, subscriptions, plans, products RESTART IDENTITY CASCADE`);
  await client.query(`DELETE FROM auth.users WHERE email LIKE '%@subflow.test'`);

  // --- people -----------------------------------------------------------------
  const nCustomers = LARGE ? 2000 : 10;
  const profiles: unknown[][] = [
    [DEMO_USERS.admin, 'Alex Admin', 'admin@subflow.test', 'admin'],
    [DEMO_USERS.staff, 'Sam Staff', 'staff@subflow.test', 'staff'],
  ];
  for (let i = 0; i < nCustomers; i++) {
    const name = i === 0 ? 'Asha Patel' : `${pick(FIRST)} ${pick(LAST)}${i > 15 ? ` (${pick(COMPANY)} ${i})` : ''}`;
    profiles.push([uuid(101 + i), name, `customer${i + 1}@subflow.test`, 'customer']);
  }
  // Users go into auth.users; schema.sql's trigger creates their profiles. Roles are then
  // set as service_role, which the profile-protection trigger allows.
  await client.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data)
     SELECT id, email, jsonb_build_object('full_name', name) FROM unnest($1::uuid[], $2::text[], $3::text[]) AS t(id, name, email)`,
    [profiles.map((p) => p[0]), profiles.map((p) => p[1]), profiles.map((p) => p[2])],
  );
  await client.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`);
  await client.query(
    `UPDATE profiles p SET role = t.role::app_role, full_name = t.name
       FROM unnest($1::uuid[], $2::text[], $3::text[]) AS t(id, name, role) WHERE p.id = t.id`,
    [profiles.map((p) => p[0]), profiles.map((p) => p[1]), profiles.map((p) => p[3])],
  );

  await insertMany(client, 'products', ['id', 'name', 'price'], ['uuid', 'text', 'numeric'],
    PRODUCTS.map((p) => [PRODUCT(p.id), p.name, centsToSql(p.price)]));
  await insertMany(client, 'plans', ['id', 'name', 'price', 'billing_period'], ['uuid', 'text', 'numeric', 'text'],
    PLANS.map((p) => [PLAN(p.id), p.name, centsToSql(p.price), p.period]));

  // --- subscriptions ------------------------------------------------------------
  const nSubs = LARGE ? 5000 : 14;
  const subs: { id: number; customer: string; plan: (typeof PLANS)[number]; status: string; lines: { product: number; qty: number; price: number }[] }[] = [];
  for (let i = 1; i <= nSubs; i++) {
    const plan = i <= 3 ? PLANS[1] : pick(PLANS);
    const customer = i <= 3 ? DEMO_USERS.customer : uuid(101 + int(0, nCustomers - 1));
    const r = rand();
    const status = i <= 6 ? 'Active' : r < 0.78 ? 'Active' : r < 0.88 ? 'Closed' : r < 0.94 ? 'Confirmed' : 'Quotation';
    const lines = [{ product: 1, qty: i === 1 ? 6 : int(1, 12), price: PRODUCTS[0].price }];
    if (rand() < 0.6) lines.push({ product: int(2, 5), qty: int(1, 3), price: 0 });
    for (const l of lines) l.price = PRODUCTS[l.product - 1].price;
    subs.push({ id: i, customer, plan, status, lines });
  }
  await insertMany(client, 'subscriptions', ['id', 'subscription_number', 'customer_id', 'plan_id', 'status', 'start_date'],
    ['uuid', 'text', 'uuid', 'uuid', 'text', 'date'],
    subs.map((s) => [SUB(s.id), `SUB-${String(s.id).padStart(5, '0')}`, s.customer, PLAN(s.plan.id), s.status, addDays(today, -200)]));
  await insertMany(client, 'subscription_items', ['subscription_id', 'product_id', 'quantity', 'unit_price'],
    ['uuid', 'uuid', 'int', 'numeric'],
    subs.flatMap((s) => s.lines.map((l) => [SUB(s.id), PRODUCT(l.product), l.qty, centsToSql(l.price)])));

  // --- invoices + payments -------------------------------------------------------
  // Each billable subscription gets one invoice per ~month for the last 6 months.
  const invoices: unknown[][] = [];
  const invLines: unknown[][] = [];
  const payments: unknown[][] = [];
  let invId = 0;
  const monthsBack = 6;

  // Hand-picked invoices for the demo customer so every page has something to show.
  const scripted: Record<number, { daysAgo: number; outcome: string }[]> = {
    1: [{ daysAgo: 150, outcome: 'paid' }, { daysAgo: 120, outcome: 'paid' }, { daysAgo: 75, outcome: 'overdue' }, { daysAgo: 25, outcome: 'partial' }],
    2: [{ daysAgo: 100, outcome: 'overdue' }, { daysAgo: 40, outcome: 'unpaid' }, { daysAgo: 5, outcome: 'unpaid' }],
    3: [{ daysAgo: 130, outcome: 'overdue' }, { daysAgo: 60, outcome: 'cancelled' }, { daysAgo: 1, outcome: 'draft' }],
  };

  for (const s of subs) {
    if (s.status === 'Quotation') continue;
    const plan = scripted[s.id] ?? Array.from({ length: monthsBack }, (_, m) => {
      const daysAgo = m * 30 + int(0, 10);
      const r = rand();
      const recent = daysAgo < 20;
      const outcome = r < 0.68 ? 'paid' : r < 0.78 ? 'partial' : r < 0.95 ? 'unpaid' : r < 0.98 ? 'cancelled' : recent ? 'draft' : 'unpaid';
      return { daysAgo, outcome };
    });
    for (const { daysAgo, outcome } of plan) {
      invId++;
      const invoiceDate = addDays(today, -daysAgo);
      const dueDate = addDays(invoiceDate, 15);
      const subtotal = s.lines.reduce((a, l) => a + l.qty * l.price, 0);
      const discount = s.id === 1 && daysAgo === 150 ? Math.round(s.lines[0].qty * s.lines[0].price * 0.1) : 0;
      const tax = Math.round((subtotal - discount) * TAX_RATE);
      const total = subtotal - discount + tax;
      const status = outcome === 'paid' ? 'Paid' : outcome === 'cancelled' ? 'Cancelled' : outcome === 'draft' ? 'Draft' : 'Confirmed';
      invoices.push([INV(invId), `INV-${String(invId).padStart(6, '0')}`, s.customer, SUB(s.id), status, invoiceDate, dueDate,
        centsToSql(subtotal), centsToSql(discount), centsToSql(tax), centsToSql(total)]);
      s.lines.forEach((l, idx) => {
        const lineSub = l.qty * l.price;
        const lineDisc = idx === 0 ? discount : 0;
        const lineTax = Math.round((lineSub - lineDisc) * TAX_RATE);
        invLines.push([INV(invId), PRODUCT(l.product), l.qty, centsToSql(l.price), centsToSql(lineTax), centsToSql(lineSub - lineDisc + lineTax)]);
      });

      const payDate = () => {
        const d = addDays(invoiceDate, int(0, 20));
        return d > today ? today : d;
      };
      if (outcome === 'paid') {
        if (rand() < 0.2) {
          const first = Math.round(total * 0.4);
          payments.push([INV(invId), s.customer, pick(METHODS), centsToSql(first), payDate(), DEMO_USERS.staff]);
          payments.push([INV(invId), s.customer, pick(METHODS), centsToSql(total - first), payDate(), DEMO_USERS.staff]);
        } else {
          payments.push([INV(invId), s.customer, pick(METHODS), centsToSql(total), payDate(), DEMO_USERS.staff]);
        }
      } else if (outcome === 'partial' || (outcome === 'overdue' && s.id === 1)) {
        payments.push([INV(invId), s.customer, pick(METHODS), centsToSql(Math.round(total * 0.5)), payDate(), DEMO_USERS.staff]);
      }
    }
  }

  await insertMany(client, 'invoices',
    ['id', 'invoice_number', 'customer_id', 'subscription_id', 'status', 'invoice_date', 'due_date', 'subtotal', 'discount_amount', 'tax_amount', 'total_amount'],
    ['uuid', 'text', 'uuid', 'uuid', 'text', 'date', 'date', 'numeric', 'numeric', 'numeric', 'numeric'], invoices);
  await insertMany(client, 'invoice_items',
    ['invoice_id', 'product_id', 'quantity', 'unit_price', 'tax_amount', 'line_total'],
    ['uuid', 'uuid', 'int', 'numeric', 'numeric', 'numeric'], invLines);
  await insertMany(client, 'payments',
    ['invoice_id', 'customer_id', 'method', 'amount', 'payment_date', 'recorded_by'],
    ['uuid', 'uuid', 'text', 'numeric', 'date', 'uuid'], payments);

  // --- discounts -------------------------------------------------------------------
  const disc = await client.query<{ id: number }>(
    `INSERT INTO discounts (name, code, type, value, scope, min_purchase, min_quantity, start_date, end_date, usage_limit, used_count, is_active, created_by) VALUES
      ('10% off for 5+ seats', 'SEATS10', 'PERCENT', 10, 'PRODUCT', 0, 5, $1, NULL, 1, 1, true, $5),
      ('Welcome 500 off', 'WELCOME500', 'FIXED', 500, 'SUBSCRIPTION', 2000, 0, $1, NULL, NULL, 0, true, $5),
      ('Diwali 15%', 'DIWALI15', 'PERCENT', 15, 'SUBSCRIPTION', 0, 0, $2, $3, 100, 0, true, $5),
      ('Black Friday 20% storage', 'BF20', 'PERCENT', 20, 'PRODUCT', 0, 0, $4, NULL, NULL, 0, true, $5),
      ('Old partner deal', 'PARTNER', 'FIXED', 1000, 'SUBSCRIPTION', 0, 0, $2, NULL, NULL, 0, false, $5)
     RETURNING id`,
    [addDays(today, -180), addDays(today, -60), addDays(today, -30), addDays(today, 20), DEMO_USERS.admin],
  );
  const [seats, , , bf] = disc.rows.map((r) => r.id);
  await client.query(`INSERT INTO discount_targets VALUES ($1, 'PRODUCT', $3), ($2, 'PRODUCT', $4)`, [seats, bf, PRODUCT(1), PRODUCT(2)]);
  // The seats discount was used once, on the demo customer's oldest invoice.
  const firstInv = await client.query<{ id: string; discount_amount: string }>(
    `SELECT id, discount_amount FROM invoices WHERE subscription_id = $1 ORDER BY invoice_date LIMIT 1`, [SUB(1)],
  );
  await client.query(`INSERT INTO discount_usages (discount_id, invoice_id, amount) VALUES ($1, $2, $3)`,
    [seats, firstInv.rows[0].id, firstInv.rows[0].discount_amount]);

  await client.query('ANALYZE');

  console.log(
    `Seeded ${profiles.length} profiles, ${subs.length} subscriptions, ${invoices.length} invoices, ${payments.length} payments in ${Date.now() - t0} ms`,
  );
  console.log(`Dev users: admin=${DEMO_USERS.admin} staff=${DEMO_USERS.staff} customer=${DEMO_USERS.customer}`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
