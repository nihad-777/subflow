export type DiscountStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'EXHAUSTED' | 'INACTIVE';

export interface Discount {
  id: number;
  name: string;
  code: string | null;
  type: 'FIXED' | 'PERCENT';
  value: number;
  scope: 'PRODUCT' | 'SUBSCRIPTION';
  minPurchase: number;
  minQuantity: number;
  startDate: string;
  endDate: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  status: DiscountStatus;
  appliesToAll: boolean;
  targetIds: string[];
}

export interface DiscountDetail extends Discount {
  usages: { invoiceId: string; invoiceNumber: string; invoiceDate: string; invoiceStatus: string; customer: { id: string; name: string }; amount: number; usedAt: string }[];
}

export interface Payment {
  id: number;
  invoiceId: string;
  invoiceNumber: string;
  customer: { id: string; name: string };
  method: string;
  amount: number;
  paymentDate: string;
  reference: string | null;
  note: string | null;
  status: 'POSTED' | 'VOIDED';
  recordedBy: { id: string; name: string } | null;
  voidReason: string | null;
}

export interface Balance {
  invoiceId: string;
  number: string;
  status: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  outstanding: number;
  isPartiallyPaid: boolean;
  isOverdue: boolean;
  daysOverdue: number;
}

export interface PayableInvoice {
  id: string;
  number: string;
  dueDate: string;
  customer: { id: string; name: string };
  total: number;
  amountPaid: number;
  outstanding: number;
  isOverdue: boolean;
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}
