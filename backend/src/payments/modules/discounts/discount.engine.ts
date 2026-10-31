// Pure discount calculation. No database access: callers pass the candidate
// discounts in. All money is integer cents inside this file.
//
// Rules (say these out loud in the demo):
//   1. Each line gets at most ONE product discount: the eligible one giving the
//      largest reduction. PERCENT = line subtotal * value / 100.
//      FIXED = flat amount off the line (not per unit).
//   2. Then at most ONE subscription discount (the best) is applied to the
//      subtotal after product discounts, and spread across lines in proportion
//      to their net amount so tax can still be computed per line.
//   3. Nothing goes below zero. Every amount is rounded to whole cents.
//   4. Eligibility is judged on the invoice date only.

export type DiscountType = 'FIXED' | 'PERCENT';
export type DiscountScope = 'PRODUCT' | 'SUBSCRIPTION';

export interface DiscountRule {
  id: number;
  name: string;
  type: DiscountType;
  /** PERCENT: 0-100. FIXED: cents. */
  value: number;
  scope: DiscountScope;
  minPurchaseCents: number;
  minQuantity: number;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, null = no end */
  endDate: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  /** Empty = applies to everything in its scope. */
  targetIds: string[];
}

export interface EngineLine {
  lineId: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface EngineInput {
  subscriptionId: string;
  /** YYYY-MM-DD */
  invoiceDate: string;
  lines: EngineLine[];
  discounts: DiscountRule[];
}

export interface EngineLineResult {
  lineId: string;
  subtotalCents: number;
  discountId: number | null;
  productDiscountCents: number;
  invoiceDiscountShareCents: number;
  /** product discount + share of invoice discount */
  discountCents: number;
  netCents: number;
}

export interface EngineResult {
  subtotalCents: number;
  lines: EngineLineResult[];
  invoiceDiscount: { discountId: number; amountCents: number } | null;
  discountTotalCents: number;
  netTotalCents: number;
  /** One entry per discount actually used, with the total it took off. */
  used: { discountId: number; amountCents: number }[];
}

export function isDiscountLive(d: DiscountRule, on: string): boolean {
  if (!d.isActive) return false;
  if (d.startDate > on) return false;
  if (d.endDate && d.endDate < on) return false;
  if (d.usageLimit !== null && d.usedCount >= d.usageLimit) return false;
  return true;
}

function reduction(d: DiscountRule, baseCents: number): number {
  if (baseCents <= 0) return 0;
  const raw = d.type === 'PERCENT' ? Math.round((baseCents * d.value) / 100) : d.value;
  return Math.max(0, Math.min(raw, baseCents));
}

/** Splits `amount` across `weights` proportionally; shares always sum to `amount`. */
export function allocateProportionally(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / total);
  const shares = exact.map(Math.floor);
  let remainder = amount - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    shares[i] += 1;
    remainder -= 1;
  }
  return shares;
}

export function calculateDiscounts(input: EngineInput): EngineResult {
  const live = input.discounts.filter((d) => isDiscountLive(d, input.invoiceDate));
  const lineSubtotals = input.lines.map((l) => Math.max(0, l.quantity * l.unitPriceCents));
  const subtotalCents = lineSubtotals.reduce((a, b) => a + b, 0);
  const totalQuantity = input.lines.reduce((a, l) => a + l.quantity, 0);

  // 1. Product discounts, best one per line.
  const productRules = live.filter((d) => d.scope === 'PRODUCT' && subtotalCents >= d.minPurchaseCents);
  const lines: EngineLineResult[] = input.lines.map((line, idx) => {
    const base = lineSubtotals[idx];
    let best: { id: number; cents: number } | null = null;
    for (const d of productRules) {
      if (d.targetIds.length > 0 && !d.targetIds.includes(line.productId)) continue;
      if (line.quantity < d.minQuantity) continue;
      const cents = reduction(d, base);
      if (cents > 0 && (!best || cents > best.cents || (cents === best.cents && d.id < best.id))) {
        best = { id: d.id, cents };
      }
    }
    return {
      lineId: line.lineId,
      subtotalCents: base,
      discountId: best?.id ?? null,
      productDiscountCents: best?.cents ?? 0,
      invoiceDiscountShareCents: 0,
      discountCents: best?.cents ?? 0,
      netCents: base - (best?.cents ?? 0),
    };
  });

  // 2. One subscription discount on what is left.
  const afterProduct = lines.reduce((a, l) => a + l.netCents, 0);
  let invoiceDiscount: EngineResult['invoiceDiscount'] = null;
  for (const d of live) {
    if (d.scope !== 'SUBSCRIPTION') continue;
    if (d.targetIds.length > 0 && !d.targetIds.includes(input.subscriptionId)) continue;
    if (subtotalCents < d.minPurchaseCents || totalQuantity < d.minQuantity) continue;
    const cents = reduction(d, afterProduct);
    if (
      cents > 0 &&
      (!invoiceDiscount ||
        cents > invoiceDiscount.amountCents ||
        (cents === invoiceDiscount.amountCents && d.id < invoiceDiscount.discountId))
    ) {
      invoiceDiscount = { discountId: d.id, amountCents: cents };
    }
  }

  if (invoiceDiscount) {
    const shares = allocateProportionally(
      invoiceDiscount.amountCents,
      lines.map((l) => l.netCents),
    );
    lines.forEach((l, i) => {
      l.invoiceDiscountShareCents = shares[i];
      l.discountCents += shares[i];
      l.netCents -= shares[i];
    });
  }

  // 3. Usage summary, one entry per discount.
  const usedMap = new Map<number, number>();
  for (const l of lines) {
    if (l.discountId !== null) usedMap.set(l.discountId, (usedMap.get(l.discountId) ?? 0) + l.productDiscountCents);
  }
  if (invoiceDiscount) {
    usedMap.set(invoiceDiscount.discountId, (usedMap.get(invoiceDiscount.discountId) ?? 0) + invoiceDiscount.amountCents);
  }

  const discountTotalCents = lines.reduce((a, l) => a + l.discountCents, 0);
  return {
    subtotalCents,
    lines,
    invoiceDiscount,
    discountTotalCents,
    netTotalCents: subtotalCents - discountTotalCents,
    used: [...usedMap.entries()].map(([discountId, amountCents]) => ({ discountId, amountCents })),
  };
}
