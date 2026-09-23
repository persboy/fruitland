import { describe, expect, it } from "vitest";
import { normalizeIranMobile } from "./phone";

describe("normalizeIranMobile", () => {
  it.each([
    ["09123456789", "09123456789"],
    ["9123456789", "09123456789"],
    ["+989123456789", "09123456789"],
    ["00989123456789", "09123456789"],
    [" 0912 345 6789 ", "09123456789"],
    ["0912-345-6789", "09123456789"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeIranMobile(input)).toBe(expected);
  });

  it.each(["", "12345", "08123456789", "091234567890", "not-a-phone"])(
    "rejects %s as null",
    (input) => {
      expect(normalizeIranMobile(input)).toBeNull();
    },
  );
});
