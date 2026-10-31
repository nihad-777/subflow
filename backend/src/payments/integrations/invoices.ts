// INTEGRATION SEAM with the invoice owner's module.
// Everything this module reads from or writes to `invoices` goes through here,
// so merging means changing this one file if the real table differs.
import { queryOne, type Db, type Tx } from '../lib/db.js';

// Status strings follow Member 3's invoice lifecycle (database/subscriptions_billing.md).
export type InvoiceStatus = 'Draft' | 'Confirmed' | 'Paid' | 'Cancelled';

export interface LockedInvoice {
  id: string;
  number: string;
  customer_id: string;
  status: InvoiceStatus;
  total: string;
  due_date: string;
}

/** Locks the invoice row for the rest of the transaction (serialises payments on one invoice). */
export function lockInvoice(tx: Tx, invoiceId: string) {
  return queryOne<LockedInvoice>(
    'SELECT id, invoice_number AS number, customer_id, status, total_amount AS total, due_date FROM invoices WHERE id = $1 FOR UPDATE',
    [invoiceId],
    tx,
  );
}

/**
 * Payments flips CONFIRMED -> PAID when fully paid, and PAID -> CONFIRMED when a
 * payment is voided. If the invoice owner prefers a service call (e.g. to write
 * an audit log), replace the body of this function with that call.
 */
export async function setInvoiceStatus(tx: Tx, invoiceId: string, status: InvoiceStatus) {
  await tx.query('UPDATE invoices SET status = $2 WHERE id = $1', [invoiceId, status]);
}

/** Sum of POSTED payments for one invoice, as a numeric string. */
export async function amountPaid(invoiceId: string, db: Db): Promise<string> {
  const row = await queryOne<{ paid: string }>(
    `SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS paid FROM payments WHERE invoice_id = $1 AND status = 'POSTED'`,
    [invoiceId],
    db,
  );
  return row!.paid;
}
