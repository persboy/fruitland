import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../errors/AppError";

const m = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  findOneAndUpdate: vi.fn(),
  findById: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("../models/Category", () => ({
  Category: { find: m.find, create: m.create, findOneAndUpdate: m.findOneAndUpdate, findById: m.findById },
}));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));

import { createCategory, listCategories, setCategoryActive, updateCategory } from "./categoryService";

const actor = new Types.ObjectId().toString();
const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v) });
const rec = (over: Partial<Record<string, unknown>> = {}) => ({
  _id: new Types.ObjectId(),
  name: "میوه",
  slug: "fruit",
  icon: "🍎",
  sortOrder: 1,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  ...over,
});
const dupKey = () => Object.assign(new Error("E11000 duplicate key collection: x index: slug_1 dup key"), { code: 11000 });
const expectAppError = async (p: Promise<unknown>, code: string, status: number) =>
  expect(p).rejects.toMatchObject({ name: "AppError", code, status });

beforeEach(() => {
  vi.resetAllMocks();
  m.auditCreate.mockResolvedValue({});
});

describe("listCategories", () => {
  it("sorts deterministically (sortOrder, name, _id) and maps to DTOs (id, icon null, ISO dates, no internals)", async () => {
    const sort = vi.fn().mockReturnValue(lean([rec({ icon: undefined }), rec({ name: "سبزی", slug: "veg", isActive: false })]));
    m.find.mockReturnValue({ sort });
    const out = await listCategories();
    expect(sort).toHaveBeenCalledWith({ sortOrder: 1, name: 1, _id: 1 });
    expect(m.find).toHaveBeenCalledWith({}); // active AND inactive
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      name: "میوه", slug: "fruit", icon: null, sortOrder: 1, isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(Object.keys(out[1]!).sort()).toEqual(["createdAt", "icon", "id", "isActive", "name", "slug", "sortOrder", "updatedAt"]);
    expect(m.auditCreate).not.toHaveBeenCalled(); // reads are not audited
  });
});

describe("createCategory", () => {
  it("creates active (never from client input), writes only validated fields, and audits with the actor", async () => {
    const created = rec();
    m.create.mockResolvedValue(created);
    const dto = await createCategory(actor, { name: "میوه", slug: "fruit", icon: "🍎", sortOrder: 1, isActive: false, role: "x" } as never);
    expect(m.create).toHaveBeenCalledWith({ name: "میوه", slug: "fruit", icon: "🍎", sortOrder: 1 });
    expect(m.create.mock.calls[0]![0]).not.toHaveProperty("isActive");
    expect(dto).toMatchObject({ id: created._id.toString(), slug: "fruit", isActive: true });
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "category.created", entityType: "Category", entityId: created._id,
      before: null, after: { name: "میوه", slug: "fruit", icon: "🍎", sortOrder: 1, isActive: true },
    });
  });

  it("omits icon/sortOrder when not provided (model defaults apply)", async () => {
    m.create.mockResolvedValue(rec({ icon: undefined, sortOrder: 0 }));
    await createCategory(actor, { name: "n", slug: "s" });
    expect(m.create).toHaveBeenCalledWith({ name: "n", slug: "s" });
  });

  it("duplicate slug (E11000) → 409 CATEGORY_SLUG_TAKEN, no raw Mongo error, no audit", async () => {
    m.create.mockRejectedValue(dupKey());
    const p = createCategory(actor, { name: "n", slug: "s" });
    await expectAppError(p, "CATEGORY_SLUG_TAKEN", 409);
    await expect(createCategory(actor, { name: "n", slug: "s" })).rejects.not.toThrow(/E11000/);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("unexpected database errors propagate untouched (the route turns them into a generic 500)", async () => {
    const boom = new Error("connection lost");
    m.create.mockRejectedValue(boom);
    await expect(createCategory(actor, { name: "n", slug: "s" })).rejects.toBe(boom);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("updateCategory", () => {
  it("applies only the given fields with $set, audits before/after, and returns the fresh DTO", async () => {
    const before = rec();
    m.findOneAndUpdate.mockReturnValue(lean(before));
    m.findById.mockReturnValue(lean(rec({ _id: before._id, name: "میوه‌ها", sortOrder: 5 })));
    const dto = await updateCategory(actor, before._id.toString(), { name: "میوه‌ها", sortOrder: 5 });
    const [filter, update, options] = m.findOneAndUpdate.mock.calls[0]!;
    expect(filter).toEqual({ _id: before._id });
    expect(update).toEqual({ $set: { name: "میوه‌ها", sortOrder: 5 } });
    expect(options).toMatchObject({ new: false, runValidators: true });
    expect(dto).toMatchObject({ name: "میوه‌ها", sortOrder: 5 });
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "category.updated", entityType: "Category", entityId: before._id,
      before: { name: "میوه", slug: "fruit", icon: "🍎", sortOrder: 1, isActive: true },
      after: { name: "میوه‌ها", slug: "fruit", icon: "🍎", sortOrder: 5, isActive: true },
    });
  });

  it("an empty icon clears it with $unset (not an empty string)", async () => {
    const before = rec();
    m.findOneAndUpdate.mockReturnValue(lean(before));
    m.findById.mockReturnValue(lean(rec({ _id: before._id, icon: undefined })));
    const dto = await updateCategory(actor, before._id.toString(), { icon: "" });
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toEqual({ $unset: { icon: 1 } });
    expect(dto.icon).toBeNull();
    expect(m.auditCreate.mock.calls[0]![0].after.icon).toBeNull();
  });

  it("protected fields cannot be written: isActive/_id/timestamps never reach the update, even if passed to the service", async () => {
    const before = rec();
    m.findOneAndUpdate.mockReturnValue(lean(before));
    m.findById.mockReturnValue(lean(before));
    await updateCategory(actor, before._id.toString(), { name: "x", isActive: false, _id: "1", createdAt: "x", updatedAt: "x", $inc: { sortOrder: 1 } } as never);
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toEqual({ $set: { name: "x" } });
  });

  it("not found → 404 CATEGORY_NOT_FOUND, no audit", async () => {
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await expectAppError(updateCategory(actor, new Types.ObjectId().toString(), { name: "x" }), "CATEGORY_NOT_FOUND", 404);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("malformed id → 404 CATEGORY_NOT_FOUND without touching the database", async () => {
    await expectAppError(updateCategory(actor, "not-an-id", { name: "x" }), "CATEGORY_NOT_FOUND", 404);
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("slug changed to another category's slug (E11000 on update) → 409 CATEGORY_SLUG_TAKEN, no audit", async () => {
    m.findOneAndUpdate.mockImplementation(() => ({ lean: () => Promise.reject(dupKey()) }));
    await expectAppError(updateCategory(actor, new Types.ObjectId().toString(), { slug: "taken" }), "CATEGORY_SLUG_TAKEN", 409);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("setCategoryActive", () => {
  it("deactivates an active category with a conditional write and audits category.deactivated", async () => {
    const cur = rec({ isActive: true });
    m.findById.mockReturnValueOnce(lean(cur)).mockReturnValueOnce(lean({ ...cur, isActive: false }));
    m.findOneAndUpdate.mockReturnValue(lean(cur));
    const dto = await setCategoryActive(actor, cur._id.toString(), false);
    expect(m.findOneAndUpdate).toHaveBeenCalledWith({ _id: cur._id, isActive: true }, { $set: { isActive: false } }, { new: false });
    expect(dto.isActive).toBe(false);
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "category.deactivated", entityType: "Category", entityId: cur._id,
      before: { isActive: true }, after: { isActive: false },
    });
  });

  it("activates an inactive category and audits category.activated", async () => {
    const cur = rec({ isActive: false });
    m.findById.mockReturnValueOnce(lean(cur)).mockReturnValueOnce(lean({ ...cur, isActive: true }));
    m.findOneAndUpdate.mockReturnValue(lean(cur));
    await setCategoryActive(actor, cur._id.toString(), true);
    expect(m.findOneAndUpdate.mock.calls[0]![0]).toEqual({ _id: cur._id, isActive: false });
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action: "category.activated", before: { isActive: false }, after: { isActive: true } });
  });

  it("already in the requested state → success, no write, no audit", async () => {
    const cur = rec({ isActive: true });
    m.findById.mockReturnValue(lean(cur));
    const dto = await setCategoryActive(actor, cur._id.toString(), true);
    expect(dto.isActive).toBe(true);
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("lost a race (conditional write matched nothing because another request already flipped it) → no duplicate audit", async () => {
    const cur = rec({ isActive: true });
    m.findById.mockReturnValueOnce(lean(cur)).mockReturnValueOnce(lean({ ...cur, isActive: false }));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    const dto = await setCategoryActive(actor, cur._id.toString(), false);
    expect(dto.isActive).toBe(false);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("not found / malformed id → 404 CATEGORY_NOT_FOUND (never a silent success)", async () => {
    m.findById.mockReturnValue(lean(null));
    await expectAppError(setCategoryActive(actor, new Types.ObjectId().toString(), false), "CATEGORY_NOT_FOUND", 404);
    await expectAppError(setCategoryActive(actor, "zzz", false), "CATEGORY_NOT_FOUND", 404);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

it("AppError is the error type thrown for expected failures", () => {
  expect(AppError.notFound("x")).toBeInstanceOf(AppError);
});
