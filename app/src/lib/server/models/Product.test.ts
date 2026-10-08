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

  it("rejects an invalid (non-ObjectId) categoryId", () => {
    const doc = new Product({ name: "سیب", slug: "apple", categoryId: "not-an-id", variants: [{ unit: "kg", price: 50000 }] });
    expect(doc.validateSync()?.errors.categoryId).toBeDefined();
  });

  it("rejects duplicate units within one product", () => {
    const doc = new Product({
      name: "سیب",
      slug: "apple",
      categoryId,
      variants: [{ unit: "kg", price: 50000 }, { unit: "kg", price: 60000 }],
    });
    expect(doc.validateSync()?.errors.variants).toBeDefined();
  });

  it("accepts different units in one product", () => {
    const doc = new Product({
      name: "سیب",
      slug: "apple",
      categoryId,
      variants: [{ unit: "kg", price: 50000 }, { unit: "box", price: 400000 }],
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it.each([0, -1, -50000])("rejects price %s (zero and negatives are not allowed)", (price) => {
    const doc = new Product({ name: "سیب", slug: "apple", categoryId, variants: [{ unit: "kg", price }] });
    expect(doc.validateSync()?.errors["variants.0.price"]).toBeDefined();
  });

  it("accepts the minimum price of 1 Toman", () => {
    const doc = new Product({ name: "سیب", slug: "apple", categoryId, variants: [{ unit: "kg", price: 1 }] });
    expect(doc.validateSync()).toBeUndefined();
  });

  it("gives every variant its own stable _id and keeps Persian slugs as given (lowercased)", () => {
    const doc = new Product({
      name: "سیب",
      slug: "سیب-قرمز-2",
      categoryId,
      variants: [{ unit: "kg", price: 50000 }, { unit: "box", price: 400000 }],
    });
    expect(doc.slug).toBe("سیب-قرمز-2");
    expect(doc.variants[0]!._id.toString()).not.toBe(doc.variants[1]!._id.toString());
  });

  it("has no stock, originalPrice or legacy fields in the schema", () => {
    const paths = Object.keys(Product.schema.paths);
    for (const legacy of ["stockQty", "originalPrice", "emoji", "origin", "harvestSeason", "storageInstructions", "reviewAttributes", "isBestSeller", "isNew", "isSeasonal"]) {
      expect(paths.some((p) => p.includes(legacy))).toBe(false);
    }
  });
});
