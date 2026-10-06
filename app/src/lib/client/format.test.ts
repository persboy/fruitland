import { describe, expect, it } from "vitest";
import { formatNumberInput, formatToman, parseTomanInput, toEnglishDigits } from "./format";

describe("parseTomanInput", () => {
  it("parses ASCII, Persian and Arabic digits and separators", () => {
    expect(parseTomanInput("25000")).toBe(25000);
    expect(parseTomanInput("۲۵٬۰۰۰")).toBe(25000);
    expect(parseTomanInput("٥٠٠,٠٠٠")).toBe(500000);
    expect(parseTomanInput("0")).toBe(0);
  });
  it("returns null (never 0) for empty or non-integer input", () => {
    expect(parseTomanInput("")).toBeNull();
    expect(parseTomanInput("12.5")).toBeNull();
    expect(parseTomanInput("-3")).toBeNull();
    expect(parseTomanInput("abc")).toBeNull();
  });
});

describe("formatting", () => {
  it("converts digits and formats Toman in Persian", () => {
    expect(toEnglishDigits("۰۹۱۲")).toBe("0912");
    expect(formatToman(130000)).toBe("۱۳۰٬۰۰۰ تومان");
  });
});

describe("formatNumberInput", () => {
  it("adds the Persian separator, strips non-digits and leading zeros, and round-trips", () => {
    expect(formatNumberInput("25000")).toBe("۲۵٬۰۰۰");
    expect(formatNumberInput("۲۵٬۰۰۰")).toBe("۲۵٬۰۰۰");
    expect(formatNumberInput("0007")).toBe("۷");
    expect(formatNumberInput("0")).toBe("۰");
    expect(formatNumberInput("abc")).toBe("");
    expect(parseTomanInput(formatNumberInput("1234567"))).toBe(1234567);
  });
});

describe("Jalali date helpers", () => {
  it("formatJalaliDate renders Persian digits in the Persian calendar (Tehran)", async () => {
    const { formatJalaliDate, formatJalaliDateTime, formatJalaliCalendarDate } = await import("./format");
    expect(formatJalaliDate("2026-03-21T12:00:00.000Z")).toMatch(/۱۴۰۵/);
    expect(formatJalaliDateTime("2026-03-21T12:00:00.000Z")).toMatch(/[۰-۹]/);
    expect(formatJalaliCalendarDate("1990-05-17")).toMatch(/۱۳۶۹/);
  });
  it("a calendar date does not shift with the timezone (UTC date-only)", async () => {
    const { formatJalaliCalendarDate } = await import("./format");
    expect(formatJalaliCalendarDate("2026-03-21")).toBe(formatJalaliCalendarDate("2026-03-21"));
    expect(formatJalaliCalendarDate("2026-03-20")).not.toBe(formatJalaliCalendarDate("2026-03-21"));
  });
});
