import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";
import { AuditLog } from "../models/AuditLog";
import { Category } from "../models/Category";
import { Product } from "../models/Product";
import { createProduct, getProduct, listProducts, setProductActive, updateProduct } from "./productService";

/**
 * Real-MongoDB tests for the Products admin service (a standalone mongod is enough — every write is a single-document
 * atomic operation). Run with `npm run test:integration`.
 */
describe("products (integration, real MongoDB)", () => {
  const actor = new Types.ObjectId().toString();
  let n = 0;
  const category = (over: Record<string, unknown> = {}) => Category.create({ name: `دسته ${++n}`, slug: `cat-${n}`, ...over });
  const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, ...over });
  const input = (categoryId: string, over: Record<string, unknown> = {}) => ({ name: "سیب قرمز", categoryId, variants: [{ unit: "kg" as const, price: 50000 }], ...over });

  beforeAll(async () => {
    await startTestDb();
    await Product.init(); // build the unique slug index before any write
    await Category.init();
  }, 120_000);
  afterAll(stopTestDb);
  afterEach(clearTestDb);

  it("has the unique slug index plus the existing category/active and text indexes — nothing new", async () => {
    const keys = (await Product.collection.indexes()).map((i) => JSON.stringify(i.key));
    expect(keys).toContain(JSON.stringify({ slug: 1 }));
    expect(keys).toContain(JSON.stringify({ categoryId: 1, isActive: 1 }));
    expect(keys).toHaveLength(4); // _id, slug, categoryId+isActive, text(name)
    expect((await Product.collection.indexes()).find((i) => i.key.slug === 1)?.unique).toBe(true);
  });

  describe("create", () => {
    it("creates with defaults and a server-generated Persian slug", async () => {
      const c = await category();
      const p = await createProduct(actor, input(c._id.toString()));
      expect(p).toMatchObject({ name: "سیب قرمز", slug: "سیب-قرمز", isActive: true, isOrganic: false, sortOrder: 0, description: null, images: [] });
      expect(p.category).toEqual({ id: c._id.toString(), name: c.name, isActive: true });
      expect(p.variants).toHaveLength(1);
      expect(p.variants[0]).toMatchObject({ unit: "kg", price: 50000, isAvailable: true });
      expect(Types.ObjectId.isValid(p.variants[0]!.id)).toBe(true);
    });

    it("rejects an inactive or nonexistent category and writes nothing", async () => {
      const off = await category({ isActive: false });
      await expect(createProduct(actor, input(off._id.toString()))).rejects.toMatchObject({ status: 400, code: "PRODUCT_CATEGORY_INVALID" });
      await expect(createProduct(actor, input(new Types.ObjectId().toString()))).rejects.toMatchObject({ code: "PRODUCT_CATEGORY_INVALID" });
      expect(await Product.countDocuments()).toBe(0);
      expect(await AuditLog.countDocuments({ action: "product.created" })).toBe(0);
    });

    it("slug collisions get -2, -3… and never overwrite another product's slug", async () => {
      const c = await category();
      const a = await createProduct(actor, input(c._id.toString()));
      const b = await createProduct(actor, input(c._id.toString()));
      const d = await createProduct(actor, input(c._id.toString()));
      expect([a.slug, b.slug, d.slug]).toEqual(["سیب-قرمز", "سیب-قرمز-2", "سیب-قرمز-3"]);
      expect((await getProduct(a.id)).slug).toBe("سیب-قرمز");
    });

    it("concurrent creates of the same name all succeed with distinct slugs (unique index + retry)", async () => {
      const c = await category();
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => createProduct(actor, input(c._id.toString()))));
      const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createProduct>>> => r.status === "fulfilled");
      expect(new Set(ok.map((r) => r.value.slug)).size).toBe(ok.length);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      for (const r of results.filter((r) => r.status === "rejected")) expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: "PRODUCT_SLUG_CONFLICT" });
      expect(await Product.countDocuments()).toBe(ok.length);
    });

    it("the model backstops duplicate units and zero price even without the service validation", async () => {
      const c = await category();
      await expect(Product.create({ name: "x", slug: "x1", categoryId: c._id, variants: [{ unit: "kg", price: 1 }, { unit: "kg", price: 2 }] })).rejects.toThrow();
      await expect(Product.create({ name: "x", slug: "x2", categoryId: c._id, variants: [{ unit: "kg", price: 0 }] })).rejects.toThrow();
    });

    it("writes one product.created audit entry", async () => {
      const c = await category();
      const p = await createProduct(actor, input(c._id.toString()));
      const log = await AuditLog.findOne({ action: "product.created" }).lean();
      expect(log).toMatchObject({ entityType: "Product", entityId: new Types.ObjectId(p.id), before: null });
    });
  });

  describe("update", () => {
    it("PRESERVES existing variant _ids and mints one only for the new variant (real Mongo)", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString(), { variants: [{ unit: "kg", price: 50000 }, { unit: "box", price: 400000 }] }));
      const [A, B] = created.variants;
      const out = await updateProduct(actor, created.id, { variants: [{ id: A!.id, price: 55000 }, { id: B!.id }, { unit: "bundle", price: 9000 }] });
      expect(out.variants.map((v) => v.id).slice(0, 2)).toEqual([A!.id, B!.id]);
      expect(out.variants[2]!.id).not.toBe(A!.id);
      expect(out.variants[2]!.id).not.toBe(B!.id);
      expect(out.variants.map((v) => [v.unit, v.price])).toEqual([["kg", 55000], ["box", 400000], ["bundle", 9000]]);
      // and it is what is actually stored
      const raw = await Product.collection.findOne({ _id: new Types.ObjectId(created.id) });
      expect((raw!.variants as { _id: Types.ObjectId }[]).slice(0, 2).map((v) => v._id.toString())).toEqual([A!.id, B!.id]);
    });

    it("repeated edits keep the ids stable", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString()));
      const original = created.variants[0]!.id;
      for (const price of [60000, 61000, 62000]) {
        const out = await updateProduct(actor, created.id, { variants: [{ id: original, price }] });
        expect(out.variants[0]!.id).toBe(original);
      }
    });

    it("disables a variant via isAvailable=false and never removes one", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString(), { variants: [{ unit: "kg", price: 5 }, { unit: "box", price: 9 }] }));
      const [A, B] = created.variants;
      const out = await updateProduct(actor, created.id, { variants: [{ id: A!.id, isAvailable: false }, { id: B!.id }] });
      expect(out.variants.map((v) => v.isAvailable)).toEqual([false, true]);
      await expect(updateProduct(actor, created.id, { variants: [{ id: A!.id }] })).rejects.toMatchObject({ code: "PRODUCT_VARIANT_REMOVAL_NOT_ALLOWED" });
      expect((await getProduct(created.id)).variants).toHaveLength(2);
    });

    it("rejects duplicate units, foreign variant ids and zero prices; nothing changes", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString()));
      const A = created.variants[0]!;
      await expect(updateProduct(actor, created.id, { variants: [{ id: A.id }, { unit: "kg", price: 5 }] })).rejects.toMatchObject({ code: "PRODUCT_VARIANTS_INVALID" });
      await expect(updateProduct(actor, created.id, { variants: [{ id: A.id }, { id: new Types.ObjectId().toString(), price: 5 }] })).rejects.toMatchObject({ code: "PRODUCT_VARIANT_NOT_FOUND" });
      await expect(updateProduct(actor, created.id, { variants: [{ id: A.id, price: 0 }] })).rejects.toMatchObject({ code: "PRODUCT_VARIANTS_INVALID" });
      expect((await getProduct(created.id)).variants).toEqual(created.variants);
      expect(await AuditLog.countDocuments({ action: "product.updated" })).toBe(0);
    });

    it("category: moving to an active one works; inactive/nonexistent is rejected; an unchanged inactive category does not block other edits", async () => {
      const a = await category();
      const b = await category();
      const off = await category({ isActive: false });
      const created = await createProduct(actor, input(a._id.toString()));
      expect((await updateProduct(actor, created.id, { categoryId: b._id.toString() })).category?.id).toBe(b._id.toString());
      await expect(updateProduct(actor, created.id, { categoryId: off._id.toString() })).rejects.toMatchObject({ code: "PRODUCT_CATEGORY_INVALID" });
      await expect(updateProduct(actor, created.id, { categoryId: new Types.ObjectId().toString() })).rejects.toMatchObject({ code: "PRODUCT_CATEGORY_INVALID" });
      expect((await getProduct(created.id)).category?.id).toBe(b._id.toString());
      // the category goes inactive later: the product is untouched and still editable
      await Category.updateOne({ _id: b._id }, { $set: { isActive: false } });
      const after = await updateProduct(actor, created.id, { categoryId: b._id.toString(), sortOrder: 4 });
      expect(after).toMatchObject({ sortOrder: 4, isActive: true });
      expect(after.category).toMatchObject({ id: b._id.toString(), isActive: false });
    });

    it("the slug never changes on rename and is not writable", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString()));
      const renamed = await updateProduct(actor, created.id, { name: "گلابی" });
      expect(renamed).toMatchObject({ name: "گلابی", slug: "سیب-قرمز" });
    });

    it("description '' clears it for real ($unset)", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString(), { description: "تازه" }));
      expect((await updateProduct(actor, created.id, { description: "" })).description).toBeNull();
      expect(await Product.collection.findOne({ _id: new Types.ObjectId(created.id) })).not.toHaveProperty("description");
    });

    it("an unchanged request writes nothing and audits nothing", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString()));
      const before = await Product.collection.findOne({ _id: new Types.ObjectId(created.id) });
      await updateProduct(actor, created.id, { name: created.name, sortOrder: 0, variants: [{ id: created.variants[0]!.id }] });
      expect((await Product.collection.findOne({ _id: new Types.ObjectId(created.id) }))!.updatedAt).toEqual(before!.updatedAt);
      expect(await AuditLog.countDocuments({ action: "product.updated" })).toBe(0);
    });

    it("optimistic concurrency: of two racing edits at least one lands, none is silently lost, the loser is a 409", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString()));
      const results = await Promise.allSettled([
        updateProduct(actor, created.id, { sortOrder: 1 }),
        updateProduct(actor, created.id, { sortOrder: 2 }),
        updateProduct(actor, created.id, { sortOrder: 3 }),
      ]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      for (const r of results.filter((r) => r.status === "rejected")) expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: "PRODUCT_CONCURRENT_UPDATE" });
      const landed = results.filter((r) => r.status === "fulfilled").length;
      expect(await AuditLog.countDocuments({ action: "product.updated" })).toBe(landed);
    });

    it("404 for unknown and malformed ids", async () => {
      await expect(updateProduct(actor, new Types.ObjectId().toString(), { sortOrder: 1 })).rejects.toMatchObject({ status: 404 });
      await expect(updateProduct(actor, "nope", { sortOrder: 1 })).rejects.toMatchObject({ status: 404 });
    });

    it("audit records before/after of the editable fields with variant ids", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString()));
      await updateProduct(actor, created.id, { name: "گلابی", variants: [{ id: created.variants[0]!.id, price: 70000 }] });
      const log = await AuditLog.findOne({ action: "product.updated" }).lean();
      expect(log!.before).toMatchObject({ name: "سیب قرمز" });
      expect(log!.after).toMatchObject({ name: "گلابی" });
      expect((log!.after as { variants: { id: string; price: number }[] }).variants[0]).toMatchObject({ id: created.variants[0]!.id, price: 70000 });
    });
  });

  describe("status", () => {
    it("deactivates/reactivates touching only isActive, with one audit entry per real change", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString(), { variants: [{ unit: "kg", price: 5, isAvailable: false }] }));
      const raw = () => Product.collection.findOne({ _id: new Types.ObjectId(created.id) });
      const before = await raw();
      expect((await setProductActive(actor, created.id, false)).isActive).toBe(false);
      await setProductActive(actor, created.id, false); // no-op
      expect((await setProductActive(actor, created.id, true)).isActive).toBe(true);
      await setProductActive(actor, created.id, true); // no-op
      const after = await raw();
      expect({ ...after, updatedAt: before!.updatedAt }).toEqual({ ...before });
      expect((await getProduct(created.id)).variants[0]!.isAvailable).toBe(false); // variant availability untouched
      expect(await AuditLog.countDocuments({ action: "product.deactivated" })).toBe(1);
      expect(await AuditLog.countDocuments({ action: "product.activated" })).toBe(1);
    });

    it("racing identical requests produce a single audit entry", async () => {
      const c = await category();
      const created = await createProduct(actor, input(c._id.toString()));
      await Promise.all(Array.from({ length: 8 }, () => setProductActive(actor, created.id, false)));
      expect(await AuditLog.countDocuments({ action: "product.deactivated" })).toBe(1);
    });

    it("404 for an unknown id", async () => {
      await expect(setProductActive(actor, new Types.ObjectId().toString(), true)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("list", () => {
    it("orders by sortOrder, name, _id and paginates for real (no overlap, correct totals, out-of-range page empty)", async () => {
      const c = await category();
      for (const [name, sortOrder] of [["ج", 1], ["الف", 1], ["ب", 0], ["پ", 2], ["ت", 2]] as const) await createProduct(actor, input(c._id.toString(), { name, sortOrder }));
      const pages = await Promise.all([1, 2, 3, 4].map((page) => listProducts(q({ limit: 2, page }))));
      const names = pages.slice(0, 3).flatMap((p) => p.items.map((i) => i.name));
      expect(names).toEqual(["ب", "الف", "ج", "پ", "ت"]);
      expect(pages[0]!.pagination).toEqual({ page: 1, pageSize: 2, total: 5 });
      expect(pages[3]!.items).toEqual([]);
    });

    it("filters by category, active and organic (including false) and combines them", async () => {
      const a = await category();
      const b = await category();
      await createProduct(actor, input(a._id.toString(), { name: "یک", isOrganic: true }));
      await createProduct(actor, input(a._id.toString(), { name: "دو", isActive: false }));
      await createProduct(actor, input(b._id.toString(), { name: "سه" }));
      expect((await listProducts(q({ categoryId: a._id.toString() }))).items.map((i) => i.name).sort()).toEqual(["دو", "یک"].sort());
      expect((await listProducts(q({ isActive: false }))).items.map((i) => i.name)).toEqual(["دو"]);
      expect((await listProducts(q({ isActive: true }))).pagination.total).toBe(2);
      expect((await listProducts(q({ isOrganic: true }))).items.map((i) => i.name)).toEqual(["یک"]);
      expect((await listProducts(q({ isOrganic: false }))).pagination.total).toBe(2);
      expect((await listProducts(q({ categoryId: a._id.toString(), isActive: true, isOrganic: true }))).items.map((i) => i.name)).toEqual(["یک"]);
    });

    it("search matches name or slug case-insensitively and treats regex metacharacters literally", async () => {
      const c = await category();
      await createProduct(actor, input(c._id.toString(), { name: "Apple Red" }));
      await createProduct(actor, input(c._id.toString(), { name: "سیب‌زمینی" }));
      await createProduct(actor, input(c._id.toString(), { name: "موز" }));
      expect((await listProducts(q({ search: "apple" }))).items.map((i) => i.name)).toEqual(["Apple Red"]);
      expect((await listProducts(q({ search: "سیب" }))).items.map((i) => i.name)).toEqual(["سیب‌زمینی"]);
      expect((await listProducts(q({ search: "apple-red" }))).items.map((i) => i.name)).toEqual(["Apple Red"]); // by slug
      for (const s of [".", ".*", "(", "[a-z]", "a|b", "$"]) expect((await listProducts(q({ search: s }))).items).toEqual([]);
    });

    it("lists inactive categories' products as they are", async () => {
      const off = await category({ isActive: false });
      await createProduct(actor, input((await category())._id.toString()));
      await Product.create({ name: "قدیمی", slug: "old", categoryId: off._id, variants: [{ unit: "kg", price: 1 }] });
      const out = await listProducts(q());
      expect(out.items.find((i) => i.name === "قدیمی")?.category).toMatchObject({ isActive: false });
    });
  });

  it("never exposes legacy or internal fields", async () => {
    const c = await category();
    const p = await createProduct(actor, input(c._id.toString()));
    expect(JSON.stringify(p)).not.toMatch(/__v|stockQty|originalPrice|emoji|_id/);
    expect(Object.keys(p.variants[0]!).sort()).toEqual(["id", "isAvailable", "price", "unit"]);
  });
});
