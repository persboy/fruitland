import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";
import { AuditLog } from "../models/AuditLog";
import { Category } from "../models/Category";
import { createCategory, listCategories, setCategoryActive, updateCategory } from "./categoryService";

/**
 * Real-MongoDB tests for the Category admin service (needs a downloadable
 * mongod via mongodb-memory-server; run with `npm run test:integration`).
 * They prove what mocks cannot: the UNIQUE index really rejects duplicates —
 * including two concurrent creates — and the real sort/audit behaviour.
 */
describe("categoryService (integration, real MongoDB)", () => {
  const actor = new Types.ObjectId().toString();

  beforeAll(async () => {
    await startTestDb();
    await Category.init(); // build the unique slug index before any write
  }, 120_000);
  afterAll(stopTestDb);
  afterEach(clearTestDb);

  it("creates active, lists in sortOrder → name order, and audits creation", async () => {
    await createCategory(actor, { name: "ب", slug: "b", sortOrder: 2 });
    await createCategory(actor, { name: "ج", slug: "c", sortOrder: 1 });
    await createCategory(actor, { name: "الف", slug: "a", sortOrder: 1 });
    const list = await listCategories();
    expect(list.map((c) => c.slug)).toEqual(["a", "c", "b"]);
    expect(list.every((c) => c.isActive)).toBe(true);
    expect(await AuditLog.countDocuments({ action: "category.created", entityType: "Category" })).toBe(3);
  });

  it("duplicate slug on create → CATEGORY_SLUG_TAKEN and exactly one row", async () => {
    await createCategory(actor, { name: "میوه", slug: "fruit" });
    await expect(createCategory(actor, { name: "دیگر", slug: "fruit" })).rejects.toMatchObject({ code: "CATEGORY_SLUG_TAKEN", status: 409 });
    expect(await Category.countDocuments({})).toBe(1);
    expect(await AuditLog.countDocuments({})).toBe(1);
  });

  it("two CONCURRENT creates with the same slug: exactly one wins, the other gets CATEGORY_SLUG_TAKEN (the index, not a pre-check, decides)", async () => {
    const results = await Promise.allSettled([
      createCategory(actor, { name: "الف", slug: "same" }),
      createCategory(actor, { name: "ب", slug: "same" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "CATEGORY_SLUG_TAKEN", status: 409 });
    expect(await Category.countDocuments({ slug: "same" })).toBe(1);
  });

  it("update: edits only given fields, clears icon, audits before/after; duplicate slug on update is rejected and nothing changes", async () => {
    const a = await createCategory(actor, { name: "الف", slug: "a", icon: "🍎", sortOrder: 1 });
    await createCategory(actor, { name: "ب", slug: "b" });
    const updated = await updateCategory(actor, a.id, { name: "الف۲", icon: "", sortOrder: 7 });
    expect(updated).toMatchObject({ name: "الف۲", slug: "a", icon: null, sortOrder: 7, isActive: true });
    const audit = await AuditLog.findOne({ action: "category.updated" }).lean();
    expect(audit?.before).toMatchObject({ name: "الف", icon: "🍎", sortOrder: 1 });
    expect(audit?.after).toMatchObject({ name: "الف۲", icon: null, sortOrder: 7 });

    await expect(updateCategory(actor, a.id, { slug: "b" })).rejects.toMatchObject({ code: "CATEGORY_SLUG_TAKEN", status: 409 });
    expect((await Category.findById(a.id))!.slug).toBe("a");
    expect(await AuditLog.countDocuments({ action: "category.updated" })).toBe(1);
  });

  it("update/status of a missing or malformed id → CATEGORY_NOT_FOUND", async () => {
    await expect(updateCategory(actor, new Types.ObjectId().toString(), { name: "x" })).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND", status: 404 });
    await expect(setCategoryActive(actor, "nope", false)).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND", status: 404 });
  });

  it("deactivate → activate round-trip is audited; repeating the same state writes and audits nothing; hard delete does not exist", async () => {
    const c = await createCategory(actor, { name: "الف", slug: "a" });
    expect((await setCategoryActive(actor, c.id, false)).isActive).toBe(false);
    expect((await setCategoryActive(actor, c.id, false)).isActive).toBe(false); // no-op
    expect((await setCategoryActive(actor, c.id, true)).isActive).toBe(true);
    const actions = (await AuditLog.find({ entityId: new Types.ObjectId(c.id), action: /activated$/ }).sort({ createdAt: 1 }).lean()).map((a) => a.action);
    expect(actions).toEqual(["category.deactivated", "category.activated"]);
    const service = await import("./categoryService");
    expect(Object.keys(service).some((k) => /delete|remove/i.test(k))).toBe(false);
  });

  it("two concurrent deactivations produce exactly one audit entry", async () => {
    const c = await createCategory(actor, { name: "الف", slug: "a" });
    await Promise.all([setCategoryActive(actor, c.id, false), setCategoryActive(actor, c.id, false)]);
    expect(await AuditLog.countDocuments({ action: "category.deactivated" })).toBe(1);
    expect((await Category.findById(c.id))!.isActive).toBe(false);
  });
});
