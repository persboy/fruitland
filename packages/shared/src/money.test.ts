import { describe, expect, it } from "vitest";
import {
  addToman,
  applyPercentageDiscount,
  assertInteger,
  capDiscount,
  formatToman,
  subtractToman,
  toPersianDigits,
} from "./money";

describe("money utils", () => {
  it("rejects non-integer amounts", () => {
    expect(() => assertInteger(10.5, "test")).toThrow();
    expect(() => assertInteger(10, "test")).not.toThrow();
  });

  it("adds integer Toman values", () => {
    expect(addToman(1000, 2000, 3000)).toBe(6000);
  });

  it("throws when adding a non-integer", () => {
    expect(() => addToman(1000, 2.5)).toThrow();
  });

  it("subtracts integer Toman values", () => {
    expect(subtractToman(5000, 2000)).toBe(3000);
  });

  it("applies a percentage discount rounding down", () => {
    // 10% of 999 = 99.9 -> floor to 99 -> 900
    expect(applyPercentageDiscount(999, 10)).toBe(900);
    expect(applyPercentageDiscount(100000, 20)).toBe(80000);
  });

  it("rejects out-of-range percentages", () => {
    expect(() => applyPercentageDiscount(1000, 101)).toThrow();
    expect(() => applyPercentageDiscount(1000, -1)).toThrow();
  });

  it("caps a discount at the maximum when provided", () => {
    expect(capDiscount(50000, 20000)).toBe(20000);
    expect(capDiscount(5000, 20000)).toBe(5000);
    expect(capDiscount(5000, null)).toBe(5000);
    expect(capDiscount(5000, undefined)).toBe(5000);
  });

  it("formats Toman with Persian digits and grouping", () => {
    expect(formatToman(130000)).toBe("۱۳۰,۰۰۰");
  });

  it("converts arabic digits to persian digits", () => {
    expect(toPersianDigits("2026")).toBe("۲۰۲۶");
  });
});
