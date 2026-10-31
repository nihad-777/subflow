import { z } from 'zod';
import { pool, query, queryOne, withTransaction, type Db } from '../../lib/db.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { centsToSql, fromCents, hasAtMostTwoDecimals, money, toCents } from '../../lib/money.js';
import { isValidDate, todayStr } from '../../lib/dates.js';
import { parse } from '../../lib/http.js';
import type { AuthUser } from '../../middleware/auth.js';
import { amountPaid, lockInvoice, setInvoiceStatus } from '../../integrations/invoices.js';

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'UPI', 'CHEQUE', 'OTHER'] as const;

const fmt = (cents: number) =>
  fromCents(cents).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Balance (the one formula used everywhere)
//   amount_paid  = SUM(posted payments)
//   outstanding  = total - amount_paid
//   overdue      = CONFIRMED AND due_date < today AND outstanding > 0
// ---------------------------------------------------------------------------

export async function invoiceBalance(invoiceId: string, db: Db = pool) {
  const row = await queryOne(
    `SELECT i.id, i.invoice_number, i.customer_id, i.status, i.invoice_date, i.due_date, i.total_amount,
            COALESCE(pp.paid, 0) AS paid, (CURRENT_DATE - i.due_date) AS days_past_due
       FROM invoices i
       LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payments p WHERE p.invoice_id = i.id AND p.status = 'POSTED') pp ON true
      WHERE i.id = $1`,
    [invoiceId],
    db,
  );
  if (!row) return null;
  const totalC = toCents(row.total_amount);
  const paidC = toCents(row.paid);
  const outstandingC = row.status === 'cancelled' ? 0 : Math.max(0, totalC - paidC);
  const isOverdue = row.status === 'confirmed' && row.days_past_due > 0 && outstandingC > 0;
  return {
    invoiceId: row.id as string,
    number: row.invoice_number as string,
    customerId: row.customer_id as string,
    status: row.status as string,
    invoiceDate: row.invoice_date as string,
    dueDate: row.due_date as string,
    total: fromCents(totalC),
    amountPaid: fromCents(paidC),
    outstanding: fromCents(outstandingC),
    isPartiallyPaid: paidC > 0 && outstandingC > 0,
    isOverdue,
    daysOverdue: isOverdue ? (row.days_past_due as number) : 0,
  };
}

export async function getBalanceFor(user: AuthUser, invoiceId: string) {
  const b = await invoiceBalance(invoiceId);
  // Customers only see their own invoices; 404 (not 403) so ids can't be probed.
  if (!b || (user.role === 'CUSTOMER' && b.customerId !== user.id)) throw notFound('Invoice');
  return b;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const SELECT_PAYMENT = `
  SELECT p.*, i.invoice_number, c.full_name AS customer_name,
         r.full_name AS recorded_by_name, v.full_name AS voided_by_name
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    JOIN profiles c ON c.id = p.customer_id
    LEFT JOIN profiles r ON r.id = p.recorded_by
    LEFT JOIN profiles v ON v.id = p.voided_by`;

function serializePayment(p: any) {
  return {
    id: p.id,
    invoiceId: p.invoice_id,
    invoiceNumber: p.invoice_number,
    customer: { id: p.customer_id, name: p.customer_name },
    method: p.method,
    amount: money(p.amount),
    paymentDate: p.payment_date,
    reference: p.reference,
    note: p.note,
    status: p.status,
    recordedBy: p.recorded_by ? { id: p.recorded_by, name: p.recorded_by_name } : null,
    voidReason: p.void_reason,
    voidedBy: p.voided_by ? { id: p.voided_by, name: p.voided_by_name } : null,
    voidedAt: p.voided_at,
    createdAt: p.created_at,
  };
}

async function findPayment(id: number, db: Db = pool) {
  const p = await queryOne(`${SELECT_PAYMENT} WHERE p.id = $1`, [id], db);
  return p ? serializePayment(p) : null;
}

// ---------------------------------------------------------------------------
// Record a payment (idempotent, row-locked, no overpayment)
// ---------------------------------------------------------------------------

const moneyInput = z
  .union([z.number(), z.string()])
  .refine((v) => hasAtMostTwoDecimals(v), 'Use at most 2 decimal places')
  .transform((v) => toCents(v))
  .refine((c) => c > 0, 'Amount must be greater than 0');

export const recordPaymentSchema = z.object({
  invoiceId: z.string().uuid('Pick an invoice'),
  method: z.enum(PAYMENT_METHODS),
  amount: moneyInput, // -> cents
  paymentDate: z
    .string()
    .refine(isValidDate, 'Use a valid YYYY-MM-DD date')
    .refine((d) => d <= todayStr(), 'Payment date cannot be in the future')
    .optional(),
  reference: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(500).nullish(),
  idempotencyKey: z.string().trim().min(8).max(100).nullish(),
});

export async function recordPayment(body: unknown, user: AuthUser) {
  const input = parse(recordPaymentSchema, body);
  const key = input.idempotencyKey ?? null;

  const replay = async (db: Db) => {
    if (!key) return null;
    const existing = await queryOne(`SELECT id, invoice_id, amount FROM payments WHERE idempotency_key = $1`, [key], db);
    if (!existing) return null;
    if (existing.invoice_id !== input.invoiceId || toCents(existing.amount) !== input.amount) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different payment');
    }
    return { replayed: true, payment: (await findPayment(existing.id, db))!, invoice: (await invoiceBalance(existing.invoice_id, db))! };
  };

  // Fast path for double clicks / retries.
  const early = await replay(pool);
  if (early) return early;

  return withTransaction(async (tx) => {
    const invoice = await lockInvoice(tx, input.invoiceId);
    if (!invoice) throw notFound('Invoice');

    // A concurrent request with the same key may have committed while we waited for the lock.
    const late = await replay(tx);
    if (late) return late;

    if (invoice.status !== 'confirmed') {
      const why: Record<string, string> = {
        Draft: 'Invoice is still a draft; confirm it before taking payment',
        Paid: 'Invoice is already fully paid',
        Cancelled: 'Invoice is cancelled',
      };
      throw conflict('INVOICE_NOT_PAYABLE', why[invoice.status] ?? 'Invoice cannot take payments', { status: invoice.status });
    }

    const outstanding = toCents(invoice.total) - toCents(await amountPaid(invoice.id, tx));
    if (input.amount > outstanding) {
      throw badRequest('OVERPAYMENT', `Amount exceeds the outstanding balance of ${fmt(outstanding)}`, {
        outstanding: fromCents(outstanding),
      });
    }

    const inserted = await queryOne<{ id: number }>(
      `INSERT INTO payments (invoice_id, customer_id, method, amount, payment_date, reference, note, idempotency_key, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [invoice.id, invoice.customer_id, input.method, centsToSql(input.amount), input.paymentDate ?? todayStr(),
        input.reference ?? null, input.note ?? null, key, user.id],
      tx,
    );
    if (!inserted) {
      // Same key used concurrently on another invoice; the winner is committed by now.
      const r = await replay(tx);
      if (r) return r;
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used');
    }

    if (input.amount === outstanding) await setInvoiceStatus(tx, invoice.id, 'paid');

    return { replayed: false, payment: (await findPayment(inserted.id, tx))!, invoice: (await invoiceBalance(invoice.id, tx))! };
  });
}

// ---------------------------------------------------------------------------
// Void (admin). Never deletes: keeps the audit trail.
// ---------------------------------------------------------------------------

export const voidSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });

export async function voidPayment(paymentId: number, body: unknown, user: AuthUser) {
  const { reason } = parse(voidSchema, body);
  const head = await queryOne<{ invoice_id: string }>('SELECT invoice_id FROM payments WHERE id = $1', [paymentId]);
  if (!head) throw notFound('Payment');

  return withTransaction(async (tx) => {
    // Same lock order as recordPayment (invoice first) so the two never deadlock.
    const invoice = await lockInvoice(tx, head.invoice_id);
    const payment = await queryOne('SELECT id, status FROM payments WHERE id = $1 FOR UPDATE', [paymentId], tx);
    if (!invoice || !payment) throw notFound('Payment');
    if (payment.status === 'VOIDED') throw conflict('ALREADY_VOIDED', 'Payment is already voided');

    await tx.query(
      `UPDATE payments SET status = 'VOIDED', void_reason = $2, voided_by = $3, voided_at = now() WHERE id = $1`,
      [paymentId, reason, user.id],
    );
    const outstanding = toCents(invoice.total) - toCents(await amountPaid(invoice.id, tx));
    if (invoice.status === 'paid' && outstanding > 0) await setInvoiceStatus(tx, invoice.id, 'confirmed');

    return { payment: (await findPayment(paymentId, tx))!, invoice: (await invoiceBalance(invoice.id, tx))! };
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface PaymentFilters {
  from?: string;
  to?: string;
  method?: string;
  customerId?: string;
  invoiceId?: string;
  status?: string;
  q?: string;
}

function buildWhere(f: PaymentFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  for (const d of [f.from, f.to]) if (d && !isValidDate(d)) throw badRequest('VALIDATION_ERROR', 'Dates must be YYYY-MM-DD');
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.from) add('p.payment_date >= ?', f.from);
  if (f.to) add('p.payment_date <= ?', f.to);
  if (f.method) add('p.method = ?', f.method.toUpperCase());
  if (f.customerId) add('p.customer_id = ?::uuid', f.customerId);
  if (f.invoiceId) add('p.invoice_id = ?::uuid', f.invoiceId);
  if (f.status) add('p.status = ?', f.status.toUpperCase());
  if (f.q) {
    params.push(`%${f.q}%`);
    const n = `$${params.length}`;
    where.push(`(i.invoice_number ILIKE ${n} OR c.full_name ILIKE ${n} OR p.reference ILIKE ${n})`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function listPayments(f: PaymentFilters, page: { offset: number; limit: number }) {
  const { sql, params } = buildWhere(f);
  const [rows, totals] = await Promise.all([
    query(`${SELECT_PAYMENT} ${sql} ORDER BY p.payment_date DESC, p.id DESC LIMIT ${page.limit} OFFSET ${page.offset}`, params),
    queryOne(
      `SELECT count(*)::int AS n,
              COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'POSTED'), 0) AS posted_total
         FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN profiles c ON c.id = p.customer_id ${sql}`,
      params,
    ),
  ]);
  return { total: totals!.n, postedAmount: money(totals!.posted_total), items: rows.map(serializePayment) };
}

export async function getPayment(id: number) {
  const p = await findPayment(id);
  if (!p) throw notFound('Payment');
  return p;
}

/** Invoices that can take a payment, for the Record payment picker. */
export async function payableInvoices(q: string | undefined, limit = 20) {
  const params: unknown[] = [];
  let filter = '';
  if (q) {
    params.push(`%${q}%`);
    filter = `AND (i.invoice_number ILIKE $1 OR c.full_name ILIKE $1 OR c.email ILIKE $1)`;
  }
  const rows = await query(
    `SELECT i.id, i.invoice_number, i.due_date, i.total_amount, c.id AS customer_id, c.full_name,
            COALESCE(pp.paid, 0) AS paid
       FROM invoices i
       JOIN profiles c ON c.id = i.customer_id
       LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payments p WHERE p.invoice_id = i.id AND p.status = 'POSTED') pp ON true
      WHERE i.status = 'confirmed' ${filter}
      ORDER BY i.due_date ASC, i.id ASC
      LIMIT ${limit}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.invoice_number,
    dueDate: r.due_date,
    customer: { id: r.customer_id, name: r.full_name },
    total: money(r.total_amount),
    amountPaid: money(r.paid),
    outstanding: fromCents(toCents(r.total_amount) - toCents(r.paid)),
    isOverdue: r.due_date < todayStr(),
  }));
}
