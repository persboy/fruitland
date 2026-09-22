import { describe, expect, it } from "vitest";
import { formatJalaliDate, toJalali } from "./jalali";

describe("jalali utils", () => {
  it("converts a known Gregorian (UTC) date to the correct Jalali date", () => {
    // 2024-03-19T21:00:00Z is 2024-03-20T00:30 in Tehran (UTC+3:30), i.e.
    // Gregorian calendar day 2024-03-20 in Tehran, which is 1403-01-01
    // (Nowruz / Farvardin 1st, 1403).
    const date = new Date("2024-03-19T21:00:00.000Z");
    const { jy, jm, jd } = toJalali(date);
    expect(jy).toBe(1403);
    expect(jm).toBe(1);
    expect(jd).toBe(1);
  });

  it("formats a Jalali date with Persian digits and month name", () => {
    const date = new Date("2024-03-19T21:00:00.000Z");
    expect(formatJalaliDate(date)).toBe("۱ فروردین ۱۴۰۳");
  });
});
