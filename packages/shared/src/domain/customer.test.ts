import { describe, expect, it } from "vitest";
import {
  customerListQuerySchema,
  customerStatusSchema,
  isValidCalendarDate,
  normalizeDigits,
  updateCustomerProfileSchema,
} from "./customer";

describe("customerListQuerySchema", () => {
  it("applies defaults: page 1, limit 20, status all, no search", () => {
    expect(customerListQuerySchema.parse({})).toEqual({ page: 1, limit: 20, status: "all" });
  });
  it("coerces numeric strings and accepts every status", () => {
    expect(customerListQuerySchema.parse({ page: "3", limit: "100", status: "inactive" })).toMatchObject({ page: 3, limit: 100, status: "inactive" });
    for (const status of ["active", "inactive", "all"]) expect(customerListQuerySchema.safeParse({ status }).success).toBe(true);
  });
  it.each([[{ page: "0" }], [{ page: "-1" }], [{ page: "1.5" }], [{ page: "abc" }], [{ limit: "0" }], [{ limit: "101" }], [{ limit: "1e9" }], [{ limit: "x" }], [{ status: "deleted" }], [{ status: "" }]])(
    "rejects %j (never clamps)",
    (q) => {
      expect(customerListQuerySchema.safeParse(q).success).toBe(false);
    },
  );
  it("search: trims, bounds to 50, empty becomes undefined, Persian digits become ASCII", () => {
    expect(customerListQuerySchema.parse({ search: "  علی  " }).search).toBe("علی");
    expect(customerListQuerySchema.parse({ search: "   " }).search).toBeUndefined();
    expect(customerListQuerySchema.parse({ search: "۰۹۱۲۳۴۵۶۷۸۹" }).search).toBe("09123456789");
    expect(customerListQuerySchema.safeParse({ search: "a".repeat(50) }).success).toBe(true);
    expect(customerListQuerySchema.safeParse({ search: "a".repeat(51) }).success).toBe(false);
  });
  it("cannot be used to override the role restriction (unknown keys are stripped)", () => {
    expect(customerListQuerySchema.parse({ role: "admin", isActive: "true" })).toEqual({ page: 1, limit: 20, status: "all" });
  });
});

describe("normalizeDigits", () => {
  it("maps Persian and Arabic-Indic digits only", () => {
    expect(normalizeDigits("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩ab1")).toBe("01234567890123456789ab1");
  });
});

describe("isValidCalendarDate", () => {
  it.each(["2000-01-01", "2024-02-29", "1999-12-31"])("accepts %s", (d) => expect(isValidCalendarDate(d)).toBe(true));
  it.each(["2023-02-29", "2024-13-01", "2024-00-10", "2024-04-31", "24-01-01", "2024/01/01", "2024-1-1", "", "abc"])("rejects %j", (d) =>
    expect(isValidCalendarDate(d)).toBe(false),
  );
});

describe("updateCustomerProfileSchema", () => {
  it("accepts any non-empty subset and trims names", () => {
    expect(updateCustomerProfileSchema.parse({ firstName: "  علی ", lastName: "رضایی", birthDate: "1990-05-17" })).toEqual({ firstName: "علی", lastName: "رضایی", birthDate: "1990-05-17" });
    expect(updateCustomerProfileSchema.parse({ birthDate: "2000-02-29" })).toEqual({ birthDate: "2000-02-29" });
    expect(updateCustomerProfileSchema.parse({ firstName: "" })).toEqual({ firstName: "" }); // clears
  });
  it("rejects an empty payload", () => {
    expect(updateCustomerProfileSchema.safeParse({}).success).toBe(false);
  });
  it("strips every field that is not firstName/lastName/birthDate", () => {
    const parsed = updateCustomerProfileSchema.parse({
      firstName: "علی", phone: "09120000000", role: "admin", isActive: false, customerCode: "12345", referralCode: "X", referredByUserId: "1",
      addresses: [], courierProfile: {}, passwordHash: "x", passwordFailedAttempts: 0, passwordLockedUntil: "2030-01-01",
    });
    expect(parsed).toEqual({ firstName: "علی" });
    expect(updateCustomerProfileSchema.safeParse({ phone: "09120000000", role: "admin" }).success).toBe(false); // nothing editable left
  });
  it.each([
    [{ birthDate: "2023-02-29" }], [{ birthDate: "1990-13-01" }], [{ birthDate: "1990/01/01" }], [{ birthDate: "" }], [{ birthDate: "1899-12-31" }],
    [{ birthDate: "2999-01-01" }], [{ birthDate: 19900101 }], [{ birthDate: null }], [{ firstName: "a".repeat(51) }], [{ lastName: "x".repeat(51) }],
    [{ firstName: "<b>x</b>" }], [{ firstName: 5 }],
  ])("rejects %j", (body) => {
    expect(updateCustomerProfileSchema.safeParse(body).success).toBe(false);
  });
  it("rejects a birth date in the future but accepts today", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(updateCustomerProfileSchema.safeParse({ birthDate: today }).success).toBe(true);
    const tomorrow = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
    expect(updateCustomerProfileSchema.safeParse({ birthDate: tomorrow }).success).toBe(false);
  });
});

describe("customerStatusSchema", () => {
  it("requires a real boolean", () => {
    expect(customerStatusSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(customerStatusSchema.parse({ isActive: true, role: "admin" })).toEqual({ isActive: true });
    for (const bad of [{}, { isActive: "true" }, { isActive: 1 }, { isActive: null }]) expect(customerStatusSchema.safeParse(bad).success).toBe(false);
  });
});
