import { describe, expect, it } from 'vitest';
import { allocateProportionally, calculateDiscounts, type DiscountRule } from '../src/payments/modules/discounts/discount.engine.js';
import { toCents, centsToSql } from '../src/payments/lib/money.js';

const rule = (over: Partial<DiscountRule>): DiscountRule => ({
  id: 1, name: 'd', type: 'PERCENT', value: 10, scope: 'PRODUCT', minPurchaseCents: 0, minQuantity: 0,
  startDate: '2026-01-01', endDate: null, usageLimit: null, usedCount: 0, isActive: true, targetIds: [], ...over,
});
const lines = [
  { lineId: 'a', productId: 'p1', quantity: 6, unitPriceCents: 100_00 }, // 600.00
  { lineId: 'b', productId: 'p2', quantity: 2, unitPriceCents: 50_00 }, // 100.00
];
const run = (discounts: DiscountRule[], invoiceDate = '2026-06-01', ls = lines) =>
  calculateDiscounts({ subscriptionId: 's7', invoiceDate, lines: ls, discounts });

describe('product discounts', () => {
  it('applies a percentage to the targeted line only', () => {
    const r = run([rule({ targetIds: ['p1'] })]);
    expect(r.lines[0]).toMatchObject({ discountId: 1, productDiscountCents: 60_00, netCents: 540_00 });
    expect(r.lines[1]).toMatchObject({ discountId: null, netCents: 100_00 });
    expect(r.discountTotalCents).toBe(60_00);
  });

  it('applies fixed amounts flat per line and floors at zero', () => {
    const r = run([rule({ type: 'FIXED', value: 150_00, targetIds: ['p2'] })]);
    expect(r.lines[1]).toMatchObject({ productDiscountCents: 100_00, netCents: 0 });
  });

  it('picks the single best discount per line', () => {
    const r = run([rule({ id: 1, value: 10 }), rule({ id: 2, type: 'FIXED', value: 80_00 })]);
    expect(r.lines[0]).toMatchObject({ discountId: 2, productDiscountCents: 80_00 }); // 80 > 60
    expect(r.lines[1]).toMatchObject({ discountId: 2, productDiscountCents: 80_00 }); // 80 > 10
    expect(r.used).toEqual([{ discountId: 2, amountCents: 160_00 }]);
  });

  it('respects min quantity per line', () => {
    const r = run([rule({ minQuantity: 5 })]);
    expect(r.lines[0].discountId).toBe(1);
    expect(r.lines[1].discountId).toBeNull();
  });

  it('respects min purchase on the invoice subtotal', () => {
    expect(run([rule({ minPurchaseCents: 700_00 })]).discountTotalCents).toBeGreaterThan(0);
    expect(run([rule({ minPurchaseCents: 700_01 })]).discountTotalCents).toBe(0);
  });
});

describe('eligibility', () => {
  it('uses the invoice date for start and end (inclusive)', () => {
    const d = rule({ startDate: '2026-06-01', endDate: '2026-06-30' });
    expect(run([d], '2026-05-31').discountTotalCents).toBe(0);
    expect(run([d], '2026-06-01').discountTotalCents).toBeGreaterThan(0);
    expect(run([d], '2026-06-30').discountTotalCents).toBeGreaterThan(0);
    expect(run([d], '2026-07-01').discountTotalCents).toBe(0);
  });

  it('skips inactive and exhausted discounts', () => {
    expect(run([rule({ isActive: false })]).discountTotalCents).toBe(0);
    expect(run([rule({ usageLimit: 1, usedCount: 1 })]).discountTotalCents).toBe(0);
    expect(run([rule({ usageLimit: 2, usedCount: 1 })]).discountTotalCents).toBeGreaterThan(0);
  });
});

describe('subscription discounts', () => {
  it('applies after product discounts and is spread across lines exactly', () => {
    const r = run([
      rule({ id: 1, targetIds: ['p1'] }), // -60 on line a
      rule({ id: 2, scope: 'SUBSCRIPTION', value: 10 }), // 10% of 640 = 64
    ]);
    expect(r.invoiceDiscount).toEqual({ discountId: 2, amountCents: 64_00 });
    const shares = r.lines.map((l) => l.invoiceDiscountShareCents);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(64_00);
    expect(r.netTotalCents).toBe(700_00 - 60_00 - 64_00);
  });

  it('only one subscription discount, the best', () => {
    const r = run([rule({ id: 5, scope: 'SUBSCRIPTION', type: 'FIXED', value: 50_00 }), rule({ id: 6, scope: 'SUBSCRIPTION', value: 20 })]);
    expect(r.invoiceDiscount).toEqual({ discountId: 6, amountCents: 140_00 });
  });

  it('targets subscriptions by id and uses total quantity for min quantity', () => {
    expect(run([rule({ scope: 'SUBSCRIPTION', targetIds: ['s8'] })]).invoiceDiscount).toBeNull();
    expect(run([rule({ scope: 'SUBSCRIPTION', targetIds: ['s7'] })]).invoiceDiscount).not.toBeNull();
    expect(run([rule({ scope: 'SUBSCRIPTION', minQuantity: 8 })]).invoiceDiscount).not.toBeNull();
    expect(run([rule({ scope: 'SUBSCRIPTION', minQuantity: 9 })]).invoiceDiscount).toBeNull();
  });

  it('never makes the invoice negative', () => {
    const r = run([rule({ scope: 'SUBSCRIPTION', type: 'FIXED', value: 10_000_00 })]);
    expect(r.netTotalCents).toBe(0);
    expect(r.lines.every((l) => l.netCents >= 0)).toBe(true);
  });
});

describe('rounding', () => {
  it('rounds percentages to whole cents', () => {
    const r = run([rule({ value: 33.33 })], '2026-06-01', [{ lineId: 'x', productId: 'p1', quantity: 1, unitPriceCents: 9_99 }]);
    expect(r.lines[0].productDiscountCents).toBe(333); // 3.3297 -> 3.33
  });

  it('allocates remainders so shares sum exactly', () => {
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportionally(0, [1, 2])).toEqual([0, 0]);
  });

  it('money helpers are exact', () => {
    expect(toCents('1180.00')).toBe(118000);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('10.005')).toBe(1001);
    expect(centsToSql(118005)).toBe('1180.05');
  });
});
