import { describe, expect, it } from "vitest";
import { formatToman, parseTomanInput, toEnglishDigits } from "./format";

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
