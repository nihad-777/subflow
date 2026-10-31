const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });

export const money = (n: number | null | undefined) => currency.format(n ?? 0);
export const moneyCompact = (n: number | null | undefined) => compact.format(n ?? 0);
export const date = (s: string | null | undefined) =>
  s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
export const startOfMonth = () => `${today().slice(0, 7)}-01`;
export const startOfYear = () => `${today().slice(0, 4)}-01-01`;
export const methodLabel = (m: string) =>
  ({ BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CARD: 'Card', UPI: 'UPI', CHEQUE: 'Cheque', OTHER: 'Other' })[m] ?? m;
