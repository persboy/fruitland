import { describe, expect, it } from "vitest";
import { PRODUCT_UNITS } from "./enums";
import {
  PRODUCT_DUPLICATE_UNIT_MESSAGE,
  PRODUCT_SLUG_MAX_LENGTH,
  PRODUCT_SLUG_PATTERN,
  PRODUCT_UNIT_LABELS,
  createProductSchema,
  normalizePersianText,
  productListQuerySchema,
  productStatusSchema,
  slugWithSuffix,
  slugifyProductName,
  updateProductSchema,
  validateVariantSet,
} from "./product";

const CAT = "64b7f0c2a1b2c3d4e5f60718";
const VID = "64b7f0c2a1b2c3d4e5f60999";
const valid = { name: "سیب قرمز", categoryId: CAT, variants: [{ unit: "kg", price: 50000 }] };
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? "" : r.error!.issues.map((i) => i.message).join("|"));

describe("slugifyProductName (Unicode, no transliteration)", () => {
  it.each([
    ["سیب قرمز", "سیب-قرمز"],
    ["  سیب   قرمز  ", "سیب-قرمز"],
    ["سیب‌زمینی", "سیب-زمینی"], // ZWNJ is a separator
    ["Apple Red", "apple-red"],
    ["سیب ۱۰ کیلویی", "سیب-10-کیلویی"], // Persian digits → ASCII
    ["سیب ١٢", "سیب-12"], // Arabic-Indic digits → ASCII
    ["سيب كوهي", "سیب-کوهی"], // Arabic yeh/kaf → Persian
    ["گوجه (درشت)", "گوجه-درشت"],
    ["موز!!!", "موز"],
    ["---موز---", "موز"],
    ["خیار/سبز", "خیار-سبز"],
    ["سِیب", "سیب"], // diacritic dropped
    ["Cherry تازه", "cherry-تازه"],
  ])("%j → %j", (input, expected) => expect(slugifyProductName(input)).toBe(expected));

  it("returns an empty string when there is no letter or digit", () => {
    expect(slugifyProductName("!!!")).toBe("");
    expect(slugifyProductName("   ")).toBe("");
    expect(slugifyProductName("---")).toBe("");
  });
  it("is deterministic and idempotent on its own output", () => {
    const s = slugifyProductName("سیب‌زمینی ۵ کیلویی");
    expect(slugifyProductName(s)).toBe(s);
  });
  it("is capped and never ends with a hyphen", () => {
    const s = slugifyProductName(`${"الف ".repeat(60)}`);
    expect(s.length).toBeLessThanOrEqual(PRODUCT_SLUG_MAX_LENGTH);
    expect(s.endsWith("-")).toBe(false);
  });
  it("every non-empty result matches the slug pattern", () => {
    for (const n of ["سیب قرمز", "Apple", "سیب‌زمینی ۵", "گوجه (درشت)", "x"]) expect(PRODUCT_SLUG_PATTERN.test(slugifyProductName(n))).toBe(true);
  });
  it("collision suffix is ASCII and numeric", () => {
    expect(slugWithSuffix("سیب", 1)).toBe("سیب");
    expect(slugWithSuffix("سیب", 2)).toBe("سیب-2");
    expect(slugWithSuffix("سیب", 13)).toBe("سیب-13");
    expect(PRODUCT_SLUG_PATTERN.test("سیب-2")).toBe(true);
  });
  it("normalizePersianText converts letters and collapses whitespace", () => expect(normalizePersianText("  سيب\n  كوهي ")).toBe("سیب کوهی"));
});

describe("createProductSchema", () => {
  it("accepts a minimal product", () => {
    const r = createProductSchema.parse(valid);
    expect(r).toMatchObject({ name: "سیب قرمز", categoryId: CAT });
    expect(r.variants).toEqual([{ unit: "kg", price: 50000 }]);
  });
  it("accepts every field", () => {
    const r = createProductSchema.parse({
      ...valid, description: " تازه ", images: ["https://cdn.example.com/a.png"], isOrganic: true, isActive: false, sortOrder: 3,
      variants: [{ unit: "kg", price: 50000, isAvailable: false }, { unit: "box", price: 400000 }],
    });
    expect(r).toMatchObject({ description: "تازه", isOrganic: true, isActive: false, sortOrder: 3 });
    expect(r.variants).toHaveLength(2);
  });
  it("normalises the name (Arabic letters, whitespace)", () => expect(createProductSchema.parse({ ...valid, name: "  سيب   كوهي " }).name).toBe("سیب کوهی"));

  describe("name", () => {
    it.each(["", "   "])("rejects %j", (n) => expect(createProductSchema.safeParse({ ...valid, name: n }).success).toBe(false));
    it("rejects a name with no letter or digit (it could not produce a slug)", () => expect(msg(createProductSchema.safeParse({ ...valid, name: "!!!" }))).toContain("حرف یا عدد"));
    it("rejects over-long names, accepts the limit", () => {
      expect(createProductSchema.safeParse({ ...valid, name: "الف".repeat(34) }).success).toBe(false);
      expect(createProductSchema.safeParse({ ...valid, name: "ا".repeat(100) }).success).toBe(true);
    });
    it("rejects non-strings", () => expect(createProductSchema.safeParse({ ...valid, name: 5 }).success).toBe(false));
  });

  describe("categoryId", () => {
    it.each(["", "nope", "123", { $ne: null }, 5, "64b7f0c2a1b2c3d4e5f6071"])("rejects %j", (c) =>
      expect(createProductSchema.safeParse({ ...valid, categoryId: c }).success).toBe(false));
    it("is required", () => expect(createProductSchema.safeParse({ name: "سیب", variants: valid.variants }).success).toBe(false));
  });

  describe("variants", () => {
    it("rejects an empty list and a missing list", () => {
      expect(msg(createProductSchema.safeParse({ ...valid, variants: [] }))).toContain("حداقل یک واحد");
      expect(createProductSchema.safeParse({ name: "سیب", categoryId: CAT }).success).toBe(false);
    });
    it("rejects duplicate units (kg + kg)", () => {
      const r = createProductSchema.safeParse({ ...valid, variants: [{ unit: "kg", price: 1000 }, { unit: "kg", price: 2000 }] });
      expect(r.success).toBe(false);
      expect(msg(r)).toBe(PRODUCT_DUPLICATE_UNIT_MESSAGE);
    });
    it.each(PRODUCT_UNITS)("accepts the registry unit %s", (unit) => expect(createProductSchema.safeParse({ ...valid, variants: [{ unit, price: 1 }] }).success).toBe(true));
    it.each(["liter", "kg1", "KG", "", null])("rejects unit %j", (unit) => expect(createProductSchema.safeParse({ ...valid, variants: [{ unit, price: 1000 }] }).success).toBe(false));
    it.each([0, -1, -50000, 0.5, 100.5, Number.NaN, Infinity, "1000", null])("rejects price %j", (price) =>
      expect(createProductSchema.safeParse({ ...valid, variants: [{ unit: "kg", price }] }).success).toBe(false));
    it("accepts price 1 (the minimum)", () => expect(createProductSchema.safeParse({ ...valid, variants: [{ unit: "kg", price: 1 }] }).success).toBe(true));
    it("says zero is not allowed", () => expect(msg(createProductSchema.safeParse({ ...valid, variants: [{ unit: "kg", price: 0 }] }))).toContain("حداقل ۱"));
    it("rejects a non-boolean isAvailable", () => expect(createProductSchema.safeParse({ ...valid, variants: [{ unit: "kg", price: 5, isAvailable: "yes" }] }).success).toBe(false));
    it("never carries legacy stock/originalPrice fields", () => {
      const r = createProductSchema.parse({ ...valid, variants: [{ unit: "kg", price: 5, stockQty: 9, originalPrice: 10, id: VID }] });
      expect(r.variants[0]).toEqual({ unit: "kg", price: 5 });
    });
  });

  it("strips slug, usedCount-style and legacy fields (never trusted)", () => {
    const r = createProductSchema.parse({ ...valid, slug: "evil", emoji: "🍎", stockQty: 5, originalPrice: 9, origin: "x", reviewAttributes: ["a"], id: "x", createdAt: "x" }) as Record<string, unknown>;
    for (const k of ["slug", "emoji", "stockQty", "originalPrice", "origin", "reviewAttributes", "id", "createdAt"]) expect(r).not.toHaveProperty(k);
  });
  it("validates description, images, sortOrder", () => {
    expect(createProductSchema.safeParse({ ...valid, description: "ا".repeat(2001) }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, images: ["javascript:alert(1)"] }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, images: ["/relative.png"] }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, images: ["x".repeat(501)] }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, images: Array.from({ length: 11 }, () => "https://a.example/x.png") }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, images: "https://a.example/x.png" }).success).toBe(false);
    for (const s of [-1, 1.5, "3"]) expect(createProductSchema.safeParse({ ...valid, sortOrder: s }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, sortOrder: 0 }).success).toBe(true);
  });
  it("rejects non-boolean flags", () => {
    expect(createProductSchema.safeParse({ ...valid, isOrganic: "true" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, isActive: 1 }).success).toBe(false);
  });
});

describe("updateProductSchema", () => {
  it("accepts each editable field alone", () => {
    expect(updateProductSchema.parse({ name: "گلابی" })).toEqual({ name: "گلابی" });
    expect(updateProductSchema.parse({ categoryId: CAT })).toEqual({ categoryId: CAT });
    expect(updateProductSchema.parse({ description: "" })).toEqual({ description: "" });
    expect(updateProductSchema.parse({ images: [] })).toEqual({ images: [] });
    expect(updateProductSchema.parse({ isOrganic: true })).toEqual({ isOrganic: true });
    expect(updateProductSchema.parse({ sortOrder: 4 })).toEqual({ sortOrder: 4 });
  });
  it("requires at least one editable field", () => expect(msg(updateProductSchema.safeParse({}))).toContain("حداقل یک فیلد"));
  it.each(["slug", "isActive", "id", "_id", "createdAt", "updatedAt", "category"])("REJECTS (does not strip) %s", (key) => {
    const r = updateProductSchema.safeParse({ name: "گلابی", [key]: "x" });
    expect(r.success).toBe(false);
    expect(msg(r)).toContain("قابل ویرایش نیست");
  });
  it.each(["stockQty", "originalPrice", "emoji", "origin", "harvestSeason", "storageInstructions", "isBestSeller", "isNew", "isSeasonal", "reviewAttributes", "image"])(
    "rejects the legacy field %s as invalid", (key) => expect(updateProductSchema.safeParse({ name: "گلابی", [key]: 1 }).success).toBe(false));
  it("applies the same value rules", () => {
    expect(updateProductSchema.safeParse({ name: "" }).success).toBe(false);
    expect(updateProductSchema.safeParse({ categoryId: "x" }).success).toBe(false);
    expect(updateProductSchema.safeParse({ sortOrder: -1 }).success).toBe(false);
  });

  describe("variants (complete list; ids preserved)", () => {
    it("accepts existing (by id), partially-specified existing, and new entries", () => {
      const r = updateProductSchema.parse({
        variants: [{ id: VID, price: 60000 }, { id: CAT, isAvailable: false }, { unit: "box", price: 400000 }],
      });
      expect(r.variants).toEqual([{ id: VID, price: 60000 }, { id: CAT, isAvailable: false }, { unit: "box", price: 400000 }]);
    });
    it("a NEW entry (no id) requires unit and price", () => {
      expect(updateProductSchema.safeParse({ variants: [{ price: 5 }] }).success).toBe(false);
      expect(updateProductSchema.safeParse({ variants: [{ unit: "kg" }] }).success).toBe(false);
      expect(updateProductSchema.safeParse({ variants: [{ isAvailable: true }] }).success).toBe(false);
    });
    it("rejects malformed variant ids", () => {
      for (const id of ["x", "123", "", { $ne: 1 }, 5]) expect(updateProductSchema.safeParse({ variants: [{ id, price: 5 }] }).success).toBe(false);
    });
    it("rejects duplicate units among the submitted entries", () => {
      expect(msg(updateProductSchema.safeParse({ variants: [{ unit: "kg", price: 5 }, { unit: "kg", price: 6 }] }))).toBe(PRODUCT_DUPLICATE_UNIT_MESSAGE);
      expect(updateProductSchema.safeParse({ variants: [{ id: VID, unit: "box" }, { unit: "box", price: 5 }] }).success).toBe(false);
    });
    it("rejects the same id twice", () => expect(updateProductSchema.safeParse({ variants: [{ id: VID, price: 5 }, { id: VID.toUpperCase(), price: 6 }] }).success).toBe(false));
    it("rejects an empty list, zero/negative/fractional prices, unknown units", () => {
      expect(updateProductSchema.safeParse({ variants: [] }).success).toBe(false);
      for (const price of [0, -5, 1.5]) expect(updateProductSchema.safeParse({ variants: [{ id: VID, price }] }).success).toBe(false);
      expect(updateProductSchema.safeParse({ variants: [{ id: VID, unit: "liter" }] }).success).toBe(false);
    });
    it("legacy variant keys are stripped (no stock/originalPrice survive)", () => {
      const r = updateProductSchema.parse({ variants: [{ id: VID, price: 5, stockQty: 1, originalPrice: 9 }] });
      expect(r.variants![0]).toEqual({ id: VID, price: 5 });
    });
  });
});

describe("validateVariantSet (final merged list)", () => {
  it("accepts a valid list", () => expect(validateVariantSet([{ unit: "kg", price: 1 }, { unit: "box", price: 9 }])).toBeNull());
  it("rejects empty, duplicate, zero, negative, fractional, unknown", () => {
    expect(validateVariantSet([])).toContain("حداقل یک");
    expect(validateVariantSet([{ unit: "kg", price: 5 }, { unit: "kg", price: 6 }])).toBe(PRODUCT_DUPLICATE_UNIT_MESSAGE);
    expect(validateVariantSet([{ unit: "kg", price: 0 }])).toContain("حداقل ۱");
    expect(validateVariantSet([{ unit: "kg", price: -3 }])).toContain("حداقل ۱");
    expect(validateVariantSet([{ unit: "kg", price: 2.5 }])).toContain("حداقل ۱");
    expect(validateVariantSet([{ unit: "liter", price: 5 }])).toContain("نامعتبر");
  });
});

describe("productStatusSchema", () => {
  it("requires a boolean isActive", () => {
    expect(productStatusSchema.parse({ isActive: false })).toEqual({ isActive: false });
    for (const b of [{}, { isActive: "true" }, { isActive: 1 }, { isActive: null }]) expect(productStatusSchema.safeParse(b).success).toBe(false);
  });
});

describe("productListQuerySchema", () => {
  it("applies defaults (limit 20) and leaves filters undefined", () => expect(productListQuerySchema.parse({})).toEqual({ page: 1, limit: 20 }));
  it("coerces page/limit and parses filters", () => {
    expect(productListQuerySchema.parse({ page: "2", limit: "50", categoryId: CAT, isActive: "false", isOrganic: "true", search: "سیب" })).toEqual({
      page: 2, limit: 50, categoryId: CAT, isActive: false, isOrganic: true, search: "سیب",
    });
  });
  it.each([{ limit: "101" }, { limit: "0" }, { page: "0" }, { page: "1.5" }, { categoryId: "x" }, { isActive: "yes" }, { isOrganic: "1" }, { search: "a".repeat(101) }])("rejects %j", (q) =>
    expect(productListQuerySchema.safeParse(q).success).toBe(false));
  it("accepts the limit maximum of 100", () => expect(productListQuerySchema.parse({ limit: "100" }).limit).toBe(100));
  it("search is normalised: Persian digits → ASCII, Arabic letters → Persian, lowercased; blank → undefined", () => {
    expect(productListQuerySchema.parse({ search: "  سيب ۱۰ APPLE " }).search).toBe("سیب 10 apple");
    expect(productListQuerySchema.parse({ search: "   " }).search).toBeUndefined();
  });
  it("keeps regex metacharacters as text for the service to escape", () => expect(productListQuerySchema.parse({ search: ".*(" }).search).toBe(".*("));
});

describe("PRODUCT_UNIT_LABELS", () => it("has a Persian label for every registry unit and nothing else", () => expect(Object.keys(PRODUCT_UNIT_LABELS).sort()).toEqual([...PRODUCT_UNITS].sort())));
