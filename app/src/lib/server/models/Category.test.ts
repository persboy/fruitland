import { describe, expect, it } from "vitest";
import { Category } from "./Category";

describe("Category schema", () => {
  it("requires name and slug", () => {
    const doc = new Category({});
    const err = doc.validateSync();
    expect(err?.errors.name).toBeDefined();
    expect(err?.errors.slug).toBeDefined();
  });

  it("lowercases the slug", () => {
    const doc = new Category({ name: "میوه", slug: "FRUIT" });
    expect(doc.slug).toBe("fruit");
  });

  it("defaults isActive to true and sortOrder to 0", () => {
    const doc = new Category({ name: "میوه", slug: "fruit" });
    expect(doc.isActive).toBe(true);
    expect(doc.sortOrder).toBe(0);
    expect(doc.validateSync()).toBeUndefined();
  });
});
