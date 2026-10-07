import { describe, expect, it } from "vitest";
import {
  computeDiscountCodeStatus,
  createDiscountCodeSchema,
  discountCodeListQuerySchema,
  discountCodeSchema,
  discountCodeStatusSchema,
  DISCOUNT_CODE_STATUS_FILTERS,
  DISCOUNT_CODE_TYPE_FILTERS,
  generateDiscountCode,
  isValidDiscountCode,
  updateDiscountCodeSchema,
} from "./discountCode";

const OWNER = "64b7f0c2a1b2c3d4e5f60718";
const valid = { code: "welcome10", type: "public", percentage: 10 };
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? "" : r.error!.issues.map((i) => i.message).join("|"));

describe("discount code normalisation and format", () => {
  it("uppercases and trims", () => expect(discountCodeSchema.parse("  welcome10 ")).toBe("WELCOME10"));
  it("converts Persian and Arabic-Indic digits to ASCII", () => {
    expect(discountCodeSchema.parse("off۱۲۳")).toBe("OFF123");
    expect(discountCodeSchema.parse("off١٢٣")).toBe("OFF123");
  });
  it.each(["AB", "A", ""])("rejects a code shorter than 3: %j", (c) => expect(discountCodeSchema.safeParse(c).success).toBe(false));
  it("accepts exactly 3 and exactly 30 characters; rejects 31", () => {
    expect(discountCodeSchema.safeParse("ABC").success).toBe(true);
    expect(discountCodeSchema.safeParse("A".repeat(30)).success).toBe(true);
    expect(discountCodeSchema.safeParse("A".repeat(31)).success).toBe(false);
  });
  it("accepts underscore and hyphen", () => expect(discountCodeSchema.parse("a_b-c")).toBe("A_B-C"));
  it.each(["AB C", "AB.C", "AB/C", "ABC!", "کد-تخفیف", "AB$C", "AB%C", "<ABC>", "AB\nC"])("rejects forbidden characters: %j", (c) =>
    expect(discountCodeSchema.safeParse(c).success).toBe(false),
  );
  it("rejects non-strings", () => {
    expect(discountCodeSchema.safeParse(undefined).success).toBe(false);
    expect(discountCodeSchema.safeParse(123).success).toBe(false);
  });
  it("isValidDiscountCode checks the normalised form", () => {
    expect(isValidDiscountCode("ABC")).toBe(true);
    expect(isValidDiscountCode("abc")).toBe(false);
  });
});

describe("generateDiscountCode", () => {
  const seeded = (seed: number) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  it("always produces a valid, uppercase code of 11 characters", () => {
    const next = seeded(7);
    for (let i = 0; i < 500; i += 1) {
      const code = generateDiscountCode((max) => next() % max);
      expect(isValidDiscountCode(code)).toBe(true);
      expect(code).toHaveLength(11);
      expect(code).toBe(code.toUpperCase());
    }
  });
  it("avoids ambiguous characters (0, O, 1, I)", () => {
    for (let r = 0; r < 32; r += 1) expect(generateDiscountCode(() => r).slice(3)).not.toMatch(/[01OI]/);
  });
  it("does not collide in a large sample from a real random source", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) seen.add(generateDiscountCode((max) => Math.floor(Math.random() * max)));
    expect(seen.size).toBe(5000);
  });
});

describe("createDiscountCodeSchema", () => {
  it("accepts a minimal public code and normalises the code", () => {
    const r = createDiscountCodeSchema.parse(valid);
    expect(r).toMatchObject({ code: "WELCOME10", type: "public", percentage: 10 });
    expect(r.ownerUserId).toBeUndefined();
  });
  it("accepts every optional field and treats null like omitted", () => {
    const r = createDiscountCodeSchema.parse({ ...valid, maxDiscountAmount: 50000, minOrderAmount: 100000, usageLimit: 5, expiresAt: "2026-10-07" });
    expect(r).toMatchObject({ maxDiscountAmount: 50000, minOrderAmount: 100000, usageLimit: 5, expiresAt: "2026-10-07" });
    const n = createDiscountCodeSchema.parse({ ...valid, maxDiscountAmount: null, minOrderAmount: null, usageLimit: null, expiresAt: null, ownerUserId: null });
    expect(n.maxDiscountAmount).toBeUndefined();
    expect(n.usageLimit).toBeUndefined();
    expect(n.expiresAt).toBeUndefined();
  });
  it("requires code, type and percentage", () => {
    expect(createDiscountCodeSchema.safeParse({}).success).toBe(false);
    expect(createDiscountCodeSchema.safeParse({ code: "ABC", type: "public" }).success).toBe(false);
    expect(createDiscountCodeSchema.safeParse({ code: "ABC", percentage: 5 }).success).toBe(false);
  });
  it("rejects an unknown type", () => expect(createDiscountCodeSchema.safeParse({ ...valid, type: "vip" }).success).toBe(false));

  describe("owner rules", () => {
    it("a personal code requires an owner", () => expect(msg(createDiscountCodeSchema.safeParse({ ...valid, type: "personal" }))).toContain("مشتری"));
    it("a personal code with a valid owner id passes", () => expect(createDiscountCodeSchema.safeParse({ ...valid, type: "personal", ownerUserId: OWNER }).success).toBe(true));
    it("a malformed owner id is rejected", () => {
      expect(createDiscountCodeSchema.safeParse({ ...valid, type: "personal", ownerUserId: "nope" }).success).toBe(false);
      expect(createDiscountCodeSchema.safeParse({ ...valid, type: "personal", ownerUserId: { $ne: null } }).success).toBe(false);
    });
    it("a public code must not carry an owner", () => expect(createDiscountCodeSchema.safeParse({ ...valid, ownerUserId: OWNER }).success).toBe(false));
  });

  describe("percentage", () => {
    it.each([1, 50, 100])("accepts %s", (p) => expect(createDiscountCodeSchema.safeParse({ ...valid, percentage: p }).success).toBe(true));
    it.each([0, -1, 101, 10.5, 0.5, Number.NaN, Infinity])("rejects %s", (p) => expect(createDiscountCodeSchema.safeParse({ ...valid, percentage: p }).success).toBe(false));
    it("rejects a numeric string (no coercion)", () => expect(createDiscountCodeSchema.safeParse({ ...valid, percentage: "10" }).success).toBe(false));
    it("says decimals are not allowed", () => expect(msg(createDiscountCodeSchema.safeParse({ ...valid, percentage: 10.5 }))).toContain("صحیح"));
  });

  describe("money fields", () => {
    it.each([0.5, 1.5, -1, 0, Number.NaN])("rejects maxDiscountAmount %s", (v) => expect(createDiscountCodeSchema.safeParse({ ...valid, maxDiscountAmount: v }).success).toBe(false));
    it.each([0.5, -1, Number.NaN])("rejects minOrderAmount %s", (v) => expect(createDiscountCodeSchema.safeParse({ ...valid, minOrderAmount: v }).success).toBe(false));
    it("accepts minOrderAmount 0", () => expect(createDiscountCodeSchema.safeParse({ ...valid, minOrderAmount: 0 }).success).toBe(true));
    it("rejects numeric strings", () => expect(createDiscountCodeSchema.safeParse({ ...valid, minOrderAmount: "1000" }).success).toBe(false));
  });

  describe("usageLimit", () => {
    it.each([1, 100])("accepts %s", (v) => expect(createDiscountCodeSchema.safeParse({ ...valid, usageLimit: v }).success).toBe(true));
    it.each([0, -3, 1.5])("rejects %s", (v) => expect(createDiscountCodeSchema.safeParse({ ...valid, usageLimit: v }).success).toBe(false));
    it("omitted means unlimited (stays undefined)", () => expect(createDiscountCodeSchema.parse(valid).usageLimit).toBeUndefined());
  });

  describe("expiresAt", () => {
    it("accepts a real calendar day", () => expect(createDiscountCodeSchema.safeParse({ ...valid, expiresAt: "2024-02-29" }).success).toBe(true));
    it.each(["2026-02-30", "2026-13-01", "1405/07/15", "2026-7-1", "", "tomorrow", "2026-10-07T10:00:00Z"])("rejects %j", (v) =>
      expect(createDiscountCodeSchema.safeParse({ ...valid, expiresAt: v }).success).toBe(false),
    );
  });

  it("never lets the client set usedCount, isActive or status (stripped)", () => {
    const r = createDiscountCodeSchema.parse({ ...valid, usedCount: 99, isActive: false, status: "expired" }) as Record<string, unknown>;
    expect(r).not.toHaveProperty("usedCount");
    expect(r).not.toHaveProperty("isActive");
    expect(r).not.toHaveProperty("status");
  });
});

describe("updateDiscountCodeSchema", () => {
  it("accepts each editable field", () => {
    expect(updateDiscountCodeSchema.parse({ percentage: 20 })).toEqual({ percentage: 20 });
    expect(updateDiscountCodeSchema.parse({ maxDiscountAmount: 1000 })).toEqual({ maxDiscountAmount: 1000 });
    expect(updateDiscountCodeSchema.parse({ minOrderAmount: 0 })).toEqual({ minOrderAmount: 0 });
    expect(updateDiscountCodeSchema.parse({ usageLimit: 3 })).toEqual({ usageLimit: 3 });
    expect(updateDiscountCodeSchema.parse({ expiresAt: "2026-10-07" })).toEqual({ expiresAt: "2026-10-07" });
  });
  it("null clears the optional fields but not percentage/minOrderAmount", () => {
    expect(updateDiscountCodeSchema.parse({ maxDiscountAmount: null, usageLimit: null, expiresAt: null })).toEqual({ maxDiscountAmount: null, usageLimit: null, expiresAt: null });
    expect(updateDiscountCodeSchema.safeParse({ percentage: null }).success).toBe(false);
    expect(updateDiscountCodeSchema.safeParse({ minOrderAmount: null }).success).toBe(false);
  });
  it("requires at least one editable field", () => {
    expect(msg(updateDiscountCodeSchema.safeParse({}))).toContain("حداقل یک فیلد");
  });
  it.each(["code", "type", "ownerUserId", "usedCount", "isActive", "status"])("REJECTS (does not strip) the immutable field %s", (key) => {
    const r = updateDiscountCodeSchema.safeParse({ percentage: 10, [key]: "x" });
    expect(r.success).toBe(false);
    expect(msg(r)).toContain("قابل ویرایش نیست");
  });
  it("rejects unknown keys", () => expect(updateDiscountCodeSchema.safeParse({ percentage: 10, foo: 1 }).success).toBe(false));
  it("applies the same value rules as create", () => {
    expect(updateDiscountCodeSchema.safeParse({ percentage: 0 }).success).toBe(false);
    expect(updateDiscountCodeSchema.safeParse({ percentage: 10.5 }).success).toBe(false);
    expect(updateDiscountCodeSchema.safeParse({ percentage: 101 }).success).toBe(false);
    expect(updateDiscountCodeSchema.safeParse({ maxDiscountAmount: 0 }).success).toBe(false);
    expect(updateDiscountCodeSchema.safeParse({ minOrderAmount: -1 }).success).toBe(false);
    expect(updateDiscountCodeSchema.safeParse({ usageLimit: 0 }).success).toBe(false);
    expect(updateDiscountCodeSchema.safeParse({ expiresAt: "2026-02-30" }).success).toBe(false);
  });
  it("strips nothing it needs and returns only editable keys", () => {
    expect(Object.keys(updateDiscountCodeSchema.parse({ percentage: 5, usageLimit: 2 })).sort()).toEqual(["percentage", "usageLimit"]);
  });
});

describe("discountCodeStatusSchema", () => {
  it("requires a boolean isActive", () => {
    expect(discountCodeStatusSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(discountCodeStatusSchema.safeParse({}).success).toBe(false);
    expect(discountCodeStatusSchema.safeParse({ isActive: "true" }).success).toBe(false);
  });
});

describe("discountCodeListQuerySchema", () => {
  it("applies defaults", () => expect(discountCodeListQuerySchema.parse({})).toEqual({ page: 1, limit: 20, type: "all", status: "all" }));
  it("coerces page/limit and accepts every type and status filter", () => {
    for (const type of DISCOUNT_CODE_TYPE_FILTERS) for (const status of DISCOUNT_CODE_STATUS_FILTERS) {
      expect(discountCodeListQuerySchema.parse({ page: "2", limit: "50", type, status })).toMatchObject({ page: 2, limit: 50, type, status });
    }
  });
  it("lists exactly the approved status and type values", () => {
    expect([...DISCOUNT_CODE_STATUS_FILTERS]).toEqual(["all", "active", "disabled", "exhausted", "expired"]);
    expect([...DISCOUNT_CODE_TYPE_FILTERS]).toEqual(["all", "public", "personal"]);
  });
  it.each([{ limit: "101" }, { limit: "0" }, { page: "0" }, { page: "1.5" }, { type: "vip" }, { status: "deleted" }, { search: "A".repeat(31) }])("rejects %j", (q) =>
    expect(discountCodeListQuerySchema.safeParse(q).success).toBe(false),
  );
  it("search is trimmed, digits normalised, uppercased; blank becomes undefined", () => {
    expect(discountCodeListQuerySchema.parse({ search: "  off۱۲ " }).search).toBe("OFF12");
    expect(discountCodeListQuerySchema.parse({ search: "   " }).search).toBeUndefined();
  });
  it("keeps regex metacharacters as plain text for the service to escape", () => {
    expect(discountCodeListQuerySchema.parse({ search: ".*" }).search).toBe(".*");
  });
});

describe("computeDiscountCodeStatus (priority: exhausted > disabled > expired > active)", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const past = new Date("2026-10-07T11:59:59Z");
  const future = new Date("2026-10-07T12:00:01Z");
  const base = { isActive: true, usedCount: 0 };

  it("active when nothing applies", () => {
    expect(computeDiscountCodeStatus(base, now)).toBe("active");
    expect(computeDiscountCodeStatus({ ...base, usageLimit: 5, usedCount: 4, expiresAt: future }, now)).toBe("active");
  });
  it("unlimited (missing/null usageLimit) is never exhausted", () => {
    expect(computeDiscountCodeStatus({ ...base, usedCount: 9999 }, now)).toBe("active");
    expect(computeDiscountCodeStatus({ ...base, usedCount: 9999, usageLimit: null }, now)).toBe("active");
  });
  it("exhausted when usedCount >= usageLimit", () => {
    expect(computeDiscountCodeStatus({ ...base, usageLimit: 3, usedCount: 3 }, now)).toBe("exhausted");
    expect(computeDiscountCodeStatus({ ...base, usageLimit: 3, usedCount: 4 }, now)).toBe("exhausted");
  });
  it("disabled when isActive is false", () => expect(computeDiscountCodeStatus({ ...base, isActive: false }, now)).toBe("disabled"));
  it("expired only when active and expiresAt is strictly before now", () => {
    expect(computeDiscountCodeStatus({ ...base, expiresAt: past }, now)).toBe("expired");
    expect(computeDiscountCodeStatus({ ...base, expiresAt: now }, now)).toBe("active");
    expect(computeDiscountCodeStatus({ ...base, expiresAt: future }, now)).toBe("active");
    expect(computeDiscountCodeStatus({ ...base, expiresAt: null }, now)).toBe("active");
  });
  it("exhausted beats disabled", () => expect(computeDiscountCodeStatus({ isActive: false, usedCount: 2, usageLimit: 2 }, now)).toBe("exhausted"));
  it("exhausted beats expired", () => expect(computeDiscountCodeStatus({ ...base, usedCount: 2, usageLimit: 2, expiresAt: past }, now)).toBe("exhausted"));
  it("disabled beats expired", () => expect(computeDiscountCodeStatus({ isActive: false, usedCount: 0, expiresAt: past }, now)).toBe("disabled"));
  it("all three at once resolves to exhausted", () => expect(computeDiscountCodeStatus({ isActive: false, usedCount: 5, usageLimit: 5, expiresAt: past }, now)).toBe("exhausted"));
});
