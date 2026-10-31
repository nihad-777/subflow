// All arithmetic happens in integer cents. Never sum JS floats.
// Postgres numeric comes back from pg as a string, e.g. "1180.00".

export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const s = typeof value === 'number' ? value.toFixed(6) : String(value).trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Not a money value: ${value}`);
  const [, neg, whole = '', frac = ''] = m;
  const padded = (frac + '000').slice(0, 3);
  let cents = Number(whole || '0') * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1; // half up on the third decimal
  return neg ? -cents : cents;
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Cents -> exact decimal string for SQL parameters, e.g. 118000 -> "1180.00". */
export function centsToSql(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const money = (v: string | number | null | undefined) => fromCents(toCents(v));

/** True if the value has at most 2 decimal places. */
export function hasAtMostTwoDecimals(value: number | string): boolean {
  return /^-?\d+(\.\d{1,2})?$/.test(String(value));
}
