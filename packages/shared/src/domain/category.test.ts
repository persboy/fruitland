import { describe, expect, it } from "vitest";
import { categoryStatusSchema, createCategorySchema, updateCategorySchema } from "./category";

describe("createCategorySchema", () => {
  it("accepts a minimal valid category, trimming and lowercasing the slug", () => {
    const r = createCategorySchema.parse({ name: "  میوه ", slug: "  Fresh-Fruit " });
    expect(r).toEqual({ name: "میوه", slug: "fresh-fruit" });
  });

  it("accepts icon (emoji) and sortOrder", () => {
    expect(createCategorySchema.parse({ name: "میوه", slug: "fruit", icon: "🍎", sortOrder: 3 })).toMatchObject({ icon: "🍎", sortOrder: 3 });
  });

  it("rejects missing/blank name and slug", () => {
    expect(createCategorySchema.safeParse({ slug: "a" }).success).toBe(false);
    expect(createCategorySchema.safeParse({ name: "   ", slug: "a" }).success).toBe(false);
    expect(createCategorySchema.safeParse({ name: "x" }).success).toBe(false);
    expect(createCategorySchema.safeParse({ name: "x", slug: "  " }).success).toBe(false);
  });

  it.each(["a b", "a_b", "-a", "a-", "a--b", "میوه", "a/b", "a.b"])("rejects malformed slug %j", (slug) => {
    expect(createCategorySchema.safeParse({ name: "x", slug }).success).toBe(false);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null])("rejects invalid sortOrder %j", (sortOrder) => {
    expect(createCategorySchema.safeParse({ name: "x", slug: "a", sortOrder }).success).toBe(false);
  });

  it("rejects over-long fields", () => {
    expect(createCategorySchema.safeParse({ name: "x".repeat(51), slug: "a" }).success).toBe(false);
    expect(createCategorySchema.safeParse({ name: "x", slug: "a".repeat(61) }).success).toBe(false);
    expect(createCategorySchema.safeParse({ name: "x", slug: "a", icon: "x".repeat(17) }).success).toBe(false);
  });

  it("strips protected/unknown keys (isActive, _id, timestamps, arbitrary fields) instead of passing them on", () => {
    const r = createCategorySchema.parse({ name: "x", slug: "a", isActive: false, _id: "1", createdAt: "x", $set: { a: 1 }, role: "admin" });
    expect(r).toEqual({ name: "x", slug: "a" });
  });
});

describe("updateCategorySchema", () => {
  it("accepts a partial update and strips protected keys", () => {
    expect(updateCategorySchema.parse({ sortOrder: 0, isActive: false, _id: "1" })).toEqual({ sortOrder: 0 });
  });

  it("allows an empty icon string (meaning: clear the icon)", () => {
    expect(updateCategorySchema.parse({ icon: "" })).toEqual({ icon: "" });
  });

  it("requires at least one editable field", () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
    expect(updateCategorySchema.safeParse({ isActive: true }).success).toBe(false);
  });

  it("applies the same field rules as create", () => {
    expect(updateCategorySchema.safeParse({ slug: "Bad Slug" }).success).toBe(false);
    expect(updateCategorySchema.safeParse({ name: "" }).success).toBe(false);
    expect(updateCategorySchema.safeParse({ sortOrder: -2 }).success).toBe(false);
  });
});

describe("categoryStatusSchema", () => {
  it("requires a boolean isActive", () => {
    expect(categoryStatusSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(categoryStatusSchema.safeParse({}).success).toBe(false);
    expect(categoryStatusSchema.safeParse({ isActive: "false" }).success).toBe(false);
    expect(categoryStatusSchema.safeParse({ isActive: 0 }).success).toBe(false);
  });
});
