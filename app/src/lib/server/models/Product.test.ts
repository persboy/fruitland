import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Product } from "./Product";

const categoryId = new Types.ObjectId();

describe("Product schema", () => {
  it("requires at least one variant", () => {
    const doc = new Product({ name: "سیب", slug: "apple", categoryId, variants: [] });
    const err = doc.validateSync();
    expect(err?.errors.variants).toBeDefined();
  });

  it("requires categoryId", () => {
    const doc = new Product({
      name: "سیب",
      slug: "apple",
      variants: [{ unit: "kg", price: 50000 }],
    });
    const err = doc.validateSync();
    expect(err?.errors.categoryId).toBeDefined();
  });

  it("rejects a non-integer (float) price as an invalid Toman value", () => {
    const doc = new Product({
      name: "سیب",
      slug: "apple",
      categoryId,
      variants: [{ unit: "kg", price: 50000.5 }],
    });
    const err = doc.validateSync();
    expect(err?.errors["variants.0.price"]).toBeDefined();
  });

  it("rejects an unknown unit", () => {
    const doc = new Product({
      name: "سیب",
      slug: "apple",
      categoryId,
      variants: [{ unit: "liter", price: 50000 }],
    });
    const err = doc.validateSync();
    expect(err?.errors["variants.0.unit"]).toBeDefined();
  });

  it("accepts a valid product with one variant", () => {
    const doc = new Product({
      name: "سیب",
      slug: "apple",
      categoryId,
      variants: [{ unit: "kg", price: 50000 }],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.isOrganic).toBe(false);
    expect(doc.variants[0]?.isAvailable).toBe(true);
  });
});
