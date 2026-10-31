// Invoice list, detail and actions (confirm, cancel, send, PDF).
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import { query, queryOne, withTransaction } from '../payments/lib/db.js';
import { conflict, notFound } from '../payments/lib/errors.js';
import { releaseDiscountUsage } from '../payments/modules/discounts/discount.service.js';
import type { AuthUser } from '../payments/middleware/auth.js';

const LIST = `
  SELECT i.id, i.invoice_number AS number, i.status, i.customer_id AS "customerId", c.full_name AS "customerName", c.email AS "customerEmail",
         s.subscription_number AS "subscriptionNumber", i.invoice_date AS "invoiceDate", i.due_date AS "dueDate",
         i.billing_period_start AS "periodStart", i.billing_period_end AS "periodEnd",
         i.subtotal::float AS subtotal, i.tax_amount::float AS "taxAmount", i.discount_amount::float AS "discountAmount",
         i.total_amount::float AS total, i.sent_at AS "sentAt",
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'POSTED'), 0)::float AS "amountPaid"
    FROM invoices i JOIN profiles c ON c.id = i.customer_id LEFT JOIN subscriptions s ON s.id = i.subscription_id`;

export async function listInvoices(f: { status?: string; q?: string; customerId?: string; offset: number; limit: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.status) add('i.status = ?', f.status);
  if (f.customerId) add('i.customer_id = ?', f.customerId);
  if (f.q) add(`(i.invoice_number || ' ' || c.full_name) ILIKE ?`, `%${f.q}%`);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [items, count] = await Promise.all([
    query(`${LIST} ${clause} ORDER BY i.invoice_date DESC, i.created_at DESC, i.id LIMIT ${f.limit} OFFSET ${f.offset}`, params),
    queryOne(`SELECT count(*)::int AS n FROM invoices i JOIN profiles c ON c.id = i.customer_id ${clause}`, params),
  ]);
  return { items, total: count!.n };
}

export async function getInvoice(id: string, actor: AuthUser) {
  const invoice = await queryOne(`${LIST} WHERE i.id = $1`, [id]);
  // Customers get a plain "not found" for anyone else's invoice, even with a real id.
  if (!invoice || (actor.role === 'CUSTOMER' && invoice.customerId !== actor.id)) throw notFound('Invoice');
  const lines = await query(
    `SELECT description, quantity::float AS quantity, unit_price::float AS "unitPrice", tax_rate::float AS "taxRate",
            tax_amount::float AS "taxAmount", line_total::float AS "lineTotal"
       FROM invoice_items WHERE invoice_id = $1`, [id]);
  const outstanding = invoice.status === 'cancelled' ? 0 : Math.max(0, Math.round((invoice.total - invoice.amountPaid) * 100) / 100);
  return { ...invoice, lines, outstanding };
}

export async function confirmInvoice(id: string, actor: AuthUser) {
  const row = await queryOne(`UPDATE invoices SET status = 'confirmed', updated_at = now() WHERE id = $1 AND status = 'draft' RETURNING id`, [id]);
  if (!row) throw conflict('ILLEGAL_TRANSITION', 'Only a draft invoice can be confirmed');
  return getInvoice(id, actor);
}

export async function cancelInvoice(id: string, actor: AuthUser) {
  await withTransaction(async (tx) => {
    const invoice = await queryOne('SELECT status FROM invoices WHERE id = $1 FOR UPDATE', [id], tx);
    if (!invoice) throw notFound('Invoice');
    if (!['draft', 'confirmed'].includes(invoice.status)) throw conflict('ILLEGAL_TRANSITION', `A ${invoice.status} invoice cannot be cancelled`);
    const paid = await queryOne(`SELECT 1 FROM payments WHERE invoice_id = $1 AND status = 'POSTED' LIMIT 1`, [id], tx);
    if (paid) throw conflict('HAS_PAYMENTS', 'Void the payments on this invoice first');
    await releaseDiscountUsage(tx, id);
    await tx.query(`UPDATE invoices SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
  });
  return getInvoice(id, actor);
}

const inr = (n: number) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function invoicePdf(inv: Awaited<ReturnType<typeof getInvoice>>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).fillColor('#176b50').text('Subflow');
    doc.moveDown(0.5).fontSize(16).fillColor('#17241f').text(`Invoice ${inv.number}`);
    doc.fontSize(10).fillColor('#555').text(`Status: ${inv.status}`);
    doc.moveDown().fillColor('#17241f')
      .text(`Bill to: ${inv.customerName || inv.customerEmail}`).text(inv.customerEmail)
      .moveDown(0.5).text(`Invoice date: ${inv.invoiceDate}`).text(`Due date: ${inv.dueDate}`)
      .text(`Billing period: ${inv.periodStart} to ${inv.periodEnd}`);
    if (inv.subscriptionNumber) doc.text(`Subscription: ${inv.subscriptionNumber}`);

    const row = (y: number, cols: string[]) => {
      doc.text(cols[0], 50, y, { width: 210 });
      doc.text(cols[1], 262, y, { width: 40, align: 'right' });
      doc.text(cols[2], 305, y, { width: 90, align: 'right' });
      doc.text(cols[3], 398, y, { width: 42, align: 'right' });
      doc.text(cols[4], 445, y, { width: 100, align: 'right' });
    };
    let y = doc.y + 24;
    doc.font('Helvetica-Bold');
    row(y, ['Item', 'Qty', 'Unit price', 'Tax', 'Amount']);
    doc.font('Helvetica');
    y += 20;
    for (const l of inv.lines) {
      row(y, [l.description, String(l.quantity), inr(l.unitPrice), `${l.taxRate}%`, inr(l.lineTotal)]);
      y += 20;
    }
    const total = (label: string, value: string) => {
      y += 16;
      doc.text(label, 305, y, { width: 135, align: 'right' });
      doc.text(value, 445, y, { width: 100, align: 'right' });
    };
    y += 8;
    total('Subtotal', inr(inv.subtotal));
    total('Discount', `- ${inr(inv.discountAmount)}`);
    total('Tax', inr(inv.taxAmount));
    doc.font('Helvetica-Bold');
    total('Total', inr(inv.total));
    doc.font('Helvetica');
    total('Paid', inr(inv.amountPaid));
    doc.font('Helvetica-Bold');
    total('Outstanding', inr(inv.outstanding));
    doc.end();
  });
}

/** With no SMTP_URL set, the message is built but goes nowhere, so demos work without a mail account. */
function mailer() {
  return process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : nodemailer.createTransport({ jsonTransport: true });
}

export async function sendInvoice(id: string, actor: AuthUser) {
  const inv = await getInvoice(id, actor);
  if (!['confirmed', 'paid'].includes(inv.status)) throw conflict('ILLEGAL_TRANSITION', 'Confirm the invoice before sending it');
  await mailer().sendMail({
    from: process.env.MAIL_FROM || 'billing@subflow.app',
    to: inv.customerEmail,
    subject: `Invoice ${inv.number} from Subflow`,
    text: `Hello ${inv.customerName || ''},\n\nYour invoice ${inv.number} for ${inr(inv.total)} is attached. It is due on ${inv.dueDate}.\n\nThank you,\nSubflow`,
    attachments: [{ filename: `${inv.number.replaceAll('/', '-')}.pdf`, content: await invoicePdf(inv) }],
  });
  const emailed = Boolean(process.env.SMTP_URL);
  if (emailed) await query('UPDATE invoices SET sent_at = now() WHERE id = $1', [id]);
  return { ...(await getInvoice(id, actor)), emailed };
}
