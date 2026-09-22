/**
 * Money is always an integer number of Toman. Never use floating point for
 * money. All functions here operate on / return integers and throw on
 * non-integer input to catch mistakes early.
 */

export type Toman = number;

export function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer Toman value, received: ${value}`);
  }
}

export function addToman(...values: Toman[]): Toman {
  return values.reduce((sum, v) => {
    assertInteger(v, "addToman operand");
    return sum + v;
  }, 0);
}

export function subtractToman(a: Toman, b: Toman): Toman {
  assertInteger(a, "subtractToman a");
  assertInteger(b, "subtractToman b");
  return a - b;
}

/**
 * Applies a percentage discount (0-100) to an amount, rounding down to the
 * nearest Toman so the store never gives away more than the configured
 * percentage.
 */
export function applyPercentageDiscount(amount: Toman, percentage: number): Toman {
  assertInteger(amount, "applyPercentageDiscount amount");
  if (percentage < 0 || percentage > 100) {
    throw new Error(`percentage must be between 0 and 100, received: ${percentage}`);
  }
  const discount = Math.floor((amount * percentage) / 100);
  return amount - discount;
}

export function capDiscount(discountAmount: Toman, maxDiscount: Toman | null | undefined): Toman {
  assertInteger(discountAmount, "capDiscount discountAmount");
  if (maxDiscount == null) return discountAmount;
  assertInteger(maxDiscount, "capDiscount maxDiscount");
  return Math.min(discountAmount, maxDiscount);
}

/** Formats an integer Toman value with Persian digit grouping, e.g. 130000 -> "۱۳۰,۰۰۰". */
export function formatToman(amount: Toman): string {
  assertInteger(amount, "formatToman amount");
  const grouped = amount.toLocaleString("en-US");
  return toPersianDigits(grouped);
}

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}
